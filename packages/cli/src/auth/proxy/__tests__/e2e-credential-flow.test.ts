/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * End-to-end verification tests for the full credential proxy system.
 *
 * Uses REAL components across REAL Unix sockets:
 * - Real CredentialProxyServer
 * - Real ProxyTokenStore
 * - Real ProxyProviderKeyStorage
 * - Real ProxySocketClient
 *
 * Only the underlying token stores use in-memory implementations.
 *
 * @plan:PLAN-20250214-CREDPROXY.P37
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type {
  OAuthToken,
  ProviderKeyStorage,
  TokenStore,
  BucketStats,
} from '@vybestack/llxprt-code-core';
import {
  ProxyProviderKeyStorage,
  ProxySocketClient,
  ProxyTokenStore,
  KeyringTokenStore,
} from '@vybestack/llxprt-code-core';
import { CredentialProxyServer } from '../credential-proxy-server.js';
import { ProactiveScheduler } from '../proactive-scheduler.js';
import {
  createTokenStore,
  createProviderKeyStorage,
  resetFactorySingletons,
} from '../credential-store-factory.js';

// ─── In-Memory Test Doubles ──────────────────────────────────────────────────

class InMemoryTokenStore implements TokenStore {
  private readonly tokens = new Map<string, OAuthToken>();
  private readonly locks = new Set<string>();

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

  async getBucketStats(
    _provider: string,
    bucket: string,
  ): Promise<BucketStats | null> {
    return { bucket, requestCount: 0, percentage: 0, lastUsed: undefined };
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

  /** Test helper: check if token exists */
  has(provider: string, bucket?: string): boolean {
    return this.tokens.has(this.key(provider, bucket));
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

// ─── Test Helpers ────────────────────────────────────────────────────────────

interface StartedServer {
  readonly server: CredentialProxyServer;
  readonly socketPath: string;
  readonly tokenStore: InMemoryTokenStore;
  readonly keyStorage: InMemoryProviderKeyStorage;
}

// ─── E2E Tests ───────────────────────────────────────────────────────────────

describe('E2E Credential Flow (Phase 37)', () => {
  let tmpDir: string;
  let priorSocketEnv: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ce-'));
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

  // ─────────────────────────────────────────────────────────────────────────
  // Scenario 1: Full Token Lifecycle
  // ─────────────────────────────────────────────────────────────────────────

  describe('Scenario 1: Full Token Lifecycle', () => {
    /**
     * @requirement E2E.1
     * @scenario Complete token lifecycle through proxy
     * @given A proxy server with in-memory token store
     * @when Token operations are performed via ProxyTokenStore
     * @then All operations succeed with proper sanitization
     */
    it('performs full token lifecycle: store → get → save → remove', async () => {
      const { server, socketPath, tokenStore } = await startServer();

      try {
        // 1. Store a token with refresh_token on the host side
        const hostToken: OAuthToken = {
          access_token: 'host-access-token',
          refresh_token: 'host-refresh-secret',
          expiry: Math.floor(Date.now() / 1000) + 3600,
          token_type: 'Bearer',
        };
        await tokenStore.saveToken('anthropic', hostToken, 'default');

        // 2. Create ProxyTokenStore connected to the socket
        const proxyStore = new ProxyTokenStore(socketPath);

        // 3. getToken() via proxy → verify access_token present, refresh_token absent
        const retrievedToken = await proxyStore.getToken(
          'anthropic',
          'default',
        );
        expect(retrievedToken).not.toBeNull();
        expect(retrievedToken!.access_token).toBe('host-access-token');
        expect(retrievedToken!.expiry).toBe(hostToken.expiry);
        expect('refresh_token' in retrievedToken!).toBe(false);

        // 4. saveToken() → verify host receives it sans refresh_token
        await proxyStore.saveToken(
          'anthropic',
          {
            access_token: 'new-access-token',
            refresh_token: 'attempt-to-inject-refresh',
            expiry: Math.floor(Date.now() / 1000) + 7200,
            token_type: 'Bearer',
          },
          'default',
        );
        const hostUpdated = await tokenStore.getToken('anthropic', 'default');
        expect(hostUpdated!.access_token).toBe('new-access-token');
        // refresh_token should NOT be overwritten by the inner process - it should be preserved
        expect(hostUpdated!.refresh_token).toBe('host-refresh-secret');

        // 5. removeToken() → verify host store is empty
        await proxyStore.removeToken('anthropic', 'default');
        const hostAfterRemove = await tokenStore.getToken(
          'anthropic',
          'default',
        );
        expect(hostAfterRemove).toBeNull();

        // 6. Stop proxy → verify socket removed
        await server.stop();
        expect(fs.existsSync(socketPath)).toBe(false);
      } finally {
        try {
          await server.stop();
        } catch {
          // Already stopped
        }
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Scenario 5: Proactive Renewal
  // ─────────────────────────────────────────────────────────────────────────

  describe('Scenario 5: Proactive Renewal', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    /**
     * @requirement E2E.5
     * @scenario Proactive token renewal
     * @given A proxy with near-expiry token
     * @when Timer fires at renewal time
     * @then Renewal fires, new token stored on host
     */
    it('schedules and executes proactive renewal', async () => {
      const {
        server,
        socketPath: _socketPath,
        tokenStore,
      } = await startServer();
      void _socketPath;

      try {
        // Store near-expiry token
        const nowSec = Math.floor(Date.now() / 1000);
        const nearExpiryToken: OAuthToken = {
          access_token: 'near-expiry-access',
          refresh_token: 'refresh-for-renewal',
          expiry: nowSec + 600, // Expires in 10 minutes
          token_type: 'Bearer',
        };
        await tokenStore.saveToken('anthropic', nearExpiryToken, 'default');

        // Track refresh calls
        let refreshCalled = false;
        const scheduler = new ProactiveScheduler({
          refreshFn: async (provider: string, bucket: string) => {
            refreshCalled = true;
            // Simulate refresh by updating token
            const current = await tokenStore.getToken(provider, bucket);
            if (current) {
              await tokenStore.saveToken(
                provider,
                {
                  ...current,
                  access_token: `renewed-${Date.now()}`,
                  expiry: Math.floor(Date.now() / 1000) + 3600,
                },
                bucket,
              );
            }
          },
          leadTimeSec: 300, // 5 minutes before expiry
          maxJitterSec: 0, // No jitter for deterministic testing
        });

        // Schedule renewal (should fire at expiry - 300 = 300 seconds from now)
        scheduler.schedule('anthropic', 'default', nearExpiryToken.expiry);
        expect(scheduler.activeCount).toBe(1);

        // Advance time past the renewal point
        await vi.advanceTimersByTimeAsync(300 * 1000 + 100);

        // Verify refresh was called
        expect(refreshCalled).toBe(true);

        // Verify new token is stored
        const updatedToken = await tokenStore.getToken('anthropic', 'default');
        expect(updatedToken!.access_token).toContain('renewed-');

        scheduler.cancelAll();
      } finally {
        await server.stop();
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Scenario 6: Profile Scoping
  // ─────────────────────────────────────────────────────────────────────────

  describe('Scenario 6: Profile Scoping', () => {
    /**
     * @requirement E2E.6
     * @scenario Multiple provider access without restrictions
     * @given A proxy with multiple providers configured
     * @when getToken is called for different providers
     * @then All providers are accessible
     */
    it('allows access to all providers', async () => {
      const { server, socketPath, tokenStore } = await startServer();

      try {
        await tokenStore.saveToken(
          'anthropic',
          {
            access_token: 'anthropic-token',
            expiry: Math.floor(Date.now() / 1000) + 3600,
            token_type: 'Bearer',
          },
          'default',
        );
        await tokenStore.saveToken(
          'gemini',
          {
            access_token: 'gemini-token',
            expiry: Math.floor(Date.now() / 1000) + 3600,
            token_type: 'Bearer',
          },
          'default',
        );

        const proxyStore = new ProxyTokenStore(socketPath);

        const anthropicToken = await proxyStore.getToken(
          'anthropic',
          'default',
        );
        expect(anthropicToken).not.toBeNull();
        expect(anthropicToken!.access_token).toBe('anthropic-token');

        const geminiToken = await proxyStore.getToken('gemini', 'default');
        expect(geminiToken).not.toBeNull();
        expect(geminiToken!.access_token).toBe('gemini-token');
      } finally {
        await server.stop();
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Scenario 7: Connection Loss
  // ─────────────────────────────────────────────────────────────────────────

  describe('Scenario 7: Connection Loss', () => {
    /**
     * @requirement E2E.7
     * @scenario Connection loss handling
     * @given A proxy server with connected ProxyTokenStore
     * @when Proxy server is stopped
     * @then Next getToken() throws connection error
     */
    it('throws connection error after proxy stops', async () => {
      const { server, socketPath, tokenStore } = await startServer();

      // Store a token first
      await tokenStore.saveToken(
        'anthropic',
        {
          access_token: 'test-token',
          expiry: Math.floor(Date.now() / 1000) + 3600,
          token_type: 'Bearer',
        },
        'default',
      );

      const proxyStore = new ProxyTokenStore(socketPath);

      // First request succeeds
      const token = await proxyStore.getToken('anthropic', 'default');
      expect(token).not.toBeNull();

      // Stop the server
      await server.stop();

      // Next request should fail with connection error
      await expect(proxyStore.getToken('anthropic', 'default')).rejects.toThrow(
        /connection|ECONNREFUSED|ENOENT/i,
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Scenario 8: Concurrent Operations
  // ─────────────────────────────────────────────────────────────────────────

  describe('Scenario 8: Concurrent Operations', () => {
    /**
     * @requirement E2E.8
     * @scenario Concurrent proxy operations
     * @given A proxy server
     * @when Multiple getToken requests are sent concurrently
     * @then All receive correct responses
     */
    it('handles multiple concurrent getToken requests', async () => {
      const { server, socketPath, tokenStore } = await startServer();

      try {
        // Store tokens for multiple providers
        const providers = ['anthropic', 'gemini', 'openai', 'qwen', 'codex'];
        for (const provider of providers) {
          await tokenStore.saveToken(
            provider,
            {
              access_token: `${provider}-access-token`,
              expiry: Math.floor(Date.now() / 1000) + 3600,
              token_type: 'Bearer',
            },
            'default',
          );
        }

        const proxyStore = new ProxyTokenStore(socketPath);

        // Send concurrent requests
        const requests = providers.map((provider) =>
          proxyStore.getToken(provider, 'default'),
        );

        const results = await Promise.all(requests);

        // Verify all responses are correct
        for (let i = 0; i < providers.length; i++) {
          expect(results[i]).not.toBeNull();
          expect(results[i]!.access_token).toBe(`${providers[i]}-access-token`);
        }
      } finally {
        await server.stop();
      }
    });

    /**
     * @requirement E2E.8.2
     * @scenario Concurrent mixed operations
     * @given A proxy server
     * @when Mixed operations (get, save, list) are sent concurrently
     * @then All operations complete correctly
     */
    it('handles mixed concurrent operations', async () => {
      const { server, socketPath, tokenStore } = await startServer();

      try {
        // Store initial token
        await tokenStore.saveToken(
          'anthropic',
          {
            access_token: 'initial-token',
            expiry: Math.floor(Date.now() / 1000) + 3600,
            token_type: 'Bearer',
          },
          'default',
        );

        const proxyStore = new ProxyTokenStore(socketPath);

        // Mix of concurrent operations
        const operations = [
          proxyStore.getToken('anthropic', 'default'),
          proxyStore.listProviders(),
          proxyStore.saveToken(
            'gemini',
            {
              access_token: 'new-gemini-token',
              expiry: Math.floor(Date.now() / 1000) + 3600,
              token_type: 'Bearer',
            },
            'default',
          ),
          proxyStore.listBuckets('anthropic'),
          proxyStore.getToken('anthropic', 'default'),
        ];

        const results = await Promise.all(operations);

        // Verify results
        expect(results[0]).not.toBeNull(); // getToken
        expect(Array.isArray(results[1])).toBe(true); // listProviders
        expect(results[2]).toBeUndefined(); // saveToken returns void
        expect(Array.isArray(results[3])).toBe(true); // listBuckets
        expect(results[4]).not.toBeNull(); // getToken again
      } finally {
        await server.stop();
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Scenario 9: Non-Sandbox Mode Unaffected
  // ─────────────────────────────────────────────────────────────────────────

  describe('Scenario 9: Non-Sandbox Mode Unaffected', () => {
    /**
     * @requirement E2E.9
     * @scenario Factory detection in non-sandbox mode
     * @given LLXPRT_CREDENTIAL_SOCKET is NOT set
     * @when createTokenStore() is called
     * @then Returns KeyringTokenStore (no proxy involved)
     */
    it('returns KeyringTokenStore when credential socket env is not set', () => {
      // Ensure env var is not set
      delete process.env.LLXPRT_CREDENTIAL_SOCKET;
      resetFactorySingletons();

      const store = createTokenStore();

      // Should NOT be a ProxyTokenStore
      expect(store).not.toBeInstanceOf(ProxyTokenStore);
      // Should be KeyringTokenStore
      expect(store).toBeInstanceOf(KeyringTokenStore);
    });

    /**
     * @requirement E2E.9.2
     * @scenario Factory returns proxy store when env var is set
     * @given LLXPRT_CREDENTIAL_SOCKET is set
     * @when createTokenStore() is called
     * @then Returns ProxyTokenStore
     */
    it('returns ProxyTokenStore when credential socket env is set', () => {
      process.env.LLXPRT_CREDENTIAL_SOCKET = path.join(tmpDir, 'test.sock');
      resetFactorySingletons();

      const store = createTokenStore();

      expect(store).toBeInstanceOf(ProxyTokenStore);
    });

    /**
     * @requirement E2E.9.3
     * @scenario Factory returns proxy key storage when env var is set
     * @given LLXPRT_CREDENTIAL_SOCKET is set
     * @when createProviderKeyStorage() is called
     * @then Returns ProxyProviderKeyStorage
     */
    it('returns ProxyProviderKeyStorage when credential socket env is set', () => {
      process.env.LLXPRT_CREDENTIAL_SOCKET = path.join(tmpDir, 'keys.sock');
      resetFactorySingletons();

      const storage = createProviderKeyStorage();

      expect(storage).toBeInstanceOf(ProxyProviderKeyStorage);
    });

    /**
     * @requirement E2E.9.4
     * @scenario Factory memoizes singleton instances
     * @given createTokenStore() is called multiple times
     * @when In the same mode (proxy or direct)
     * @then Returns the same instance
     */
    it('memoizes factory singletons', () => {
      process.env.LLXPRT_CREDENTIAL_SOCKET = path.join(tmpDir, 'memo.sock');
      resetFactorySingletons();

      const store1 = createTokenStore();
      const store2 = createTokenStore();

      expect(store1).toBe(store2);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Additional E2E Scenarios
  // ─────────────────────────────────────────────────────────────────────────

  describe('Additional E2E: API Key Operations', () => {
    /**
     * @requirement E2E.API.1
     * @scenario API key read operations through proxy
     * @given A proxy server with API keys in host storage
     * @when API key operations are performed via ProxyProviderKeyStorage
     * @then Read operations succeed, write operations are blocked
     */
    it('supports API key read operations but blocks writes', async () => {
      const { server, socketPath, keyStorage } = await startServer();

      try {
        // Store API keys on host
        await keyStorage.saveKey('anthropic', 'sk-ant-secret-key');
        await keyStorage.saveKey('openai', 'sk-openai-secret-key');

        const client = new ProxySocketClient(socketPath);
        const proxyKeys = new ProxyProviderKeyStorage(client);

        // Read operations should succeed
        const anthropicKey = await proxyKeys.getKey('anthropic');
        expect(anthropicKey).toBe('sk-ant-secret-key');

        const keys = await proxyKeys.listKeys();
        expect(keys).toContain('anthropic');
        expect(keys).toContain('openai');

        const hasAnthropic = await proxyKeys.hasKey('anthropic');
        expect(hasAnthropic).toBe(true);

        const hasUnknown = await proxyKeys.hasKey('unknown');
        expect(hasUnknown).toBe(false);

        // Write operations should be blocked
        await expect(proxyKeys.saveKey('newkey', 'value')).rejects.toThrow(
          /not available in sandbox/i,
        );
        await expect(proxyKeys.deleteKey('anthropic')).rejects.toThrow(
          /not available in sandbox/i,
        );

        client.close();
      } finally {
        await server.stop();
      }
    });
  });

  describe('Additional E2E: Multiple Buckets', () => {
    /**
     * @requirement E2E.BUCKET.1
     * @scenario Multiple bucket access without restrictions
     * @given A proxy with multiple buckets configured
     * @when Operations are performed for different buckets
     * @then All buckets are accessible
     */
    it('allows access to all buckets', async () => {
      const { server, socketPath, tokenStore } = await startServer();

      try {
        await tokenStore.saveToken(
          'anthropic',
          {
            access_token: 'default-token',
            expiry: Math.floor(Date.now() / 1000) + 3600,
            token_type: 'Bearer',
          },
          'default',
        );
        await tokenStore.saveToken(
          'anthropic',
          {
            access_token: 'staging-token',
            expiry: Math.floor(Date.now() / 1000) + 3600,
            token_type: 'Bearer',
          },
          'staging',
        );

        const proxyStore = new ProxyTokenStore(socketPath);

        const defaultToken = await proxyStore.getToken('anthropic', 'default');
        expect(defaultToken).not.toBeNull();
        expect(defaultToken!.access_token).toBe('default-token');

        const stagingToken = await proxyStore.getToken('anthropic', 'staging');
        expect(stagingToken).not.toBeNull();
        expect(stagingToken!.access_token).toBe('staging-token');
      } finally {
        await server.stop();
      }
    });
  });
});
