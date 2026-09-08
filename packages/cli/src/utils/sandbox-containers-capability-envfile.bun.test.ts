/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for the capability env-file early release on the launch
 * path (issue #3524). The env file that delivers LLXPRT_CAPABILITY_TOKEN via
 * --env-file must be deleted as soon as a sandbox handshake proves the token
 * reached the container, with a bounded no-handshake fallback after the
 * sandbox process spawns. Only the credential-proxy module boundary is
 * mocked; env-file creation, cleanup composition, and the wiring are real.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { debugLogger } from '@vybestack/llxprt-code-telemetry';
import {
  setupCredentialProxy,
  wireCleanupHandlers,
} from './sandbox-containers.js';

const authMocks = {
  createAndStartProxy: vi.fn(
    (_config: { socketPath: string; onSandboxHandshake?: () => void }) =>
      Promise.resolve({ stop: () => {} }),
  ),
  getProxySocketPath: vi.fn((): string | undefined => undefined),
  stopProxy: vi.fn((): Promise<void> => Promise.resolve()),
  getProxyCapabilityToken: vi.fn((): string | undefined => undefined),
};

void vi.mock('@vybestack/llxprt-code-providers/auth.js', () => ({
  createAndStartProxy: authMocks.createAndStartProxy,
  getProxySocketPath: authMocks.getProxySocketPath,
  stopProxy: authMocks.stopProxy,
  getProxyCapabilityToken: authMocks.getProxyCapabilityToken,
}));

const CAPABILITY_TOKEN = 'b'.repeat(64);
// Pinned to the production CAPABILITY_ENV_FILE_FALLBACK_MS so the fallback
// tests drive time by the real bound the launch path arms.
const FALLBACK_BOUND_MS = 10 * 60 * 1000;
const NO_SSH = {
  tunnelProcess: undefined,
  cleanup: undefined,
  entrypointPrefix: undefined,
} as const;

interface LaunchedCredentialProxy {
  readonly handshake: () => void;
  readonly exitCleanup: () => void;
  readonly envFilePath: string;
  readonly envFileDir: string;
}

/**
 * Narrows a setTimeout result captured through a spy to a timer handle. A
 * mock result's value is typed unknown (a result can also carry a thrown
 * error), so the handle must be certified by checking the Timer surface.
 */
function isTimer(value: unknown): value is NodeJS.Timeout {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  if (!('ref' in value) || typeof value.ref !== 'function') {
    return false;
  }
  if (!('unref' in value) || typeof value.unref !== 'function') {
    return false;
  }
  if (!('hasRef' in value) || typeof value.hasRef !== 'function') {
    return false;
  }
  return 'refresh' in value && typeof value.refresh === 'function';
}

describe('#3524 capability env-file early release', () => {
  let environmentSnapshot: NodeJS.ProcessEnv;
  let tmpDir = '';
  let isolatedHome = '';
  let capabilityRuntimeRoot = '';
  let sessionTmpdir = '';
  let sandboxStandin: ChildProcess | undefined;
  let activeLaunchCleanup: (() => void) | undefined;

  beforeEach(() => {
    environmentSnapshot = { ...process.env };
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-envfile-3524-'));
    isolatedHome = path.join(tmpDir, 'home');
    capabilityRuntimeRoot = path.join(tmpDir, 'runtime');
    sessionTmpdir = path.join(tmpDir, 'session');
    fs.mkdirSync(isolatedHome);
    fs.mkdirSync(capabilityRuntimeRoot);
    fs.mkdirSync(sessionTmpdir);
    process.env.HOME = isolatedHome;
    process.env.USERPROFILE = isolatedHome;
    process.env.XDG_RUNTIME_DIR = capabilityRuntimeRoot;
    // Isolate both the current runtime-root location and the legacy home
    // location inspected during orphan reclamation.
    vi.spyOn(os, 'homedir').mockReturnValue(isolatedHome);
    // Linux skips the macOS SSH bridge entirely; the proxy env var and env
    // file are the only launch-path side effects under test.
    vi.spyOn(os, 'platform').mockReturnValue('linux');
    authMocks.getProxySocketPath.mockReturnValue(
      path.join(tmpDir, 'credential-proxy.sock'),
    );
    authMocks.getProxyCapabilityToken.mockReturnValue(CAPABILITY_TOKEN);
    authMocks.createAndStartProxy.mockClear();
    authMocks.stopProxy.mockResolvedValue(undefined);
  });

  afterEach(() => {
    // Fully tear down the still-active launch so the single-launch claim
    // is released for the next test (#3524).
    activeLaunchCleanup?.();
    activeLaunchCleanup = undefined;
    for (const artifact of capabilityArtifacts(capabilityRuntimeRoot)) {
      fs.rmSync(path.join(capabilityRuntimeRoot, artifact), {
        recursive: true,
        force: true,
      });
    }
    sandboxStandin?.kill();
    vi.restoreAllMocks();
    process.env = environmentSnapshot;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function capabilityArtifacts(runtimeRoot: string): string[] {
    return fs
      .readdirSync(runtimeRoot)
      .filter((entry) => entry.startsWith('llxprt-code-cap-'));
  }

  /** Real child process standing in for the spawned sandbox container. */
  function spawnSandboxStandin(): ChildProcess {
    const standin = spawn(process.execPath, [
      '-e',
      'setTimeout(() => {}, 60000)',
    ]);
    standin.unref();
    sandboxStandin = standin;
    return standin;
  }

  async function launchCredentialProxy(): Promise<LaunchedCredentialProxy> {
    const args: string[] = [];
    const result = await setupCredentialProxy(
      args,
      { command: 'docker', image: 'test' },
      sessionTmpdir,
      new Set<number>(),
      [],
    );
    activeLaunchCleanup = result.credentialProxyBridgeCleanup;
    const flagIndex = args.indexOf('--env-file');
    const envFilePath = flagIndex === -1 ? undefined : args[flagIndex + 1];
    if (
      envFilePath === undefined ||
      result.credentialProxyBridgeCleanup === undefined
    ) {
      throw new Error('setupCredentialProxy produced no capability env file');
    }
    // mock.calls[0] is the argument tuple of the first call; the single
    // config object is its first element.
    const launched = authMocks.createAndStartProxy.mock.calls[0][0];
    const handshake = launched.onSandboxHandshake;
    if (typeof handshake !== 'function') {
      throw new Error(
        'setupCredentialProxy did not register onSandboxHandshake',
      );
    }
    return {
      handshake,
      exitCleanup: result.credentialProxyBridgeCleanup,
      envFilePath,
      envFileDir: path.dirname(envFilePath),
    };
  }

  it('removes the capability env file and its directory when the sandbox handshake fires', async () => {
    const launched = await launchCredentialProxy();
    expect(fs.existsSync(launched.envFilePath)).toBe(true);
    expect(fs.existsSync(launched.envFileDir)).toBe(true);

    launched.handshake();

    expect(fs.existsSync(launched.envFilePath)).toBe(false);
    expect(fs.existsSync(launched.envFileDir)).toBe(false);
  });

  it('treats a second handshake after the holder is cleared as a no-op (at-least-once delivery)', async () => {
    const launched = await launchCredentialProxy();
    launched.handshake();

    expect(() => launched.handshake()).not.toThrow();

    expect(fs.existsSync(launched.envFilePath)).toBe(false);
  });

  it('keeps the composed exit cleanup as a non-throwing backstop after early deletion', async () => {
    const launched = await launchCredentialProxy();
    launched.handshake();

    expect(() => launched.exitCleanup()).not.toThrow();

    expect(capabilityArtifacts(capabilityRuntimeRoot)).toStrictEqual([]);
  });

  it('removes the env file via the bounded fallback when no handshake ever arrives', async () => {
    vi.useFakeTimers();
    try {
      const launched = await launchCredentialProxy();
      wireCleanupHandlers(
        spawnSandboxStandin(),
        undefined,
        NO_SSH,
        undefined,
        launched.exitCleanup,
        () => {},
      );
      expect(fs.existsSync(launched.envFilePath)).toBe(true);

      vi.advanceTimersByTime(FALLBACK_BOUND_MS);

      expect(fs.existsSync(launched.envFilePath)).toBe(false);
      expect(fs.existsSync(launched.envFileDir)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('unrefs the fallback timer so it cannot hold the process open', async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    try {
      const launched = await launchCredentialProxy();
      wireCleanupHandlers(
        spawnSandboxStandin(),
        undefined,
        NO_SSH,
        undefined,
        launched.exitCleanup,
        () => {},
      );

      // Select the fallback timer by its delay: an unrelated timer may
      // legitimately be scheduled in the observed region. Every spy result
      // has a same-index call, so the delay is read from the paired call.
      const fallbackTimers = setTimeoutSpy.mock.results.flatMap(
        (result, index) => {
          const delay = setTimeoutSpy.mock.calls[index][1];
          return delay === FALLBACK_BOUND_MS && isTimer(result.value)
            ? [result.value]
            : [];
        },
      );
      expect(fallbackTimers).toHaveLength(1);
      for (const timer of fallbackTimers) {
        expect(timer.hasRef()).toBe(false);
        clearTimeout(timer);
      }
    } finally {
      setTimeoutSpy.mockRestore();
    }
  });

  it('fails fast on a second launch while one capability env file launch is active', async () => {
    const first = await launchCredentialProxy();
    const artifactsAfterFirst = capabilityArtifacts(capabilityRuntimeRoot);
    expect(artifactsAfterFirst).toHaveLength(1);

    await expect(launchCredentialProxy()).rejects.toThrow(
      /not supported by the capability transport/,
    );

    expect(capabilityArtifacts(capabilityRuntimeRoot)).toStrictEqual(
      artifactsAfterFirst,
    );
    expect(fs.existsSync(first.envFilePath)).toBe(true);
  });

  it('arms no fallback timer during setup: time advanced before wiring deletes nothing', async () => {
    vi.useFakeTimers();
    try {
      const launched = await launchCredentialProxy();

      vi.advanceTimersByTime(FALLBACK_BOUND_MS);

      expect(fs.existsSync(launched.envFilePath)).toBe(true);

      wireCleanupHandlers(
        spawnSandboxStandin(),
        undefined,
        NO_SSH,
        undefined,
        launched.exitCleanup,
        () => {},
      );
      vi.advanceTimersByTime(FALLBACK_BOUND_MS);
      expect(fs.existsSync(launched.envFilePath)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels the armed fallback timer when the composed exit cleanup runs', async () => {
    vi.useFakeTimers();
    try {
      const launched = await launchCredentialProxy();
      wireCleanupHandlers(
        spawnSandboxStandin(),
        undefined,
        NO_SSH,
        undefined,
        launched.exitCleanup,
        () => {},
      );

      launched.exitCleanup();

      expect(fs.existsSync(launched.envFileDir)).toBe(false);
      expect(vi.getTimerCount()).toBe(0);

      vi.advanceTimersByTime(FALLBACK_BOUND_MS);

      expect(fs.existsSync(launched.envFileDir)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  /**
   * Drops write permission on the host-only directory so the REAL cleanup's
   * unlink fails (EACCES/EPERM — non-idempotent, unlike ENOENT/EBADF). This
   * is a genuine OS-level filesystem failure driven through the real fs
   * calls, not a mocked throw; it relies on the runner being non-root (root
   * bypasses directory DAC), which holds for this repo's dev machines and
   * CI runners. Restores 0o700 so the shared afterEach teardown can delete
   * the artifact.
   */
  function forceRealCleanupFailure(envFileDir: string): void {
    fs.chmodSync(envFileDir, 0o500);
  }

  function restoreCleanupFailureForcing(envFileDir: string): void {
    fs.chmodSync(envFileDir, 0o700);
  }

  it('does not throw when the handshake release fails on a real filesystem error', async () => {
    const launched = await launchCredentialProxy();
    forceRealCleanupFailure(launched.envFileDir);
    try {
      const errorSpy = vi.spyOn(debugLogger, 'error');

      expect(() => launched.handshake()).not.toThrow();

      // The release genuinely failed (file survives) and the failure was
      // logged rather than propagated into the proxy connection handler.
      expect(fs.existsSync(launched.envFilePath)).toBe(true);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('capability env-file release failed'),
        expect.any(Error),
      );
    } finally {
      restoreCleanupFailureForcing(launched.envFileDir);
    }
  });

  it('does not throw when the bounded fallback release fails on a real filesystem error', async () => {
    vi.useFakeTimers();
    const launched = await launchCredentialProxy();
    forceRealCleanupFailure(launched.envFileDir);
    try {
      wireCleanupHandlers(
        spawnSandboxStandin(),
        undefined,
        NO_SSH,
        undefined,
        launched.exitCleanup,
        () => {},
      );

      // An uncaught throw from the timer callback would be an unhandled
      // exception; the guard must keep the fallback best-effort.
      expect(() => vi.advanceTimersByTime(FALLBACK_BOUND_MS)).not.toThrow();

      expect(fs.existsSync(launched.envFilePath)).toBe(true);
    } finally {
      vi.useRealTimers();
      restoreCleanupFailureForcing(launched.envFileDir);
    }
  });

  it('still surfaces a cleanup failure from the exit-time teardown', async () => {
    const launched = await launchCredentialProxy();
    forceRealCleanupFailure(launched.envFileDir);
    try {
      expect(() => launched.exitCleanup()).toThrow(
        /Credential proxy cleanup failed/,
      );

      // The throw reports a genuinely failed deletion: the env file is
      // still on disk, proving the early-release guard did not silently
      // weaken the exit path.
      expect(fs.existsSync(launched.envFilePath)).toBe(true);
    } finally {
      restoreCleanupFailureForcing(launched.envFileDir);
    }
  });
});
