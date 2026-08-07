/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { SettingsService } from '@vybestack/llxprt-code-settings';
import type {
  OAuthToken,
  TokenStore,
  BucketStats,
} from '@vybestack/llxprt-code-core';
import type { ProviderKeyStorageLike } from '@vybestack/llxprt-code-storage';
import { resolveCompressionProfileAuthToken } from './CompressionProfileResolver.js';
import { CredentialProxyServer } from '@vybestack/llxprt-code-providers/auth/proxy/credential-proxy-server.js';
import { resetFactorySingletons } from '@vybestack/llxprt-code-providers/auth.js';

const PROXY_SERVED_KEY = 'proxy-served-compression-key-2946';
const NAMED_KEY = 'compression-named-key';

/**
 * Minimal in-memory TokenStore for the proxy server. The compression-resolver
 * auth path only exercises provider-key reads, so token operations are unused
 * but required by the TokenStore contract.
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

/**
 * In-memory provider key storage that serves a fixed key, satisfying the
 * narrow ProviderKeyStorageLike interface the proxy server reads from.
 */
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

describe('#2946 CompressionProfileResolver proxy-aware key storage', () => {
  let tmpDir: string;
  let priorSocketEnv: string | undefined;
  let server: CredentialProxyServer | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpr-'));
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
      // No catch: each test starts the server exactly once and never stops
      // it, so a failure here is a real teardown defect (an unreleased Unix
      // socket would break the next run) and should fail the test.
      await server.stop();
      server = undefined;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('resolves auth-key-name through the credential proxy socket', async () => {
    const keyStorage = new InMemoryProviderKeyStorage();
    await keyStorage.saveKey(NAMED_KEY, PROXY_SERVED_KEY);
    server = new CredentialProxyServer({
      tokenStore: new InMemoryTokenStore(),
      providerKeyStorage: keyStorage,
      socketDir: tmpDir,
    });
    const socketPath = await server.start();
    process.env.LLXPRT_CREDENTIAL_SOCKET = socketPath;

    const profileSettings = new SettingsService();
    profileSettings.setProviderSetting('gemini', 'auth-key-name', NAMED_KEY);

    const result = await resolveCompressionProfileAuthToken(
      profileSettings,
      'gemini',
    );

    expect(result).toStrictEqual({ authToken: PROXY_SERVED_KEY });
  });

  // When the proxy serves no such key the resolver must report "no auth"
  // rather than falling back to the host keyring, which is unreachable
  // from inside the container anyway.
  it('returns no auth when the named key is absent from proxy storage', async () => {
    server = new CredentialProxyServer({
      tokenStore: new InMemoryTokenStore(),
      providerKeyStorage: new InMemoryProviderKeyStorage(),
      socketDir: tmpDir,
    });
    const socketPath = await server.start();
    process.env.LLXPRT_CREDENTIAL_SOCKET = socketPath;

    const profileSettings = new SettingsService();
    profileSettings.setProviderSetting('gemini', 'auth-key-name', 'absent-key');

    const result = await resolveCompressionProfileAuthToken(
      profileSettings,
      'gemini',
    );

    expect(result).toStrictEqual({});
  });
});
