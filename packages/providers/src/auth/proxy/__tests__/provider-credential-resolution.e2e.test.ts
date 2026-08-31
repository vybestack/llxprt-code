/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  AuthPrecedenceResolver,
  CredentialResolutionError,
  runtimeScopedStates,
  type IProviderRuntimeContext,
  type OAuthManager,
} from '@vybestack/llxprt-code-auth';
import type {
  BucketStats,
  OAuthToken,
  TokenStore,
} from '@vybestack/llxprt-code-core';
import {
  clearActiveProviderRuntimeContext,
  setActiveProviderRuntimeContext,
} from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { createProviderCallOptions } from '@vybestack/llxprt-code-core/test-utils/providerCallOptions.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import type { ProviderKeyStorageLike } from '@vybestack/llxprt-code-storage';
import {
  BaseProvider,
  type NormalizedGenerateChatOptions,
} from '../../../BaseProvider.js';
import type { IModel } from '../../../IModel.js';
import { resolveRuntimeAuthToken } from '../../../utils/authToken.js';
import { createCredentialResolutionError } from '../../../utils/credentialResolutionError.js';
import { CredentialProxyServer } from '../credential-proxy-server.js';
import {
  createTokenStore,
  resetFactorySingletons,
} from '../credential-store-factory.js';

const PROFILE = 'issue3451-sandbox-profile';
const PROVIDER = 'issue3451-proxy-provider';
const MISSING_KEY_NAME = 'issue3451-missing-key';
const CREDENTIAL_SECRET = 'issue3451-live-credential-secret';

class CredentialProbeProvider extends BaseProvider {
  constructor(oauthManager: OAuthManager) {
    super({
      name: PROVIDER,
      isOAuthEnabled: true,
      supportsOAuth: true,
      oauthProvider: PROVIDER,
      oauthManager,
    });
  }

  protected supportsOAuth(): boolean {
    return true;
  }

  getDefaultModel(): string {
    return 'credential-probe-model';
  }

  async getModels(): Promise<IModel[]> {
    return [
      {
        id: this.getDefaultModel(),
        name: this.getDefaultModel(),
        provider: PROVIDER,
        supportedToolFormats: [],
      },
    ];
  }

  protected async *generateChatCompletionWithOptions(
    options: NormalizedGenerateChatOptions,
  ): AsyncIterableIterator<IContent> {
    const token = await resolveRuntimeAuthToken(options.resolved.authToken);
    if (token === undefined || token === '') {
      throw createCredentialResolutionError(options, this.name);
    }
    yield {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'proxy credential accepted' }],
    };
  }
}

class InMemoryTokenStore implements TokenStore {
  private readonly tokens = new Map<string, OAuthToken>();

  constructor(token?: OAuthToken) {
    if (token !== undefined) {
      this.tokens.set(PROVIDER, token);
    }
  }

  async saveToken(
    provider: string,
    token: OAuthToken,
    _bucket?: string,
  ): Promise<void> {
    this.tokens.set(provider, token);
  }

  async getToken(
    provider: string,
    _bucket?: string,
  ): Promise<OAuthToken | null> {
    return this.tokens.get(provider) ?? null;
  }

  async removeToken(provider: string, _bucket?: string): Promise<void> {
    this.tokens.delete(provider);
  }

  async listProviders(): Promise<string[]> {
    return [...this.tokens.keys()];
  }

  async listBuckets(_provider: string): Promise<string[]> {
    return [];
  }

  async getBucketStats(
    _provider: string,
    _bucket: string,
  ): Promise<BucketStats | null> {
    return null;
  }

  async acquireRefreshLock(
    _provider: string,
    _options?: { waitMs?: number; bucket?: string },
  ): Promise<boolean> {
    return true;
  }

  async releaseRefreshLock(
    _provider: string,
    _bucket?: string,
  ): Promise<void> {}

  async acquireAuthLock(
    _provider: string,
    _options?: { waitMs?: number; bucket?: string },
  ): Promise<boolean> {
    return true;
  }

  async releaseAuthLock(_provider: string, _bucket?: string): Promise<void> {}
}

class EmptyProviderKeyStorage implements ProviderKeyStorageLike {
  async saveKey(_name: string, _apiKey: string): Promise<void> {}

  async getKey(_name: string): Promise<string | null> {
    return null;
  }

  async deleteKey(_name: string): Promise<boolean> {
    return false;
  }

  async listKeys(): Promise<string[]> {
    return [];
  }

  async hasKey(_name: string): Promise<boolean> {
    return false;
  }
}

interface RunningProxy {
  readonly server: CredentialProxyServer;
  readonly socketPath: string;
}

function createSettings(): SettingsService {
  const settings = new SettingsService();
  settings.set('activeProvider', PROVIDER);
  settings.setCurrentProfileName(PROFILE);
  return settings;
}

function createProxyOAuthManager(): OAuthManager {
  const tokenStore = createTokenStore();
  return {
    getToken: async (provider) => {
      const token = await tokenStore.getToken(provider);
      return token?.access_token ?? null;
    },
    isAuthenticated: async () => true,
  };
}

function createCallOptions(settings: SettingsService, runtimeId: string) {
  const options = createProviderCallOptions({
    providerName: PROVIDER,
    settings,
    runtimeId,
    contents: [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'test proxy credential' }],
      },
    ],
  });
  setActiveProviderRuntimeContext(options.runtime);
  return options;
}

async function callProvider(
  provider: CredentialProbeProvider,
  settings: SettingsService,
  runtimeId: string,
): Promise<void> {
  const options = createCallOptions(settings, runtimeId);
  await provider.generateChatCompletion(options).next();
}

async function captureCredentialFailure(
  provider: CredentialProbeProvider,
  settings: SettingsService,
  runtimeId: string,
): Promise<CredentialResolutionError> {
  try {
    await callProvider(provider, settings, runtimeId);
  } catch (error) {
    if (error instanceof CredentialResolutionError) {
      return error;
    }
    throw error;
  }
  throw new Error('Expected credential resolution to fail');
}

describe('Provider credential resolution through a sandbox proxy', () => {
  const proxies: RunningProxy[] = [];
  let temporaryDirectory: string;
  let originalSocket: string | undefined;

  beforeEach(async () => {
    temporaryDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'llxprt-provider-credential-e2e-'),
    );
    originalSocket = process.env.LLXPRT_CREDENTIAL_SOCKET;
    delete process.env.LLXPRT_CREDENTIAL_SOCKET;
    resetFactorySingletons();
    runtimeScopedStates.clear();
  });

  afterEach(async () => {
    clearActiveProviderRuntimeContext();
    resetFactorySingletons();
    runtimeScopedStates.clear();
    for (const proxy of proxies.splice(0)) {
      await proxy.server.stop();
    }
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
    if (originalSocket === undefined) {
      delete process.env.LLXPRT_CREDENTIAL_SOCKET;
    } else {
      process.env.LLXPRT_CREDENTIAL_SOCKET = originalSocket;
    }
  });

  async function startProxy(withCredential: boolean): Promise<RunningProxy> {
    const token: OAuthToken | undefined = withCredential
      ? {
          access_token: CREDENTIAL_SECRET,
          token_type: 'Bearer',
          expiry: Math.floor(Date.now() / 1000) + 3600,
        }
      : undefined;
    const server = new CredentialProxyServer({
      tokenStore: new InMemoryTokenStore(token),
      providerKeyStorage: new EmptyProviderKeyStorage(),
      socketDir: temporaryDirectory,
    });
    const socketPath = await server.start();
    const proxy = { server, socketPath };
    proxies.push(proxy);
    process.env.LLXPRT_CREDENTIAL_SOCKET = socketPath;
    return proxy;
  }

  function createProvider(): CredentialProbeProvider {
    return new CredentialProbeProvider(createProxyOAuthManager());
  }

  it('resolves a credential for a fresh subagent-shaped runtime while the proxy is available', async () => {
    await startProxy(true);
    const settings = createSettings();
    const provider = createProvider();

    await expect(
      callProvider(
        provider,
        settings,
        'session#typescriptexpert#credential-present',
      ),
    ).resolves.toBeUndefined();
  });

  it('classifies a closed proxy on a subagent first call while a parent runtime remains warm', async () => {
    const proxy = await startProxy(true);
    const settings = createSettings();
    const provider = createProvider();
    const parentRuntimeId = 'session-parent-runtime';
    const parentRuntime = createCallOptions(settings, parentRuntimeId).runtime;
    const getActiveRuntimeContext = (): IProviderRuntimeContext => ({
      ...parentRuntime,
      settingsService: settings,
      runtimeId: parentRuntimeId,
    });
    const parentResolver = new AuthPrecedenceResolver(
      {
        isOAuthEnabled: true,
        supportsOAuth: true,
        oauthProvider: PROVIDER,
        providerId: PROVIDER,
      },
      {
        oauthManager: createProxyOAuthManager(),
        settingsService: settings,
        getActiveRuntimeContext,
      },
    );

    const parentInitial = await parentResolver.resolveAuthenticationResult({
      settingsService: settings,
      includeOAuth: true,
    });
    expect(parentInitial.token).toBe(CREDENTIAL_SECRET);
    await proxy.server.stop();
    proxies.splice(proxies.indexOf(proxy), 1);

    const failure = await captureCredentialFailure(
      provider,
      settings,
      'session#typescriptexpert#proxy-closed',
    );

    expect(failure.kind).toBe('proxy-unavailable');
    expect(failure.diagnostics.provider).toBe(PROVIDER);
    expect(failure.diagnostics.profile).toBe(PROFILE);
    expect(failure.diagnostics.proxyContacted).toBe(true);
    expect(failure.message).not.toContain(CREDENTIAL_SECRET);

    const parentAfterFailure = await parentResolver.resolveAuthenticationResult(
      {
        settingsService: settings,
        includeOAuth: true,
      },
    );
    expect(parentAfterFailure.token).toBe(CREDENTIAL_SECRET);
  });

  it('classifies an absent proxy credential distinctly from proxy transport failure', async () => {
    await startProxy(false);
    const settings = createSettings();
    settings.set('auth-key-name', MISSING_KEY_NAME);
    const provider = createProvider();

    const failure = await captureCredentialFailure(
      provider,
      settings,
      'session#typescriptexpert#credential-absent',
    );

    expect(failure.kind).toBe('credential-not-found');
    expect(failure.kind).not.toBe('proxy-unavailable');
    expect(failure.diagnostics.provider).toBe(PROVIDER);
    expect(failure.diagnostics.profile).toBe(PROFILE);
    expect(failure.diagnostics.proxyContacted).toBe(true);
  });
});
