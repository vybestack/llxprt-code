/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import os from 'node:os';
import type { SandboxConfig } from '@vybestack/llxprt-code-core';
import { FatalSandboxError } from '@vybestack/llxprt-code-core';
import { debugLogger } from '@vybestack/llxprt-code-telemetry';
import type { CredentialProxyBridgeResult } from './sandbox-ssh.js';
import {
  setupCredentialProxyDockerMacOS,
  SSH_TUNNEL_POLL_TIMEOUT_MS,
} from './sandbox-ssh.js';
import {
  containerMountSources,
  createHostOnlyCapabilityEnvFile,
  runCapabilityCleanupStep,
} from './sandbox-capability.js';
import { setupCredentialProxyPodmanMacOS } from './sandbox-podman.js';
import {
  createAndStartProxy,
  getProxyCapabilityToken,
  getProxySocketPath,
  stopProxy,
} from '@vybestack/llxprt-code-providers/auth.js';
import {
  cleanupCredentialSocketRuntime,
  createCredentialSocketRuntime,
} from './sandbox-credential-runtime.js';

/** Composes cleanup callbacks and surfaces failures after attempting each one. */
function composeCleanups(
  a: (() => void) | undefined,
  b: (() => void) | undefined,
  c: (() => void) | undefined,
): (() => void) | undefined {
  if (a === undefined && b === undefined && c === undefined) return undefined;
  return () => {
    const errors: unknown[] = [];
    runCapabilityCleanupStep(() => a?.(), errors);
    runCapabilityCleanupStep(() => b?.(), errors);
    runCapabilityCleanupStep(() => c?.(), errors);
    if (errors.length > 0) {
      throw new AggregateError(errors, 'Credential proxy cleanup failed');
    }
  };
}

/** Sets up the macOS credential proxy bridge based on container command. */
async function setupMacOSCredProxyBridge(
  args: string[],
  config: SandboxConfig,
  socketPath: string,
  reservedTunnelPorts: Set<number>,
): Promise<CredentialProxyBridgeResult | undefined> {
  switch (config.command) {
    case 'podman':
      return setupCredentialProxyPodmanMacOS(
        args,
        socketPath,
        SSH_TUNNEL_POLL_TIMEOUT_MS,
        {
          reserveTunnelPort: (port: number) => {
            reservedTunnelPorts.add(port);
          },
          excludedTunnelPorts: reservedTunnelPorts,
        },
      );
    case 'docker':
      return setupCredentialProxyDockerMacOS(args, socketPath);
    case 'sandbox-exec':
    default:
      return undefined;
  }
}

/** Starts credential proxy and sets up bridge for Podman/Docker macOS. */
async function failOnMissingSocketPath(
  sessionTmpdirCleanup: () => void,
): Promise<Error> {
  const invariantError = new FatalSandboxError(
    'Credential proxy started but did not produce a socket path',
  );
  const errors: unknown[] = [invariantError];
  try {
    await stopProxy();
  } catch (stopErr) {
    errors.push(stopErr);
  }
  runCapabilityCleanupStep(sessionTmpdirCleanup, errors);
  return errors.length === 1
    ? invariantError
    : new AggregateError(errors, 'Credential proxy setup failed');
}

function throwCredentialProxySetupError(
  error: unknown,
  sessionTmpdirCleanup: () => void,
  errors: unknown[] = [error],
): never {
  runCapabilityCleanupStep(sessionTmpdirCleanup, errors);
  throw errors.length === 1
    ? error
    : new AggregateError(errors, 'Credential proxy setup failed');
}

function assertSupportedCredentialNetwork(config: SandboxConfig): void {
  const networkMode =
    process.env.LLXPRT_SANDBOX_NETWORK ?? process.env.SANDBOX_NETWORK;
  if (
    os.platform() === 'darwin' &&
    (config.command === 'docker' || config.command === 'podman') &&
    networkMode === 'off'
  ) {
    throw new FatalSandboxError(
      'macOS credential bridge requires container networking; enable networking or use Linux for network-off sandboxing.',
    );
  }
}

/**
 * Milliseconds after the sandbox process spawns that the capability env
 * file is deleted even when no sandbox handshake ever arrives (#3524). A
 * sandbox that never requests credentials never handshakes; without this
 * bound its env file would live until session exit — exactly the path that
 * does not run under SIGKILL, `tmux kill-session`, an OOM kill or a crash.
 * The bound errs long on purpose: deleting late only widens the window in
 * which the token is exposed, while deleting early breaks the launch,
 * because a remote or VM-backed runtime may not have read --env-file yet.
 * Ten minutes is ~20x the proxy-sidecar readiness budget and still bounds
 * exposure far below a session's lifetime.
 */
const CAPABILITY_ENV_FILE_FALLBACK_MS = 10 * 60 * 1000;

/**
 * #3524: the credential proxy, its socket, and its capability token are
 * process-wide, so a sandbox handshake carries no launch identity. At most
 * one launch may hold a live capability env file: a second launch's
 * handshake would be attributed to the first launch's release holder and
 * could delete the wrong launch's env file mid-launch.
 */
let capabilityEnvFileLaunchActive = false;

/**
 * Claims the single active capability env-file launch slot or throws. The
 * claim is a synchronous check-and-set, so of two concurrent callers only
 * one can hold it; the other fails before creating a bridge or env file
 * whose handshake could be attributed to the wrong launch.
 */
function claimCapabilityEnvFileLaunch(): void {
  if (capabilityEnvFileLaunchActive) {
    throw new FatalSandboxError(
      'Concurrent sandbox launches in one process are not supported by the capability transport: the credential proxy, its socket, and its capability token are process-wide, so a sandbox handshake cannot be attributed to a specific launch and could delete the env file of the wrong launch. Run the active launch cleanup before starting another sandbox.',
    );
  }
  capabilityEnvFileLaunchActive = true;
}

/**
 * Bridge cleanup returned by setupCredentialProxy. When a capability env
 * file exists the cleanup also carries armCapabilityEnvFileFallback so the
 * post-spawn wiring (wireCleanupHandlers) can start the no-handshake
 * release countdown without widening every launch-path signature (#3524).
 */
export interface CredentialProxyBridgeCleanup {
  /** Runs the composed bridge and env-file cleanup (idempotent). */
  (): void;
  /** Starts the bounded no-handshake env-file release countdown. */
  armCapabilityEnvFileFallback?(): void;
}

/**
 * Mutable holder for the capability env-file cleanup (#3524). The proxy
 * handshake callback is registered before the env file exists, so it reads
 * the holder at fire time rather than capturing the cleanup eagerly.
 * Handshake, fallback expiry, and the composed exit cleanup all go through
 * release(), so every deletion path clears the holder and cancels the
 * fallback timer. Handshake delivery is at-least-once: the first release
 * runs the cleanup and clears the holder; every later one is a no-op.
 * Early release (handshake, fallback expiry) passes bestEffort=true because
 * both fire in contexts that must not throw; the exit-time composed cleanup
 * calls release() strict and still surfaces filesystem failures.
 */
interface CapabilityEnvFileRelease {
  release: (bestEffort?: boolean) => void;
  adopt: (cleanup: () => void) => void;
  armFallback: () => void;
}

function createCapabilityEnvFileRelease(): CapabilityEnvFileRelease {
  let held: (() => void) | undefined;
  let fallbackTimer: ReturnType<typeof setTimeout> | undefined;
  // bestEffort is the early-release mode: the handshake callback fires on
  // the proxy's frame-processing path (a throw there surfaces as a
  // connection error and destroys that sandbox's credential connection)
  // and the fallback fires from a timer (a throw there is an unhandled
  // exception). A failed unlink is OS-level variance, so early release
  // logs the failure instead of throwing. The default stays strict: the
  // exit-time composed cleanup must still surface cleanup failures.
  const release = (bestEffort = false): void => {
    const cleanup = held;
    if (cleanup === undefined) return;
    held = undefined;
    if (fallbackTimer !== undefined) {
      clearTimeout(fallbackTimer);
      fallbackTimer = undefined;
    }
    try {
      cleanup();
    } catch (err) {
      if (!bestEffort) throw err;
      debugLogger.error('Early capability env-file release failed:', err);
    }
  };
  return {
    release,
    adopt: (cleanup: () => void): void => {
      held = cleanup;
    },
    armFallback: (): void => {
      if (held === undefined || fallbackTimer !== undefined) return;
      // Best-effort release: a throw from this timer callback would be an
      // unhandled exception, so expiry logs filesystem failures (#3524).
      const onExpire = (): void => release(true);
      fallbackTimer = setTimeout(onExpire, CAPABILITY_ENV_FILE_FALLBACK_MS);
      // Unref so the fallback can never hold the process open.
      fallbackTimer.unref();
    },
  };
}

/**
 * Composes the bridge cleanup and the env-file release and, when an env
 * file exists, exposes armCapabilityEnvFileFallback on the result so
 * wireCleanupHandlers can start the no-handshake release countdown once the
 * sandbox process has spawned (#3524). The exit-time cleanup stays
 * registered as the backstop; early deletion only makes it a no-op. The
 * env-file leg is release() itself — the same path the handshake and the
 * fallback take — so running the composed cleanup also cancels the armed
 * fallback timer and ends the single-active-launch claim.
 */
function composeArmableBridgeCleanup(
  bridgeCleanup: (() => void) | undefined,
  envFileRelease: CapabilityEnvFileRelease,
  sessionTmpdirCleanup: () => void,
): CredentialProxyBridgeCleanup {
  const launchTeardown = (): void => {
    capabilityEnvFileLaunchActive = false;
    // release is always a function, so the composed cleanup always exists;
    // the optional call only satisfies composeCleanups' union return type.
    composeCleanups(
      bridgeCleanup,
      envFileRelease.release,
      sessionTmpdirCleanup,
    )?.();
  };
  return Object.assign(launchTeardown, {
    armCapabilityEnvFileFallback: envFileRelease.armFallback,
  });
}

async function startCredentialProxyForSandbox(
  config: SandboxConfig,
  socketRuntimePath: string,
  sessionTmpdirCleanup: () => void,
  onSandboxHandshake: () => void,
): Promise<string> {
  try {
    assertSupportedCredentialNetwork(config);
  } catch (error) {
    throwCredentialProxySetupError(error, sessionTmpdirCleanup);
  }
  try {
    await createAndStartProxy({
      socketPath: socketRuntimePath,
      onSandboxHandshake,
    });
  } catch (error) {
    throwCredentialProxySetupError(
      new FatalSandboxError(
        `Failed to start credential proxy: ${error instanceof Error ? error.message : String(error)}`,
      ),
      sessionTmpdirCleanup,
    );
  }
  const socketPath = getProxySocketPath();
  if (socketPath === undefined) {
    throw await failOnMissingSocketPath(sessionTmpdirCleanup);
  }
  return socketPath;
}

export async function setupCredentialProxy(
  args: string[],
  config: SandboxConfig,
  sessionTmpdir: string,
  reservedTunnelPorts: Set<number>,
  entrypointPrefixes: string[],
): Promise<{
  credentialProxyBridgeResult: CredentialProxyBridgeResult | undefined;
  credentialProxyBridgeCleanup: CredentialProxyBridgeCleanup | undefined;
}> {
  const socketRuntime = createCredentialSocketRuntime(config, sessionTmpdir);
  const sessionTmpdirCleanup = (): void =>
    cleanupCredentialSocketRuntime(socketRuntime, sessionTmpdir);
  const envFileRelease = createCapabilityEnvFileRelease();

  // @plan:PLAN-20250214-CREDPROXY.P34 R25.1: Start credential proxy BEFORE spawning container
  let socketPath: string;
  try {
    socketPath = await startCredentialProxyForSandbox(
      config,
      socketRuntime.path,
      sessionTmpdirCleanup,
      // bestEffort: the handshake fires on the proxy's frame-processing path,
      // where a throw would destroy this sandbox's credential connection.
      () => envFileRelease.release(true),
    );
  } catch (error) {
    throwCredentialProxySetupError(error, sessionTmpdirCleanup);
  }

  // #3524: claim the single-launch slot before any bridge or env-file side
  // effects. A losing concurrent launch cleans up only its own socket runtime;
  // it must not stop the process-wide proxy owned by the active launch.
  try {
    claimCapabilityEnvFileLaunch();
  } catch (error) {
    throwCredentialProxySetupError(error, sessionTmpdirCleanup);
  }

  let credentialProxyBridgeResult: CredentialProxyBridgeResult | undefined;
  let credentialProxyBridgeCleanup: (() => void) | undefined;
  // @plan:PLAN-20250214-CREDPROXY.P34 R3.6: Pass socket path to container via env var
  const isDarwin = os.platform() === 'darwin';
  try {
    if (isDarwin) {
      credentialProxyBridgeResult = await setupMacOSCredProxyBridge(
        args,
        config,
        socketPath,
        reservedTunnelPorts,
      );
    }
    const effectiveSocketPath =
      credentialProxyBridgeResult?.containerSocketPath ?? socketPath;
    args.push('--env', `LLXPRT_CREDENTIAL_SOCKET=${effectiveSocketPath}`);

    if (credentialProxyBridgeResult !== undefined && isDarwin) {
      credentialProxyBridgeCleanup = credentialProxyBridgeResult.cleanup;
      const prefix = credentialProxyBridgeResult.entrypointPrefix;
      if (prefix !== undefined) entrypointPrefixes.push(prefix);
    }
    // @plan project-plans/issue-1954-sandbox-hardening.md (AC1): host-only env file.
    const envFileResult = createHostOnlyCapabilityEnvFile(
      getProxyCapabilityToken(),
      containerMountSources(args),
    );
    if (envFileResult !== undefined) {
      args.push(...envFileResult.args);
      envFileRelease.adopt(envFileResult.cleanup);
    }
  } catch (err) {
    capabilityEnvFileLaunchActive = false;
    const errors: unknown[] = [err];
    runCapabilityCleanupStep(() => envFileRelease.release(), errors);
    runCapabilityCleanupStep(() => credentialProxyBridgeCleanup?.(), errors);
    try {
      await stopProxy();
    } catch (stopErr) {
      errors.push(stopErr);
    }
    throwCredentialProxySetupError(err, sessionTmpdirCleanup, errors);
  }

  return {
    credentialProxyBridgeResult,
    credentialProxyBridgeCleanup: composeArmableBridgeCleanup(
      credentialProxyBridgeCleanup,
      envFileRelease,
      sessionTmpdirCleanup,
    ),
  };
}
