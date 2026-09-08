/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  AuthPrecedenceResolver,
  CredentialResolutionError,
  ProxyProviderKeyStorage,
  ProxySocketClient,
  ProxyTokenStore,
  runtimeScopedStates,
  type CredentialResolutionDiagnostics,
  type CredentialResolutionErrorKind,
  type CredentialResolutionResult,
  type IProviderKeyStorage,
  type IProviderRuntimeContext,
  type ISettingsService,
  type OAuthManager,
} from '../index.js';
import { encodeFrame, FrameDecoder } from '../proxy/framing.js';

const CREDENTIAL_SOCKET_ENV = 'LLXPRT_CREDENTIAL_SOCKET';
const CREDENTIAL_SECRET = 'issue3451-credential-secret';
const CAPABILITY_SECRET = 'issue3451-capability-secret';
const KEY_MATERIAL_SECRET = 'issue3451-key-material-secret';

type ProxyBehavior =
  | 'not-found'
  | 'disconnect-on-request'
  | 'unauthorized'
  | 'token-then-disconnect';

interface ProxyHarness {
  readonly socketPath: string;
  readonly requestCount: () => number;
  close(): Promise<void>;
}

function createSettingsService(
  values: Readonly<Record<string, unknown>> = {},
  providerValues: Readonly<
    Record<string, Readonly<Record<string, unknown>>>
  > = {},
): ISettingsService {
  const settings = new Map<string, unknown>(Object.entries(values));
  const providerSettings = new Map(
    Object.entries(providerValues).map(([provider, entries]) => [
      provider,
      { ...entries },
    ]),
  );
  return {
    get: (key) => settings.get(key),
    getProviderSettings: (provider) => providerSettings.get(provider) ?? {},
    on: () => {},
    off: () => {},
  };
}

function createRuntimeContext(
  runtimeId: string,
  settingsService: ISettingsService,
): IProviderRuntimeContext {
  return { runtimeId, settingsService, metadata: {} };
}

function createEmptyKeyStorage(): IProviderKeyStorage {
  return {
    getKey: async () => null,
    listKeys: async () => [],
    hasKey: async () => false,
  };
}

async function startProxy(behavior: ProxyBehavior): Promise<ProxyHarness> {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'llxprt-credential-resolution-'),
  );
  const socketPath = path.join(directory, 'proxy.sock');
  const sockets = new Set<net.Socket>();
  let requestCount = 0;
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    const decoder = new FrameDecoder();
    socket.on('data', (chunk) => {
      for (const frame of decoder.feed(chunk)) {
        if (frame.op === 'handshake') {
          const response =
            behavior === 'unauthorized'
              ? {
                  ok: false,
                  code: 'UNAUTHORIZED',
                  error: 'capability rejected',
                }
              : { ok: true, data: { version: 2 } };
          socket.write(encodeFrame(response));
        } else {
          requestCount += 1;
          if (behavior === 'disconnect-on-request') {
            socket.destroy();
          } else if (behavior === 'not-found') {
            socket.write(
              encodeFrame({
                ok: false,
                id: frame.id,
                code: 'NOT_FOUND',
                error: 'credential absent',
              }),
            );
          } else if (
            behavior === 'token-then-disconnect' &&
            requestCount === 1
          ) {
            socket.write(
              encodeFrame({
                ok: true,
                id: frame.id,
                data: {
                  access_token: CREDENTIAL_SECRET,
                  token_type: 'Bearer',
                  expiry: Math.floor(Date.now() / 1000) + 3600,
                },
              }),
            );
          } else {
            socket.destroy();
          }
        }
      }
    });
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(socketPath, () => {
        server.removeListener('error', reject);
        resolve();
      });
    });
  } catch (error) {
    await fs.rm(directory, { recursive: true, force: true });
    throw error;
  }
  return {
    socketPath,
    requestCount: () => requestCount,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await fs.rm(directory, { recursive: true, force: true });
    },
  };
}

function expectSafeFailure(
  result: CredentialResolutionResult,
  expectedKind: CredentialResolutionErrorKind,
  forbiddenValues: readonly string[],
): CredentialResolutionError {
  if (result.token !== null) {
    throw new Error('Expected credential resolution to fail');
  }
  expect(result.failure).toBeInstanceOf(CredentialResolutionError);
  expect(result.failure.kind).toBe(expectedKind);
  expect(result.failure.message).toContain(
    `provider=${result.failure.diagnostics.provider}`,
  );
  expect(result.failure.message).toContain(
    `profile=${result.failure.diagnostics.profile}`,
  );
  expect(result.failure.message).toContain(
    `runtimeId=${result.failure.diagnostics.runtimeId}`,
  );
  const attemptedMechanisms = result.failure.diagnostics.attemptedMechanisms;
  if (attemptedMechanisms === 'unknown') {
    throw new Error('Resolver failures must include attempted mechanisms');
  }
  expect(result.failure.message).toContain(
    `attemptedMechanisms=[${attemptedMechanisms.join(', ')}]`,
  );
  expect(result.failure.message).toContain(
    `proxyMode=${result.failure.diagnostics.proxyMode}`,
  );
  expect(result.failure.message).toContain(
    `proxyContacted=${result.failure.diagnostics.proxyContacted}`,
  );
  const publicDetails = `${result.failure.message}\n${JSON.stringify(
    result.failure.diagnostics,
  )}`;
  for (const forbiddenValue of forbiddenValues) {
    expect(publicDetails).not.toContain(forbiddenValue);
  }
  return result.failure;
}

function createProxyOAuthManager(tokenStore: ProxyTokenStore): OAuthManager {
  return {
    getToken: async (provider) => {
      const token = await tokenStore.getToken(provider);
      return token?.access_token ?? null;
    },
    isAuthenticated: async () => true,
  };
}

describe('Credential resolution diagnostics', () => {
  const clients: ProxySocketClient[] = [];
  const harnesses: ProxyHarness[] = [];
  let originalSocketEnv: string | undefined;

  beforeEach(() => {
    originalSocketEnv = process.env[CREDENTIAL_SOCKET_ENV];
    delete process.env[CREDENTIAL_SOCKET_ENV];
    runtimeScopedStates.clear();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    for (const client of clients.splice(0)) client.close();
    for (const harness of harnesses.splice(0)) await harness.close();
    runtimeScopedStates.clear();
    if (originalSocketEnv === undefined) {
      delete process.env[CREDENTIAL_SOCKET_ENV];
    } else {
      process.env[CREDENTIAL_SOCKET_ENV] = originalSocketEnv;
    }
  });

  it('does not report OAuth as attempted when the resolver cannot use OAuth', async () => {
    process.env[CREDENTIAL_SOCKET_ENV] = path.join(
      os.tmpdir(),
      'issue3451-unused-proxy.sock',
    );
    const settings = createSettingsService();
    const runtime = createRuntimeContext('runtime-unconfigured', settings);
    const resolver = new AuthPrecedenceResolver(
      {
        providerId: 'test-provider',
        envKeyNames: ['ISSUE3451_MISSING_KEY'],
      },
      {
        settingsService: settings,
        getActiveRuntimeContext: () => runtime,
      },
    );

    const result = await resolver.resolveAuthenticationResult({
      includeOAuth: true,
    });

    const failure = expectSafeFailure(result, 'no-credential-configured', [
      CREDENTIAL_SECRET,
      CAPABILITY_SECRET,
      KEY_MATERIAL_SECRET,
    ]);
    expect(failure.diagnostics).toStrictEqual({
      provider: 'test-provider',
      profile: 'no-profile',
      runtimeId: 'runtime-unconfigured',
      attemptedMechanisms: [
        'provider-auth-key',
        'provider-auth-keyfile',
        'constructor-api-key',
        'global-auth-key',
        'global-auth-key-name',
        'global-auth-keyfile',
        'env:ISSUE3451_MISSING_KEY',
      ],
      proxyMode: true,
      proxyContacted: false,
    });
    expect(failure.message).toContain('profile=no-profile');
  });

  it('trims remediation text and omits whitespace-only remediation', () => {
    const diagnostics: CredentialResolutionDiagnostics = {
      provider: 'test-provider',
      profile: 'sandbox-profile',
      runtimeId: 'runtime-remediation',
      attemptedMechanisms: ['oauth'],
      proxyMode: false,
      proxyContacted: false,
    };

    const whitespaceOnly = new CredentialResolutionError(
      'credential-source-failed',
      diagnostics,
      { remediation: ' \n\t ' },
    );
    const padded = new CredentialResolutionError(
      'credential-source-failed',
      diagnostics,
      { remediation: '  Retry credential setup.  ' },
    );

    expect(whitespaceOnly.remediation).toBeUndefined();
    expect(whitespaceOnly.message).toStartWith('Credential resolution failed:');
    expect(padded.remediation).toBe('Retry credential setup.');
    expect(padded.message).toStartWith(
      'Retry credential setup. Credential resolution failed:',
    );
  });

  it('classifies an absent named key as credential-not-found without leaking credential material', async () => {
    const settings = createSettingsService({
      'auth-key-name': 'configured-key-reference',
      currentProfile: 'sandbox-profile',
    });
    const resolver = new AuthPrecedenceResolver(
      { providerId: 'test-provider' },
      {
        settingsService: settings,
        providerKeyStorage: createEmptyKeyStorage(),
        getActiveRuntimeContext: () =>
          createRuntimeContext('runtime-not-found', settings),
      },
    );

    const result = await resolver.resolveAuthenticationResult();

    const failure = expectSafeFailure(result, 'credential-not-found', [
      CREDENTIAL_SECRET,
      CAPABILITY_SECRET,
      KEY_MATERIAL_SECRET,
    ]);
    expect(failure.diagnostics.attemptedMechanisms).toStrictEqual([
      'provider-auth-key',
      'provider-auth-keyfile',
      'constructor-api-key',
      'global-auth-key',
      'global-auth-key-name',
      'global-auth-keyfile',
    ]);
    expect(failure.diagnostics.proxyContacted).toBe(false);
    expect(failure.remediation).toBe(
      "Named key 'configured-key-reference' not found. Save it with /key save configured-key-reference <api-key> before retrying.",
    );
    expect(failure.message).toContain('/key save configured-key-reference');
  });

  it('distinguishes missing storage wiring remediation from absent named-key remediation', async () => {
    const settings = createSettingsService({
      'auth-key-name': 'configured-key-reference',
      currentProfile: 'sandbox-profile',
    });
    const missingStorageResolver = new AuthPrecedenceResolver(
      { providerId: 'test-provider' },
      {
        settingsService: settings,
        getActiveRuntimeContext: () =>
          createRuntimeContext('runtime-missing-storage', settings),
      },
    );
    const absentKeyResolver = new AuthPrecedenceResolver(
      { providerId: 'test-provider' },
      {
        settingsService: settings,
        providerKeyStorage: createEmptyKeyStorage(),
        getActiveRuntimeContext: () =>
          createRuntimeContext('runtime-absent-key', settings),
      },
    );

    const [missingStorageResult, absentKeyResult] = await Promise.all([
      missingStorageResolver.resolveAuthenticationResult(),
      absentKeyResolver.resolveAuthenticationResult(),
    ]);

    const missingStorageFailure = expectSafeFailure(
      missingStorageResult,
      'credential-source-failed',
      [CREDENTIAL_SECRET, CAPABILITY_SECRET, KEY_MATERIAL_SECRET],
    );
    const absentKeyFailure = expectSafeFailure(
      absentKeyResult,
      'credential-not-found',
      [CREDENTIAL_SECRET, CAPABILITY_SECRET, KEY_MATERIAL_SECRET],
    );
    expect(missingStorageFailure.remediation).toBe(
      'Pass providerKeyStorage to AuthPrecedenceResolver or use createAuthPrecedenceResolver() from core.',
    );
    expect(missingStorageFailure.remediation).not.toContain('/key save');
    expect(absentKeyFailure.remediation).toBe(
      "Named key 'configured-key-reference' not found. Save it with /key save configured-key-reference <api-key> before retrying.",
    );
    expect(missingStorageFailure.remediation).not.toBe(
      absentKeyFailure.remediation,
    );
    expect(missingStorageFailure.cause).toBeInstanceOf(Error);
    if (!(missingStorageFailure.cause instanceof Error)) {
      throw new Error('Expected missing storage failure to preserve its cause');
    }
    expect(missingStorageFailure.cause.message).toBe(
      'Provider key storage is required to resolve named auth keys. Pass providerKeyStorage to AuthPrecedenceResolver or use createAuthPrecedenceResolver() from core.',
    );
  });

  it('classifies a real proxy NOT_FOUND response as credential-not-found and records proxy contact', async () => {
    const harness = await startProxy('not-found');
    harnesses.push(harness);
    process.env[CREDENTIAL_SOCKET_ENV] = harness.socketPath;
    const client = new ProxySocketClient(harness.socketPath, CAPABILITY_SECRET);
    clients.push(client);
    const settings = createSettingsService({
      'auth-key-name': 'proxy-key-reference',
      currentProfile: 'sandbox-profile',
    });
    const resolver = new AuthPrecedenceResolver(
      { providerId: 'test-provider' },
      {
        settingsService: settings,
        providerKeyStorage: new ProxyProviderKeyStorage(client),
        getActiveRuntimeContext: () =>
          createRuntimeContext('runtime-proxy-not-found', settings),
      },
    );

    const result = await resolver.resolveAuthenticationResult();

    const failure = expectSafeFailure(result, 'credential-not-found', [
      CREDENTIAL_SECRET,
      CAPABILITY_SECRET,
      KEY_MATERIAL_SECRET,
    ]);
    expect(harness.requestCount()).toBe(1);
    expect(failure.diagnostics.proxyMode).toBe(true);
    expect(failure.diagnostics.proxyContacted).toBe(true);
  });

  it('reports proxy-unavailable without proxy contact when the socket cannot be reached', async () => {
    const socketPath = path.join(
      os.tmpdir(),
      `issue3451-unreachable-${process.pid}.sock`,
    );
    process.env[CREDENTIAL_SOCKET_ENV] = socketPath;
    const client = new ProxySocketClient(socketPath, CAPABILITY_SECRET);
    clients.push(client);
    const settings = createSettingsService({
      'auth-key-name': 'proxy-key-reference',
      currentProfile: 'sandbox-profile',
    });
    const resolver = new AuthPrecedenceResolver(
      { providerId: 'test-provider' },
      {
        settingsService: settings,
        providerKeyStorage: new ProxyProviderKeyStorage(client),
        getActiveRuntimeContext: () =>
          createRuntimeContext('runtime-proxy-unreachable', settings),
      },
    );

    const result = await resolver.resolveAuthenticationResult();

    const failure = expectSafeFailure(result, 'proxy-unavailable', [
      CREDENTIAL_SECRET,
      CAPABILITY_SECRET,
      KEY_MATERIAL_SECRET,
    ]);
    expect(failure.diagnostics.proxyMode).toBe(true);
    expect(failure.diagnostics.proxyContacted).toBe(false);
    expect(failure.cause).toBeInstanceOf(Error);
  });

  it('reports broader connect failures before proxy contact', async () => {
    const socket = new net.Socket();
    vi.spyOn(net, 'createConnection').mockImplementation(() => {
      queueMicrotask(() => {
        socket.emit(
          'error',
          new Error('connect EHOSTUNREACH credential-proxy.sock'),
        );
      });
      return socket;
    });
    const socketPath = 'credential-proxy.sock';
    process.env[CREDENTIAL_SOCKET_ENV] = socketPath;
    const client = new ProxySocketClient(socketPath, CAPABILITY_SECRET);
    clients.push(client);
    const settings = createSettingsService({
      'auth-key-name': 'proxy-key-reference',
      currentProfile: 'sandbox-profile',
    });
    const resolver = new AuthPrecedenceResolver(
      { providerId: 'test-provider' },
      {
        settingsService: settings,
        providerKeyStorage: new ProxyProviderKeyStorage(client),
        getActiveRuntimeContext: () =>
          createRuntimeContext('runtime-proxy-unreachable', settings),
      },
    );

    const result = await resolver.resolveAuthenticationResult();

    const failure = expectSafeFailure(result, 'proxy-unavailable', [
      CREDENTIAL_SECRET,
      CAPABILITY_SECRET,
      KEY_MATERIAL_SECRET,
    ]);
    expect(failure.diagnostics.proxyContacted).toBe(false);
  });

  it('classifies a non-transport named-key exception as credential-source-failed and preserves its cause', async () => {
    const sourceError = new Error(
      `Key storage failed while handling ${KEY_MATERIAL_SECRET}`,
    );
    const keyStorage: IProviderKeyStorage = {
      getKey: async () => {
        throw sourceError;
      },
      listKeys: async () => [],
      hasKey: async () => false,
    };
    const settings = createSettingsService({
      'auth-key-name': 'configured-key-reference',
      currentProfile: 'sandbox-profile',
    });
    const resolver = new AuthPrecedenceResolver(
      { providerId: 'test-provider' },
      {
        settingsService: settings,
        providerKeyStorage: keyStorage,
        getActiveRuntimeContext: () =>
          createRuntimeContext('runtime-key-storage-failure', settings),
      },
    );

    const result = await resolver.resolveAuthenticationResult();

    const failure = expectSafeFailure(result, 'credential-source-failed', [
      CREDENTIAL_SECRET,
      CAPABILITY_SECRET,
      KEY_MATERIAL_SECRET,
    ]);
    expect(failure.diagnostics.proxyContacted).toBe(false);
    expect(failure.cause).toBe(sourceError);
  });

  it('classifies a lost real proxy connection as proxy-unavailable and preserves its cause', async () => {
    const harness = await startProxy('disconnect-on-request');
    harnesses.push(harness);
    process.env[CREDENTIAL_SOCKET_ENV] = harness.socketPath;
    const client = new ProxySocketClient(harness.socketPath, CAPABILITY_SECRET);
    clients.push(client);
    const proxyStorage = new ProxyProviderKeyStorage(client);
    let sourceCause: unknown;
    const observingStorage: IProviderKeyStorage = {
      getKey: async (name) => {
        try {
          return await proxyStorage.getKey(name);
        } catch (error) {
          sourceCause = error;
          throw error;
        }
      },
      listKeys: () => proxyStorage.listKeys(),
      hasKey: (name) => proxyStorage.hasKey(name),
    };
    const settings = createSettingsService({
      'auth-key-name': 'proxy-key-reference',
      currentProfile: 'sandbox-profile',
    });
    const resolver = new AuthPrecedenceResolver(
      { providerId: 'test-provider' },
      {
        settingsService: settings,
        providerKeyStorage: observingStorage,
        getActiveRuntimeContext: () =>
          createRuntimeContext('runtime-proxy-loss', settings),
      },
    );

    const result = await resolver.resolveAuthenticationResult();

    const failure = expectSafeFailure(result, 'proxy-unavailable', [
      CREDENTIAL_SECRET,
      CAPABILITY_SECRET,
      KEY_MATERIAL_SECRET,
    ]);
    expect(harness.requestCount()).toBe(1);
    expect(failure.diagnostics.proxyMode).toBe(true);
    expect(failure.diagnostics.proxyContacted).toBe(true);
    expect(failure.cause).toBe(sourceCause);
  });

  it('classifies an unauthorized real proxy handshake without leaking the capability token', async () => {
    const harness = await startProxy('unauthorized');
    harnesses.push(harness);
    process.env[CREDENTIAL_SOCKET_ENV] = harness.socketPath;
    const client = new ProxySocketClient(harness.socketPath, CAPABILITY_SECRET);
    clients.push(client);
    const settings = createSettingsService({
      'auth-key-name': 'proxy-key-reference',
      currentProfile: 'sandbox-profile',
    });
    const resolver = new AuthPrecedenceResolver(
      { providerId: 'test-provider' },
      {
        settingsService: settings,
        providerKeyStorage: new ProxyProviderKeyStorage(client),
        getActiveRuntimeContext: () =>
          createRuntimeContext('runtime-unauthorized', settings),
      },
    );

    const result = await resolver.resolveAuthenticationResult();

    const failure = expectSafeFailure(result, 'proxy-unauthorized', [
      CREDENTIAL_SECRET,
      CAPABILITY_SECRET,
      KEY_MATERIAL_SECRET,
    ]);
    expect(failure.diagnostics.proxyMode).toBe(true);
    expect(failure.diagnostics.proxyContacted).toBe(true);
    expect(failure.cause).toBeInstanceOf(Error);
  });

  it('classifies an unreadable auth keyfile as credential-source-failed and preserves its cause', async () => {
    const unreadablePath = path.join(
      os.tmpdir(),
      `${KEY_MATERIAL_SECRET}-${process.pid}-missing`,
    );
    const settings = createSettingsService({
      'auth-keyfile': unreadablePath,
      currentProfile: 'sandbox-profile',
    });
    const resolver = new AuthPrecedenceResolver(
      { providerId: 'test-provider' },
      {
        settingsService: settings,
        getActiveRuntimeContext: () =>
          createRuntimeContext('runtime-keyfile-failure', settings),
      },
    );

    const result = await resolver.resolveAuthenticationResult();

    const failure = expectSafeFailure(result, 'credential-source-failed', [
      CREDENTIAL_SECRET,
      CAPABILITY_SECRET,
      KEY_MATERIAL_SECRET,
      unreadablePath,
    ]);
    expect(failure.diagnostics.attemptedMechanisms).toContain(
      'global-auth-keyfile',
    );
    expect(failure.cause).toBeInstanceOf(Error);
  });

  it('classifies an OAuth token source exception instead of silently returning null', async () => {
    const sourceError = new Error(
      `OAuth source failed while handling ${CREDENTIAL_SECRET}`,
    );
    const settings = createSettingsService({
      currentProfile: 'sandbox-profile',
    });
    const oauthManager: OAuthManager = {
      getToken: async () => {
        throw sourceError;
      },
      isAuthenticated: async () => false,
    };
    const resolver = new AuthPrecedenceResolver(
      {
        providerId: 'test-provider',
        oauthProvider: 'test-oauth',
        isOAuthEnabled: true,
        supportsOAuth: true,
      },
      {
        settingsService: settings,
        oauthManager,
        getActiveRuntimeContext: () =>
          createRuntimeContext('runtime-oauth-failure', settings),
      },
    );

    const result = await resolver.resolveAuthenticationResult({
      includeOAuth: true,
    });

    const failure = expectSafeFailure(result, 'credential-source-failed', [
      CREDENTIAL_SECRET,
      CAPABILITY_SECRET,
      KEY_MATERIAL_SECRET,
    ]);
    expect(failure.diagnostics.attemptedMechanisms.at(-1)).toBe('oauth');
    expect(failure.cause).toBe(sourceError);
  });

  it('reports the most significant failure after every configured mechanism fails', async () => {
    process.env[CREDENTIAL_SOCKET_ENV] = path.join(
      os.tmpdir(),
      `issue3451-significance-${process.pid}.sock`,
    );
    const namedKeyError = new Error('local key storage failed');
    const proxyError = new Error('connect ENOENT issue3451-proxy.sock');
    const settings = createSettingsService({
      'auth-key-name': 'configured-key-reference',
      currentProfile: 'sandbox-profile',
    });
    const keyStorage: IProviderKeyStorage = {
      getKey: async () => {
        throw namedKeyError;
      },
      listKeys: async () => [],
      hasKey: async () => false,
    };
    const oauthManager: OAuthManager = {
      getToken: async () => {
        throw proxyError;
      },
      isAuthenticated: async () => false,
    };
    const resolver = new AuthPrecedenceResolver(
      {
        providerId: 'test-provider',
        oauthProvider: 'test-oauth',
        isOAuthEnabled: true,
        supportsOAuth: true,
      },
      {
        settingsService: settings,
        providerKeyStorage: keyStorage,
        oauthManager,
        getActiveRuntimeContext: () =>
          createRuntimeContext('runtime-significant-failure', settings),
      },
    );

    const result = await resolver.resolveAuthenticationResult({
      includeOAuth: true,
    });

    const failure = expectSafeFailure(result, 'proxy-unavailable', []);
    expect(failure.cause).toBe(proxyError);
    expect(failure.cause).not.toBe(namedKeyError);
    expect(failure.diagnostics.proxyContacted).toBe(false);
  });

  it('retains null-returning behavior for legacy authentication helpers after a source failure', async () => {
    const settings = createSettingsService({
      'auth-keyfile': path.join(
        os.tmpdir(),
        `${KEY_MATERIAL_SECRET}-${process.pid}-compatibility-missing`,
      ),
    });
    const resolver = new AuthPrecedenceResolver(
      {
        providerId: 'test-provider',
        isOAuthEnabled: true,
        supportsOAuth: true,
      },
      { settingsService: settings },
    );

    const authentication = await resolver.resolveAuthentication();
    const hasNonOAuth = await resolver.hasNonOAuthAuthentication();
    const oauthOnly = await resolver.isOAuthOnlyAvailable();

    expect(authentication).toBeNull();
    expect(hasNonOAuth).toBe(false);
    expect(oauthOnly).toBe(true);
  });

  it('keeps a warm runtime cached while a fresh runtime makes a failing live proxy call', async () => {
    const harness = await startProxy('token-then-disconnect');
    harnesses.push(harness);
    process.env[CREDENTIAL_SOCKET_ENV] = harness.socketPath;
    const tokenStore = new ProxyTokenStore(
      harness.socketPath,
      CAPABILITY_SECRET,
    );
    clients.push(tokenStore.getClient());
    const settings = createSettingsService({
      currentProfile: 'sandbox-profile',
    });
    const parentRuntime = createRuntimeContext('parent-runtime', settings);
    const subagentRuntime = createRuntimeContext(
      'parent-runtime#typescriptexpert#fresh',
      settings,
    );
    let activeRuntime = parentRuntime;
    const resolver = new AuthPrecedenceResolver(
      {
        providerId: 'test-provider',
        oauthProvider: 'test-oauth',
        isOAuthEnabled: true,
        supportsOAuth: true,
      },
      {
        settingsService: settings,
        oauthManager: createProxyOAuthManager(tokenStore),
        getActiveRuntimeContext: () => activeRuntime,
      },
    );

    const parentInitial = await resolver.resolveAuthenticationResult({
      includeOAuth: true,
    });
    const parentCached = await resolver.resolveAuthenticationResult({
      includeOAuth: true,
    });
    activeRuntime = subagentRuntime;
    const subagentFailure = await resolver.resolveAuthenticationResult({
      includeOAuth: true,
    });
    activeRuntime = parentRuntime;
    const parentAfterFailure = await resolver.resolveAuthenticationResult({
      includeOAuth: true,
    });

    expect(parentInitial.token).toBe(CREDENTIAL_SECRET);
    expect(parentCached.token).toBe(CREDENTIAL_SECRET);
    const failure = expectSafeFailure(subagentFailure, 'proxy-unavailable', [
      CREDENTIAL_SECRET,
      CAPABILITY_SECRET,
      KEY_MATERIAL_SECRET,
    ]);
    expect(failure.diagnostics.runtimeId).toBe(
      'parent-runtime#typescriptexpert#fresh',
    );
    expect(failure.diagnostics.proxyContacted).toBe(true);
    expect(parentAfterFailure.token).toBe(CREDENTIAL_SECRET);
    expect(harness.requestCount()).toBe(2);
  });
});
