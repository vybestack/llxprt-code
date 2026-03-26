/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ProactiveRenewalManager } from '../proactive-renewal-manager.js';
import { executeTokenRefresh } from '../token-refresh-helper.js';
import type { OAuthToken, OAuthProvider, TokenStore } from '../types.js';
import type { ProviderRegistry } from '../provider-registry.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeToken(
  accessToken: string,
  refreshToken: string,
  expiresInSec = 600,
): OAuthToken {
  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: 'Bearer',
    expiry: Math.floor(Date.now() / 1000) + expiresInSec,
  };
}

function makeExpiredToken(
  accessToken: string,
  refreshToken: string,
): OAuthToken {
  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: 'Bearer',
    expiry: Math.floor(Date.now() / 1000) - 60,
  };
}

function createMockTokenStore(): TokenStore {
  return {
    getToken: vi.fn(),
    saveToken: vi.fn(),
    removeToken: vi.fn(),
    listBuckets: vi.fn(),
    acquireRefreshLock: vi.fn().mockResolvedValue(true),
    releaseRefreshLock: vi.fn().mockResolvedValue(undefined),
  } as unknown as TokenStore;
}

function createMockProvider(): OAuthProvider {
  return {
    name: 'test-provider',
    getToken: vi.fn(),
    refreshToken: vi.fn(),
    initiateAuth: vi.fn(),
  } as unknown as OAuthProvider;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ProactiveRenewalManager – cross-process refresh safety', () => {
  let tokenStore: TokenStore;
  let provider: OAuthProvider;
  let manager: ProactiveRenewalManager;

  beforeEach(() => {
    vi.useFakeTimers();
    tokenStore = createMockTokenStore();
    provider = createMockProvider();
    manager = new ProactiveRenewalManager(
      tokenStore,
      (_name: string) => provider,
      (_name: string) => true,
    );
  });

  afterEach(() => {
    manager.clearAllTimers();
    vi.useRealTimers();
  });

  describe('refresh_token comparison in hasTokenBeenRefreshedExternally', () => {
    it('skips refresh when refresh_token differs from scheduled', async () => {
      const originalToken = makeToken('access-A', 'refresh-R1', 600);
      manager.scheduleProactiveRenewal('anthropic', 'default', originalToken);

      // Another process refreshed: same access_token (unlikely) but new refresh_token
      const diskToken = makeToken('access-A', 'refresh-R2', 500);
      vi.mocked(tokenStore.getToken).mockResolvedValue(diskToken);

      await manager.runProactiveRenewal('anthropic', 'default');

      expect(provider.refreshToken).not.toHaveBeenCalled();
    });

    it('skips refresh when access_token differs from scheduled', async () => {
      const originalToken = makeToken('access-A', 'refresh-R1', 600);
      manager.scheduleProactiveRenewal('anthropic', 'default', originalToken);

      // Another process refreshed: new access_token, new refresh_token
      const diskToken = makeToken('access-B', 'refresh-R2', 3600);
      vi.mocked(tokenStore.getToken).mockResolvedValue(diskToken);

      await manager.runProactiveRenewal('anthropic', 'default');

      expect(provider.refreshToken).not.toHaveBeenCalled();
    });

    it('proceeds with refresh when both access_token and refresh_token match', async () => {
      const originalToken = makeToken('access-A', 'refresh-R1', 600);
      manager.scheduleProactiveRenewal('anthropic', 'default', originalToken);

      // Disk token is identical (no other process refreshed)
      vi.mocked(tokenStore.getToken).mockResolvedValue(
        makeToken('access-A', 'refresh-R1', 600),
      );
      const refreshedToken = makeToken('access-B', 'refresh-R2', 3600);
      vi.mocked(provider.refreshToken).mockResolvedValue(refreshedToken);

      await manager.runProactiveRenewal('anthropic', 'default');

      expect(provider.refreshToken).toHaveBeenCalledTimes(1);
      expect(tokenStore.saveToken).toHaveBeenCalled();
    });
  });

  describe('stores both access_token and refresh_token in schedule', () => {
    it('stores refresh_token alongside access_token when scheduling', async () => {
      const token = makeToken('access-X', 'refresh-Y', 1200);
      manager.scheduleProactiveRenewal('anthropic', 'default', token);

      // Verify by triggering renewal with a token where only refresh_token changed
      const diskTokenDiffRefresh = makeToken('access-X', 'refresh-Z', 1200);
      vi.mocked(tokenStore.getToken).mockResolvedValue(diskTokenDiffRefresh);

      await manager.runProactiveRenewal('anthropic', 'default');

      // Should skip because refresh_token changed
      expect(provider.refreshToken).not.toHaveBeenCalled();
    });
  });
});

describe('executeTokenRefresh – refresh_token guard', () => {
  let tokenStore: TokenStore;
  let provider: OAuthProvider;
  let providerRegistry: Pick<ProviderRegistry, 'getProvider'>;
  let renewalManager: ProactiveRenewalManager;

  beforeEach(() => {
    tokenStore = createMockTokenStore();
    provider = createMockProvider();
    providerRegistry = {
      getProvider: (_name: string) => provider,
    };
    renewalManager = new ProactiveRenewalManager(
      tokenStore,
      (_name: string) => provider,
      (_name: string) => true,
    );
  });

  afterEach(() => {
    renewalManager.clearAllTimers();
  });

  it('skips refresh when disk refresh_token differs from original token', async () => {
    const originalToken = makeExpiredToken('access-A', 'refresh-R1');
    const diskToken = makeExpiredToken('access-A', 'refresh-R2');

    vi.mocked(tokenStore.getToken).mockResolvedValue(diskToken);

    const result = await executeTokenRefresh(
      'anthropic',
      'default',
      originalToken,
      Math.floor(Date.now() / 1000) + 30,
      tokenStore,
      providerRegistry as ProviderRegistry,
      renewalManager,
    );

    // Should NOT call refreshToken (refresh_token was consumed by another process)
    expect(provider.refreshToken).not.toHaveBeenCalled();
    // Disk token is expired, so returns null instead of propagating a stale token
    expect(result).toBeNull();
  });

  it('proceeds with refresh when disk refresh_token matches original', async () => {
    const originalToken = makeExpiredToken('access-A', 'refresh-R1');
    const diskToken = makeExpiredToken('access-A', 'refresh-R1');
    const refreshedToken = makeToken('access-B', 'refresh-R2', 3600);

    vi.mocked(tokenStore.getToken).mockResolvedValue(diskToken);
    vi.mocked(provider.refreshToken).mockResolvedValue(refreshedToken);

    const result = await executeTokenRefresh(
      'anthropic',
      'default',
      originalToken,
      Math.floor(Date.now() / 1000) + 30,
      tokenStore,
      providerRegistry as ProviderRegistry,
      renewalManager,
    );

    expect(provider.refreshToken).toHaveBeenCalledTimes(1);
    expect(result?.access_token).toBe('access-B');
  });
});
