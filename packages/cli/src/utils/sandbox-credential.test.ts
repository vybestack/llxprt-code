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
  getProxySocketPath: vi.fn(),
  stopProxy: vi.fn(),
  getProxyCapabilityToken: vi.fn(),
};
const bridgeMocks = {
  setupCredentialProxyDockerMacOS: vi.fn(),
  setupCredentialProxyPodmanMacOS: vi.fn(),
  dockerCleanup: vi.fn(),
  podmanCleanup: vi.fn(),
};

vi.mock('@vybestack/llxprt-code-providers/auth.js', () => ({
  createAndStartProxy: authMocks.createAndStartProxy,
  getProxySocketPath: authMocks.getProxySocketPath,
  stopProxy: authMocks.stopProxy,
  getProxyCapabilityToken: authMocks.getProxyCapabilityToken,
}));
vi.mock('./sandbox-ssh.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('./sandbox-ssh.js')>();
  return {
    ...original,
    setupCredentialProxyDockerMacOS:
      bridgeMocks.setupCredentialProxyDockerMacOS,
  };
});
vi.mock('./sandbox-podman.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('./sandbox-podman.js')>();
  return {
    ...original,
    setupCredentialProxyPodmanMacOS:
      bridgeMocks.setupCredentialProxyPodmanMacOS,
  };
});

import { setupCredentialProxy } from './sandbox-containers.js';

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

function capabilityArtifacts(home: string): string[] {
  return fs
    .readdirSync(home)
    .filter((entry) => entry.startsWith('.llxprt-code-cap-'));
}

function invokeCredentialSetup(
  command: ContainerCommand,
  tmpDir: string,
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
      tmpDir,
      reservedPorts,
      prefixes,
    ),
  };
}

describe('#1456 credential proxy network policy', () => {
  let environmentSnapshot: NodeJS.ProcessEnv;
  let tmpDir = '';
  let isolatedHome: string;

  beforeEach(() => {
    environmentSnapshot = { ...process.env };
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'credential-1456-'));
    isolatedHome = path.join(tmpDir, 'home');
    fs.mkdirSync(isolatedHome);
    process.env.HOME = isolatedHome;
    process.env.USERPROFILE = isolatedHome;
    setNetworkEnvironment(undefined, undefined);
    vi.resetAllMocks();
    vi.spyOn(os, 'homedir').mockReturnValue(isolatedHome);
    authMocks.createAndStartProxy.mockResolvedValue({ stop: vi.fn() });
    authMocks.getProxySocketPath.mockReturnValue(
      path.join(tmpDir, HOST_SOCKET_NAME),
    );
    authMocks.getProxyCapabilityToken.mockReturnValue(CAPABILITY_TOKEN);
    authMocks.stopProxy.mockResolvedValue(undefined);
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
    vi.restoreAllMocks();
    if (tmpDir !== '') {
      fs.rmSync(tmpDir, { recursive: true, force: true });
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
      const invocation = invokeCredentialSetup(command, tmpDir);
      let unexpectedCleanup: (() => void) | undefined;
      const result = invocation.promise.then((value) => {
        unexpectedCleanup = value.credentialProxyBridgeCleanup;
        return value;
      });

      try {
        await expect(result).rejects.toBeInstanceOf(FatalSandboxError);
        await expect(result).rejects.toThrowError(CREDENTIAL_NETWORK_ERROR);
        expect(invocation.args).toStrictEqual([]);
        expect(invocation.prefixes).toStrictEqual([]);
        expect(invocation.reservedPorts).toStrictEqual(new Set<number>());
        expect(authMocks.createAndStartProxy).not.toHaveBeenCalled();
        expect(authMocks.getProxySocketPath).not.toHaveBeenCalled();
        expect(authMocks.getProxyCapabilityToken).not.toHaveBeenCalled();
        expect(authMocks.stopProxy).not.toHaveBeenCalled();
        expect(
          bridgeMocks.setupCredentialProxyDockerMacOS,
        ).not.toHaveBeenCalled();
        expect(
          bridgeMocks.setupCredentialProxyPodmanMacOS,
        ).not.toHaveBeenCalled();
        expect(capabilityArtifacts(isolatedHome)).toStrictEqual([]);
      } finally {
        unexpectedCleanup?.();
        await authMocks.stopProxy();
        expect(capabilityArtifacts(isolatedHome)).toStrictEqual([]);
      }
    },
  );

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
      const invocation = invokeCredentialSetup(command, tmpDir);
      let cleanup: (() => void) | undefined;

      try {
        const result = await invocation.promise;
        cleanup = result.credentialProxyBridgeCleanup;
        const envFile = invocation.args[3] ?? '';
        const expectedSocket = socket ?? path.join(tmpDir, HOST_SOCKET_NAME);
        expect(invocation.args).toStrictEqual([
          '--env',
          `LLXPRT_CREDENTIAL_SOCKET=${expectedSocket}`,
          '--env-file',
          envFile,
        ]);
        expect(fs.existsSync(envFile)).toBe(true);
        expect(invocation.prefixes).toStrictEqual(prefix);
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
      } finally {
        cleanup?.();
        await authMocks.stopProxy();
        expect(capabilityArtifacts(isolatedHome)).toStrictEqual([]);
      }
    },
  );
});
