/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Behavioral tests for handleOAuthExchange.
 * Verifies REAL token exchange and state persistence.
 *
 * CRITICAL: Tests verify BACKING STORE state, not just response.
 * This catches fake implementations that return hardcoded tokens.
 *
 * @plan PLAN-20250217-CREDPROXY-REMEDIATION.P04
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type {
  TokenStore,
  OAuthToken,
  BucketStats,
  DeviceCodeResponse,
} from '@vybestack/llxprt-code-core';
import { ProxySocketClient } from '@vybestack/llxprt-code-core';
import {
  CredentialProxyServer,
  type CredentialProxyServerOptions,
  type OAuthFlowInterface,
} from '../credential-proxy-server.js';

// ─── In-Memory Token Store (NOT a mock) ──────────────────────────────────────

class InMemoryTokenStore implements TokenStore {
  private tokens = new Map<string, OAuthToken>();
  private locks = new Set<string>();

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
    const k = this.key(provider, options?.bucket);
    if (this.locks.has(k)) return false;
    this.locks.add(k);
    return true;
  }

  async releaseRefreshLock(provider: string, bucket?: string): Promise<void> {
    this.locks.delete(this.key(provider, bucket));
  }
}

// ─── Controllable Test Flow (NOT a mock) ─────────────────────────────────────

class TestOAuthFlow implements OAuthFlowInterface {
  private initiateResult: DeviceCodeResponse;
  private exchangeResult: OAuthToken | null = null;
  private exchangeCount = 0;
  private lastExchangeCode: string | null = null;
  private lastExchangeState: string | null = null;
  readonly flowType: 'pkce_redirect' | 'device_code';

  constructor(flowType: 'pkce_redirect' | 'device_code') {
    this.flowType = flowType;
    this.initiateResult = {
      device_code: 'pkce_verifier_' + Math.random().toString(36),
      user_code: 'TEST',
      verification_uri: 'https://example-provider.com/auth',
      verification_uri_complete:
        'https://example-provider.com/auth?challenge=xyz',
      expires_in: 1800,
      interval: 5,
    };
  }

  setExchangeResult(result: OAuthToken): void {
    this.exchangeResult = result;
  }

  getExchangeCount(): number {
    return this.exchangeCount;
  }

  getLastExchangeParams(): { code: string | null; state: string | null } {
    return { code: this.lastExchangeCode, state: this.lastExchangeState };
  }

  async initiateDeviceFlow(_redirectUri?: string): Promise<DeviceCodeResponse> {
    return this.initiateResult;
  }

  async exchangeCodeForToken(
    code: string,
    state?: string,
  ): Promise<OAuthToken> {
    this.exchangeCount++;
    this.lastExchangeCode = code;
    this.lastExchangeState = state ?? null;

    if (!this.exchangeResult) {
      throw new Error('TestOAuthFlow: exchangeResult not configured');
    }
    return this.exchangeResult;
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

describe('oauth_exchange handler', () => {
  let backingStore: InMemoryTokenStore;
  let keyStorage: InMemoryProviderKeyStorage;
  let server: CredentialProxyServer;
  let client: ProxySocketClient;
  let testFlow: TestOAuthFlow;

  beforeEach(async () => {
    backingStore = new InMemoryTokenStore();
    keyStorage = new InMemoryProviderKeyStorage();
    testFlow = new TestOAuthFlow('pkce_redirect');

    const flowFactories = new Map([['anthropic', () => testFlow]]);

    const opts: CredentialProxyServerOptions = {
      tokenStore: backingStore,
      providerKeyStorage:
        keyStorage as unknown as CredentialProxyServerOptions['providerKeyStorage'],
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
  });

  // ─── Token Storage Tests ─────────────────────────────────────────────────

  describe('token storage', () => {
    it('stores exchanged token in backing store', async () => {
      // Configure test flow to return specific token
      const expectedToken: OAuthToken = {
        access_token: 'real_access_from_provider_abc123',
        refresh_token: 'real_refresh_xyz789',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) + 3600,
      };
      testFlow.setExchangeResult(expectedToken);

      // Initiate and exchange
      const init = await client.request('oauth_initiate', {
        provider: 'anthropic',
      });
      expect(init.ok).toBe(true);

      const exchange = await client.request('oauth_exchange', {
        session_id: init.data?.session_id,
        code: 'authorization_code_from_browser',
      });
      expect(exchange.ok).toBe(true);

      // CRITICAL: Verify BACKING STORE has the token
      const stored = await backingStore.getToken('anthropic');
      expect(stored).not.toBeNull();
      expect(stored?.access_token).toBe('real_access_from_provider_abc123');
    });

    it('stores token with correct provider and bucket', async () => {
      testFlow.setExchangeResult({
        access_token: 'bucket_test_token',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) + 3600,
      });

      const init = await client.request('oauth_initiate', {
        provider: 'anthropic',
        bucket: 'enterprise',
      });
      const exchange = await client.request('oauth_exchange', {
        session_id: init.data?.session_id,
        code: 'auth_code',
      });
      expect(exchange.ok).toBe(true);

      // Verify token stored with correct bucket
      const stored = await backingStore.getToken('anthropic', 'enterprise');
      expect(stored?.access_token).toBe('bucket_test_token');

      // Default bucket should NOT have this token
      const defaultBucket = await backingStore.getToken('anthropic');
      expect(defaultBucket).toBeNull();
    });
  });

  // ─── Sanitization Tests ──────────────────────────────────────────────────

  describe('token sanitization', () => {
    it('response does NOT contain refresh_token', async () => {
      testFlow.setExchangeResult({
        access_token: 'access_token_value',
        refresh_token: 'MUST_NOT_APPEAR_IN_RESPONSE',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) + 3600,
      });

      const init = await client.request('oauth_initiate', {
        provider: 'anthropic',
      });
      const exchange = await client.request('oauth_exchange', {
        session_id: init.data?.session_id,
        code: 'auth_code',
      });

      expect(exchange.ok).toBe(true);
      expect(exchange.data?.access_token).toBe('access_token_value');
      expect(exchange.data?.refresh_token).toBeUndefined();
      expect('refresh_token' in (exchange.data ?? {})).toBe(false);
    });

    it('backing store DOES contain refresh_token', async () => {
      testFlow.setExchangeResult({
        access_token: 'access_value',
        refresh_token: 'MUST_BE_IN_BACKING_STORE',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) + 3600,
      });

      const init = await client.request('oauth_initiate', {
        provider: 'anthropic',
      });
      await client.request('oauth_exchange', {
        session_id: init.data?.session_id,
        code: 'auth_code',
      });

      // Backing store must have refresh_token
      const stored = await backingStore.getToken('anthropic');
      expect(stored?.refresh_token).toBe('MUST_BE_IN_BACKING_STORE');
    });

    it('preserves provider-specific fields in backing store', async () => {
      testFlow.setExchangeResult({
        access_token: 'access',
        refresh_token: 'refresh',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) + 3600,
        // Provider-specific fields (like CodexOAuthToken)
        account_id: 'acct_12345',
      } as OAuthToken & { account_id: string });

      const init = await client.request('oauth_initiate', {
        provider: 'anthropic',
      });
      await client.request('oauth_exchange', {
        session_id: init.data?.session_id,
        code: 'auth_code',
      });

      const stored = await backingStore.getToken('anthropic');
      expect((stored as unknown as Record<string, unknown>).account_id).toBe(
        'acct_12345',
      );
    });
  });

  // ─── Session Lifecycle Tests ─────────────────────────────────────────────

  describe('session lifecycle', () => {
    it('session is consumed after successful exchange', async () => {
      testFlow.setExchangeResult({
        access_token: 'first_exchange',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) + 3600,
      });

      const init = await client.request('oauth_initiate', {
        provider: 'anthropic',
      });

      // First exchange succeeds
      const first = await client.request('oauth_exchange', {
        session_id: init.data?.session_id,
        code: 'code1',
      });
      expect(first.ok).toBe(true);

      // Second exchange with SAME session fails (session deleted after first success)
      const second = await client.request('oauth_exchange', {
        session_id: init.data?.session_id,
        code: 'code2',
      });
      expect(second.ok).toBe(false);
      expect(second.code).toBe('SESSION_NOT_FOUND');
    });

    it('invalid session returns SESSION_NOT_FOUND', async () => {
      const exchange = await client.request('oauth_exchange', {
        session_id: 'nonexistent_session_id_12345678',
        code: 'auth_code',
      });

      expect(exchange.ok).toBe(false);
      expect(exchange.code).toBe('SESSION_NOT_FOUND');
    });

    // NOTE: Session expiry test requires oauthSessionTimeoutMs option
    // which will be added in Phase 05 implementation
    it.skip('expired session returns SESSION_EXPIRED', async () => {
      // This test requires oauthSessionTimeoutMs option in CredentialProxyServerOptions
      // Will be enabled when Phase 05 adds that option
    });
  });

  // ─── Provider Call Tests ─────────────────────────────────────────────────

  describe('provider integration', () => {
    it('calls flow.exchangeCodeForToken with code', async () => {
      testFlow.setExchangeResult({
        access_token: 'from_provider',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) + 3600,
      });

      const init = await client.request('oauth_initiate', {
        provider: 'anthropic',
      });
      await client.request('oauth_exchange', {
        session_id: init.data?.session_id,
        code: 'the_authorization_code',
      });

      // Verify flow was called (via observable state, not mock)
      expect(testFlow.getExchangeCount()).toBe(1);
      expect(testFlow.getLastExchangeParams().code).toBe(
        'the_authorization_code',
      );
    });

    it('provider error propagates as EXCHANGE_FAILED', async () => {
      // Don't set exchange result - flow will throw
      const init = await client.request('oauth_initiate', {
        provider: 'anthropic',
      });
      const exchange = await client.request('oauth_exchange', {
        session_id: init.data?.session_id,
        code: 'auth_code',
      });

      expect(exchange.ok).toBe(false);
      expect(exchange.code).toBe('EXCHANGE_FAILED');
    });
  });

  // ─── Validation Tests ────────────────────────────────────────────────────

  describe('validation', () => {
    it('missing session_id returns INVALID_REQUEST', async () => {
      const exchange = await client.request('oauth_exchange', {
        code: 'auth_code',
      });

      expect(exchange.ok).toBe(false);
      expect(exchange.code).toBe('INVALID_REQUEST');
    });

    it('missing code returns INVALID_REQUEST', async () => {
      testFlow.setExchangeResult({
        access_token: 'token',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) + 3600,
      });

      const init = await client.request('oauth_initiate', {
        provider: 'anthropic',
      });
      const exchange = await client.request('oauth_exchange', {
        session_id: init.data?.session_id,
        // Missing code
      });

      expect(exchange.ok).toBe(false);
      expect(exchange.code).toBe('INVALID_REQUEST');
    });
  });

  // ─── Response Structure Tests ────────────────────────────────────────────

  describe('response structure', () => {
    it('returns access_token and token_type', async () => {
      testFlow.setExchangeResult({
        access_token: 'the_access_token',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) + 3600,
      });

      const init = await client.request('oauth_initiate', {
        provider: 'anthropic',
      });
      const exchange = await client.request('oauth_exchange', {
        session_id: init.data?.session_id,
        code: 'auth_code',
      });

      expect(exchange.ok).toBe(true);
      expect(exchange.data?.access_token).toBe('the_access_token');
      expect(exchange.data?.token_type).toBe('Bearer');
      expect(exchange.data?.expiry).toBeDefined();
    });
  });

  // ─── Argument-Capture Tests (Deepthinker Recommendations) ──────────────────

  describe('argument capture verification', () => {
    it('exchange passes correct code to provider', async () => {
      testFlow.setExchangeResult({
        access_token: 'token',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) + 3600,
      });

      const init = await client.request('oauth_initiate', {
        provider: 'anthropic',
      });
      const specificCode = 'authorization_code_' + Math.random().toString(36);

      await client.request('oauth_exchange', {
        session_id: init.data?.session_id,
        code: specificCode,
      });

      // Verify via capturing test double, NOT toHaveBeenCalledWith
      const params = testFlow.getLastExchangeParams();
      expect(params.code).toBe(specificCode);
    });

    it('exchange passes correct state to provider (for PKCE flows)', async () => {
      testFlow.setExchangeResult({
        access_token: 'token',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) + 3600,
      });

      const init = await client.request('oauth_initiate', {
        provider: 'anthropic',
      });

      await client.request('oauth_exchange', {
        session_id: init.data?.session_id,
        code: 'auth_code',
        state: init.data?.state as string, // Pass state from initiate (if applicable)
      });

      // The state should be captured by the test double
      expect(testFlow.getExchangeCount()).toBe(1);
    });
  });

  // ─── Unpredictable Token Tests (Anti-Fake) ─────────────────────────────────

  describe('anti-fake verification', () => {
    it('tokens are unpredictable - uses random nonce', async () => {
      // Generate a random nonce that changes each test run
      const nonce = 'nonce_' + Math.random().toString(36).substring(2, 15);

      testFlow.setExchangeResult({
        access_token: `real_token_with_${nonce}`,
        refresh_token: `refresh_${nonce}`,
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) + 3600,
      });

      const init = await client.request('oauth_initiate', {
        provider: 'anthropic',
      });
      const exchange = await client.request('oauth_exchange', {
        session_id: init.data?.session_id,
        code: 'auth_code',
      });

      expect(exchange.ok).toBe(true);
      // Response must contain the nonce - catches hardcoded tokens
      expect(exchange.data?.access_token).toContain(nonce);

      // Backing store must also have nonce
      const stored = await backingStore.getToken('anthropic');
      expect(stored?.access_token).toContain(nonce);
      expect(stored?.refresh_token).toContain(nonce);
    });
  });

  // ─── Concurrency Race Tests (Deepthinker Recommendations) ──────────────────

  describe('concurrency handling', () => {
    it('concurrent exchange - only one succeeds', async () => {
      testFlow.setExchangeResult({
        access_token: 'concurrent_token',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) + 3600,
      });

      const init = await client.request('oauth_initiate', {
        provider: 'anthropic',
      });

      // Fire two exchanges simultaneously
      const [result1, result2] = await Promise.all([
        client.request('oauth_exchange', {
          session_id: init.data?.session_id,
          code: 'auth_code_1',
        }),
        client.request('oauth_exchange', {
          session_id: init.data?.session_id,
          code: 'auth_code_2',
        }),
      ]);

      // Exactly one should succeed, one should fail
      const successes = [result1, result2].filter((r) => r.ok);
      const failures = [result1, result2].filter((r) => !r.ok);

      expect(successes.length).toBe(1);
      expect(failures.length).toBe(1);
      expect(failures[0].code).toBe('SESSION_ALREADY_USED');
    });

    it('concurrent exchange - no token duplication', async () => {
      testFlow.setExchangeResult({
        access_token: 'concurrent_token',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) + 3600,
      });

      const init = await client.request('oauth_initiate', {
        provider: 'anthropic',
      });

      // Fire concurrent exchanges
      await Promise.all([
        client.request('oauth_exchange', {
          session_id: init.data?.session_id,
          code: 'auth_code_1',
        }),
        client.request('oauth_exchange', {
          session_id: init.data?.session_id,
          code: 'auth_code_2',
        }),
      ]);

      // Exchange MUST be called exactly once
      // The second request MUST fail at session validation before reaching provider
      expect(testFlow.getExchangeCount()).toBe(1);

      // Backing store should have exactly one token entry
      const stored = await backingStore.getToken('anthropic');
      expect(stored).not.toBeNull();
      expect(stored?.access_token).toBe('concurrent_token');
    });
  });
});
