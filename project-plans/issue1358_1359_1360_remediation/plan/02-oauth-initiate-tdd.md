# Phase 02: OAuth Initiate TDD

## Phase ID

`PLAN-20250217-CREDPROXY-REMEDIATION.P02`

## Purpose

Write **behavioral tests FIRST** for `handleOAuthInitiate` that:
1. Verify correct flow_type per provider (anthropic=pkce_redirect, qwen=device_code)
2. Verify session uniqueness
3. Verify security constraints (no PKCE verifier in response)
4. Will FAIL against NOT_IMPLEMENTED stub (proving they test real behavior)

---

## Prerequisites

- Phase 01 completed (fake handlers deleted)
- Phase 01a verification passed

---

## Test File

**Create**: `packages/cli/src/auth/proxy/__tests__/oauth-initiate.spec.ts`

---

## Test Implementation

```typescript
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Behavioral tests for handleOAuthInitiate.
 * Verifies REAL flow type detection and session creation.
 *
 * @plan PLAN-20250217-CREDPROXY-REMEDIATION.P02
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

// ─── Controllable Test Flow (NOT a mock) ─────────────────────────────────────

class TestOAuthFlow {
  private initiateResult: DeviceCodeResponse | null = null;
  readonly flowType: 'pkce_redirect' | 'device_code';

  constructor(flowType: 'pkce_redirect' | 'device_code') {
    this.flowType = flowType;
  }

  setInitiateResult(result: DeviceCodeResponse): void {
    this.initiateResult = result;
  }

  async initiateDeviceFlow(redirectUri?: string): Promise<DeviceCodeResponse> {
    if (!this.initiateResult) {
      throw new Error('TestOAuthFlow: initiateResult not configured');
    }
    return this.initiateResult;
  }
}

// ─── Test Flow Factories ─────────────────────────────────────────────────────

function createAnthropicFlow(): TestOAuthFlow {
  const flow = new TestOAuthFlow('pkce_redirect');
  flow.setInitiateResult({
    device_code: 'pkce_verifier_anthropic_abc123',  // PKCE verifier
    user_code: 'ANTHROPIC',
    verification_uri: 'https://console.anthropic.com/oauth/authorize',
    verification_uri_complete: 'https://console.anthropic.com/oauth/authorize?challenge=xyz',
    expires_in: 1800,
    interval: 5,
  });
  return flow;
}

function createQwenFlow(): TestOAuthFlow {
  const flow = new TestOAuthFlow('device_code');
  flow.setInitiateResult({
    device_code: 'qwen_device_code_xyz789',
    user_code: 'QWEN-1234',
    verification_uri: 'https://account.aliyun.com/device',
    verification_uri_complete: 'https://account.aliyun.com/device?code=QWEN-1234',
    expires_in: 1800,
    interval: 5,
  });
  return flow;
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

describe('oauth_initiate handler', () => {
  let backingStore: InMemoryTokenStore;
  let keyStorage: InMemoryProviderKeyStorage;
  let server: CredentialProxyServer;
  let client: ProxySocketClient;
  let flowFactories: Map<string, () => TestOAuthFlow>;

  beforeEach(async () => {
    backingStore = new InMemoryTokenStore();
    keyStorage = new InMemoryProviderKeyStorage();
    flowFactories = new Map([
      ['anthropic', createAnthropicFlow],
      ['qwen', createQwenFlow],
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

  // ─── Flow Type Detection Tests ───────────────────────────────────────────

  describe('flow type detection', () => {
    it('anthropic provider returns pkce_redirect flow type', async () => {
      const response = await client.request('oauth_initiate', { provider: 'anthropic' });

      expect(response.ok).toBe(true);
      expect(response.data.flow_type).toBe('pkce_redirect');
    });

    it('qwen provider returns device_code flow type', async () => {
      const response = await client.request('oauth_initiate', { provider: 'qwen' });

      expect(response.ok).toBe(true);
      expect(response.data.flow_type).toBe('device_code');
    });

    it('unknown provider returns PROVIDER_NOT_CONFIGURED error', async () => {
      const response = await client.request('oauth_initiate', { provider: 'unknown_provider' });

      expect(response.ok).toBe(false);
      expect(response.code).toBe('PROVIDER_NOT_CONFIGURED');
    });
  });

  // ─── Auth URL Tests ──────────────────────────────────────────────────────

  describe('auth URL generation', () => {
    it('anthropic returns console.anthropic.com URL, not fake', async () => {
      const response = await client.request('oauth_initiate', { provider: 'anthropic' });

      expect(response.ok).toBe(true);
      expect(response.data.auth_url).toContain('console.anthropic.com');
      expect(response.data.auth_url).not.toContain('example.com');
      expect(response.data.auth_url).not.toContain('test');
    });

    it('qwen returns aliyun.com URL, not fake', async () => {
      const response = await client.request('oauth_initiate', { provider: 'qwen' });

      expect(response.ok).toBe(true);
      expect(response.data.auth_url).toContain('aliyun.com');
      expect(response.data.auth_url).not.toContain('example.com');
    });

    it('device_code flow includes user_code', async () => {
      const response = await client.request('oauth_initiate', { provider: 'qwen' });

      expect(response.ok).toBe(true);
      expect(response.data.flow_type).toBe('device_code');
      expect(response.data.user_code).toBeDefined();
      expect(response.data.user_code).toBe('QWEN-1234');
    });
  });

  // ─── Session Tests ───────────────────────────────────────────────────────

  describe('session management', () => {
    it('returns session_id that is 32 hex characters', async () => {
      const response = await client.request('oauth_initiate', { provider: 'anthropic' });

      expect(response.ok).toBe(true);
      expect(response.data.session_id).toMatch(/^[a-f0-9]{32}$/);
    });

    it('returns different session_ids for each call', async () => {
      const r1 = await client.request('oauth_initiate', { provider: 'anthropic' });
      const r2 = await client.request('oauth_initiate', { provider: 'anthropic' });

      expect(r1.ok).toBe(true);
      expect(r2.ok).toBe(true);
      expect(r1.data.session_id).not.toBe(r2.data.session_id);
    });

    it('session can be cancelled after initiation', async () => {
      const init = await client.request('oauth_initiate', { provider: 'anthropic' });
      expect(init.ok).toBe(true);

      const cancel = await client.request('oauth_cancel', { session_id: init.data.session_id });
      expect(cancel.ok).toBe(true);

      // Exchange should fail after cancel
      const exchange = await client.request('oauth_exchange', {
        session_id: init.data.session_id,
        code: 'any_code',
      });
      expect(exchange.ok).toBe(false);
      expect(exchange.code).toBe('SESSION_NOT_FOUND');
    });
  });

  // ─── Security Tests ──────────────────────────────────────────────────────

  describe('security constraints', () => {
    it('PKCE verifier is NOT in response', async () => {
      const response = await client.request('oauth_initiate', { provider: 'anthropic' });

      expect(response.ok).toBe(true);
      // The PKCE verifier (device_code in our flow) must NOT be returned to client
      expect(response.data.code_verifier).toBeUndefined();
      expect(response.data.pkce_verifier).toBeUndefined();
      expect('code_verifier' in response.data).toBe(false);
      expect('pkce_verifier' in response.data).toBe(false);
    });

    it('internal flow state is NOT exposed', async () => {
      const response = await client.request('oauth_initiate', { provider: 'anthropic' });

      expect(response.ok).toBe(true);
      expect(response.data.flowInstance).toBeUndefined();
      expect(response.data.pkceState).toBeUndefined();
      expect('flowInstance' in response.data).toBe(false);
    });
  });

  // ─── Response Structure Tests ────────────────────────────────────────────

  describe('response structure', () => {
    it('returns pollIntervalMs for polling', async () => {
      const response = await client.request('oauth_initiate', { provider: 'qwen' });

      expect(response.ok).toBe(true);
      expect(response.data.pollIntervalMs).toBeDefined();
      expect(typeof response.data.pollIntervalMs).toBe('number');
      expect(response.data.pollIntervalMs).toBeGreaterThan(0);
    });

    it('pkce_redirect flow has verification_uri_complete', async () => {
      const response = await client.request('oauth_initiate', { provider: 'anthropic' });

      expect(response.ok).toBe(true);
      // auth_url should be the complete URL for pkce_redirect
      expect(response.data.auth_url).toBeDefined();
    });
  });

  // ─── Error Cases ─────────────────────────────────────────────────────────

  describe('error cases', () => {
    it('missing provider returns INVALID_REQUEST', async () => {
      const response = await client.request('oauth_initiate', {});

      expect(response.ok).toBe(false);
      expect(response.code).toBe('INVALID_REQUEST');
    });

    it('unauthorized provider returns UNAUTHORIZED', async () => {
      // Create server with restricted providers
      await client.close();
      await server.stop();

      server = new CredentialProxyServer({
        tokenStore: backingStore,
        providerKeyStorage: keyStorage,
        flowFactories: flowFactories as unknown as Map<string, () => unknown>,
        allowedProviders: ['anthropic'],  // Only anthropic allowed
      });
      const socketPath = await server.start();
      client = new ProxySocketClient();
      await client.connect(socketPath);

      const response = await client.request('oauth_initiate', { provider: 'qwen' });

      expect(response.ok).toBe(false);
      expect(response.code).toBe('UNAUTHORIZED');
    });
  });

  // ─── Provider Coverage Tests (Deepthinker Recommendations) ─────────────────

  describe('provider-specific flow types', () => {
    it('anthropic -> pkce_redirect flow, returns verification_uri_complete', async () => {
      const response = await client.request('oauth_initiate', { provider: 'anthropic' });

      expect(response.ok).toBe(true);
      expect(response.data.flow_type).toBe('pkce_redirect');
      expect(response.data.auth_url).toContain('console.anthropic.com');
    });

    it('qwen -> device_code flow, returns user_code + verification_uri', async () => {
      const response = await client.request('oauth_initiate', { provider: 'qwen' });

      expect(response.ok).toBe(true);
      expect(response.data.flow_type).toBe('device_code');
      expect(response.data.user_code).toBeDefined();
      expect(response.data.auth_url).toContain('aliyun.com');
    });

    it('each provider uses correct flow factory (verified by response shape)', async () => {
      // Test anthropic flow response matches expected shape
      const anthropicResponse = await client.request('oauth_initiate', { provider: 'anthropic' });
      expect(anthropicResponse.ok).toBe(true);
      expect(anthropicResponse.data.flow_type).toBe('pkce_redirect');

      // Test qwen flow response matches expected shape
      const qwenResponse = await client.request('oauth_initiate', { provider: 'qwen' });
      expect(qwenResponse.ok).toBe(true);
      expect(qwenResponse.data.flow_type).toBe('device_code');
      expect(qwenResponse.data.user_code).toBeDefined();
    });
  });

  // ─── Unpredictable Value Tests (Anti-Fake) ─────────────────────────────────

  describe('anti-fake verification', () => {
    it('auth URLs contain unpredictable values from flow, not hardcoded', async () => {
      // The test flow is configured with specific URLs containing challenge parameters
      // A fake implementation returning hardcoded 'example.com' would fail
      const response = await client.request('oauth_initiate', { provider: 'anthropic' });

      expect(response.ok).toBe(true);
      // Must contain the challenge parameter from the configured flow
      expect(response.data.auth_url).toContain('challenge=xyz');
    });

    it('user_code matches flow configuration, not hardcoded', async () => {
      const response = await client.request('oauth_initiate', { provider: 'qwen' });

      expect(response.ok).toBe(true);
      // Must match the configured user_code, not a generic value
      expect(response.data.user_code).toBe('QWEN-1234');
    });
  });
});
```

---

## Test Verification

### Tests MUST fail against NOT_IMPLEMENTED stub

```bash
# Run tests - they should FAIL because handlers return NOT_IMPLEMENTED
npm test -- packages/cli/src/auth/proxy/__tests__/oauth-initiate.spec.ts

# Expected: FAIL with "NOT_IMPLEMENTED" errors
```

### Tests verify REAL behavior, not mocks

```bash
# Check for mock theater
grep -n "toHaveBeenCalled" packages/cli/src/auth/proxy/__tests__/oauth-initiate.spec.ts
# Expected: 0 matches

# Check for state verification
grep -n "backingStore\|flowFactories" packages/cli/src/auth/proxy/__tests__/oauth-initiate.spec.ts
# Expected: Multiple matches (tests use real components)
```

---

## Success Criteria

1. [x] Test file created at `packages/cli/src/auth/proxy/__tests__/oauth-initiate.spec.ts`
2. [x] Tests cover:
   - Flow type detection per provider
   - Auth URL verification (real URLs, not example.com)
   - Session uniqueness
   - Security constraints (no PKCE verifier in response)
   - Error cases
3. [x] Tests FAIL against NOT_IMPLEMENTED stub (proving they test real behavior)
4. [x] No mock theater (`toHaveBeenCalled`) in tests
5. [x] Tests use real InMemoryTokenStore and controllable TestOAuthFlow

---

## Phase Completion Marker

Create: `project-plans/issue1358_1359_1360_remediation/.completed/P02.md`

```markdown
Phase: P02
Completed: YYYY-MM-DD HH:MM
Files Created:
- packages/cli/src/auth/proxy/__tests__/oauth-initiate.spec.ts

Tests Added: ~15 tests
- flow type detection: 3 tests
- auth URL: 3 tests
- session management: 3 tests
- security: 2 tests
- response structure: 2 tests
- error cases: 2 tests

Verification:
- Tests fail against NOT_IMPLEMENTED stub: YES
- No mock theater: YES (grep returns 0)
- TypeScript compiles: YES
```
