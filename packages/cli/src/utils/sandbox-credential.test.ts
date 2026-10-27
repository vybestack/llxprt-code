/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FatalSandboxError } from '@vybestack/llxprt-code-core';

const authMocks = {
  createAndStartProxy: vi.fn(),
  stop: vi.fn(),
};
const bridgeMocks = {
  setupCredentialProxyDockerMacOS: vi.fn(),
  setupCredentialProxyPodmanMacOS: vi.fn(),
  dockerCleanup: vi.fn(),
  podmanCleanup: vi.fn(),
};

void vi.mock('@vybestack/llxprt-code-providers/auth.js', () => ({
  createAndStartProxy: authMocks.createAndStartProxy,
}));
const original = { ...(await import('./sandbox-ssh.js')) };
void vi.mock('./sandbox-ssh.js', () => ({
  ...original,
  setupCredentialProxyDockerMacOS: bridgeMocks.setupCredentialProxyDockerMacOS,
}));
const actualOriginal = { ...(await import('./sandbox-podman.js')) };
void vi.mock('./sandbox-podman.js', () => ({
  ...actualOriginal,
  setupCredentialProxyPodmanMacOS: bridgeMocks.setupCredentialProxyPodmanMacOS,
}));

import { setupCredentialProxy } from './sandbox-containers.js';
import { createCredentialSocketRuntime } from './sandbox-credential-runtime.js';

const isWindows = process.platform === 'win32';
const NETWORK_ENV_KEYS = ['LLXPRT_SANDBOX_NETWORK', 'SANDBOX_NETWORK'] as const;
const CAPABILITY_TOKEN = 'a'.repeat(64);
const HOST_SOCKET_NAME = 'credential-proxy.sock';
const CREDENTIAL_NETWORK_ERROR =
  'macOS credential bridge requires container networking; enable networking or use Linux for network-off sandboxing.';

type ContainerCommand = 'docker' | 'podman';
interface CredentialInvocation {
  readonly args: string[];
  readonly prefixes: string[];
  readonly reservedPorts: Set<number>;
  readonly promise: ReturnType<typeof setupCredentialProxy>;
}

function setNetworkEnvironment(
  primary: string | undefined,
  legacy: string | undefined,
): void {
  for (const key of NETWORK_ENV_KEYS) delete process.env[key];
  if (primary !== undefined) process.env.LLXPRT_SANDBOX_NETWORK = primary;
  if (legacy !== undefined) process.env.SANDBOX_NETWORK = legacy;
}

function credentialSocketForPlatform(
  socket: string | undefined,
  tmpDir: string,
): string {
  return socket ?? path.join(tmpDir, HOST_SOCKET_NAME);
}

function argumentOrEmpty(args: readonly string[], index: number): string {
  return args[index] ?? '';
}

const realOsTmpdir: () => string = os.tmpdir;
const realMkdtempSync = fs.mkdtempSync.bind(fs);

const RUNTIME_PREFIX_NAME = 'lx-';

function isCredentialRuntimePrefix(prefix: string): boolean {
  return path.basename(prefix).startsWith(RUNTIME_PREFIX_NAME);
}

/**
 * Replaces fs.mkdtempSync for string-prefix calls. The overloads that return
 * a Buffer are never used by the code under test, so only the string form is
 * implemented.
 */
function stubMkdtempSync(implementation: (prefix: string) => string): void {
  vi.spyOn(fs, 'mkdtempSync').mockImplementation(
    implementation as typeof fs.mkdtempSync,
  );
}

interface RuntimeAllocation {
  /** Prefix of every credential runtime allocation attempt. */
  readonly prefixes: string[];
  /** Directory of every credential runtime that was actually created. */
  readonly created: string[];
}

/**
 * Production allocates the simulated-Darwin Podman socket runtime under the
 * literal '/tmp', which does not exist on Windows. On Windows the allocation
 * is redirected to a short native fixture root (the same layout as
 * sandbox-launch-release.test.ts, because Darwin socket paths are limited to
 * 103 bytes); the directory is still created and removed for real.
 */
function observeCredentialRuntimeAllocation(
  nativeRuntimeRoot: string,
): RuntimeAllocation {
  const allocation: RuntimeAllocation = { prefixes: [], created: [] };
  stubMkdtempSync((prefix) => {
    if (!isCredentialRuntimePrefix(prefix)) return realMkdtempSync(prefix);
    allocation.prefixes.push(prefix);
    const created = realMkdtempSync(
      isWindows ? path.join(nativeRuntimeRoot, path.basename(prefix)) : prefix,
    );
    allocation.created.push(created);
    return created;
  });
  return allocation;
}

/**
 * Runs the test body, then its teardown assertions. A teardown failure never
 * replaces a body failure: both are reported together so the original error
 * stays visible.
 */
async function runWithTeardown(
  body: () => Promise<void>,
  teardown: () => Promise<void>,
): Promise<void> {
  try {
    await body();
  } catch (bodyError) {
    try {
      await teardown();
    } catch (teardownError) {
      throw new AggregateError(
        [bodyError, teardownError],
        'Test body and teardown both failed',
      );
    }
    throw bodyError;
  }
  await teardown();
}

/**
 * Overrides os.tmpdir for the code under test. Bun exposes os.tmpdir as an
 * accessor property, which vi.spyOn cannot wrap, and once TMPDIR is deleted
 * after being set, os.tmpdir keeps returning the stale value for the rest of
 * the process. Redefining the property avoids both pitfalls.
 */
function overrideOsTmpdir(value: string): void {
  Object.defineProperty(os, 'tmpdir', {
    value: () => value,
    configurable: true,
  });
}

function restoreOsTmpdir(): void {
  Object.defineProperty(os, 'tmpdir', {
    value: realOsTmpdir,
    configurable: true,
  });
}

function capabilityArtifacts(home: string): string[] {
  return fs
    .readdirSync(home)
    .filter((entry) => entry.startsWith('.llxprt-code-cap-'));
}

function runtimeCapabilityArtifacts(runtimeRoot: string): string[] {
  return fs
    .readdirSync(runtimeRoot)
    .filter((entry) => entry.startsWith('llxprt-code-cap-'));
}

function invokeCredentialSetup(
  command: ContainerCommand,
  sessionTmpdir: string,
): CredentialInvocation {
  const args: string[] = [];
  const prefixes: string[] = [];
  const reservedPorts = new Set<number>();
  return {
    args,
    prefixes,
    reservedPorts,
    promise: setupCredentialProxy(
      args,
      { command, image: 'test' },
      sessionTmpdir,
      reservedPorts,
      prefixes,
    ),
  };
}

describe('#1456 credential proxy network policy', () => {
  let environmentSnapshot: NodeJS.ProcessEnv;
  let tmpDir = '';
  let isolatedHome: string;
  let sessionTmpdir = '';
  let nativeRuntimeRoot = '';
  let runtimeAllocation: RuntimeAllocation;

  beforeEach(() => {
    environmentSnapshot = { ...process.env };
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'credential-1456-'));
    nativeRuntimeRoot = isWindows
      ? fs.mkdtempSync(path.join(path.parse(os.tmpdir()).root, 'cr-'))
      : '';
    isolatedHome = path.join(tmpDir, 'home');
    sessionTmpdir = path.join(tmpDir, 'session');
    fs.mkdirSync(isolatedHome);
    fs.mkdirSync(sessionTmpdir);
    process.env.HOME = isolatedHome;
    process.env.USERPROFILE = isolatedHome;
    delete process.env.XDG_RUNTIME_DIR;
    setNetworkEnvironment(undefined, undefined);
    vi.resetAllMocks();
    // os.tmpdir is an accessor property in Bun (vi.spyOn cannot wrap it) and
    // a set-then-deleted TMPDIR leaves os.tmpdir() stale; redefine instead.
    overrideOsTmpdir(tmpDir);
    vi.spyOn(os, 'homedir').mockReturnValue(isolatedHome);
    runtimeAllocation = observeCredentialRuntimeAllocation(nativeRuntimeRoot);
    authMocks.createAndStartProxy.mockResolvedValue({
      socketPath: path.join(tmpDir, HOST_SOCKET_NAME),
      capabilityToken: CAPABILITY_TOKEN,
      stop: authMocks.stop,
    });
    authMocks.stop.mockResolvedValue(undefined);
    bridgeMocks.setupCredentialProxyDockerMacOS.mockResolvedValue({
      cleanup: bridgeMocks.dockerCleanup,
      entrypointPrefix: 'DOCKER_CREDENTIAL_BRIDGE',
      containerSocketPath: '/tmp/docker-credential.sock',
    });
    bridgeMocks.setupCredentialProxyPodmanMacOS.mockResolvedValue({
      cleanup: bridgeMocks.podmanCleanup,
      entrypointPrefix: 'PODMAN_CREDENTIAL_BRIDGE',
      containerSocketPath: '/tmp/podman-credential.sock',
    });
  });

  afterEach(() => {
    process.env = environmentSnapshot;
    restoreOsTmpdir();
    vi.restoreAllMocks();
    if (tmpDir !== '') {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
    if (nativeRuntimeRoot !== '') {
      fs.rmSync(nativeRuntimeRoot, { recursive: true, force: true });
    }
  });

  it.each([
    {
      command: 'docker' as const,
      setNetwork: (): void => setNetworkEnvironment('off', undefined),
      source: 'primary',
    },
    {
      command: 'podman' as const,
      setNetwork: (): void => setNetworkEnvironment('off', undefined),
      source: 'primary',
    },
    {
      command: 'docker' as const,
      setNetwork: (): void => setNetworkEnvironment(undefined, 'off'),
      source: 'legacy',
    },
    {
      command: 'podman' as const,
      setNetwork: (): void => setNetworkEnvironment(undefined, 'off'),
      source: 'legacy',
    },
  ])(
    'rejects Darwin $command network off from $source before resources',
    async ({ command, setNetwork }) => {
      setNetwork();
      vi.spyOn(os, 'platform').mockReturnValue('darwin');
      const invocation = invokeCredentialSetup(command, sessionTmpdir);
      let unexpectedCleanup: (() => void) | undefined;
      const result = invocation.promise.then((value) => {
        unexpectedCleanup = value.credentialProxyBridgeCleanup;
        return value;
      });

      await runWithTeardown(
        async () => {
          await expect(result).rejects.toBeInstanceOf(FatalSandboxError);
          await expect(result).rejects.toThrowError(CREDENTIAL_NETWORK_ERROR);
          expect(invocation.args).toStrictEqual([]);
          expect(invocation.prefixes).toStrictEqual([]);
          expect(invocation.reservedPorts).toStrictEqual(new Set<number>());
          expect(authMocks.createAndStartProxy).not.toHaveBeenCalled();
          expect(authMocks.stop).not.toHaveBeenCalled();
          expect(
            bridgeMocks.setupCredentialProxyDockerMacOS,
          ).not.toHaveBeenCalled();
          expect(
            bridgeMocks.setupCredentialProxyPodmanMacOS,
          ).not.toHaveBeenCalled();
          expect(capabilityArtifacts(isolatedHome)).toStrictEqual([]);
          // Policy is rejected before any socket runtime is allocated.
          expect(runtimeAllocation.prefixes).toStrictEqual([]);
        },
        async () => {
          unexpectedCleanup?.();
          await authMocks.stop();
          expect(capabilityArtifacts(isolatedHome)).toStrictEqual([]);
          expect(runtimeCapabilityArtifacts(tmpDir)).toStrictEqual([]);
          expect(fs.existsSync(sessionTmpdir)).toBe(false);
        },
      );
    },
  );

  it('removes the session directory when allocating the socket runtime fails', async () => {
    vi.spyOn(os, 'platform').mockReturnValue('darwin');
    const allocationFailure = new Error('induced runtime allocation failure');
    stubMkdtempSync((prefix) => {
      if (isCredentialRuntimePrefix(prefix)) throw allocationFailure;
      return realMkdtempSync(prefix);
    });

    const invocation = invokeCredentialSetup('podman', sessionTmpdir);

    await expect(invocation.promise).rejects.toThrowError(
      /Failed to create a private Podman macOS credential socket runtime/,
    );
    expect(fs.existsSync(sessionTmpdir)).toBe(false);
    expect(authMocks.createAndStartProxy).not.toHaveBeenCalled();
    expect(invocation.args).toStrictEqual([]);
  });

  it.each([
    {
      command: 'docker' as const,
      platform: 'linux' as const,
      primary: 'off',
      legacy: undefined,
      socket: undefined,
      prefix: [],
      bridgeSocket: undefined,
      dockerBridgeCalls: 0,
      podmanBridgeCalls: 0,
    },
    {
      command: 'podman' as const,
      platform: 'linux' as const,
      primary: 'off',
      legacy: undefined,
      socket: undefined,
      prefix: [],
      bridgeSocket: undefined,
      dockerBridgeCalls: 0,
      podmanBridgeCalls: 0,
    },
    {
      command: 'docker' as const,
      platform: 'darwin' as const,
      primary: 'on',
      legacy: undefined,
      socket: '/tmp/docker-credential.sock',
      prefix: ['DOCKER_CREDENTIAL_BRIDGE'],
      bridgeSocket: '/tmp/docker-credential.sock',
      dockerBridgeCalls: 1,
      podmanBridgeCalls: 0,
    },
    {
      command: 'podman' as const,
      platform: 'darwin' as const,
      primary: undefined,
      legacy: undefined,
      socket: '/tmp/podman-credential.sock',
      prefix: ['PODMAN_CREDENTIAL_BRIDGE'],
      bridgeSocket: '/tmp/podman-credential.sock',
      dockerBridgeCalls: 0,
      podmanBridgeCalls: 1,
    },
    {
      command: 'docker' as const,
      platform: 'darwin' as const,
      primary: '',
      legacy: 'off',
      socket: '/tmp/docker-credential.sock',
      prefix: ['DOCKER_CREDENTIAL_BRIDGE'],
      bridgeSocket: '/tmp/docker-credential.sock',
      dockerBridgeCalls: 1,
      podmanBridgeCalls: 0,
    },
  ])(
    'returns exact $platform $command outputs for primary=$primary legacy=$legacy',
    async ({
      command,
      platform,
      primary,
      legacy,
      socket,
      prefix,
      bridgeSocket,
      dockerBridgeCalls,
      podmanBridgeCalls,
    }) => {
      setNetworkEnvironment(primary, legacy);
      vi.spyOn(os, 'platform').mockReturnValue(platform);
      const invocation = invokeCredentialSetup(command, sessionTmpdir);
      let cleanup: (() => void) | undefined;

      await runWithTeardown(
        async () => {
          const result = await invocation.promise;
          cleanup = result.credentialProxyBridgeCleanup;
          const envFile = argumentOrEmpty(invocation.args, 3);
          const platformSocket = credentialSocketForPlatform(socket, tmpDir);
          expect(invocation.args).toStrictEqual([
            '--env',
            `LLXPRT_CREDENTIAL_SOCKET=${platformSocket}`,
            '--env-file',
            envFile,
          ]);
          expect(fs.existsSync(envFile)).toBe(true);
          expect(invocation.prefixes).toStrictEqual(
            prefix as unknown as string[],
          );
          expect(invocation.reservedPorts).toStrictEqual(new Set<number>());
          expect(result.credentialProxyBridgeResult?.containerSocketPath).toBe(
            bridgeSocket,
          );
          expect(
            bridgeMocks.setupCredentialProxyDockerMacOS,
          ).toHaveBeenCalledTimes(dockerBridgeCalls);
          expect(
            bridgeMocks.setupCredentialProxyPodmanMacOS,
          ).toHaveBeenCalledTimes(podmanBridgeCalls);
        },
        async () => {
          cleanup?.();
          await authMocks.stop();
          expect(capabilityArtifacts(isolatedHome)).toStrictEqual([]);
          expect(runtimeCapabilityArtifacts(tmpDir)).toStrictEqual([]);
          expect(
            runtimeAllocation.created.filter((runtime) =>
              fs.existsSync(runtime),
            ),
          ).toStrictEqual([]);
          expect(fs.existsSync(sessionTmpdir)).toBe(false);
        },
      );
    },
  );
});

describe('Podman credential socket runtime', () => {
  describe.skipIf(isWindows)('#3534 Podman credential socket runtime', () => {
    let environmentSnapshot: NodeJS.ProcessEnv;
    let fixtureRoot = '';
    let sessionTmpdir = '';

    beforeEach(() => {
      environmentSnapshot = { ...process.env };
      fixtureRoot = fs.mkdtempSync(
        path.join(realOsTmpdir(), 'issue3534-cred-'),
      );
      const longTmpRoot = path.join(
        fixtureRoot,
        'private',
        'var',
        'folders',
        'abcdefghijklmnopqrstuvwxyz0123456789',
        'T',
      );
      sessionTmpdir = path.join(longTmpRoot, 'llxprt-sandbox-session');
      fs.mkdirSync(sessionTmpdir, { recursive: true, mode: 0o700 });
      overrideOsTmpdir(longTmpRoot);
      vi.spyOn(os, 'platform').mockReturnValue('darwin');
      authMocks.stop.mockResolvedValue(undefined);
      bridgeMocks.setupCredentialProxyPodmanMacOS.mockResolvedValue({
        cleanup: bridgeMocks.podmanCleanup,
        entrypointPrefix: 'PODMAN_CREDENTIAL_BRIDGE',
        containerSocketPath: '/tmp/podman-credential.sock',
      });
    });

    afterEach(() => {
      process.env = environmentSnapshot;
      restoreOsTmpdir();
      vi.restoreAllMocks();
      fs.rmSync(fixtureRoot, { recursive: true, force: true });
    });

    it('uses a private short socket directory despite a long normal temporary root and removes it on cleanup', async () => {
      let socketRuntime = '';
      let socketPath = '';
      authMocks.createAndStartProxy.mockImplementation(
        async (config: { socketPath: string }) => {
          socketRuntime = config.socketPath;
          socketPath = path.join(
            socketRuntime,
            `${process.pid}-${'n'.repeat(22)}.sock`,
          );
          fs.writeFileSync(socketPath, 'socket fixture');
          return {
            socketPath,
            capabilityToken: CAPABILITY_TOKEN,
            stop: authMocks.stop,
          };
        },
      );

      const invocation = invokeCredentialSetup('podman', sessionTmpdir);
      const result = await invocation.promise;

      expect(socketRuntime.startsWith(sessionTmpdir)).toBe(false);
      expect(Buffer.byteLength(socketPath)).toBeLessThanOrEqual(103);
      expect(fs.statSync(socketRuntime).mode & 0o777).toBe(0o700);
      expect(fs.existsSync(socketPath)).toBe(true);

      result.credentialProxyBridgeCleanup?.();
      expect(fs.existsSync(socketRuntime)).toBe(false);
      expect(fs.existsSync(sessionTmpdir)).toBe(false);
    });

    it('removes the short socket directory and normal session directory when bridge setup fails', async () => {
      let socketRuntime = '';
      let socketPath = '';
      authMocks.createAndStartProxy.mockImplementation(
        async (config: { socketPath: string }) => {
          socketRuntime = config.socketPath;
          socketPath = path.join(
            socketRuntime,
            `${process.pid}-${'n'.repeat(22)}.sock`,
          );
          fs.writeFileSync(socketPath, 'socket fixture');
          return {
            socketPath,
            capabilityToken: CAPABILITY_TOKEN,
            stop: authMocks.stop,
          };
        },
      );
      bridgeMocks.setupCredentialProxyPodmanMacOS.mockRejectedValue(
        new FatalSandboxError('induced Podman bridge failure'),
      );

      const result = invokeCredentialSetup('podman', sessionTmpdir).promise;

      await expect(result).rejects.toThrow('induced Podman bridge failure');
      expect(socketRuntime).not.toBe('');
      expect(fs.existsSync(socketRuntime)).toBe(false);
      expect(fs.existsSync(sessionTmpdir)).toBe(false);
    });

    it('removes the normal session directory when short socket runtime removal fails and surfaces the failure', async () => {
      let socketRuntime = '';
      let socketPath = '';
      authMocks.createAndStartProxy.mockImplementation(
        async (config: { socketPath: string }) => {
          socketRuntime = config.socketPath;
          socketPath = path.join(
            socketRuntime,
            `${process.pid}-${'n'.repeat(22)}.sock`,
          );
          fs.writeFileSync(socketPath, 'socket fixture');
          return {
            socketPath,
            capabilityToken: CAPABILITY_TOKEN,
            stop: authMocks.stop,
          };
        },
      );
      const result = await invokeCredentialSetup('podman', sessionTmpdir)
        .promise;
      const realRmSync = fs.rmSync.bind(fs);
      const rmSpy = vi
        .spyOn(fs, 'rmSync')
        .mockImplementation((target, options) => {
          if (target.toString() === socketRuntime) {
            throw new Error('induced short runtime cleanup failure');
          }
          return realRmSync(target, options);
        });
      let cleanupError: unknown;

      try {
        result.credentialProxyBridgeCleanup?.();
      } catch (error) {
        cleanupError = error;
      } finally {
        rmSpy.mockRestore();
      }

      expect(cleanupError).toBeInstanceOf(AggregateError);
      if (!(cleanupError instanceof AggregateError)) {
        throw new Error('Expected credential cleanup to aggregate its failure');
      }
      expect(
        cleanupError.errors.some(
          (error: unknown) =>
            error instanceof Error &&
            error.message === 'induced short runtime cleanup failure',
        ),
      ).toBe(true);
      expect(fs.existsSync(sessionTmpdir)).toBe(false);
      realRmSync(socketRuntime, { recursive: true, force: true });
    });

    // The runtime root is the literal '/tmp', so a real mkdtemp there can never
    // reach the boundary; only the runtime directory name is substituted, and
    // the directory itself is real so the guard's own cleanup is observed.
    it('rejects a 104-byte Darwin runtime socket path before starting the proxy or Podman bridge', async () => {
      const socketBasename = `${process.pid}-${'x'.repeat(22)}.sock`;
      const shortestRuntime = path.join('/tmp', `r${process.pid}`);
      const shortestSocketPath = path.join(shortestRuntime, socketBasename);
      const runtimePath =
        shortestRuntime +
        'r'.repeat(104 - Buffer.byteLength(shortestSocketPath));
      const longestSocketPath = path.join(runtimePath, socketBasename);
      fs.mkdirSync(runtimePath, { recursive: true, mode: 0o700 });
      const mkdtempSpy = vi
        .spyOn(fs, 'mkdtempSync')
        .mockReturnValue(runtimePath);

      const invocation = invokeCredentialSetup('podman', sessionTmpdir);

      try {
        expect(Buffer.byteLength(longestSocketPath)).toBe(104);
        await expect(invocation.promise).rejects.toThrowError(
          /exceeds Darwin's 103-byte pathname limit/,
        );
        // The rejection names the boundary rather than the downstream
        // "proxy started but did not produce a socket path" failure, so the
        // guard ran while the runtime was being constructed. Nothing was
        // wired for the container and the rejected runtime left nothing behind.
        expect(fs.existsSync(runtimePath)).toBe(false);
        expect(invocation.args).toStrictEqual([]);
        expect(invocation.prefixes).toStrictEqual([]);
      } finally {
        mkdtempSpy.mockRestore();
        fs.rmSync(runtimePath, { recursive: true, force: true });
      }
    });

    it('accepts a 103-byte Darwin runtime socket path and keeps the runtime', async () => {
      const socketBasename = `${process.pid}-${'x'.repeat(22)}.sock`;
      const shortestRuntime = path.join('/tmp', `r${process.pid}`);
      const shortestSocketPath = path.join(shortestRuntime, socketBasename);
      const runtimePath =
        shortestRuntime +
        'r'.repeat(103 - Buffer.byteLength(shortestSocketPath));
      const longestSocketPath = path.join(runtimePath, socketBasename);
      fs.mkdirSync(runtimePath, { recursive: true, mode: 0o700 });
      const mkdtempSpy = vi
        .spyOn(fs, 'mkdtempSync')
        .mockReturnValue(runtimePath);

      try {
        expect(Buffer.byteLength(longestSocketPath)).toBe(103);
        const runtime = createCredentialSocketRuntime(
          { command: 'podman', image: 'test' },
          sessionTmpdir,
        );
        expect(runtime.path).toBe(runtimePath);
        expect(fs.existsSync(runtimePath)).toBe(true);
        runtime.cleanup();
        expect(fs.existsSync(runtimePath)).toBe(false);
      } finally {
        mkdtempSpy.mockRestore();
        fs.rmSync(runtimePath, { recursive: true, force: true });
      }
    });

    it('preserves runtime initialization and cleanup failures together', () => {
      const runtimePath = path.join('/tmp', 'lx-initialization-failure');
      const initializationFailure = new Error(
        'induced runtime permission initialization failure',
      );
      const cleanupFailure = new Error('induced runtime cleanup failure');
      const mkdtempSpy = vi
        .spyOn(fs, 'mkdtempSync')
        .mockReturnValue(runtimePath);
      const chmodSpy = vi.spyOn(fs, 'chmodSync').mockImplementation(() => {
        throw initializationFailure;
      });
      const rmSpy = vi.spyOn(fs, 'rmSync').mockImplementation(() => {
        throw cleanupFailure;
      });
      let thrown: unknown;

      try {
        createCredentialSocketRuntime(
          { command: 'podman', image: 'test' },
          sessionTmpdir,
        );
      } catch (error) {
        thrown = error;
      } finally {
        mkdtempSpy.mockRestore();
        chmodSpy.mockRestore();
        rmSpy.mockRestore();
      }

      expect(thrown).toBeInstanceOf(AggregateError);
      if (!(thrown instanceof AggregateError)) {
        throw new Error('Expected runtime failures to be aggregated');
      }
      expect(thrown.errors).toHaveLength(2);
      // The initialization failure survives the failing cleanup instead of
      // being replaced by it, and the cleanup failure is carried alongside.
      const preserved: unknown = thrown.errors[0];
      expect(preserved).toBeInstanceOf(FatalSandboxError);
      if (!(preserved instanceof FatalSandboxError)) {
        throw new Error('Expected the initialization failure to be preserved');
      }
      expect(preserved.message).toContain(initializationFailure.message);
      expect(preserved.message).toContain("under '/tmp'");
      expect(thrown.errors[1]).toBe(cleanupFailure);
    });

    it('keeps installed Docker compatibility by using the normal session directory', async () => {
      let socketRuntime = '';
      const socketPath = path.join(sessionTmpdir, HOST_SOCKET_NAME);
      authMocks.createAndStartProxy.mockImplementation(
        async (config: { socketPath: string }) => {
          socketRuntime = config.socketPath;
          fs.writeFileSync(socketPath, 'socket fixture');
          return {
            socketPath,
            capabilityToken: CAPABILITY_TOKEN,
            stop: authMocks.stop,
          };
        },
      );

      const invocation = invokeCredentialSetup('docker', sessionTmpdir);
      const result = await invocation.promise;

      expect(socketRuntime).toBe(sessionTmpdir);
      result.credentialProxyBridgeCleanup?.();
      expect(fs.existsSync(sessionTmpdir)).toBe(false);
    });
  });
});
