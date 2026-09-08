/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  ProxySocketClient,
  type BucketStats,
  type OAuthToken,
  type TokenStore,
} from '@vybestack/llxprt-code-auth';
import type { ProviderKeyStorageLike } from '@vybestack/llxprt-code-storage';
import { CredentialProxyServer } from '../credential-proxy-server.js';

class BoundaryTokenStore implements TokenStore {
  private readonly tokens = new Map<string, OAuthToken>();
  private readonly stats = new Map<string, BucketStats>();

  private key(provider: string, bucket?: string): string {
    return `${provider}:${bucket ?? 'default'}`;
  }

  async saveToken(
    provider: string,
    token: OAuthToken,
    bucket?: string,
  ): Promise<void> {
    this.tokens.set(this.key(provider, bucket), token);
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
    return [
      ...new Set([...this.tokens.keys()].map((key) => key.split(':')[0])),
    ];
  }

  async listBuckets(provider: string): Promise<string[]> {
    const prefix = `${provider}:`;
    return [...this.tokens.keys()]
      .filter((key) => key.startsWith(prefix))
      .map((key) => key.slice(prefix.length));
  }

  async getBucketStats(
    provider: string,
    bucket: string,
  ): Promise<BucketStats | null> {
    return this.stats.get(this.key(provider, bucket)) ?? null;
  }

  setBucketStats(provider: string, bucket: string, stats: BucketStats): void {
    this.stats.set(this.key(provider, bucket), stats);
  }

  async acquireRefreshLock(): Promise<boolean> {
    return true;
  }

  async releaseRefreshLock(): Promise<void> {}

  async acquireAuthLock(): Promise<boolean> {
    return true;
  }

  async releaseAuthLock(): Promise<void> {}
}

class BoundaryKeyStorage implements ProviderKeyStorageLike {
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
    return [...this.keys.keys()];
  }

  async hasKey(name: string): Promise<boolean> {
    return this.keys.has(name);
  }
}

function makeToken(overrides: Partial<OAuthToken> = {}): OAuthToken {
  return {
    access_token: 'test-access-token',
    refresh_token: 'test-refresh-token',
    expiry: 9_999_999_999,
    token_type: 'Bearer',
    ...overrides,
  };
}

const CAPABILITY_TOKEN = 'a'.repeat(64);

describe('CredentialProxyServer payload validation', () => {
  let tokenStore: BoundaryTokenStore;
  let server: CredentialProxyServer | undefined;
  let client: ProxySocketClient | undefined;

  beforeEach(() => {
    tokenStore = new BoundaryTokenStore();
  });

  afterEach(async () => {
    client?.close();
    await server?.stop();
  });

  async function start(capabilityToken?: string): Promise<ProxySocketClient> {
    server = new CredentialProxyServer({
      tokenStore,
      providerKeyStorage: new BoundaryKeyStorage(),
      capabilityToken,
    });
    const socketPath = await server.start();
    client = new ProxySocketClient(socketPath, capabilityToken);
    await client.ensureConnected();
    return client;
  }

  it('rejects a wrong-typed get_token bucket with the provider message', async () => {
    const connectedClient = await start();
    const response = await connectedClient.request('get_token', {
      provider: 'anthropic',
      bucket: 42,
    });
    expect(response).toMatchObject({
      ok: false,
      code: 'INVALID_REQUEST',
      error: 'Missing provider',
    });
  });

  it('rejects a wrong-typed save_token bucket with the existing message', async () => {
    const connectedClient = await start();
    const response = await connectedClient.request('save_token', {
      provider: 'anthropic',
      bucket: 42,
      token: makeToken(),
    });
    expect(response).toMatchObject({
      ok: false,
      code: 'INVALID_REQUEST',
      error: 'Missing provider or token',
    });
  });

  it('rejects a wrong-typed remove_token bucket with the provider message', async () => {
    const connectedClient = await start();
    const response = await connectedClient.request('remove_token', {
      provider: 'anthropic',
      bucket: [],
    });
    expect(response).toMatchObject({
      ok: false,
      code: 'INVALID_REQUEST',
      error: 'Missing provider',
    });
  });

  it('rejects a wrong-typed list_buckets provider with the provider message', async () => {
    const connectedClient = await start();
    const response = await connectedClient.request('list_buckets', {
      provider: ['anthropic'],
    });
    expect(response).toMatchObject({
      ok: false,
      code: 'INVALID_REQUEST',
      error: 'Missing provider',
    });
  });

  it('rejects a wrong-typed get_api_key name with the existing message', async () => {
    const connectedClient = await start();
    const response = await connectedClient.request('get_api_key', {
      name: { provider: 'anthropic' },
    });
    expect(response).toMatchObject({
      ok: false,
      code: 'INVALID_REQUEST',
      error: 'Missing name',
    });
  });

  it('rejects a wrong-typed has_api_key name with the existing message', async () => {
    const connectedClient = await start();
    const response = await connectedClient.request('has_api_key', {
      name: 42,
    });
    expect(response).toMatchObject({
      ok: false,
      code: 'INVALID_REQUEST',
      error: 'Missing name',
    });
  });

  it('rejects a wrong-typed get_bucket_stats bucket with the provider message', async () => {
    const connectedClient = await start();
    const response = await connectedClient.request('get_bucket_stats', {
      provider: 'anthropic',
      bucket: false,
    });
    expect(response).toMatchObject({
      ok: false,
      code: 'INVALID_REQUEST',
      error: 'Missing provider',
    });
  });

  it('rejects a wrong-typed refresh_token provider with the provider message', async () => {
    const connectedClient = await start();
    const response = await connectedClient.request('refresh_token', {
      provider: 42,
    });
    expect(response).toMatchObject({
      ok: false,
      code: 'INVALID_REQUEST',
      error: 'Missing provider',
    });
  });

  it('rejects a wrong-typed refresh_token bucket with the provider message', async () => {
    const connectedClient = await start();
    const response = await connectedClient.request('refresh_token', {
      provider: 'anthropic',
      bucket: { name: 'work' },
    });
    expect(response).toMatchObject({
      ok: false,
      code: 'INVALID_REQUEST',
      error: 'Missing provider',
    });
  });

  it('rejects a malformed saved token without altering storage', async () => {
    const connectedClient = await start();

    const malformedResponse = await connectedClient.request('save_token', {
      provider: 'anthropic',
      token: { access_token: 42, expiry: 'later', token_type: 'Bearer' },
    });
    expect(malformedResponse).toMatchObject({
      ok: false,
      code: 'INVALID_REQUEST',
      error: 'Missing provider or token',
    });
    expect(await tokenStore.getToken('anthropic')).toBeNull();
  });

  it('preserves a valid saved token after a rejected save underneath it', async () => {
    const connectedClient = await start();
    const saved = makeToken({ access_token: 'existing-token' });
    await tokenStore.saveToken('anthropic', saved);

    await connectedClient.request('save_token', {
      provider: 'anthropic',
      token: { access_token: 42, expiry: 'later', token_type: 'Bearer' },
    });

    expect(await tokenStore.getToken('anthropic')).toMatchObject({
      access_token: 'existing-token',
      expiry: saved.expiry,
      token_type: saved.token_type,
    });
  });

  it('stores a valid saved token with its explicit refresh_token', async () => {
    const connectedClient = await start();

    const validToken = makeToken({
      access_token: 'valid-token',
      refresh_token: 'new-rt',
    });
    const validResponse = await connectedClient.request('save_token', {
      provider: 'anthropic',
      token: {
        access_token: 'valid-token',
        refresh_token: 'new-rt',
        expiry: validToken.expiry,
        token_type: 'Bearer',
      },
    });
    expect(validResponse.ok).toBe(true);
    const stored = await tokenStore.getToken('anthropic');
    expect(stored?.access_token).toBe('valid-token');
  });

  it('keeps the host refresh_token when a saved token omits one', async () => {
    const connectedClient = await start();
    await tokenStore.saveToken('anthropic', {
      access_token: 'host-token',
      refresh_token: 'host-rt',
      expiry: 9_999_999_999,
      token_type: 'Bearer',
    });

    const validToken = makeToken({ access_token: 'incoming-token' });
    const validResponse = await connectedClient.request('save_token', {
      provider: 'anthropic',
      token: {
        access_token: 'incoming-token',
        expiry: validToken.expiry,
        token_type: 'Bearer',
      },
    });
    expect(validResponse.ok).toBe(true);
    const stored = await tokenStore.getToken('anthropic');
    expect(stored?.access_token).toBe('incoming-token');
    expect(stored?.refresh_token).toBe('host-rt');
  });

  it('preserves a saved token extension field', async () => {
    const connectedClient = await start();

    const token = makeToken({ access_token: 'ext-token' });
    const response = await connectedClient.request('save_token', {
      provider: 'anthropic',
      token: {
        access_token: 'ext-token',
        account_id: 'acct-1',
        expiry: token.expiry,
        token_type: 'Bearer',
      },
    });
    expect(response.ok).toBe(true);
    const stored = await tokenStore.getToken('anthropic');
    expect(Reflect.get(stored ?? {}, 'account_id')).toBe('acct-1');
  });

  it('rejects malformed outbound token data', async () => {
    const malformedToken = makeToken();
    Reflect.set(malformedToken, 'expiry', 'later');
    await tokenStore.saveToken('anthropic', malformedToken);
    const connectedClient = await start();

    const tokenResponse = await connectedClient.request('get_token', {
      provider: 'anthropic',
    });
    expect(tokenResponse.code).toBe('INTERNAL_ERROR');
    expect(tokenResponse.ok).toBe(false);
  });

  it('rejects malformed outbound bucket stats', async () => {
    const malformedStats: BucketStats = {
      bucket: 'default',
      requestCount: 4,
      percentage: 20,
    };
    Reflect.set(malformedStats, 'percentage', 'twenty');
    tokenStore.setBucketStats('anthropic', 'default', malformedStats);
    const connectedClient = await start();

    const statsResponse = await connectedClient.request('get_bucket_stats', {
      provider: 'anthropic',
      bucket: 'default',
    });
    expect(statsResponse.code).toBe('INTERNAL_ERROR');
    expect(statsResponse.ok).toBe(false);
  });

  it('preserves an empty bucket name in the sandbox stats response', async () => {
    const connectedClient = await start(CAPABILITY_TOKEN);

    const response = await connectedClient.request('get_bucket_stats', {
      provider: 'anthropic',
      bucket: '',
    });

    expect(response).toMatchObject({
      ok: true,
      data: { bucket: '', requestCount: 0, percentage: 0 },
    });
  });
});
