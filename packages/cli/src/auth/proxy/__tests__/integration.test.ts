/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type {
  OAuthToken,
  ProviderKeyStorage,
  TokenStore,
} from '@vybestack/llxprt-code-core';
import {
  ProxyProviderKeyStorage,
  ProxySocketClient,
  ProxyTokenStore,
} from '@vybestack/llxprt-code-core';
import {
  createProviderKeyStorage,
  createTokenStore,
  resetFactorySingletons,
} from '../credential-store-factory.js';
import { CredentialProxyServer } from '../credential-proxy-server.js';
import { createAndStartProxy, stopProxy } from '../sandbox-proxy-lifecycle.js';

/** @plan:PLAN-20250214-CREDPROXY.P31 */

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
      if (provider) {
        providers.add(provider);
      }
    }
    return Array.from(providers);
  }

  async listBuckets(provider: string): Promise<string[]> {
    const buckets: string[] = [];
    for (const composite of this.tokens.keys()) {
      const [tokenProvider, bucket] = composite.split('::');
      if (tokenProvider === provider && bucket) {
        buckets.push(bucket);
      }
    }
    return buckets;
  }

  async getBucketStats(_provider: string, _bucket: string): Promise<null> {
    return null;
  }

  async acquireRefreshLock(
    _provider: string,
    _options?: { waitMs?: number; staleMs?: number; bucket?: string },
  ): Promise<boolean> {
    return true;
  }

  async releaseRefreshLock(_provider: string, _bucket?: string): Promise<void> {
    // no-op for integration test storage
  }
}

class InMemoryProviderKeyStorage {
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

type StartedServer = {
  readonly server: CredentialProxyServer;
  readonly socketPath: string;
  readonly tokenStore: InMemoryTokenStore;
  readonly keyStorage: InMemoryProviderKeyStorage;
};

describe('proxy integration (phase 31)', () => {
  let tmpDir: string;
  let priorSocketEnv: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-'));
    priorSocketEnv = process.env.LLXPRT_CREDENTIAL_SOCKET;
    delete process.env.LLXPRT_CREDENTIAL_SOCKET;
    resetFactorySingletons();
  });

  afterEach(async () => {
    try {
      await stopProxy();
    } catch {
      // best-effort cleanup during red-state TDD phase
    }

    if (priorSocketEnv === undefined) {
      delete process.env.LLXPRT_CREDENTIAL_SOCKET;
    } else {
      process.env.LLXPRT_CREDENTIAL_SOCKET = priorSocketEnv;
    }

    resetFactorySingletons();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  async function startServer(): Promise<StartedServer> {
    const tokenStore = new InMemoryTokenStore();
    const keyStorage = new InMemoryProviderKeyStorage();
    const server = new CredentialProxyServer({
      tokenStore,
      providerKeyStorage: keyStorage as unknown as ProviderKeyStorage,
      socketDir: tmpDir,
    });
    const socketPath = await server.start();
    return { server, socketPath, tokenStore, keyStorage };
  }

  async function withServer(
    run: (started: StartedServer) => Promise<void>,
  ): Promise<void> {
    const started = await startServer();
    try {
      await run(started);
    } finally {
      await started.server.stop();
    }
  }

  it('selects ProxyTokenStore when credential socket env var is present', () => {
    // @requirement R2.1
    // @scenario Factory should detect sandbox mode and return proxy token store.
    process.env.LLXPRT_CREDENTIAL_SOCKET = path.join(
      tmpDir,
      'factory-proxy.sock',
    );
    const store = createTokenStore();
    expect(store).toBeInstanceOf(ProxyTokenStore);
  });

  it('selects KeyringTokenStore when credential socket env var is absent', () => {
    // @requirement R2.2
    // @scenario Factory should detect host mode and return direct token store.
    delete process.env.LLXPRT_CREDENTIAL_SOCKET;
    const store = createTokenStore();
    expect(store).not.toBeInstanceOf(ProxyTokenStore);
  });

  it('returns the same token store instance across repeated factory calls', () => {
    // @requirement R2.4
    // @scenario Token store factory should memoize and reuse singleton instance.
    process.env.LLXPRT_CREDENTIAL_SOCKET = path.join(
      tmpDir,
      'factory-singleton.sock',
    );
    const first = createTokenStore();
    const second = createTokenStore();
    expect(first).toBe(second);
  });

  it('selects ProxyProviderKeyStorage when credential socket env var is present', () => {
    // @requirement R2.3
    // @scenario Key storage factory should return proxy-backed implementation in sandbox mode.
    process.env.LLXPRT_CREDENTIAL_SOCKET = path.join(
      tmpDir,
      'factory-keys.sock',
    );
    const storage = createProviderKeyStorage();
    expect(storage).toBeInstanceOf(ProxyProviderKeyStorage);
  });

  it('returns lifecycle handle with stop function when proxy is started', async () => {
    // @requirement R25.1
    // @scenario Lifecycle helper should create and return a stop-capable proxy handle.
    const handle = await createAndStartProxy({
      socketPath: path.join(tmpDir, 'lifecycle.sock'),
    });
    expect(typeof handle.stop).toBe('function');
  });

  it('supports create/stop lifecycle sequence through helper API', async () => {
    // @requirement R25.3
    // @scenario Lifecycle helper should start then stop proxy without leaking resources.
    const handle = await createAndStartProxy({
      socketPath: path.join(tmpDir, 'lifecycle-stop.sock'),
    });
    await stopProxy();
    await expect(handle.stop()).resolves.toBeUndefined();
  });

  it('creates socket file on server start and removes it on server stop', async () => {
    // @requirement R25.1
    // @scenario Real server lifecycle should materialize then clean up Unix socket file.
    let socketPath = '';
    await withServer(async (started) => {
      socketPath = started.socketPath;
      expect(fs.existsSync(started.socketPath)).toBe(true);
    });
    expect(fs.existsSync(socketPath)).toBe(false);
  });

  it('builds socket path using pid+nonce naming convention', async () => {
    // @requirement R25.2
    // @scenario Generated socket path should include process id and random nonce suffix.
    await withServer(async ({ socketPath }) => {
      const socketFile = path.basename(socketPath);
      // Socket filename format: {pid}-{base64url nonce}.sock
      // base64url uses [A-Za-z0-9_-], 128 bits = 22 chars
      expect(socketFile).toMatch(
        new RegExp(`^${process.pid}-[A-Za-z0-9_-]{22}\\.sock$`),
      );
    });
  });

  it('returns sanitized token over proxy getToken when host token has refresh_token', async () => {
    // @requirement R10.1
    // @scenario Host-stored refresh token must be stripped before sandbox receives token payload.
    await withServer(async ({ socketPath, tokenStore }) => {
      await tokenStore.saveToken(
        'anthropic',
        {
          access_token: 'acc-read',
          refresh_token: 'ref-secret',
          expiry: Date.now() + 60_000,
          token_type: 'Bearer',
        },
        'default',
      );

      const proxyStore = new ProxyTokenStore(socketPath);
      const token = await proxyStore.getToken('anthropic', 'default');

      expect(token?.access_token).toBe('acc-read');
      expect('refresh_token' in (token ?? {})).toBe(false);
    });
  });

  it('persists token via saveToken round-trip and preserves host refresh_token', async () => {
    // @requirement R8.1
    // @scenario Sandbox saveToken should strip sandbox refresh_token while preserving an existing host refresh_token.
    await withServer(async ({ socketPath, tokenStore }) => {
      await tokenStore.saveToken(
        'anthropic',
        {
          access_token: 'acc-host',
          refresh_token: 'ref-host',
          expiry: Date.now() + 60_000,
          token_type: 'Bearer',
        },
        'primary',
      );

      const proxyStore = new ProxyTokenStore(socketPath);
      await proxyStore.saveToken(
        'anthropic',
        {
          access_token: 'acc-save',
          refresh_token: 'ref-save',
          expiry: Date.now() + 60_000,
          token_type: 'Bearer',
        },
        'primary',
      );

      const hostToken = await tokenStore.getToken('anthropic', 'primary');
      expect(hostToken?.access_token).toBe('acc-save');
      expect(hostToken?.refresh_token).toBe('ref-host');
    });
  });

  it('removes stored token via removeToken round-trip', async () => {
    // @requirement R8.3
    // @scenario Sandbox removeToken should delete host token entry through proxy path.
    await withServer(async ({ socketPath, tokenStore }) => {
      await tokenStore.saveToken(
        'anthropic',
        {
          access_token: 'acc-delete',
          expiry: Date.now() + 60_000,
          token_type: 'Bearer',
        },
        'delete-me',
      );

      const proxyStore = new ProxyTokenStore(socketPath);
      await proxyStore.removeToken('anthropic', 'delete-me');

      const hostToken = await tokenStore.getToken('anthropic', 'delete-me');
      expect(hostToken).toBeNull();
    });
  });

  it('returns provider list from host token store via proxy', async () => {
    // @requirement R8.4
    // @scenario listProviders should return host provider names across socket boundary.
    await withServer(async ({ socketPath, tokenStore }) => {
      await tokenStore.saveToken(
        'anthropic',
        {
          access_token: 'acc-a',
          expiry: Date.now() + 60_000,
          token_type: 'Bearer',
        },
        'bucket-a',
      );
      await tokenStore.saveToken(
        'openai',
        {
          access_token: 'acc-o',
          expiry: Date.now() + 60_000,
          token_type: 'Bearer',
        },
        'bucket-o',
      );

      const proxyStore = new ProxyTokenStore(socketPath);
      const providers = await proxyStore.listProviders();

      expect(providers).toContain('anthropic');
      expect(providers).toContain('openai');
    });
  });

  it('returns bucket list for provider from host token store via proxy', async () => {
    // @requirement R8.5
    // @scenario listBuckets should surface provider buckets maintained on host side.
    await withServer(async ({ socketPath, tokenStore }) => {
      await tokenStore.saveToken(
        'anthropic',
        {
          access_token: 'acc-1',
          expiry: Date.now() + 60_000,
          token_type: 'Bearer',
        },
        'bucket-1',
      );
      await tokenStore.saveToken(
        'anthropic',
        {
          access_token: 'acc-2',
          expiry: Date.now() + 60_000,
          token_type: 'Bearer',
        },
        'bucket-2',
      );

      const proxyStore = new ProxyTokenStore(socketPath);
      const buckets = await proxyStore.listBuckets('anthropic');

      expect(buckets).toContain('bucket-1');
      expect(buckets).toContain('bucket-2');
    });
  });

  it('returns bucket stats payload through proxy for provider+bucket pair', async () => {
    // @requirement R8.6
    // @scenario getBucketStats should round-trip and return stats or null contractually.
    await withServer(async ({ socketPath }) => {
      const proxyStore = new ProxyTokenStore(socketPath);
      const stats = await proxyStore.getBucketStats('anthropic', 'default');
      expect(stats === null || typeof stats === 'object').toBe(true);
    });
  });

  it('reads API key over proxy from host-side provider key storage', async () => {
    // @requirement R9.1
    // @scenario getKey should round-trip through proxy and return host-side key value.
    await withServer(async ({ socketPath, keyStorage }) => {
      await keyStorage.saveKey('anthropic', 'api-key-anthropic');
      const proxyKeys = new ProxyProviderKeyStorage(
        new ProxySocketClient(socketPath),
      );

      const key = await proxyKeys.getKey('anthropic');
      expect(key).toBe('api-key-anthropic');
    });
  });

  it('lists API keys over proxy from host-side provider key storage', async () => {
    // @requirement R9.2
    // @scenario listKeys should return host key names through real socket channel.
    await withServer(async ({ socketPath, keyStorage }) => {
      await keyStorage.saveKey('anthropic', 'api-key-anthropic');
      await keyStorage.saveKey('openai', 'api-key-openai');
      const proxyKeys = new ProxyProviderKeyStorage(
        new ProxySocketClient(socketPath),
      );

      const keys = await proxyKeys.listKeys();
      expect(keys).toContain('anthropic');
      expect(keys).toContain('openai');
    });
  });

  it('checks key existence over proxy using host-side provider key storage', async () => {
    // @requirement R9.3
    // @scenario hasKey should reflect host-side key presence through proxy transport.
    await withServer(async ({ socketPath, keyStorage }) => {
      await keyStorage.saveKey('anthropic', 'api-key-anthropic');
      const proxyKeys = new ProxyProviderKeyStorage(
        new ProxySocketClient(socketPath),
      );

      const exists = await proxyKeys.hasKey('anthropic');
      expect(exists).toBe(true);
    });
  });

  it('blocks saveKey in sandbox mode with explicit unsupported-operation message', async () => {
    // @requirement R9.4
    // @scenario saveKey should reject in sandbox mode to enforce read-only key policy.
    await withServer(async ({ socketPath }) => {
      const proxyKeys = new ProxyProviderKeyStorage(
        new ProxySocketClient(socketPath),
      );
      await expect(proxyKeys.saveKey('anthropic', 'forbidden')).rejects.toThrow(
        'API key management is not available in sandbox mode',
      );
    });
  });

  it('blocks deleteKey in sandbox mode with explicit unsupported-operation message', async () => {
    // @requirement R9.4
    // @scenario deleteKey should reject in sandbox mode to enforce read-only key policy.
    await withServer(async ({ socketPath }) => {
      const proxyKeys = new ProxyProviderKeyStorage(
        new ProxySocketClient(socketPath),
      );
      await expect(proxyKeys.deleteKey('anthropic')).rejects.toThrow(
        'API key management is not available in sandbox mode',
      );
    });
  });

  it('allows access to all providers without restrictions', async () => {
    await withServer(async ({ socketPath, tokenStore }) => {
      await tokenStore.saveToken(
        'openai',
        {
          access_token: 'openai-token',
          expiry: Math.floor(Date.now() / 1000) + 3600,
          token_type: 'Bearer',
        },
        'default',
      );
      await tokenStore.saveToken(
        'anthropic',
        {
          access_token: 'anthropic-token',
          expiry: Math.floor(Date.now() / 1000) + 3600,
          token_type: 'Bearer',
        },
        'default',
      );

      const proxyStore = new ProxyTokenStore(socketPath);
      const openaiToken = await proxyStore.getToken('openai', 'default');
      expect(openaiToken).not.toBeNull();
      expect(openaiToken!.access_token).toBe('openai-token');

      const anthropicToken = await proxyStore.getToken('anthropic', 'default');
      expect(anthropicToken).not.toBeNull();
      expect(anthropicToken!.access_token).toBe('anthropic-token');
    });
  });

  it('surfaces hard error to client when proxy connection is lost', async () => {
    // @requirement R24.2
    // @scenario After server stop, further client requests should raise transport error.
    const started = await startServer();
    try {
      const proxyStore = new ProxyTokenStore(started.socketPath);
      await proxyStore.listProviders();
      await started.server.stop();
      await expect(proxyStore.listProviders()).rejects.toThrow(
        /Credential proxy connection lost|connect|ECONNREFUSED|ENOENT/i,
      );
    } finally {
      await started.server.stop();
    }
  });
});
