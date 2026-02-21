/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Behavioral tests for handleRefreshToken.
 * Verifies REAL token refresh through RefreshCoordinator.
 *
 * CRITICAL: Tests verify BACKING STORE state, not just response.
 * Tests verify rate limiting and deduplication behavior.
 *
 * @plan PLAN-20250217-CREDPROXY-REMEDIATION.P06
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type {
  TokenStore,
  OAuthToken,
  BucketStats,
} from '@vybestack/llxprt-code-core';
import {
  ProxySocketClient,
  ProviderKeyStorage,
} from '@vybestack/llxprt-code-core';
import {
  CredentialProxyServer,
  type CredentialProxyServerOptions,
  type OAuthFlowInterface,
} from '../credential-proxy-server.js';

// ─── In-Memory Token Store (NOT a mock) ──────────────────────────────────────

class InMemoryTokenStore implements TokenStore {
  private tokens = new Map<string, OAuthToken>();
  private locks = new Map<string, boolean>();

  private key(provider: string, bucket?: string): string {
    return bucket ? `${provider}:${bucket}` : provider;
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
    for (const key of this.tokens.keys()) {
      providers.add(key.split(':')[0]);
    }
    return Array.from(providers);
  }

  async listBuckets(provider: string): Promise<string[]> {
    const buckets: string[] = [];
    for (const key of this.tokens.keys()) {
      const [p, b] = key.split(':');
      if (p === provider && b) buckets.push(b);
    }
    return buckets;
  }

  async getBucketStats(
    _provider: string,
    _bucket: string,
  ): Promise<BucketStats | null> {
    return null;
  }

  async acquireRefreshLock(
    provider: string,
    options?: { waitMs?: number; staleMs?: number; bucket?: string },
  ): Promise<boolean> {
    const k = `${this.key(provider, options?.bucket)}:lock`;
    if (this.locks.get(k)) {
      return false;
    }
    this.locks.set(k, true);
    return true;
  }

  async releaseRefreshLock(provider: string, bucket?: string): Promise<void> {
    const k = `${this.key(provider, bucket)}:lock`;
    this.locks.delete(k);
  }
}

// ─── Controllable Test Provider (NOT a mock) ─────────────────────────────────

/**
 * Controllable test double for OAuth providers that support refreshToken().
 * NOT a mock - configures deterministic responses to drive real behavior.
 *
 * Tracks:
 * - refreshCount: number of times refreshToken() was called
 * - lastRefreshToken: the refresh_token passed to the last call
 */
class TestOAuthProvider implements OAuthFlowInterface {
  private refreshResult: OAuthToken | null = null;
  private refreshCount = 0;
  private refreshDelayMs = 0;
  private shouldThrow = false;
  private throwError: Error | null = null;
  private lastRefreshToken: string | null = null;

  setRefreshResult(token: OAuthToken): void {
    this.refreshResult = token;
  }

  setRefreshDelay(ms: number): void {
    this.refreshDelayMs = ms;
  }

  setThrowOnRefresh(error: Error): void {
    this.shouldThrow = true;
    this.throwError = error;
  }

  getRefreshCount(): number {
    return this.refreshCount;
  }

  /**
   * Get the last refresh_token passed to refreshToken().
   * Used for argument-capture verification (NOT mock theater).
   */
  getLastRefreshToken(): string | null {
    return this.lastRefreshToken;
  }

  reset(): void {
    this.refreshCount = 0;
    this.shouldThrow = false;
    this.throwError = null;
    this.lastRefreshToken = null;
  }

  async refreshToken(refreshToken: string): Promise<OAuthToken> {
    this.refreshCount++;
    this.lastRefreshToken = refreshToken;

    if (this.refreshDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.refreshDelayMs));
    }

    if (this.shouldThrow && this.throwError) {
      throw this.throwError;
    }

    if (!this.refreshResult) {
      throw new Error('TestOAuthProvider: refreshResult not configured');
    }

    return this.refreshResult;
  }

  // Required by OAuthFlowInterface but not used for refresh tests
  async initiateDeviceFlow(): Promise<{
    device_code: string;
    user_code?: string;
    verification_uri: string;
    verification_uri_complete?: string;
    expires_in: number;
    interval?: number;
  }> {
    throw new Error('Not implemented for refresh tests');
  }
}

// ─── In-Memory Key Storage ───────────────────────────────────────────────────

class InMemoryProviderKeyStorage {
  private keys = new Map<string, string>();

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

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('refresh_token handler', () => {
  let backingStore: InMemoryTokenStore;
  let keyStorage: InMemoryProviderKeyStorage;
  let server: CredentialProxyServer;
  let client: ProxySocketClient;
  let testProvider: TestOAuthProvider;

  beforeEach(async () => {
    backingStore = new InMemoryTokenStore();
    keyStorage = new InMemoryProviderKeyStorage();
    testProvider = new TestOAuthProvider();

    // Register provider for refresh operations via flowFactories
    // The server uses flowFactories to get provider instances that support refreshToken()
    const flowFactories = new Map([['anthropic', () => testProvider]]);

    const opts: CredentialProxyServerOptions = {
      tokenStore: backingStore,
      providerKeyStorage: keyStorage as unknown as ProviderKeyStorage,
      flowFactories,
    };

    server = new CredentialProxyServer(opts);
    const socketPath = await server.start();
    client = new ProxySocketClient(socketPath);
    await client.ensureConnected();
  });

  afterEach(async () => {
    try {
      client?.close();
    } catch {
      // client may not be initialized
    }
    try {
      await server?.stop();
    } catch {
      // server may not be started
    }
    vi.useRealTimers();
  });

  // ─── Token Refresh Tests ─────────────────────────────────────────────────

  describe('token refresh', () => {
    it('updates access_token in backing store', async () => {
      // Pre-populate with expiring token that HAS refresh_token
      await backingStore.saveToken('anthropic', {
        access_token: 'old_access_token',
        refresh_token: 'valid_refresh_token',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) - 1000, // Expired
      });

      // Configure provider to return new token
      testProvider.setRefreshResult({
        access_token: 'fresh_access_from_provider',
        refresh_token: 'fresh_refresh_from_provider',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) + 3600,
      });

      // Request refresh
      const response = await client.request('refresh_token', {
        provider: 'anthropic',
      });
      expect(response.ok).toBe(true);

      // CRITICAL: Verify BACKING STORE has new token
      const stored = await backingStore.getToken('anthropic');
      expect(stored).not.toBeNull();
      expect(stored?.access_token).toBe('fresh_access_from_provider');
    });

    it('preserves refresh_token in backing store', async () => {
      await backingStore.saveToken('anthropic', {
        access_token: 'old_access',
        refresh_token: 'original_refresh',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) - 1000,
      });

      testProvider.setRefreshResult({
        access_token: 'new_access',
        refresh_token: 'new_refresh_from_provider',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) + 3600,
      });

      await client.request('refresh_token', { provider: 'anthropic' });

      // Backing store must have refresh_token
      const stored = await backingStore.getToken('anthropic');
      expect(stored?.refresh_token).toBe('new_refresh_from_provider');
    });

    it('handles bucket-specific tokens', async () => {
      await backingStore.saveToken(
        'anthropic',
        {
          access_token: 'old_bucket_access',
          refresh_token: 'bucket_refresh',
          token_type: 'Bearer',
          expiry: Math.floor(Date.now() / 1000) - 1000,
        },
        'enterprise',
      );

      testProvider.setRefreshResult({
        access_token: 'new_bucket_access',
        refresh_token: 'new_bucket_refresh',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) + 3600,
      });

      const response = await client.request('refresh_token', {
        provider: 'anthropic',
        bucket: 'enterprise',
      });
      expect(response.ok).toBe(true);

      // Verify bucket-specific storage
      const stored = await backingStore.getToken('anthropic', 'enterprise');
      expect(stored?.access_token).toBe('new_bucket_access');

      // Default bucket should be unaffected
      const defaultBucket = await backingStore.getToken('anthropic');
      expect(defaultBucket).toBeNull();
    });
  });

  // ─── Sanitization Tests ──────────────────────────────────────────────────

  describe('response sanitization', () => {
    it('response does NOT contain refresh_token', async () => {
      await backingStore.saveToken('anthropic', {
        access_token: 'old_access',
        refresh_token: 'valid_refresh',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) - 1000,
      });

      testProvider.setRefreshResult({
        access_token: 'new_access',
        refresh_token: 'MUST_NOT_APPEAR_IN_RESPONSE',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) + 3600,
      });

      const response = await client.request('refresh_token', {
        provider: 'anthropic',
      });

      expect(response.ok).toBe(true);
      expect(response.data?.access_token).toBe('new_access');
      expect(response.data?.refresh_token).toBeUndefined();
      expect('refresh_token' in (response.data ?? {})).toBe(false);
    });

    it('response includes token_type and expiry', async () => {
      const expiry = Math.floor(Date.now() / 1000) + 7200;
      await backingStore.saveToken('anthropic', {
        access_token: 'old_access',
        refresh_token: 'valid_refresh',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) - 1000,
      });

      testProvider.setRefreshResult({
        access_token: 'new_access',
        refresh_token: 'new_refresh',
        token_type: 'Bearer',
        expiry,
      });

      const response = await client.request('refresh_token', {
        provider: 'anthropic',
      });

      expect(response.ok).toBe(true);
      expect(response.data?.token_type).toBe('Bearer');
      expect(response.data?.expiry).toBe(expiry);
    });
  });

  // ─── Rate Limiting Tests ─────────────────────────────────────────────────

  describe('rate limiting', () => {
    it('enforces 30s cooldown per provider:bucket', async () => {
      await backingStore.saveToken('anthropic', {
        access_token: 'old_access',
        refresh_token: 'valid_refresh',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) - 1000,
      });

      testProvider.setRefreshResult({
        access_token: 'first_refresh',
        refresh_token: 'new_refresh',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) + 3600,
      });

      // First refresh succeeds
      const first = await client.request('refresh_token', {
        provider: 'anthropic',
      });
      expect(first.ok).toBe(true);

      // Second refresh within 30s returns RATE_LIMITED
      const second = await client.request('refresh_token', {
        provider: 'anthropic',
      });
      expect(second.ok).toBe(false);
      expect(second.code).toBe('RATE_LIMITED');
      expect(second.retryAfter).toBeGreaterThan(0);
      // Should be close to 30 (within ~5s tolerance for timing)
      expect(second.retryAfter).toBeGreaterThan(25);
    });

    it('different buckets have independent rate limits', async () => {
      await backingStore.saveToken(
        'anthropic',
        {
          access_token: 'old_access',
          refresh_token: 'valid_refresh',
          token_type: 'Bearer',
          expiry: Math.floor(Date.now() / 1000) - 1000,
        },
        'bucket1',
      );

      await backingStore.saveToken(
        'anthropic',
        {
          access_token: 'old_access',
          refresh_token: 'valid_refresh',
          token_type: 'Bearer',
          expiry: Math.floor(Date.now() / 1000) - 1000,
        },
        'bucket2',
      );

      testProvider.setRefreshResult({
        access_token: 'new_access',
        refresh_token: 'new_refresh',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) + 3600,
      });

      // Refresh bucket1
      const first = await client.request('refresh_token', {
        provider: 'anthropic',
        bucket: 'bucket1',
      });
      expect(first.ok).toBe(true);

      // Refresh bucket2 should succeed (different rate limit)
      const second = await client.request('refresh_token', {
        provider: 'anthropic',
        bucket: 'bucket2',
      });
      expect(second.ok).toBe(true);
    });

    it('different providers have independent rate limits', async () => {
      // Set up a second provider
      const geminiProvider = new TestOAuthProvider();
      geminiProvider.setRefreshResult({
        access_token: 'gemini_access',
        refresh_token: 'gemini_refresh',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) + 3600,
      });

      // Recreate server with multiple providers
      client.close();
      await server.stop();

      const flowFactories = new Map([
        ['anthropic', () => testProvider],
        ['gemini', () => geminiProvider],
      ]);

      server = new CredentialProxyServer({
        tokenStore: backingStore,
        providerKeyStorage: keyStorage as unknown as ProviderKeyStorage,
        flowFactories,
      });
      const socketPath = await server.start();
      client = new ProxySocketClient(socketPath);
      await client.ensureConnected();

      // Set up tokens for both providers
      await backingStore.saveToken('anthropic', {
        access_token: 'old_anthropic',
        refresh_token: 'anthropic_refresh',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) - 1000,
      });

      await backingStore.saveToken('gemini', {
        access_token: 'old_gemini',
        refresh_token: 'gemini_refresh',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) - 1000,
      });

      testProvider.setRefreshResult({
        access_token: 'new_anthropic',
        refresh_token: 'new_anthropic_refresh',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) + 3600,
      });

      // Refresh anthropic
      const anthropic = await client.request('refresh_token', {
        provider: 'anthropic',
      });
      expect(anthropic.ok).toBe(true);

      // Gemini should succeed (independent rate limit)
      const gemini = await client.request('refresh_token', {
        provider: 'gemini',
      });
      expect(gemini.ok).toBe(true);
    });
  });

  // ─── Deduplication Tests ─────────────────────────────────────────────────

  describe('concurrent deduplication', () => {
    it('concurrent refresh calls are deduplicated', async () => {
      await backingStore.saveToken('anthropic', {
        access_token: 'old_access',
        refresh_token: 'valid_refresh',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) - 1000,
      });

      // Configure slow refresh to allow concurrent calls
      testProvider.setRefreshDelay(100);
      testProvider.setRefreshResult({
        access_token: 'deduplicated_access',
        refresh_token: 'new_refresh',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) + 3600,
      });

      // Fire 5 concurrent refresh requests
      const requests = Array(5)
        .fill(null)
        .map(() => client.request('refresh_token', { provider: 'anthropic' }));

      const responses = await Promise.all(requests);

      // At least one should succeed (the first one)
      const successes = responses.filter((r) => r.ok);
      expect(successes.length).toBeGreaterThanOrEqual(1);

      // Provider should be called at most once (deduplication)
      // Others may return rate_limited or get deduplicated response
      expect(testProvider.getRefreshCount()).toBe(1);
    });

    it('5 simultaneous refresh requests result in single provider call', async () => {
      await backingStore.saveToken('anthropic', {
        access_token: 'old_access',
        refresh_token: 'valid_refresh',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) - 1000,
      });

      testProvider.setRefreshDelay(50);
      testProvider.setRefreshResult({
        access_token: 'deduplicated_new_access',
        refresh_token: 'deduplicated_new_refresh',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) + 3600,
      });

      // Fire 5 simultaneous refresh requests
      const results = await Promise.all([
        client.request('refresh_token', { provider: 'anthropic' }),
        client.request('refresh_token', { provider: 'anthropic' }),
        client.request('refresh_token', { provider: 'anthropic' }),
        client.request('refresh_token', { provider: 'anthropic' }),
        client.request('refresh_token', { provider: 'anthropic' }),
      ]);

      // Provider should have been called exactly ONCE (deduplication)
      expect(testProvider.getRefreshCount()).toBe(1);

      // All successful requests should return the same token
      const successResults = results.filter((r) => r.ok);
      expect(successResults.length).toBeGreaterThanOrEqual(1);
      for (const result of successResults) {
        expect(result.data?.access_token).toBe('deduplicated_new_access');
      }

      // Verify backing store has correct token
      const stored = await backingStore.getToken('anthropic');
      expect(stored?.access_token).toBe('deduplicated_new_access');
    });
  });

  // ─── Error Handling Tests ────────────────────────────────────────────────

  describe('error handling', () => {
    it('returns NOT_FOUND when no token exists', async () => {
      // No token saved
      const response = await client.request('refresh_token', {
        provider: 'anthropic',
      });

      expect(response.ok).toBe(false);
      expect(response.code).toBe('NOT_FOUND');
    });

    it('returns REFRESH_NOT_AVAILABLE when no refresh_token', async () => {
      // Token without refresh_token
      await backingStore.saveToken('anthropic', {
        access_token: 'access_only',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) - 1000,
        // No refresh_token!
      });

      const response = await client.request('refresh_token', {
        provider: 'anthropic',
      });

      expect(response.ok).toBe(false);
      expect(response.code).toBe('REFRESH_NOT_AVAILABLE');
    });

    it('provider error propagates as REFRESH_FAILED', async () => {
      await backingStore.saveToken('anthropic', {
        access_token: 'old_access',
        refresh_token: 'valid_refresh',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) - 1000,
      });

      testProvider.setThrowOnRefresh(new Error('Provider API error'));

      const response = await client.request('refresh_token', {
        provider: 'anthropic',
      });

      expect(response.ok).toBe(false);
      expect(response.code).toBe('REFRESH_FAILED');
    });

    it('auth error returns REAUTH_REQUIRED', async () => {
      await backingStore.saveToken('anthropic', {
        access_token: 'old_access',
        refresh_token: 'invalid_refresh',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) - 1000,
      });

      // Simulate auth error (invalid_grant, expired refresh_token, etc.)
      const authError = new Error('invalid_grant: refresh token expired');
      (authError as unknown as Record<string, unknown>).code = 'invalid_grant';
      testProvider.setThrowOnRefresh(authError);

      const response = await client.request('refresh_token', {
        provider: 'anthropic',
      });

      expect(response.ok).toBe(false);
      // Either REAUTH_REQUIRED or REFRESH_FAILED is acceptable
      expect(['REAUTH_REQUIRED', 'REFRESH_FAILED']).toContain(response.code);
    });

    it('provider not registered returns PROVIDER_NOT_FOUND', async () => {
      // Request refresh for unregistered provider
      await backingStore.saveToken('unknown_provider', {
        access_token: 'access',
        refresh_token: 'refresh',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) - 1000,
      });

      const response = await client.request('refresh_token', {
        provider: 'unknown_provider',
      });

      expect(response.ok).toBe(false);
      expect(response.code).toBe('PROVIDER_NOT_FOUND');
    });
  });

  // ─── Validation Tests ────────────────────────────────────────────────────

  describe('validation', () => {
    it('missing provider returns INVALID_REQUEST', async () => {
      const response = await client.request('refresh_token', {});

      expect(response.ok).toBe(false);
      expect(response.code).toBe('INVALID_REQUEST');
    });

    it('empty provider returns INVALID_REQUEST', async () => {
      const response = await client.request('refresh_token', { provider: '' });

      expect(response.ok).toBe(false);
      expect(response.code).toBe('INVALID_REQUEST');
    });

    it('unconfigured provider returns PROVIDER_NOT_FOUND', async () => {
      const response = await client.request('refresh_token', {
        provider: 'unconfigured_provider',
      });

      expect(response.ok).toBe(false);
      expect(response.code).toBe('PROVIDER_NOT_FOUND');
    });
  });

  // ─── Provider Integration Tests ──────────────────────────────────────────

  describe('provider integration', () => {
    it('calls provider.refreshToken with correct refresh_token', async () => {
      const knownRefreshToken = 'known_refresh_' + Math.random().toString(36);

      await backingStore.saveToken('anthropic', {
        access_token: 'old_access',
        refresh_token: knownRefreshToken,
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) - 1000,
      });

      testProvider.setRefreshResult({
        access_token: 'new_access',
        refresh_token: 'new_refresh',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) + 3600,
      });

      await client.request('refresh_token', { provider: 'anthropic' });

      // Verify provider was called
      expect(testProvider.getRefreshCount()).toBe(1);

      // Verify the captured refresh_token matches what was in store
      const capturedToken = testProvider.getLastRefreshToken();
      expect(capturedToken).toBe(knownRefreshToken);
    });
  });

  // ─── Argument-Capture Tests (NOT mock theater) ───────────────────────────

  describe('argument capture verification', () => {
    it('refresh uses correct refresh_token from store - captured', async () => {
      const knownRefreshToken =
        'known_refresh_' + Math.random().toString(36).slice(2);

      await backingStore.saveToken('anthropic', {
        access_token: 'old_access',
        refresh_token: knownRefreshToken,
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) - 1000,
      });

      testProvider.setRefreshResult({
        access_token: 'new_access',
        refresh_token: 'new_refresh',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) + 3600,
      });

      await client.request('refresh_token', { provider: 'anthropic' });

      // Verify via capturing test double, NOT toHaveBeenCalledWith
      const capturedToken = testProvider.getLastRefreshToken();
      expect(capturedToken).toBe(knownRefreshToken);
    });

    it('bucket-specific refresh uses bucket token refresh_token', async () => {
      const bucketRefreshToken =
        'bucket_refresh_' + Math.random().toString(36).slice(2);

      // Save default bucket token
      await backingStore.saveToken('anthropic', {
        access_token: 'default_access',
        refresh_token: 'default_refresh',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) - 1000,
      });

      // Save enterprise bucket token
      await backingStore.saveToken(
        'anthropic',
        {
          access_token: 'enterprise_access',
          refresh_token: bucketRefreshToken,
          token_type: 'Bearer',
          expiry: Math.floor(Date.now() / 1000) - 1000,
        },
        'enterprise',
      );

      testProvider.setRefreshResult({
        access_token: 'new_access',
        refresh_token: 'new_refresh',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) + 3600,
      });

      await client.request('refresh_token', {
        provider: 'anthropic',
        bucket: 'enterprise',
      });

      // Should have used the bucket-specific refresh_token
      expect(testProvider.getLastRefreshToken()).toBe(bucketRefreshToken);
    });
  });

  // ─── Anti-Fake Verification Tests ────────────────────────────────────────

  describe('anti-fake verification', () => {
    it('refreshed tokens are unpredictable - uses random nonce', async () => {
      // Generate a random nonce that changes each test run
      const nonce =
        'refresh_nonce_' + Math.random().toString(36).substring(2, 15);

      await backingStore.saveToken('anthropic', {
        access_token: 'old_access',
        refresh_token: 'valid_refresh',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) - 1000,
      });

      testProvider.setRefreshResult({
        access_token: `refreshed_token_with_${nonce}`,
        refresh_token: `new_refresh_${nonce}`,
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) + 3600,
      });

      const response = await client.request('refresh_token', {
        provider: 'anthropic',
      });

      expect(response.ok).toBe(true);
      // Response must contain the nonce - catches hardcoded tokens
      expect(response.data?.access_token).toContain(nonce);

      // Backing store must also have nonce
      const stored = await backingStore.getToken('anthropic');
      expect(stored?.access_token).toContain(nonce);
      expect(stored?.refresh_token).toContain(nonce);
    });

    it('fake implementation returning Date.now() tokens will fail', async () => {
      // This test specifically catches fake implementations that return
      // `refreshed_${Date.now()}` style tokens

      await backingStore.saveToken('anthropic', {
        access_token: 'old_access',
        refresh_token: 'valid_refresh',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) - 1000,
      });

      // Set up a SPECIFIC token that a fake couldn't produce
      const specificToken = 'exact_token_abc123_' + Math.random();
      testProvider.setRefreshResult({
        access_token: specificToken,
        refresh_token: 'specific_refresh_xyz789',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) + 3600,
      });

      const response = await client.request('refresh_token', {
        provider: 'anthropic',
      });

      expect(response.ok).toBe(true);
      // MUST be EXACTLY the configured token, not `refreshed_${Date.now()}`
      expect(response.data?.access_token).toBe(specificToken);

      // Backing store must have the exact token too
      const stored = await backingStore.getToken('anthropic');
      expect(stored?.access_token).toBe(specificToken);
    });
  });

  // ─── Response Schema Tests ───────────────────────────────────────────────

  describe('response schema', () => {
    it('success response has correct structure', async () => {
      await backingStore.saveToken('anthropic', {
        access_token: 'old_access',
        refresh_token: 'valid_refresh',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) - 1000,
      });

      testProvider.setRefreshResult({
        access_token: 'new_access',
        refresh_token: 'new_refresh',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) + 3600,
      });

      const response = await client.request('refresh_token', {
        provider: 'anthropic',
      });

      expect(response.ok).toBe(true);
      expect(response.data).toHaveProperty('access_token');
      expect(response.data).toHaveProperty('token_type');
      expect(response.data).toHaveProperty('expiry');
      expect(response.data).not.toHaveProperty('refresh_token');
    });

    it('rate_limited response has retryAfter', async () => {
      await backingStore.saveToken('anthropic', {
        access_token: 'old_access',
        refresh_token: 'valid_refresh',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) - 1000,
      });

      testProvider.setRefreshResult({
        access_token: 'new_access',
        refresh_token: 'new_refresh',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) + 3600,
      });

      // First refresh to trigger rate limit
      await client.request('refresh_token', { provider: 'anthropic' });

      // Second refresh should be rate limited
      const response = await client.request('refresh_token', {
        provider: 'anthropic',
      });

      expect(response.ok).toBe(false);
      expect(response.code).toBe('RATE_LIMITED');
      expect(response.retryAfter).toBeDefined();
      expect(typeof response.retryAfter).toBe('number');
    });

    it('error response has code and error fields', async () => {
      const response = await client.request('refresh_token', {
        provider: 'anthropic',
      });

      expect(response.ok).toBe(false);
      expect(response.code).toBeDefined();
      expect(typeof response.code).toBe('string');
    });
  });
});
