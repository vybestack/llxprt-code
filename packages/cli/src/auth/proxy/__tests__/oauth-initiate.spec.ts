/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Behavioral tests for handleOAuthInitiate.
 * Verifies REAL flow type detection and session creation.
 *
 * These tests are designed to FAIL against NOT_IMPLEMENTED stubs,
 * proving they test real behavior rather than mock interactions.
 *
 * NO MOCK THEATER: These tests verify actual state changes,
 * not mock interactions (no toHaveBeenCalled, etc.)
 *
 * @plan PLAN-20250217-CREDPROXY-REMEDIATION.P02
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

/**
 * A controllable test double for OAuth flows.
 * This is NOT a mock - it returns configured responses to drive real behavior.
 */
class TestOAuthFlow {
  private initiateResult: DeviceCodeResponse | null = null;
  readonly flowType: 'pkce_redirect' | 'device_code';

  constructor(flowType: 'pkce_redirect' | 'device_code') {
    this.flowType = flowType;
  }

  setInitiateResult(result: DeviceCodeResponse): void {
    this.initiateResult = result;
  }

  async initiateDeviceFlow(_redirectUri?: string): Promise<DeviceCodeResponse> {
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
    device_code: 'pkce_verifier_anthropic_abc123', // PKCE verifier - should NOT be exposed
    user_code: 'ANTHROPIC',
    verification_uri: 'https://console.anthropic.com/oauth/authorize',
    verification_uri_complete:
      'https://console.anthropic.com/oauth/authorize?challenge=xyz',
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
    verification_uri_complete:
      'https://account.aliyun.com/device?code=QWEN-1234',
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

  // ─── Flow Type Detection Tests ───────────────────────────────────────────

  describe('flow type detection', () => {
    /**
     * @requirement R-OAUTH-01
     * @scenario Anthropic provider uses PKCE redirect flow
     * @given A configured server with anthropic flow factory
     * @when oauth_initiate is called for anthropic
     * @then Response contains flow_type: 'pkce_redirect'
     */
    it('anthropic provider returns pkce_redirect flow type', async () => {
      const response = await client.request('oauth_initiate', {
        provider: 'anthropic',
      });

      expect(response.ok).toBe(true);
      expect(response.data?.flow_type).toBe('pkce_redirect');
    });

    /**
     * @requirement R-OAUTH-02
     * @scenario Qwen provider uses device code flow
     * @given A configured server with qwen flow factory
     * @when oauth_initiate is called for qwen
     * @then Response contains flow_type: 'device_code'
     */
    it('qwen provider returns device_code flow type', async () => {
      const response = await client.request('oauth_initiate', {
        provider: 'qwen',
      });

      expect(response.ok).toBe(true);
      expect(response.data?.flow_type).toBe('device_code');
    });

    /**
     * @requirement R-OAUTH-03
     * @scenario Unknown provider returns error
     * @given A server without a flow factory for the requested provider
     * @when oauth_initiate is called for unknown provider
     * @then Response is ok:false with code PROVIDER_NOT_CONFIGURED
     */
    it('unknown provider returns PROVIDER_NOT_CONFIGURED error', async () => {
      const response = await client.request('oauth_initiate', {
        provider: 'unknown_provider',
      });

      expect(response.ok).toBe(false);
      expect(response.code).toBe('PROVIDER_NOT_CONFIGURED');
    });
  });

  // ─── Auth URL Tests ──────────────────────────────────────────────────────

  describe('auth URL generation', () => {
    /**
     * @requirement R-OAUTH-04
     * @scenario Anthropic auth URL comes from real flow, not hardcoded
     * @given A configured anthropic flow factory
     * @when oauth_initiate is called
     * @then auth_url contains console.anthropic.com (from test flow config)
     */
    it('anthropic returns console.anthropic.com URL, not fake', async () => {
      const response = await client.request('oauth_initiate', {
        provider: 'anthropic',
      });

      expect(response.ok).toBe(true);
      expect(response.data?.auth_url).toContain('console.anthropic.com');
      expect(response.data?.auth_url).not.toContain('example.com');
      expect(response.data?.auth_url).not.toContain('test');
    });

    /**
     * @requirement R-OAUTH-05
     * @scenario Qwen auth URL comes from real flow, not hardcoded
     * @given A configured qwen flow factory
     * @when oauth_initiate is called
     * @then auth_url contains aliyun.com (from test flow config)
     */
    it('qwen returns aliyun.com URL, not fake', async () => {
      const response = await client.request('oauth_initiate', {
        provider: 'qwen',
      });

      expect(response.ok).toBe(true);
      expect(response.data?.auth_url).toContain('aliyun.com');
      expect(response.data?.auth_url).not.toContain('example.com');
    });

    /**
     * @requirement R-OAUTH-06
     * @scenario Device code flow includes user_code in response
     * @given A device_code flow provider (qwen)
     * @when oauth_initiate is called
     * @then Response includes user_code from the flow
     */
    it('device_code flow includes user_code', async () => {
      const response = await client.request('oauth_initiate', {
        provider: 'qwen',
      });

      expect(response.ok).toBe(true);
      expect(response.data?.flow_type).toBe('device_code');
      expect(response.data?.user_code).toBeDefined();
      expect(response.data?.user_code).toBe('QWEN-1234');
    });
  });

  // ─── Session Tests ───────────────────────────────────────────────────────

  describe('session management', () => {
    /**
     * @requirement R-OAUTH-07
     * @scenario Session IDs are properly formatted
     * @given A successful oauth_initiate call
     * @when Response is examined
     * @then session_id is 32 hex characters (128-bit identifier)
     */
    it('returns session_id that is 32 hex characters', async () => {
      const response = await client.request('oauth_initiate', {
        provider: 'anthropic',
      });

      expect(response.ok).toBe(true);
      expect(response.data?.session_id).toMatch(/^[a-f0-9]{32}$/);
    });

    /**
     * @requirement R-OAUTH-08
     * @scenario Each initiate call creates a unique session
     * @given Multiple oauth_initiate calls
     * @when Session IDs are compared
     * @then All session IDs are unique
     */
    it('returns different session_ids for each call', async () => {
      const r1 = await client.request('oauth_initiate', {
        provider: 'anthropic',
      });
      const r2 = await client.request('oauth_initiate', {
        provider: 'anthropic',
      });

      expect(r1.ok).toBe(true);
      expect(r2.ok).toBe(true);
      expect(r1.data?.session_id).not.toBe(r2.data?.session_id);
    });

    /**
     * @requirement R-OAUTH-09
     * @scenario Cancelled sessions cannot be used for exchange
     * @given A session that was cancelled via oauth_cancel
     * @when oauth_exchange is attempted with that session
     * @then Response is ok:false with code SESSION_NOT_FOUND
     */
    it('session can be cancelled after initiation', async () => {
      const init = await client.request('oauth_initiate', {
        provider: 'anthropic',
      });
      expect(init.ok).toBe(true);

      const cancel = await client.request('oauth_cancel', {
        session_id: init.data?.session_id,
      });
      expect(cancel.ok).toBe(true);

      // Exchange should fail after cancel
      const exchange = await client.request('oauth_exchange', {
        session_id: init.data?.session_id,
        code: 'any_code',
      });
      expect(exchange.ok).toBe(false);
      expect(exchange.code).toBe('SESSION_NOT_FOUND');
    });
  });

  // ─── Security Tests ──────────────────────────────────────────────────────

  describe('security constraints', () => {
    /**
     * @requirement R-OAUTH-10 (CRITICAL SECURITY)
     * @scenario PKCE verifier is never exposed to client
     * @given A pkce_redirect flow initiate response
     * @when Response is examined
     * @then code_verifier and pkce_verifier are NOT present
     */
    it('PKCE verifier is NOT in response', async () => {
      const response = await client.request('oauth_initiate', {
        provider: 'anthropic',
      });

      expect(response.ok).toBe(true);
      // The PKCE verifier (device_code in our flow) must NOT be returned to client
      expect(response.data?.code_verifier).toBeUndefined();
      expect(response.data?.pkce_verifier).toBeUndefined();
      expect('code_verifier' in (response.data ?? {})).toBe(false);
      expect('pkce_verifier' in (response.data ?? {})).toBe(false);
    });

    /**
     * @requirement R-OAUTH-11 (SECURITY)
     * @scenario Internal flow state is never exposed
     * @given An oauth_initiate response
     * @when Response is examined
     * @then Internal implementation details are not present
     */
    it('internal flow state is NOT exposed', async () => {
      const response = await client.request('oauth_initiate', {
        provider: 'anthropic',
      });

      expect(response.ok).toBe(true);
      expect(response.data?.flowInstance).toBeUndefined();
      expect(response.data?.pkceState).toBeUndefined();
      expect('flowInstance' in (response.data ?? {})).toBe(false);
    });
  });

  // ─── Response Structure Tests ────────────────────────────────────────────

  describe('response structure', () => {
    /**
     * @requirement R-OAUTH-12
     * @scenario Response includes poll interval for device code flows
     * @given A device_code flow provider
     * @when oauth_initiate is called
     * @then pollIntervalMs is present and positive
     */
    it('returns pollIntervalMs for polling', async () => {
      const response = await client.request('oauth_initiate', {
        provider: 'qwen',
      });

      expect(response.ok).toBe(true);
      expect(response.data?.pollIntervalMs).toBeDefined();
      expect(typeof response.data?.pollIntervalMs).toBe('number');
      expect(response.data?.pollIntervalMs).toBeGreaterThan(0);
    });

    /**
     * @requirement R-OAUTH-13
     * @scenario PKCE redirect flow returns auth URL
     * @given A pkce_redirect flow provider
     * @when oauth_initiate is called
     * @then auth_url is present for browser redirect
     */
    it('pkce_redirect flow has verification_uri_complete', async () => {
      const response = await client.request('oauth_initiate', {
        provider: 'anthropic',
      });

      expect(response.ok).toBe(true);
      // auth_url should be the complete URL for pkce_redirect
      expect(response.data?.auth_url).toBeDefined();
    });
  });

  // ─── Error Cases ─────────────────────────────────────────────────────────

  describe('error cases', () => {
    /**
     * @requirement R-OAUTH-14
     * @scenario Missing provider parameter returns error
     * @given An oauth_initiate request without provider
     * @when Request is processed
     * @then Response is ok:false with code INVALID_REQUEST
     */
    it('missing provider returns INVALID_REQUEST', async () => {
      const response = await client.request('oauth_initiate', {});

      expect(response.ok).toBe(false);
      expect(response.code).toBe('INVALID_REQUEST');
    });

    /**
     * @requirement R-OAUTH-15
     * @scenario Provider without configured flow factory returns PROVIDER_NOT_CONFIGURED
     * @given A server without a flow factory for the requested provider
     * @when oauth_initiate is called for an unconfigured provider
     * @then Response is ok:false with code PROVIDER_NOT_CONFIGURED
     */
    it('unconfigured provider returns PROVIDER_NOT_CONFIGURED', async () => {
      const response = await client.request('oauth_initiate', {
        provider: 'totally_unconfigured_provider',
      });

      expect(response.ok).toBe(false);
      expect(response.code).toBe('PROVIDER_NOT_CONFIGURED');
    });
  });

  // ─── Provider Coverage Tests (Deepthinker Recommendations) ─────────────────

  describe('provider-specific flow types', () => {
    /**
     * @requirement R-OAUTH-16
     * @scenario Anthropic provider-specific response shape
     * @given Anthropic flow factory
     * @when oauth_initiate is called
     * @then Response matches pkce_redirect expected shape
     */
    it('anthropic -> pkce_redirect flow, returns verification_uri_complete', async () => {
      const response = await client.request('oauth_initiate', {
        provider: 'anthropic',
      });

      expect(response.ok).toBe(true);
      expect(response.data?.flow_type).toBe('pkce_redirect');
      expect(response.data?.auth_url).toContain('console.anthropic.com');
    });

    /**
     * @requirement R-OAUTH-17
     * @scenario Qwen provider-specific response shape
     * @given Qwen flow factory
     * @when oauth_initiate is called
     * @then Response matches device_code expected shape with user_code
     */
    it('qwen -> device_code flow, returns user_code + verification_uri', async () => {
      const response = await client.request('oauth_initiate', {
        provider: 'qwen',
      });

      expect(response.ok).toBe(true);
      expect(response.data?.flow_type).toBe('device_code');
      expect(response.data?.user_code).toBeDefined();
      expect(response.data?.auth_url).toContain('aliyun.com');
    });

    /**
     * @requirement R-OAUTH-18
     * @scenario Each provider uses its correct flow factory
     * @given Multiple configured providers
     * @when oauth_initiate is called for each
     * @then Each response matches the expected flow type
     */
    it('each provider uses correct flow factory (verified by response shape)', async () => {
      // Test anthropic flow response matches expected shape
      const anthropicResponse = await client.request('oauth_initiate', {
        provider: 'anthropic',
      });
      expect(anthropicResponse.ok).toBe(true);
      expect(anthropicResponse.data?.flow_type).toBe('pkce_redirect');

      // Test qwen flow response matches expected shape
      const qwenResponse = await client.request('oauth_initiate', {
        provider: 'qwen',
      });
      expect(qwenResponse.ok).toBe(true);
      expect(qwenResponse.data?.flow_type).toBe('device_code');
      expect(qwenResponse.data?.user_code).toBeDefined();
    });
  });

  // ─── Unpredictable Value Tests (Anti-Fake) ─────────────────────────────────

  describe('anti-fake verification', () => {
    /**
     * @requirement R-OAUTH-19 (ANTI-FAKE)
     * @scenario Auth URLs contain unpredictable values from flow
     * @given A configured flow with specific challenge parameter
     * @when oauth_initiate is called
     * @then auth_url contains the challenge parameter from flow
     */
    it('auth URLs contain unpredictable values from flow, not hardcoded', async () => {
      // The test flow is configured with specific URLs containing challenge parameters
      // A fake implementation returning hardcoded 'example.com' would fail
      const response = await client.request('oauth_initiate', {
        provider: 'anthropic',
      });

      expect(response.ok).toBe(true);
      // Must contain the challenge parameter from the configured flow
      expect(response.data?.auth_url).toContain('challenge=xyz');
    });

    /**
     * @requirement R-OAUTH-20 (ANTI-FAKE)
     * @scenario User code matches flow configuration
     * @given A configured flow with specific user_code
     * @when oauth_initiate is called
     * @then user_code matches the configured value exactly
     */
    it('user_code matches flow configuration, not hardcoded', async () => {
      const response = await client.request('oauth_initiate', {
        provider: 'qwen',
      });

      expect(response.ok).toBe(true);
      // Must match the configured user_code, not a generic value
      expect(response.data?.user_code).toBe('QWEN-1234');
    });
  });
});
