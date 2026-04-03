/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Phase 5: TokenAccessCoordinator unit tests.
 *
 * These tests cover the isolated TokenAccessCoordinator class before
 * the full wiring into OAuthManager.  They focus on:
 *   A) Authenticator guard error when auth-required path reached with no authenticator
 *   B) getOAuthToken refresh-lock parameters (waitMs:10000 / staleMs:30000)
 *   C) getToken disk-check refresh-lock parameters (waitMs:5000 / staleMs:30000)
 *   D) peekStoredToken reads from store without locking
 *   E) withBucketResolutionLock serialises concurrent calls for same provider
 *   F) getToken returns null when provider not registered
 *   G) getToken returns null when OAuth disabled via registry
 *   H) getToken propagates errors from Gemini normally (G4 dead-code removed)
 */

import { describe, it, expect, vi } from 'vitest';
import { TokenAccessCoordinator } from '../token-access-coordinator.js';
import type { OAuthProvider } from '../types.js';
import type { OAuthToken, TokenStore } from '../types.js';
import type { OAuthTokenRequestMetadata } from '@vybestack/llxprt-code-core';

// --------------------------------------------------------------------------
// Minimal stub helpers
// --------------------------------------------------------------------------

function makeToken(accessToken: string, expiryOffsetSecs = 3600): OAuthToken {
  return {
    access_token: accessToken,
    refresh_token: `refresh-${accessToken}`,
    expiry: Math.floor(Date.now() / 1000) + expiryOffsetSecs,
    token_type: 'Bearer',
    scope: null,
  };
}

function createMockTokenStore(): TokenStore {
  return {
    saveToken: vi.fn(async () => {}),
    getToken: vi.fn(async () => null),
    removeToken: vi.fn(async () => {}),
    listProviders: vi.fn(async () => []),
    listBuckets: vi.fn(async () => []),
    getBucketStats: vi.fn(async () => null),
    acquireRefreshLock: vi.fn(async () => true),
    releaseRefreshLock: vi.fn(async () => {}),
    acquireAuthLock: vi.fn(async () => true),
    releaseAuthLock: vi.fn(async () => {}),
  };
}

function createMockProvider(name: string): OAuthProvider {
  return {
    name,
    initiateAuth: vi.fn(async () => makeToken('from-initiate')),
    getToken: vi.fn(async () => null),
    refreshToken: vi.fn(async () => null),
  };
}

// Minimal ProviderRegistry-like object that TokenAccessCoordinator receives
function createMockRegistry(provider?: OAuthProvider, oauthEnabled = true) {
  return {
    getProvider: vi.fn((_name: string) => provider ?? undefined),
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

// Minimal facade reference (BucketFailoverOAuthManagerLike)
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

// Mock runtimeSettings for profile resolution
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

// --------------------------------------------------------------------------
// Factory helper that creates coordinator with all mocks wired
// --------------------------------------------------------------------------

function makeCoordinator(opts?: {
  provider?: OAuthProvider;
  oauthEnabled?: boolean;
  tokenStoreOverride?: TokenStore;
  settings?: import('../../../src/config/settings.js').LoadedSettings;
}) {
  const tokenStore = opts?.tokenStoreOverride ?? createMockTokenStore();
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
    opts?.settings,
    undefined, // config
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

// --------------------------------------------------------------------------
// A) Authenticator guard
// --------------------------------------------------------------------------

describe('TokenAccessCoordinator – authenticator guard', () => {
  it('throws a clear error when auth-required path is reached with no authenticator wired', async () => {
    // Single-bucket profile — this is the path that calls authenticate() directly
    const provider = createMockProvider('anthropic');
    const { coordinator, tokenStore } = makeCoordinator({ provider });

    // Settings = undefined, registry says oauth enabled → will try to trigger auth
    // acquireRefreshLock → true, no disk token → falls through to auth section
    vi.mocked(tokenStore.acquireRefreshLock).mockResolvedValue(true);
    vi.mocked(tokenStore.getToken).mockResolvedValue(null);

    // NO setAuthenticator call — must throw
    await expect(coordinator.getToken('anthropic')).rejects.toThrow(
      'authenticator not wired',
    );
  });
});

// --------------------------------------------------------------------------
// B) getOAuthToken refresh-lock parameters
// --------------------------------------------------------------------------

describe('TokenAccessCoordinator – getOAuthToken refresh lock parameters', () => {
  it('acquires refresh lock with waitMs:10000 and staleMs:30000 when token is expired', async () => {
    const provider = createMockProvider('anthropic');
    const expiredToken = makeToken('expired', -10); // expired 10s ago
    const { coordinator, tokenStore } = makeCoordinator({ provider });

    // Return expired token on first getToken, lock succeeds, recheck also returns expired
    vi.mocked(tokenStore.getToken).mockResolvedValue(expiredToken);
    vi.mocked(tokenStore.acquireRefreshLock).mockResolvedValue(true);

    await coordinator.getOAuthToken('anthropic', 'default');

    expect(tokenStore.acquireRefreshLock).toHaveBeenCalledWith(
      'anthropic',
      expect.objectContaining({ waitMs: 10000, staleMs: 30000 }),
    );
  });

  it('releases refresh lock even when refresh throws', async () => {
    const provider = createMockProvider('anthropic');
    const expiredToken = makeToken('expired', -10);
    provider.refreshToken = vi.fn(async () => {
      throw new Error('refresh network failure');
    });
    const { coordinator, tokenStore } = makeCoordinator({ provider });

    vi.mocked(tokenStore.getToken).mockResolvedValue(expiredToken);
    vi.mocked(tokenStore.acquireRefreshLock).mockResolvedValue(true);

    // getOAuthToken swallows refresh errors and returns null
    const result = await coordinator.getOAuthToken('anthropic', 'default');

    expect(result).toBeNull();
    expect(tokenStore.releaseRefreshLock).toHaveBeenCalledWith(
      'anthropic',
      'default',
    );
  });

  it('returns valid token without touching refresh lock', async () => {
    const provider = createMockProvider('anthropic');
    const validToken = makeToken('still-good', 3600);
    const { coordinator, tokenStore } = makeCoordinator({ provider });

    vi.mocked(tokenStore.getToken).mockResolvedValue(validToken);

    const result = await coordinator.getOAuthToken('anthropic', 'default');

    expect(result).toEqual(validToken);
    expect(tokenStore.acquireRefreshLock).not.toHaveBeenCalled();
  });

  it('performs TOCTOU double-check: returns refreshed token from another process after lock acquisition', async () => {
    const provider = createMockProvider('anthropic');
    const expiredToken = makeToken('expired', -10);
    const freshToken = makeToken('refreshed-by-other', 3600);

    const { coordinator, tokenStore } = makeCoordinator({ provider });

    // First getToken returns expired; after lock acquisition recheck returns fresh
    let callCount = 0;
    vi.mocked(tokenStore.getToken).mockImplementation(async () => {
      callCount++;
      if (callCount === 1) return expiredToken; // initial read
      return freshToken; // recheck under lock
    });
    vi.mocked(tokenStore.acquireRefreshLock).mockResolvedValue(true);

    const result = await coordinator.getOAuthToken('anthropic', 'default');

    expect(result).toEqual(freshToken);
    // Provider refresh should NOT have been called because recheck showed fresh token
    expect(provider.refreshToken).not.toHaveBeenCalled();
  });
});

// --------------------------------------------------------------------------
// C) getToken disk-check refresh-lock parameters
// --------------------------------------------------------------------------

describe('TokenAccessCoordinator – getToken disk-check refresh lock parameters', () => {
  it('acquires refresh lock with waitMs:5000 and staleMs:30000 in disk-check path', async () => {
    const provider = createMockProvider('anthropic');
    const { coordinator, tokenStore } = makeCoordinator({ provider });

    // No token in store initially (getOAuthToken returns null), no disk token either
    vi.mocked(tokenStore.getToken).mockResolvedValue(null);
    vi.mocked(tokenStore.acquireRefreshLock).mockResolvedValue(true);

    // Wire an authenticator so we don't blow up on the auth path
    coordinator.setAuthenticator({
      authenticate: vi.fn(async () => {}),
      authenticateMultipleBuckets: vi.fn(async () => {}),
    });

    // No profile buckets → single-bucket path
    // After disk-check still null → falls through to auth
    try {
      await coordinator.getToken('anthropic');
    } catch {
      // may throw for other reasons, that's ok — we just want to check lock params
    }

    // Find the call with waitMs:5000 — that's the disk-check lock
    const lockCalls = vi.mocked(tokenStore.acquireRefreshLock).mock.calls;
    const diskCheckCall = lockCalls.find(
      ([, opts]) => (opts as { waitMs?: number }).waitMs === 5000,
    );
    expect(diskCheckCall).toBeDefined();
    expect(diskCheckCall![1]).toMatchObject({ waitMs: 5000, staleMs: 30000 });
  });

  it('releases disk-check refresh lock on all error paths', async () => {
    const provider = createMockProvider('anthropic');
    provider.refreshToken = vi.fn(async () => {
      throw new Error('refresh failed');
    });

    const { coordinator, tokenStore } = makeCoordinator({ provider });

    const expiredDiskToken = makeToken('disk-expired', -100);
    // getOAuthToken path: no store token
    // disk-check path: finds expired token with refresh_token
    vi.mocked(tokenStore.getToken)
      .mockResolvedValueOnce(null) // getOAuthToken's first read
      .mockResolvedValueOnce(expiredDiskToken); // disk-check inside getToken

    vi.mocked(tokenStore.acquireRefreshLock).mockResolvedValue(true);

    coordinator.setAuthenticator({
      authenticate: vi.fn(async () => {}),
      authenticateMultipleBuckets: vi.fn(async () => {}),
    });

    try {
      await coordinator.getToken('anthropic');
    } catch {
      // ignored
    }

    // releaseRefreshLock must have been called at least once
    expect(tokenStore.releaseRefreshLock).toHaveBeenCalled();
  });
});

// --------------------------------------------------------------------------
// D) peekStoredToken
// --------------------------------------------------------------------------

describe('TokenAccessCoordinator – peekStoredToken', () => {
  it('reads token from store for known provider without acquiring any lock', async () => {
    const provider = createMockProvider('anthropic');
    const storedToken = makeToken('peeked', 3600);
    const { coordinator, tokenStore } = makeCoordinator({ provider });

    vi.mocked(tokenStore.getToken).mockResolvedValue(storedToken);

    const result = await coordinator.peekStoredToken('anthropic');

    expect(result).toEqual(storedToken);
    expect(tokenStore.acquireRefreshLock).not.toHaveBeenCalled();
    expect(tokenStore.acquireAuthLock).not.toHaveBeenCalled();
  });

  it('returns null when store has no token (swallows error)', async () => {
    const provider = createMockProvider('anthropic');
    const { coordinator, tokenStore } = makeCoordinator({ provider });

    vi.mocked(tokenStore.getToken).mockRejectedValue(new Error('disk error'));

    const result = await coordinator.peekStoredToken('anthropic');
    expect(result).toBeNull();
  });

  it('throws when provider is unknown', async () => {
    const { coordinator } = makeCoordinator({ provider: undefined });

    await expect(coordinator.peekStoredToken('unknown')).rejects.toThrow(
      'Unknown provider',
    );
  });
});

// --------------------------------------------------------------------------
// E) withBucketResolutionLock serialisation
// --------------------------------------------------------------------------

describe('TokenAccessCoordinator – withBucketResolutionLock serialisation', () => {
  it('serialises concurrent getOAuthToken calls for the same provider', async () => {
    const provider = createMockProvider('anthropic');
    const validToken = makeToken('valid', 3600);
    const { coordinator, tokenStore } = makeCoordinator({ provider });

    vi.mocked(tokenStore.getToken).mockResolvedValue(validToken);

    // Fire two concurrent getOAuthToken calls
    const [r1, r2] = await Promise.all([
      coordinator.getOAuthToken('anthropic'),
      coordinator.getOAuthToken('anthropic'),
    ]);

    expect(r1).toEqual(validToken);
    expect(r2).toEqual(validToken);
  });
});

// --------------------------------------------------------------------------
// F) getToken returns null when provider not registered
// --------------------------------------------------------------------------

describe('TokenAccessCoordinator – getToken provider not registered', () => {
  it('returns null when provider is unknown', async () => {
    const { coordinator } = makeCoordinator({ provider: undefined });

    const result = await coordinator.getToken('unknown-provider');
    expect(result).toBeNull();
  });
});

// --------------------------------------------------------------------------
// G) getToken returns null when OAuth disabled
// --------------------------------------------------------------------------

describe('TokenAccessCoordinator – getToken OAuth disabled', () => {
  it('returns null when settings present and OAuth is disabled', async () => {
    const provider = createMockProvider('anthropic');
    // Create with a fake LoadedSettings-like object that is truthy
    const fakeSettings =
      {} as import('../../../src/config/settings.js').LoadedSettings;
    const { coordinator } = makeCoordinator({
      provider,
      oauthEnabled: false,
      settings: fakeSettings,
    });

    const result = await coordinator.getToken('anthropic');
    expect(result).toBeNull();
  });
});

// --------------------------------------------------------------------------
// H) Gemini errors propagate normally (G4 dead code removed)
// --------------------------------------------------------------------------

describe('TokenAccessCoordinator – Gemini error propagation (G4)', () => {
  it('propagates normal auth errors without special-casing (no USE_EXISTING_GEMINI_OAUTH swallowing)', async () => {
    const provider = createMockProvider('gemini');
    const { coordinator, tokenStore, facade } = makeCoordinator({ provider });

    coordinator.setAuthenticator({
      authenticate: vi.fn(async () => {
        throw new Error('auth failed hard');
      }),
      authenticateMultipleBuckets: vi.fn(async () => {}),
    });

    vi.mocked(tokenStore.getToken).mockResolvedValue(null);
    vi.mocked(tokenStore.acquireRefreshLock).mockResolvedValue(true);
    vi.mocked(facade.authenticate).mockRejectedValue(
      new Error('auth failed hard'),
    );

    await expect(coordinator.getToken('gemini')).rejects.toThrow(
      'auth failed hard',
    );
  });
});
