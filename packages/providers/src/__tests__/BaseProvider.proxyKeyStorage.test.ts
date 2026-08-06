/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type {
  OAuthToken,
  TokenStore,
  BucketStats,
} from '@vybestack/llxprt-code-core';
import type { ProviderKeyStorageLike } from '@vybestack/llxprt-code-storage';
import type { IProviderKeyStorage } from '@vybestack/llxprt-code-auth';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import {
  createProviderRuntimeContext,
  setActiveProviderRuntimeContext,
} from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { createRuntimeConfigStub } from '@vybestack/llxprt-code-core/test-utils/runtime.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  BaseProvider,
  type BaseProviderConfig,
  type NormalizedGenerateChatOptions,
} from '../BaseProvider.js';
import { CredentialProxyServer } from '../auth/proxy/credential-proxy-server.js';
import { resetFactorySingletons } from '../auth/proxy/credential-store-factory.js';

const userMessage = (text: string): IContent => ({
  speaker: 'human',
  blocks: [{ type: 'text', text }],
});

/**
 * Minimal in-memory TokenStore for the proxy server. These tests only exercise
 * provider-key reads, so token operations are unused but required by the
 * TokenStore contract.
 */
class InMemoryTokenStore implements TokenStore {
  private readonly tokens = new Map<string, OAuthToken>();

  private key(provider: string, bucket?: string): string {
    return `${provider}::${bucket ?? 'default'}`;
  }

  async saveToken(
    provider: string,
    token: OAuthToken,
    bucket?: string,
  ): Promise<void> {
    this.tokens.set(this.key(provider, bucket), { ...token });
  }

  async getToken(
    provider: string,
    bucket?: string,
  ): Promise<OAuthToken | null> {
    return this.tokens.get(this.key(provider, bucket)) ?? null;
  }

  async removeToken(provider: string, bucket?: string): Promise<void> {
    this.tokens.delete(this.key(provider, bucket));
  }

  async listProviders(): Promise<string[]> {
    const providers = new Set<string>();
    for (const composite of this.tokens.keys()) {
      const [provider] = composite.split('::');
      if (provider) providers.add(provider);
    }
    return Array.from(providers);
  }

  async listBuckets(provider: string): Promise<string[]> {
    const buckets: string[] = [];
    for (const composite of this.tokens.keys()) {
      const [tokenProvider, bucket] = composite.split('::');
      if (tokenProvider === provider && bucket) buckets.push(bucket);
    }
    return buckets;
  }

  async getBucketStats(
    _provider: string,
    bucket: string,
  ): Promise<BucketStats | null> {
    return { bucket, requestCount: 0, percentage: 0, lastUsed: undefined };
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

/** In-memory provider key storage serving a fixed set of keys. */
class InMemoryProviderKeyStorage implements ProviderKeyStorageLike {
  private readonly keys = new Map<string, string>();

  async saveKey(name: string, apiKey: string): Promise<void> {
    this.keys.set(name, apiKey);
  }

  async getKey(name: string): Promise<string | null> {
    return this.keys.get(name) ?? null;
  }

  async deleteKey(name: string): Promise<boolean> {
    return this.keys.delete(name);
  }

  async listKeys(): Promise<string[]> {
    return Array.from(this.keys.keys());
  }

  async hasKey(name: string): Promise<boolean> {
    return this.keys.has(name);
  }
}

class ProxyAwareProvider extends BaseProvider {
  capturedAuthToken = '';

  constructor(providerKeyStorage?: IProviderKeyStorage) {
    const config: BaseProviderConfig = { name: 'proxy-aware' };
    if (providerKeyStorage !== undefined) {
      config.providerKeyStorage = providerKeyStorage;
    }
    super(config);
  }

  async getModels(): Promise<never[]> {
    return [];
  }

  getDefaultModel(): string {
    return 'proxy-aware-model';
  }

  protected supportsOAuth(): boolean {
    return false;
  }

  protected generateChatCompletionWithOptions(
    options: NormalizedGenerateChatOptions,
  ): AsyncIterableIterator<IContent> {
    this.capturedAuthToken =
      typeof options.resolved.authToken === 'string'
        ? options.resolved.authToken
        : '';
    return (async function* () {})();
  }
}

function buildChatOptions(settings: SettingsService) {
  const config = createRuntimeConfigStub(settings);
  const runtime = createProviderRuntimeContext({
    runtimeId: `proxy-aware.${Math.random().toString(36).slice(2, 10)}`,
    settingsService: settings,
    config,
  });
  return { contents: [userMessage('hi')], settings, config, runtime };
}

const PROXY_SERVED_KEY = 'proxy-served-secret-key-2946';
const NAMED_KEY = 'my-named-key';

describe.sequential('#2946 BaseProvider proxy-aware key storage', () => {
  let tmpDir: string;
  let priorSocketEnv: string | undefined;
  let server: CredentialProxyServer | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bpp-'));
    priorSocketEnv = process.env.LLXPRT_CREDENTIAL_SOCKET;
    delete process.env.LLXPRT_CREDENTIAL_SOCKET;
    resetFactorySingletons();
  });

  afterEach(async () => {
    if (priorSocketEnv === undefined) {
      delete process.env.LLXPRT_CREDENTIAL_SOCKET;
    } else {
      process.env.LLXPRT_CREDENTIAL_SOCKET = priorSocketEnv;
    }
    resetFactorySingletons();
    if (server !== undefined) {
      // No catch: each test starts the server exactly once and never stops it,
      // so a failure here is a real teardown defect (an unreleased Unix socket
      // would break the next run) and should fail the test.
      await server.stop();
      server = undefined;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  async function startServerWithNamedKey(): Promise<string> {
    const keyStorage = new InMemoryProviderKeyStorage();
    await keyStorage.saveKey(NAMED_KEY, PROXY_SERVED_KEY);
    server = new CredentialProxyServer({
      tokenStore: new InMemoryTokenStore(),
      providerKeyStorage: keyStorage,
      socketDir: tmpDir,
    });
    return server.start();
  }

  it('resolves auth-key-name through the credential proxy socket', async () => {
    const socketPath = await startServerWithNamedKey();
    process.env.LLXPRT_CREDENTIAL_SOCKET = socketPath;

    const provider = new ProxyAwareProvider();
    const settings = new SettingsService();
    settings.set('activeProvider', 'proxy-aware');
    settings.set('auth-key-name', NAMED_KEY);
    const config = createRuntimeConfigStub(settings);
    setActiveProviderRuntimeContext({ settingsService: settings, config });
    provider.setRuntimeSettingsService(settings);

    await provider.generateChatCompletion(buildChatOptions(settings)).next();

    expect(provider.capturedAuthToken).toBe(PROXY_SERVED_KEY);
  });

  it('honours an explicitly injected config.providerKeyStorage over the factory default, even with a proxy socket set', async () => {
    // Start a proxy serving PROXY_SERVED_KEY. With a socket set, the factory
    // default would resolve to the proxy key. An explicitly injected storage
    // must win instead — proving the DI override is effective on the sandbox
    // path, which is the genuinely new behaviour.
    const socketPath = await startServerWithNamedKey();
    process.env.LLXPRT_CREDENTIAL_SOCKET = socketPath;

    const injectedKey = 'injected-key-wins-2946';
    const injectedStorage: IProviderKeyStorage = {
      getKey: async () => injectedKey,
      listKeys: async () => [],
      hasKey: async () => true,
    };

    const provider = new ProxyAwareProvider(injectedStorage);
    const settings = new SettingsService();
    settings.set('activeProvider', 'proxy-aware');
    settings.set('auth-key-name', NAMED_KEY);
    const config = createRuntimeConfigStub(settings);
    setActiveProviderRuntimeContext({ settingsService: settings, config });
    provider.setRuntimeSettingsService(settings);

    await provider.generateChatCompletion(buildChatOptions(settings)).next();

    expect(provider.capturedAuthToken).toBe(injectedKey);
  });
});
