# Phase 04b: OAuth Poll TDD

## Phase ID

`PLAN-20250217-CREDPROXY-REMEDIATION.P04b`

## Purpose

Write **behavioral tests FIRST** for `handleOAuthPoll` that:
1. Verify polling returns PENDING status when flow is not yet complete
2. Verify token is stored in backingStore when flow completes
3. Verify refresh_token is stripped from response but preserved in store
4. Verify session cleanup after completion
5. Verify timeout handling
6. Will FAIL against NOT_IMPLEMENTED stub

---

## Prerequisites

- Phase 04a completed (oauth_exchange TDD verification passed)

---

## Background: Device Code Polling

For `device_code` flows (Qwen, Anthropic fallback), the OAuth process involves:

1. **Initiate**: Server returns `device_code`, `user_code`, and `verification_uri`
2. **User action**: User visits URL and enters code (happens outside our control)
3. **Poll**: Client repeatedly calls `oauth_poll` until flow completes or times out

The polling operation:
1. Retrieves session with `device_code` and flow instance
2. Calls `flowInstance.pollForToken(deviceCode)`
3. Provider returns one of:
   - `authorization_pending` → return `{ status: 'pending' }`
   - `slow_down` → return `{ status: 'pending', interval: <increased> }`
   - Token → store in tokenStore, return sanitized token
4. If timeout exceeded → return `SESSION_EXPIRED`

---

## Test File

**Create**: `packages/cli/src/auth/proxy/__tests__/oauth-poll.spec.ts`

---

## Test Implementation

```typescript
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Behavioral tests for handleOAuthPoll.
 * Verifies REAL device_code polling and state persistence.
 *
 * CRITICAL: Tests verify BACKING STORE state, not just response.
 * This catches fake implementations that immediately return tokens.
 *
 * @plan PLAN-20250217-CREDPROXY-REMEDIATION.P04b
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { TokenStore, OAuthToken, BucketStats, DeviceCodeResponse } from '@vybestack/llxprt-code-core';
import { ProxySocketClient } from '@vybestack/llxprt-code-core';
import { CredentialProxyServer, type CredentialProxyServerOptions } from '../credential-proxy-server.js';

// ─── In-Memory Token Store (NOT a mock) ──────────────────────────────────────

class InMemoryTokenStore implements TokenStore {
  private tokens = new Map<string, OAuthToken>();

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

  async acquireRefreshLock(): Promise<boolean> {
    return true;
  }

  async releaseRefreshLock(): Promise<void> {}
}

// ─── Controllable Test Flow for Device Code Polling (NOT a mock) ─────────────

/**
 * Poll result from provider.
 * - If token is set, polling is complete
 * - If error is 'authorization_pending', user hasn't completed authorization
 * - If error is 'slow_down', client should increase polling interval
 */
interface PollResult {
  token?: OAuthToken;
  error?: 'authorization_pending' | 'slow_down' | 'expired_token' | 'access_denied';
  newInterval?: number;
}

class TestDeviceCodeFlow {
  private initiateResult: DeviceCodeResponse;
  private pollResults: PollResult[] = [];
  private pollIndex = 0;
  private pollCount = 0;
  private lastPolledDeviceCode: string | null = null;
  readonly flowType: 'device_code' = 'device_code';

  constructor() {
    this.initiateResult = {
      device_code: 'device_code_' + Math.random().toString(36).slice(2),
      user_code: 'ABCD-1234',
      verification_uri: 'https://provider.example.com/device',
      verification_uri_complete: 'https://provider.example.com/device?code=ABCD-1234',
      expires_in: 600,
      interval: 5,
    };
  }

  /**
   * Set the sequence of poll results.
   * Each call to pollForToken() will return the next result in sequence.
   * Useful for simulating: pending → pending → token
   */
  setPollSequence(results: PollResult[]): void {
    this.pollResults = results;
    this.pollIndex = 0;
  }

  getPollCount(): number {
    return this.pollCount;
  }

  getLastPolledDeviceCode(): string | null {
    return this.lastPolledDeviceCode;
  }

  getDeviceCode(): string {
    return this.initiateResult.device_code;
  }

  async initiateDeviceFlow(): Promise<DeviceCodeResponse> {
    return this.initiateResult;
  }

  /**
   * Poll for token completion.
   * Simulates real provider behavior based on configured poll sequence.
   */
  async pollForToken(deviceCode: string): Promise<OAuthToken> {
    this.pollCount++;
    this.lastPolledDeviceCode = deviceCode;

    if (this.pollResults.length === 0) {
      // No poll results configured - act like perpetual pending
      const err = new Error('authorization_pending') as Error & { code: string };
      err.code = 'authorization_pending';
      throw err;
    }

    const result = this.pollResults[Math.min(this.pollIndex, this.pollResults.length - 1)];
    this.pollIndex++;

    if (result.token) {
      return result.token;
    }

    const err = new Error(result.error || 'authorization_pending') as Error & { 
      code: string; 
      newInterval?: number;
    };
    err.code = result.error || 'authorization_pending';
    if (result.newInterval) {
      err.newInterval = result.newInterval;
    }
    throw err;
  }

  // Not used for device_code flow but required by interface
  async exchangeCodeForToken(): Promise<OAuthToken> {
    throw new Error('device_code flow uses pollForToken, not exchangeCodeForToken');
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

describe('oauth_poll handler', () => {
  let backingStore: InMemoryTokenStore;
  let keyStorage: InMemoryProviderKeyStorage;
  let server: CredentialProxyServer;
  let client: ProxySocketClient;
  let testFlow: TestDeviceCodeFlow;

  beforeEach(async () => {
    backingStore = new InMemoryTokenStore();
    keyStorage = new InMemoryProviderKeyStorage();
    testFlow = new TestDeviceCodeFlow();

    const flowFactories = new Map([
      ['qwen', () => testFlow],
    ]);

    const opts: CredentialProxyServerOptions = {
      tokenStore: backingStore,
      providerKeyStorage: keyStorage,
      flowFactories: flowFactories as unknown as Map<string, () => unknown>,
    };

    server = new CredentialProxyServer(opts);
    const socketPath = await server.start();
    client = new ProxySocketClient();
    await client.connect(socketPath);
  });

  afterEach(async () => {
    await client.close();
    await server.stop();
  });

  // ─── Pending Status Tests ────────────────────────────────────────────────

  describe('pending status', () => {
    it('returns pending when provider says authorization_pending', async () => {
      // Flow returns pending on first poll
      testFlow.setPollSequence([
        { error: 'authorization_pending' },
      ]);

      const init = await client.request('oauth_initiate', { provider: 'qwen' });
      expect(init.ok).toBe(true);
      expect(init.data.flow_type).toBe('device_code');

      const poll = await client.request('oauth_poll', {
        session_id: init.data.session_id,
      });

      expect(poll.ok).toBe(true);
      expect(poll.data.status).toBe('pending');
      expect(poll.data.token).toBeUndefined();
    });

    it('returns pending with increased interval on slow_down', async () => {
      testFlow.setPollSequence([
        { error: 'slow_down', newInterval: 10 },
      ]);

      const init = await client.request('oauth_initiate', { provider: 'qwen' });
      const poll = await client.request('oauth_poll', {
        session_id: init.data.session_id,
      });

      expect(poll.ok).toBe(true);
      expect(poll.data.status).toBe('pending');
      expect(poll.data.interval).toBeGreaterThan(5); // Original was 5
    });

    it('backing store has NO token while pending', async () => {
      testFlow.setPollSequence([
        { error: 'authorization_pending' },
      ]);

      const init = await client.request('oauth_initiate', { provider: 'qwen' });
      await client.request('oauth_poll', {
        session_id: init.data.session_id,
      });

      // CRITICAL: No token should be stored while pending
      const stored = await backingStore.getToken('qwen');
      expect(stored).toBeNull();
    });
  });

  // ─── Completion Tests ────────────────────────────────────────────────────

  describe('completion', () => {
    it('returns token when provider returns success', async () => {
      const expectedToken: OAuthToken = {
        access_token: 'device_flow_access_token_xyz',
        refresh_token: 'device_flow_refresh_token_abc',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) + 3600,
      };

      testFlow.setPollSequence([
        { token: expectedToken },
      ]);

      const init = await client.request('oauth_initiate', { provider: 'qwen' });
      const poll = await client.request('oauth_poll', {
        session_id: init.data.session_id,
      });

      expect(poll.ok).toBe(true);
      expect(poll.data.status).toBe('complete');
      expect(poll.data.token.access_token).toBe('device_flow_access_token_xyz');
    });

    it('stores token in backing store on completion', async () => {
      const expectedToken: OAuthToken = {
        access_token: 'stored_access_token',
        refresh_token: 'stored_refresh_token',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) + 3600,
      };

      testFlow.setPollSequence([
        { token: expectedToken },
      ]);

      const init = await client.request('oauth_initiate', { provider: 'qwen' });
      await client.request('oauth_poll', {
        session_id: init.data.session_id,
      });

      // CRITICAL: Verify BACKING STORE has the token
      const stored = await backingStore.getToken('qwen');
      expect(stored).not.toBeNull();
      expect(stored?.access_token).toBe('stored_access_token');
    });

    it('returns token after multiple pending polls', async () => {
      const finalToken: OAuthToken = {
        access_token: 'final_token_after_wait',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) + 3600,
      };

      // Simulate: pending → pending → success
      testFlow.setPollSequence([
        { error: 'authorization_pending' },
        { error: 'authorization_pending' },
        { token: finalToken },
      ]);

      const init = await client.request('oauth_initiate', { provider: 'qwen' });

      // First poll - pending
      const poll1 = await client.request('oauth_poll', { session_id: init.data.session_id });
      expect(poll1.data.status).toBe('pending');

      // Second poll - still pending
      const poll2 = await client.request('oauth_poll', { session_id: init.data.session_id });
      expect(poll2.data.status).toBe('pending');

      // Third poll - complete
      const poll3 = await client.request('oauth_poll', { session_id: init.data.session_id });
      expect(poll3.data.status).toBe('complete');
      expect(poll3.data.token.access_token).toBe('final_token_after_wait');

      // Verify backing store
      const stored = await backingStore.getToken('qwen');
      expect(stored?.access_token).toBe('final_token_after_wait');
    });
  });

  // ─── Sanitization Tests ──────────────────────────────────────────────────

  describe('token sanitization', () => {
    it('response does NOT contain refresh_token', async () => {
      testFlow.setPollSequence([{
        token: {
          access_token: 'access_value',
          refresh_token: 'MUST_NOT_APPEAR_IN_RESPONSE',
          token_type: 'Bearer',
          expiry: Math.floor(Date.now() / 1000) + 3600,
        },
      }]);

      const init = await client.request('oauth_initiate', { provider: 'qwen' });
      const poll = await client.request('oauth_poll', {
        session_id: init.data.session_id,
      });

      expect(poll.ok).toBe(true);
      expect(poll.data.status).toBe('complete');
      expect(poll.data.token.access_token).toBe('access_value');
      expect(poll.data.token.refresh_token).toBeUndefined();
      expect('refresh_token' in poll.data.token).toBe(false);
    });

    it('backing store DOES contain refresh_token', async () => {
      testFlow.setPollSequence([{
        token: {
          access_token: 'access_value',
          refresh_token: 'MUST_BE_IN_BACKING_STORE',
          token_type: 'Bearer',
          expiry: Math.floor(Date.now() / 1000) + 3600,
        },
      }]);

      const init = await client.request('oauth_initiate', { provider: 'qwen' });
      await client.request('oauth_poll', {
        session_id: init.data.session_id,
      });

      // Backing store must have refresh_token
      const stored = await backingStore.getToken('qwen');
      expect(stored?.refresh_token).toBe('MUST_BE_IN_BACKING_STORE');
    });
  });

  // ─── Session Lifecycle Tests ─────────────────────────────────────────────

  describe('session lifecycle', () => {
    it('session is consumed after successful completion', async () => {
      testFlow.setPollSequence([{
        token: {
          access_token: 'completed_token',
          token_type: 'Bearer',
          expiry: Math.floor(Date.now() / 1000) + 3600,
        },
      }]);

      const init = await client.request('oauth_initiate', { provider: 'qwen' });

      // First poll completes
      const poll1 = await client.request('oauth_poll', { session_id: init.data.session_id });
      expect(poll1.ok).toBe(true);
      expect(poll1.data.status).toBe('complete');

      // Second poll with SAME session fails
      const poll2 = await client.request('oauth_poll', { session_id: init.data.session_id });
      expect(poll2.ok).toBe(false);
      expect(poll2.code).toBe('SESSION_ALREADY_USED');
    });

    it('can poll multiple times while pending', async () => {
      // Flow stays pending forever
      testFlow.setPollSequence([
        { error: 'authorization_pending' },
        { error: 'authorization_pending' },
        { error: 'authorization_pending' },
      ]);

      const init = await client.request('oauth_initiate', { provider: 'qwen' });

      // Multiple polls should all succeed with pending
      for (let i = 0; i < 3; i++) {
        const poll = await client.request('oauth_poll', { session_id: init.data.session_id });
        expect(poll.ok).toBe(true);
        expect(poll.data.status).toBe('pending');
      }
    });

    it('invalid session returns SESSION_NOT_FOUND', async () => {
      const poll = await client.request('oauth_poll', {
        session_id: 'nonexistent_session_id_12345678',
      });

      expect(poll.ok).toBe(false);
      expect(poll.code).toBe('SESSION_NOT_FOUND');
    });

    it('expired session returns SESSION_EXPIRED', async () => {
      // Create server with short session timeout
      await client.close();
      await server.stop();

      server = new CredentialProxyServer({
        tokenStore: backingStore,
        providerKeyStorage: keyStorage,
        flowFactories: new Map([['qwen', () => testFlow]]) as unknown as Map<string, () => unknown>,
        oauthSessionTimeoutMs: 50, // 50ms timeout for test
      });
      const socketPath = await server.start();
      client = new ProxySocketClient();
      await client.connect(socketPath);

      const init = await client.request('oauth_initiate', { provider: 'qwen' });

      // Wait for session to expire
      await new Promise(resolve => setTimeout(resolve, 100));

      const poll = await client.request('oauth_poll', {
        session_id: init.data.session_id,
      });

      expect(poll.ok).toBe(false);
      expect(poll.code).toBe('SESSION_EXPIRED');
    });
  });

  // ─── Provider Call Tests ─────────────────────────────────────────────────

  describe('provider integration', () => {
    it('calls flow.pollForToken with device_code from session', async () => {
      testFlow.setPollSequence([
        { error: 'authorization_pending' },
      ]);

      const init = await client.request('oauth_initiate', { provider: 'qwen' });
      await client.request('oauth_poll', {
        session_id: init.data.session_id,
      });

      // Verify flow was called with correct device_code
      expect(testFlow.getPollCount()).toBe(1);
      expect(testFlow.getLastPolledDeviceCode()).toBe(testFlow.getDeviceCode());
    });

    it('provider access_denied error propagates as ACCESS_DENIED', async () => {
      testFlow.setPollSequence([
        { error: 'access_denied' },
      ]);

      const init = await client.request('oauth_initiate', { provider: 'qwen' });
      const poll = await client.request('oauth_poll', {
        session_id: init.data.session_id,
      });

      expect(poll.ok).toBe(false);
      expect(poll.code).toBe('ACCESS_DENIED');
    });

    it('provider expired_token error propagates as SESSION_EXPIRED', async () => {
      testFlow.setPollSequence([
        { error: 'expired_token' },
      ]);

      const init = await client.request('oauth_initiate', { provider: 'qwen' });
      const poll = await client.request('oauth_poll', {
        session_id: init.data.session_id,
      });

      expect(poll.ok).toBe(false);
      expect(poll.code).toBe('SESSION_EXPIRED');
    });
  });

  // ─── Validation Tests ────────────────────────────────────────────────────

  describe('validation', () => {
    it('missing session_id returns INVALID_REQUEST', async () => {
      const poll = await client.request('oauth_poll', {});

      expect(poll.ok).toBe(false);
      expect(poll.code).toBe('INVALID_REQUEST');
    });
  });

  // ─── Response Structure Tests ────────────────────────────────────────────

  describe('response structure', () => {
    it('pending response has status and optional interval', async () => {
      testFlow.setPollSequence([
        { error: 'authorization_pending' },
      ]);

      const init = await client.request('oauth_initiate', { provider: 'qwen' });
      const poll = await client.request('oauth_poll', {
        session_id: init.data.session_id,
      });

      expect(poll.ok).toBe(true);
      expect(poll.data.status).toBe('pending');
      expect(poll.data.token).toBeUndefined();
      // interval may or may not be present
    });

    it('complete response has status and sanitized token', async () => {
      testFlow.setPollSequence([{
        token: {
          access_token: 'the_access_token',
          token_type: 'Bearer',
          expiry: Math.floor(Date.now() / 1000) + 3600,
        },
      }]);

      const init = await client.request('oauth_initiate', { provider: 'qwen' });
      const poll = await client.request('oauth_poll', {
        session_id: init.data.session_id,
      });

      expect(poll.ok).toBe(true);
      expect(poll.data.status).toBe('complete');
      expect(poll.data.token.access_token).toBe('the_access_token');
      expect(poll.data.token.token_type).toBe('Bearer');
      expect(poll.data.token.expiry).toBeDefined();
    });
  });

  // ─── Bucket Tests ────────────────────────────────────────────────────────

  describe('bucket handling', () => {
    it('stores token with correct bucket', async () => {
      testFlow.setPollSequence([{
        token: {
          access_token: 'bucket_token',
          token_type: 'Bearer',
          expiry: Math.floor(Date.now() / 1000) + 3600,
        },
      }]);

      const init = await client.request('oauth_initiate', { 
        provider: 'qwen',
        bucket: 'enterprise',
      });
      await client.request('oauth_poll', {
        session_id: init.data.session_id,
      });

      // Verify token stored with correct bucket
      const stored = await backingStore.getToken('qwen', 'enterprise');
      expect(stored?.access_token).toBe('bucket_token');

      // Default bucket should NOT have this token
      const defaultBucket = await backingStore.getToken('qwen', 'default');
      expect(defaultBucket).toBeNull();
    });
  });

  // ─── Argument-Capture Tests (Deepthinker Recommendations) ──────────────────

  describe('argument capture verification', () => {
    it('poll passes correct device_code to provider (from session, NOT request)', async () => {
      testFlow.setPollSequence([
        { error: 'authorization_pending' },
      ]);

      const init = await client.request('oauth_initiate', { provider: 'qwen' });
      await client.request('oauth_poll', {
        session_id: init.data.session_id,
        // Note: NOT passing device_code - it should come from session
      });

      // Verify via capturing test double, NOT toHaveBeenCalledWith
      const capturedDeviceCode = testFlow.getLastPolledDeviceCode();
      expect(capturedDeviceCode).toBe(testFlow.getDeviceCode());
      // The device_code must match what was stored in session during initiate
    });
  });

  // ─── Unpredictable Token Tests (Anti-Fake) ─────────────────────────────────

  describe('anti-fake verification', () => {
    it('poll tokens are unpredictable - uses random nonce', async () => {
      // Generate a random nonce that changes each test run
      const nonce = 'poll_nonce_' + Math.random().toString(36).substring(2, 15);
      
      testFlow.setPollSequence([{
        token: {
          access_token: `device_token_with_${nonce}`,
          refresh_token: `device_refresh_${nonce}`,
          token_type: 'Bearer',
          expiry: Math.floor(Date.now() / 1000) + 3600,
        },
      }]);

      const init = await client.request('oauth_initiate', { provider: 'qwen' });
      const poll = await client.request('oauth_poll', {
        session_id: init.data.session_id,
      });

      expect(poll.ok).toBe(true);
      expect(poll.data.status).toBe('complete');
      // Response must contain the nonce - catches hardcoded tokens
      expect(poll.data.token.access_token).toContain(nonce);

      // Backing store must also have nonce
      const stored = await backingStore.getToken('qwen');
      expect(stored?.access_token).toContain(nonce);
      expect(stored?.refresh_token).toContain(nonce);
    });
  });

  // ─── Canonical Response Schema Verification ────────────────────────────────

  describe('canonical response schema', () => {
    it('pending response matches canonical schema', async () => {
      testFlow.setPollSequence([
        { error: 'authorization_pending' },
      ]);

      const init = await client.request('oauth_initiate', { provider: 'qwen' });
      const poll = await client.request('oauth_poll', {
        session_id: init.data.session_id,
      });

      // Canonical pending response: { ok: true, data: { status: 'pending', interval?: number } }
      expect(poll.ok).toBe(true);
      expect(poll.data.status).toBe('pending');
      // Should NOT have token
      expect(poll.data.token).toBeUndefined();
    });

    it('complete response matches canonical schema', async () => {
      testFlow.setPollSequence([{
        token: {
          access_token: 'canonical_access',
          refresh_token: 'canonical_refresh',
          token_type: 'Bearer',
          expiry: Math.floor(Date.now() / 1000) + 3600,
        },
      }]);

      const init = await client.request('oauth_initiate', { provider: 'qwen' });
      const poll = await client.request('oauth_poll', {
        session_id: init.data.session_id,
      });

      // Canonical complete response: { ok: true, data: { status: 'complete', token: {...} } }
      expect(poll.ok).toBe(true);
      expect(poll.data.status).toBe('complete');
      expect(poll.data.token).toBeDefined();
      expect(poll.data.token.access_token).toBe('canonical_access');
      expect(poll.data.token.token_type).toBe('Bearer');
      expect(poll.data.token.expiry).toBeDefined();
      // NO refresh_token - stripped by sanitization
      expect(poll.data.token.refresh_token).toBeUndefined();
    });
  });
});
```

---

## Test Verification

### Tests MUST fail against NOT_IMPLEMENTED stub

```bash
npm test -- packages/cli/src/auth/proxy/__tests__/oauth-poll.spec.ts
# Expected: FAIL (handleOAuthPoll is NOT_IMPLEMENTED)
```

### Anti-mock-theater check

```bash
grep -n "toHaveBeenCalled" packages/cli/src/auth/proxy/__tests__/oauth-poll.spec.ts
# Expected: 0 matches
```

### State verification check

```bash
grep -n "backingStore.getToken" packages/cli/src/auth/proxy/__tests__/oauth-poll.spec.ts
# Expected: Multiple matches
```

---

## Success Criteria

1. [ ] Test file created
2. [ ] Tests verify backingStore state (not just response)
3. [ ] Tests verify pending status when flow incomplete
4. [ ] Tests verify token stored only on completion
5. [ ] Tests verify refresh_token stripped from response
6. [ ] Tests verify refresh_token preserved in backingStore
7. [ ] Tests verify session consumed after completion
8. [ ] Tests verify multiple pending polls allowed
9. [ ] Tests FAIL against NOT_IMPLEMENTED stub
10. [ ] No mock theater

---

## Phase Completion Marker

Create: `project-plans/issue1358_1359_1360_remediation/.completed/P04b.md`
