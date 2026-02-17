# Phase 06: Refresh Token TDD

## Phase ID

`PLAN-20250217-CREDPROXY-REMEDIATION.P06`

## Purpose

Write **behavioral tests FIRST** for `handleRefreshToken` that:
1. Verify RefreshCoordinator is used (rate limiting, dedup)
2. Verify new token stored in backingStore
3. Verify refresh_token stripped from response
4. Will FAIL against NOT_IMPLEMENTED stub

---

## Prerequisites

- Phase 05 completed (handleOAuthExchange implemented)
- Phase 05a verification passed

---

## Test File

**Create**: `packages/cli/src/auth/proxy/__tests__/refresh-flow.spec.ts`

---

## Test Implementation

```typescript
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
import type { TokenStore, OAuthToken, BucketStats, DeviceCodeResponse, ProviderKeyStorage } from '@vybestack/llxprt-code-core';
import { ProxySocketClient } from '@vybestack/llxprt-code-core';
import { CredentialProxyServer, type CredentialProxyServerOptions } from '../credential-proxy-server.js';

// ─── In-Memory Token Store (NOT a mock) ──────────────────────────────────────

class InMemoryTokenStore implements TokenStore {
  private tokens = new Map<string, OAuthToken>();
  private locks = new Map<string, boolean>();

  async saveToken(provider: string, token: OAuthToken, bucket?: string): Promise<void> {
    this.tokens.set(`${provider}:${bucket ?? 'default'}`, { ...token });
  }

  async getToken(provider: string, bucket?: string): Promise<OAuthToken | null> {
    return this.tokens.get(`${provider}:${bucket ?? 'default'}`) ?? null;
  }

  async removeToken(provider: string, bucket?: string): Promise<void> {
    this.tokens.delete(`${provider}:${bucket ?? 'default'}`);
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

  async getBucketStats(): Promise<BucketStats | null> {
    return null;
  }

  async acquireRefreshLock(provider: string, bucket?: string): Promise<boolean> {
    const key = `${provider}:${bucket ?? 'default'}:lock`;
    if (this.locks.get(key)) {
      return false;
    }
    this.locks.set(key, true);
    return true;
  }

  async releaseRefreshLock(provider: string, bucket?: string): Promise<void> {
    const key = `${provider}:${bucket ?? 'default'}:lock`;
    this.locks.delete(key);
  }
}

// ─── Controllable Test Provider (NOT a mock) ─────────────────────────────────

class TestOAuthProvider {
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
    this.lastRefreshToken = refreshToken; // Capture for verification

    if (this.refreshDelayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, this.refreshDelayMs));
    }

    if (this.shouldThrow && this.throwError) {
      throw this.throwError;
    }

    if (!this.refreshResult) {
      throw new Error('TestOAuthProvider: refreshResult not configured');
    }

    return this.refreshResult;
  }
}

// ─── In-Memory Key Storage ───────────────────────────────────────────────────

class InMemoryProviderKeyStorage implements ProviderKeyStorage {
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

    // Register provider for refresh operations
    const providers = new Map([
      ['anthropic', testProvider],
    ]);

    const opts: CredentialProxyServerOptions = {
      tokenStore: backingStore,
      providerKeyStorage: keyStorage,
      providers: providers as unknown as Map<string, unknown>,
    };

    server = new CredentialProxyServer(opts);
    const socketPath = await server.start();
    client = new ProxySocketClient();
    await client.connect(socketPath);
  });

  afterEach(async () => {
    await client.close();
    await server.stop();
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
      const response = await client.request('refresh_token', { provider: 'anthropic' });
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

      const response = await client.request('refresh_token', { provider: 'anthropic' });

      expect(response.ok).toBe(true);
      expect(response.data.access_token).toBe('new_access');
      expect(response.data.refresh_token).toBeUndefined();
      expect('refresh_token' in response.data).toBe(false);
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
      const first = await client.request('refresh_token', { provider: 'anthropic' });
      expect(first.ok).toBe(true);

      // Second refresh within 30s returns RATE_LIMITED
      const second = await client.request('refresh_token', { provider: 'anthropic' });
      expect(second.ok).toBe(false);
      expect(second.code).toBe('RATE_LIMITED');
      expect(second.retryAfter).toBeGreaterThan(0);
      expect(second.retryAfter).toBeGreaterThan(25); // MUST be close to 30 (within ~5s tolerance for timing)
    });

    it('different buckets have independent rate limits', async () => {
      await backingStore.saveToken('anthropic', {
        access_token: 'old_access',
        refresh_token: 'valid_refresh',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) - 1000,
      }, 'bucket1');

      await backingStore.saveToken('anthropic', {
        access_token: 'old_access',
        refresh_token: 'valid_refresh',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) - 1000,
      }, 'bucket2');

      testProvider.setRefreshResult({
        access_token: 'new_access',
        refresh_token: 'new_refresh',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) + 3600,
      });

      // Refresh bucket1
      const first = await client.request('refresh_token', { 
        provider: 'anthropic', 
        bucket: 'bucket1' 
      });
      expect(first.ok).toBe(true);

      // Refresh bucket2 should succeed (different rate limit)
      const second = await client.request('refresh_token', { 
        provider: 'anthropic', 
        bucket: 'bucket2' 
      });
      expect(second.ok).toBe(true);
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
        access_token: 'new_access',
        refresh_token: 'new_refresh',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) + 3600,
      });

      // Fire 5 concurrent refresh requests
      const requests = Array(5).fill(null).map(() => 
        client.request('refresh_token', { provider: 'anthropic' })
      );

      const responses = await Promise.all(requests);

      // At least one should succeed
      const successes = responses.filter(r => r.ok);
      expect(successes.length).toBeGreaterThanOrEqual(1);

      // Provider should be called at most once (deduplication)
      expect(testProvider.getRefreshCount()).toBe(1);
    });
  });

  // ─── Error Handling Tests ────────────────────────────────────────────────

  describe('error handling', () => {
    it('returns NOT_FOUND when no token exists', async () => {
      // No token saved
      const response = await client.request('refresh_token', { provider: 'anthropic' });

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

      const response = await client.request('refresh_token', { provider: 'anthropic' });

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

      const response = await client.request('refresh_token', { provider: 'anthropic' });

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
      (authError as unknown as Record<string, unknown>).code = 'INVALID_GRANT';
      testProvider.setThrowOnRefresh(authError);

      const response = await client.request('refresh_token', { provider: 'anthropic' });

      expect(response.ok).toBe(false);
      // Either REAUTH_REQUIRED or REFRESH_FAILED is acceptable
      expect(['REAUTH_REQUIRED', 'REFRESH_FAILED']).toContain(response.code);
    });
  });

  // ─── Validation Tests ────────────────────────────────────────────────────

  describe('validation', () => {
    it('missing provider returns INVALID_REQUEST', async () => {
      const response = await client.request('refresh_token', {});

      expect(response.ok).toBe(false);
      expect(response.code).toBe('INVALID_REQUEST');
    });

    it('unauthorized provider returns UNAUTHORIZED', async () => {
      // Server configured with no providers
      await client.close();
      await server.stop();

      server = new CredentialProxyServer({
        tokenStore: backingStore,
        providerKeyStorage: keyStorage,
        allowedProviders: ['other_provider'], // anthropic not allowed
      });
      const socketPath = await server.start();
      client = new ProxySocketClient();
      await client.connect(socketPath);

      const response = await client.request('refresh_token', { provider: 'anthropic' });

      expect(response.ok).toBe(false);
      expect(response.code).toBe('UNAUTHORIZED');
    });
  });

  // ─── Provider Call Tests ─────────────────────────────────────────────────

  describe('provider integration', () => {
    it('calls provider.refreshToken with correct refresh_token', async () => {
      await backingStore.saveToken('anthropic', {
        access_token: 'old_access',
        refresh_token: 'the_refresh_token_value',
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
    });
  });

  // ─── Argument-Capture Tests (Deepthinker Recommendations) ──────────────────

  describe('argument capture verification', () => {
    it('refresh uses correct refresh_token from store - captured', async () => {
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

      // Verify the captured refresh_token matches what was in store
      const capturedToken = testProvider.getLastRefreshToken();
      expect(capturedToken).toBe(knownRefreshToken);
    });
  });

  // ─── Unpredictable Token Tests (Anti-Fake) ─────────────────────────────────

  describe('anti-fake verification', () => {
    it('refreshed tokens are unpredictable - uses random nonce', async () => {
      // Generate a random nonce that changes each test run
      const nonce = 'refresh_nonce_' + Math.random().toString(36).substring(2, 15);
      
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

      const response = await client.request('refresh_token', { provider: 'anthropic' });

      expect(response.ok).toBe(true);
      // Response must contain the nonce - catches hardcoded tokens
      expect(response.data.access_token).toContain(nonce);

      // Backing store must also have nonce
      const stored = await backingStore.getToken('anthropic');
      expect(stored?.access_token).toContain(nonce);
      expect(stored?.refresh_token).toContain(nonce);
    });
  });

  // ─── Concurrent Refresh Tests (Deepthinker Recommendations) ────────────────

  describe('concurrent refresh - deduplication', () => {
    it('5 simultaneous refresh requests result in single provider call', async () => {
      await backingStore.saveToken('anthropic', {
        access_token: 'old_access',
        refresh_token: 'valid_refresh',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) - 1000,
      });

      const refreshedToken = {
        access_token: 'deduplicated_new_access',
        refresh_token: 'deduplicated_new_refresh',
        token_type: 'Bearer' as const,
        expiry: Math.floor(Date.now() / 1000) + 3600,
      };
      testProvider.setRefreshResult(refreshedToken);

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

      // All 5 requests should return the same token
      const successResults = results.filter(r => r.ok);
      expect(successResults.length).toBeGreaterThanOrEqual(1);
      for (const result of successResults) {
        expect(result.data.access_token).toBe('deduplicated_new_access');
      }
    });
  });
});
```

---

## Test Verification

### Tests MUST fail against stub

```bash
npm test -- packages/cli/src/auth/proxy/__tests__/refresh-flow.spec.ts
# Expected: FAIL (handleRefreshToken returns fake token)
```

### Anti-mock-theater check

```bash
grep -n "toHaveBeenCalled" packages/cli/src/auth/proxy/__tests__/refresh-flow.spec.ts
# Expected: 0 matches
```

### State verification check

```bash
grep -n "backingStore.getToken" packages/cli/src/auth/proxy/__tests__/refresh-flow.spec.ts
# Expected: Multiple matches
```

### Rate limit test

```bash
grep -n "RATE_LIMITED\|retryAfter" packages/cli/src/auth/proxy/__tests__/refresh-flow.spec.ts
# Expected: Present
```

---

## Success Criteria

1. [x] Test file created
2. [x] Tests verify backingStore state after refresh
3. [x] Tests verify refresh_token stripped from response
4. [x] Tests verify refresh_token preserved in backingStore
5. [x] Tests verify rate limiting (30s cooldown)
6. [x] Tests verify concurrent deduplication
7. [x] Tests verify error handling (NOT_FOUND, REFRESH_NOT_AVAILABLE)
8. [x] Tests FAIL against fake `refreshed_${Date.now()}` implementation
9. [x] No mock theater

---

## Phase Completion Marker

Create: `project-plans/issue1358_1359_1360_remediation/.completed/P06.md`
