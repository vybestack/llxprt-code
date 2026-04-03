/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * @fix issue1861
 * TokenAccessCoordinator forceRefreshToken tests
 *
 * These behavioral tests verify that forceRefreshToken:
 * 1. Refreshes token when stored token matches failed token
 * 2. Returns stored token when it differs from failed token (another process refreshed)
 * 3. Handles TOCTOU race conditions correctly
 */

import { describe, it, expect, vi } from 'vitest';
import { TokenAccessCoordinator } from '../token-access-coordinator.js';
import type { OAuthProvider, OAuthToken, TokenStore } from '../types.js';
import type { OAuthTokenRequestMetadata } from '@vybestack/llxprt-code-core';

// --------------------------------------------------------------------------
// Test helpers
// --------------------------------------------------------------------------

function makeToken(
  accessToken: string,
  expiryOffsetSecs = 3600,
  refreshToken?: string,
): OAuthToken {
  return {
    access_token: accessToken,
    refresh_token: refreshToken ?? `refresh-${accessToken}`,
    expiry: Math.floor(Date.now() / 1000) + expiryOffsetSecs,
    token_type: 'Bearer',
    scope: null,
  };
}

function createMockTokenStore(
  initialTokens: Map<string, OAuthToken> = new Map(),
): TokenStore {
  const tokens = new Map(initialTokens);
  const locks = new Map<string, boolean>();

  return {
    saveToken: vi.fn(
      async (provider: string, token: OAuthToken, bucket?: string) => {
        const key = bucket ? `${provider}::${bucket}` : provider;
        tokens.set(key, token);
      },
    ),
    getToken: vi.fn(async (provider: string, bucket?: string) => {
      const key = bucket ? `${provider}::${bucket}` : provider;
      return tokens.get(key) ?? null;
    }),
    removeToken: vi.fn(async (provider: string, bucket?: string) => {
      const key = bucket ? `${provider}::${bucket}` : provider;
      tokens.delete(key);
    }),
    listProviders: vi.fn(async () => Array.from(tokens.keys())),
    listBuckets: vi.fn(async () => []),
    getBucketStats: vi.fn(async () => null),
    acquireRefreshLock: vi.fn(async (_provider: string, _opts?: unknown) => {
      const bucket =
        typeof _opts === 'object' &&
        _opts &&
        'bucket' in _opts &&
        typeof (_opts as { bucket?: unknown }).bucket === 'string'
          ? ((_opts as { bucket?: string }).bucket as string)
          : undefined;
      const key = bucket ? `${_provider}::${bucket}` : _provider;
      if (locks.get(key)) return false;
      locks.set(key, true);
      return true;
    }),
    releaseRefreshLock: vi.fn(async (_provider: string, _bucket?: string) => {
      const key = _bucket ? `${_provider}::${_bucket}` : _provider;
      locks.delete(key);
    }),
    acquireAuthLock: vi.fn(async () => true),
    releaseAuthLock: vi.fn(async () => {}),
  };
}

function createMockProvider(name: string): OAuthProvider {
  return {
    name,
    initiateAuth: vi.fn(async () => makeToken('from-initiate')),
    getToken: vi.fn(async () => null),
    refreshToken: vi.fn(async (oldToken: OAuthToken) =>
      makeToken(
        `refreshed-${oldToken.access_token}`,
        3600,
        oldToken.refresh_token,
      ),
    ),
  };
}

// Minimal ProviderRegistry-like object
function createMockRegistry(provider?: OAuthProvider, oauthEnabled = true) {
  return {
    getProvider: vi.fn((name: string) =>
      provider && name === provider.name ? provider : undefined,
    ),
    isOAuthEnabled: vi.fn(() => oauthEnabled),
    hasExplicitInMemoryOAuthState: vi.fn(() => false),
  };
}

// Minimal ProactiveRenewalManager-like stub
function createMockRenewalManager() {
  return {
    scheduleProactiveRenewal: vi.fn(),
  };
}

// Minimal OAuthBucketManager-like stub
function createMockBucketManager() {
  return {
    getSessionBucket: vi.fn(
      (_provider: string, _metadata?: OAuthTokenRequestMetadata) =>
        undefined as string | undefined,
    ),
    setSessionBucket: vi.fn(),
    clearSessionBucket: vi.fn(),
    clearAllSessionBuckets: vi.fn(),
    getSessionBucketScopeKey: vi.fn(
      (provider: string, metadata?: OAuthTokenRequestMetadata) =>
        metadata?.profileId ? `${provider}::${metadata.profileId}` : provider,
    ),
  };
}

// Minimal facade reference
function createMockFacade() {
  return {
    getSessionBucket: vi.fn(() => undefined as string | undefined),
    setSessionBucket: vi.fn(),
    getOAuthToken: vi.fn(async () => null as OAuthToken | null),
    authenticate: vi.fn(async () => {}),
    authenticateMultipleBuckets: vi.fn(async () => {}),
    getTokenStore: vi.fn(),
    forceRefreshToken: vi.fn(async () => null as OAuthToken | null),
  };
}

// Factory helper
function makeCoordinator(opts?: {
  provider?: OAuthProvider;
  oauthEnabled?: boolean;
  initialTokens?: Map<string, OAuthToken>;
}) {
  const tokenStore = createMockTokenStore(opts?.initialTokens);
  const provider = opts?.provider;
  const registry = createMockRegistry(provider, opts?.oauthEnabled ?? true);
  const renewalManager = createMockRenewalManager();
  const bucketManager = createMockBucketManager();
  const facade = createMockFacade();

  const coordinator = new TokenAccessCoordinator(
    tokenStore,
    registry as never,
    renewalManager as never,
    bucketManager as never,
    facade as never,
    undefined,
    undefined,
  );

  return {
    coordinator,
    tokenStore,
    registry,
    renewalManager,
    bucketManager,
    facade,
    provider,
  };
}

// Mock runtimeSettings
vi.mock('../../runtime/runtimeSettings.js', () => ({
  getEphemeralSetting: vi.fn(() => undefined),
  getCliRuntimeServices: vi.fn(() => ({
    settingsService: {
      getCurrentProfileName: vi.fn(() => null),
      get: vi.fn(() => null),
    },
  })),
  getCliProviderManager: vi.fn(() => ({
    getProviderByName: vi.fn(() => null),
  })),
  getCliRuntimeContext: vi.fn(() => ({
    runtimeId: 'test-runtime',
  })),
}));

// Mock @vybestack/llxprt-code-core ProfileManager
vi.mock('@vybestack/llxprt-code-core', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@vybestack/llxprt-code-core')>();
  return {
    ...actual,
    ProfileManager: class MockProfileManager {
      async loadProfile(name: string) {
        throw new Error(`Profile ${name} not found`);
      }
    },
  };
});

describe('TokenAccessCoordinator forceRefreshToken', () => {
  /**
   * @fix issue1861
   * Test that forceRefreshToken refreshes when stored token matches failed token
   */
  it('should force refresh when stored token matches the failed access token', async () => {
    const failedToken = 'failed-access-token';
    const initialToken = makeToken(failedToken, 3600, 'refresh-token-123');
    const initialTokens = new Map([['anthropic', initialToken]]);

    const provider = createMockProvider('anthropic');
    const { coordinator, tokenStore } = makeCoordinator({
      provider,
      initialTokens,
    });

    // Call forceRefreshToken with the failed token
    const result = await coordinator.forceRefreshToken(
      'anthropic',
      failedToken,
    );

    // Should return a refreshed token
    expect(result).not.toBeNull();
    expect(result?.access_token).toBe('refreshed-failed-access-token');
    expect(result?.refresh_token).toBe('refresh-token-123'); // Same refresh token

    // Should have saved the new token to the store
    expect(tokenStore.saveToken).toHaveBeenCalledWith(
      'anthropic',
      expect.objectContaining({
        access_token: 'refreshed-failed-access-token',
      }),
      undefined,
    );

    // Should have acquired and released the lock
    expect(tokenStore.acquireRefreshLock).toHaveBeenCalledWith(
      'anthropic',
      expect.any(Object),
    );
    expect(tokenStore.releaseRefreshLock).toHaveBeenCalledWith(
      'anthropic',
      undefined,
    );
  });

  /**
   * @fix issue1861
   * Test that forceRefreshToken returns stored token when it differs from failed token
   * (another process already refreshed)
   */
  it('should return stored token when it differs from failed token (another process refreshed)', async () => {
    const failedToken = 'failed-access-token';
    const alreadyRefreshedToken = makeToken(
      'already-refreshed-by-other-process',
      3600,
      'refresh-token-123',
    );
    const initialTokens = new Map([['anthropic', alreadyRefreshedToken]]);

    const provider = createMockProvider('anthropic');
    const {
      coordinator,
      tokenStore,
      provider: mockProvider,
    } = makeCoordinator({
      provider,
      initialTokens,
    });

    // Call forceRefreshToken with the old failed token
    const result = await coordinator.forceRefreshToken(
      'anthropic',
      failedToken,
    );

    // Should return the already-refreshed token without calling refresh
    expect(result).not.toBeNull();
    expect(result?.access_token).toBe('already-refreshed-by-other-process');

    // Should NOT have called the provider's refreshToken
    expect(mockProvider?.refreshToken).not.toHaveBeenCalled();

    // Should NOT have saved a new token
    expect(tokenStore.saveToken).not.toHaveBeenCalled();
  });

  /**
   * @fix issue1861
   * Test that forceRefreshToken handles missing stored token
   */
  it('should return null when no token exists in store', async () => {
    const failedToken = 'failed-access-token';
    const provider = createMockProvider('anthropic');
    const {
      coordinator,
      tokenStore,
      provider: mockProvider,
    } = makeCoordinator({
      provider,
      initialTokens: new Map(), // No tokens
    });

    const result = await coordinator.forceRefreshToken(
      'anthropic',
      failedToken,
    );

    expect(result).toBeNull();
    expect(mockProvider?.refreshToken).not.toHaveBeenCalled();
    expect(tokenStore.saveToken).not.toHaveBeenCalled();
  });

  /**
   * @fix issue1861
   * Test that forceRefreshToken handles unknown provider
   */
  it('should return null when provider is unknown', async () => {
    const providerName = 'unknown-provider';
    const failedToken = 'failed-access-token';
    const initialToken = makeToken(failedToken, 3600, 'refresh-token-123');
    const initialTokens = new Map([[providerName, initialToken]]);

    const { coordinator, registry } = makeCoordinator({
      provider: undefined,
      initialTokens,
    });

    const result = await coordinator.forceRefreshToken(
      providerName,
      failedToken,
    );

    expect(result).toBeNull();
    expect(registry.getProvider).toHaveBeenCalledWith(providerName);
  });

  /**
   * @fix issue1861
   * Test that forceRefreshToken handles lock acquisition failure
   */
  it('should return null when lock cannot be acquired', async () => {
    const failedToken = 'failed-access-token';
    const initialToken = makeToken(failedToken, 3600, 'refresh-token-123');
    const initialTokens = new Map([['anthropic', initialToken]]);

    const provider = createMockProvider('anthropic');
    const {
      coordinator,
      tokenStore,
      provider: mockProvider,
    } = makeCoordinator({
      provider,
      initialTokens,
    });

    // Make lock acquisition fail
    vi.mocked(tokenStore.acquireRefreshLock).mockResolvedValue(false);

    const result = await coordinator.forceRefreshToken(
      'anthropic',
      failedToken,
    );

    expect(result).toBeNull();
    expect(mockProvider?.refreshToken).not.toHaveBeenCalled();
    expect(tokenStore.releaseRefreshLock).not.toHaveBeenCalled();
  });

  /**
   * @fix issue1861
   * Test that forceRefreshToken handles refresh errors gracefully
   */
  it('should return null when refresh operation fails', async () => {
    const failedToken = 'failed-access-token';
    const initialToken = makeToken(failedToken, 3600, 'refresh-token-123');
    const initialTokens = new Map([['anthropic', initialToken]]);

    const provider = createMockProvider('anthropic');
    // Make refresh fail
    provider.refreshToken = vi.fn(async () => {
      throw new Error('Refresh failed - token revoked');
    });

    const { coordinator, tokenStore } = makeCoordinator({
      provider,
      initialTokens,
    });

    const result = await coordinator.forceRefreshToken(
      'anthropic',
      failedToken,
    );

    expect(result).toBeNull();
    // Lock should still be released
    expect(tokenStore.releaseRefreshLock).toHaveBeenCalledWith(
      'anthropic',
      undefined,
    );
  });

  /**
   * @fix issue1861
   * Test that forceRefreshToken works with specific bucket
   */
  it('should force refresh for specific bucket when provided', async () => {
    const failedToken = 'failed-access-token';
    const bucket = 'my-bucket';
    const initialToken = makeToken(failedToken, 3600, 'refresh-token-123');
    const initialTokens = new Map([[`anthropic::${bucket}`, initialToken]]);

    const provider = createMockProvider('anthropic');
    const { coordinator, tokenStore } = makeCoordinator({
      provider,
      initialTokens,
    });

    const result = await coordinator.forceRefreshToken(
      'anthropic',
      failedToken,
      bucket,
    );

    expect(result).not.toBeNull();
    expect(result?.access_token).toBe('refreshed-failed-access-token');

    // Should use the bucket-specific key
    expect(tokenStore.getToken).toHaveBeenCalledWith('anthropic', bucket);
    expect(tokenStore.acquireRefreshLock).toHaveBeenCalledWith(
      'anthropic',
      expect.objectContaining({ bucket }),
    );
    expect(tokenStore.saveToken).toHaveBeenCalledWith(
      'anthropic',
      expect.any(Object),
      bucket,
    );
  });

  /**
   * @fix issue1861
   * Test TOCTOU: token changes after initial read but before lock acquisition
   */
  it('should handle TOCTOU when token changes between read and lock', async () => {
    const failedToken = 'failed-access-token';
    const refreshedByOtherToken = makeToken(
      'refreshed-by-other',
      3600,
      'refresh-token-123',
    );

    const initialTokens = new Map([['anthropic', refreshedByOtherToken]]);

    const provider = createMockProvider('anthropic');
    const { coordinator, provider: mockProvider } = makeCoordinator({
      provider,
      initialTokens,
    });

    // The token in the store already has a different access_token than the failed one
    // This simulates another process having refreshed it

    const result = await coordinator.forceRefreshToken(
      'anthropic',
      failedToken, // This is the token that failed
    );

    // Should return the already-refreshed token (different from failed token)
    expect(result?.access_token).toBe('refreshed-by-other');
    // Should NOT have called refresh
    expect(mockProvider?.refreshToken).not.toHaveBeenCalled();
  });

  /**
   * @fix issue1861
   * Test that forceRefreshToken handles null refresh_token
   */
  it('should handle token without refresh_token gracefully', async () => {
    const failedToken = 'failed-access-token';
    const initialToken: OAuthToken = {
      access_token: failedToken,
      expiry: Math.floor(Date.now() / 1000) + 3600,
      token_type: 'Bearer',
      scope: null,
      // No refresh_token
    };
    const initialTokens = new Map([['anthropic', initialToken]]);

    const provider = createMockProvider('anthropic');
    const {
      coordinator,
      tokenStore,
      provider: mockProvider,
    } = makeCoordinator({
      provider,
      initialTokens,
    });

    const result = await coordinator.forceRefreshToken(
      'anthropic',
      failedToken,
    );

    // Without a refresh token, cannot refresh - should return null
    expect(result).toBeNull();
    expect(mockProvider?.refreshToken).not.toHaveBeenCalled();
    expect(tokenStore.releaseRefreshLock).toHaveBeenCalled();
  });
});
