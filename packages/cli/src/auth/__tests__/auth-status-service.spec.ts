/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoist mock factories so they're available before vi.mock() runs
// ---------------------------------------------------------------------------
const { flushMockRef, providerManagerRef, providerRef } = vi.hoisted(() => ({
  flushMockRef: {
    current: undefined as ReturnType<typeof vi.fn> | undefined,
  },
  providerManagerRef: {
    current: undefined as
      | { getProviderByName: ReturnType<typeof vi.fn> }
      | undefined,
  },
  providerRef: {
    current: undefined as unknown,
  },
}));

vi.mock('@vybestack/llxprt-code-core', async () => {
  const actual = await vi.importActual<
    typeof import('@vybestack/llxprt-code-core')
  >('@vybestack/llxprt-code-core');
  const flushMock = vi.fn(() => ({
    runtimeId: 'test-runtime',
    revokedTokens: [],
  }));
  flushMockRef.current = flushMock;
  return {
    ...actual,
    flushRuntimeAuthScope: flushMock,
  };
});

vi.mock('../../runtime/runtimeSettings.js', async () => {
  const actual = await vi.importActual<
    typeof import('../../runtime/runtimeSettings.js')
  >('../../runtime/runtimeSettings.js');
  const managerMock = {
    getProviderByName: vi.fn(() => providerRef.current),
  };
  providerManagerRef.current = managerMock;
  return {
    ...actual,
    getCliRuntimeContext: vi.fn(() => ({
      runtimeId: 'test-runtime',
      metadata: {},
    })),
    getCliProviderManager: vi.fn(() => managerMock),
    getCliRuntimeServices: vi.fn(() => ({
      settingsService: {
        getCurrentProfileName: vi.fn(() => null),
        get: vi.fn(() => null),
      },
    })),
  };
});

import { AuthStatusService } from '../auth-status-service.js';
import type { OAuthProvider } from '../types.js';
import type { TokenStore, OAuthToken } from '@vybestack/llxprt-code-core';
import type { ProviderRegistry } from '../provider-registry.js';
import type { ProactiveRenewalManager } from '../proactive-renewal-manager.js';
import type { OAuthBucketManager } from '../OAuthBucketManager.js';
import type { TokenAccessCoordinator } from '../token-access-coordinator.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTokenStore(
  overrides: Partial<TokenStore> = {},
): TokenStore & { [k: string]: ReturnType<typeof vi.fn> } {
  return {
    saveToken: vi.fn(),
    getToken: vi.fn().mockResolvedValue(null),
    removeToken: vi.fn().mockResolvedValue(undefined),
    listProviders: vi.fn().mockResolvedValue([]),
    listBuckets: vi.fn().mockResolvedValue(['default']),
    getBucketStats: vi.fn().mockResolvedValue(null),
    acquireRefreshLock: vi.fn().mockResolvedValue(true),
    releaseRefreshLock: vi.fn().mockResolvedValue(undefined),
    acquireAuthLock: vi.fn().mockResolvedValue(true),
    releaseAuthLock: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as TokenStore & { [k: string]: ReturnType<typeof vi.fn> };
}

function makeProvider(
  name: string,
  overrides: Partial<OAuthProvider> & Record<string, unknown> = {},
): OAuthProvider & Record<string, unknown> {
  return {
    name,
    initiateAuth: vi.fn(async () => ({
      access_token: 'tok',
      refresh_token: 'ref',
      expiry: Math.floor(Date.now() / 1000) + 3600,
      token_type: 'Bearer' as const,
    })),
    getToken: vi.fn(async () => null),
    refreshToken: vi.fn(async () => null),
    logout: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeProviderRegistry(
  providers: OAuthProvider[],
  oauthEnabled: boolean = true,
): ProviderRegistry {
  const map = new Map(providers.map((p) => [p.name, p]));
  return {
    getProvider: vi.fn((name: string) => map.get(name)),
    getSupportedProviders: vi.fn(() => Array.from(map.keys())),
    isOAuthEnabled: vi.fn(() => oauthEnabled),
    toggleOAuthEnabled: vi.fn(),
    setOAuthEnabledState: vi.fn(),
    registerProvider: vi.fn(),
    hasExplicitInMemoryOAuthState: vi.fn(() => false),
  } as unknown as ProviderRegistry;
}

function makeProactiveRenewalManager(): ProactiveRenewalManager {
  return {
    clearRenewalsForProvider: vi.fn(),
    scheduleProactiveRenewal: vi.fn(),
    clearAllTimers: vi.fn(),
    runProactiveRenewal: vi.fn(),
    clearProactiveRenewal: vi.fn(),
  } as unknown as ProactiveRenewalManager;
}

function makeBucketManager(): OAuthBucketManager {
  return {
    setSessionBucket: vi.fn(),
    getSessionBucket: vi.fn().mockReturnValue(undefined),
    clearSessionBucket: vi.fn(),
    clearAllSessionBuckets: vi.fn(),
    getSessionBucketScopeKey: vi.fn((provider: string) => provider),
  } as unknown as OAuthBucketManager;
}

function makeTokenAccessCoordinator(
  sessionBucket: string | undefined = undefined,
  sessionMetadata:
    | import('@vybestack/llxprt-code-core').OAuthTokenRequestMetadata
    | undefined = undefined,
): TokenAccessCoordinator {
  return {
    getCurrentProfileSessionBucket: vi.fn().mockResolvedValue(sessionBucket),
    getCurrentProfileSessionMetadata: vi
      .fn()
      .mockResolvedValue(sessionMetadata),
    getProfileBuckets: vi.fn().mockResolvedValue([]),
    doGetProfileBuckets: vi.fn().mockResolvedValue([]),
  } as unknown as TokenAccessCoordinator;
}

function makeService(
  opts: {
    tokenStore?: TokenStore;
    providers?: OAuthProvider[];
    oauthEnabled?: boolean;
    sessionBucket?: string;
    proactiveRenewalManager?: ProactiveRenewalManager;
    bucketManager?: OAuthBucketManager;
    tokenAccessCoordinator?: TokenAccessCoordinator;
  } = {},
): AuthStatusService {
  const {
    tokenStore = makeTokenStore(),
    providers = [],
    oauthEnabled = true,
    sessionBucket,
    proactiveRenewalManager = makeProactiveRenewalManager(),
    bucketManager = makeBucketManager(),
    tokenAccessCoordinator = makeTokenAccessCoordinator(sessionBucket),
  } = opts;
  const providerRegistry = makeProviderRegistry(providers, oauthEnabled);
  return new AuthStatusService(
    tokenStore,
    providerRegistry,
    proactiveRenewalManager,
    bucketManager,
    tokenAccessCoordinator,
  );
}

// ---------------------------------------------------------------------------
// isAuthenticated — generic provider override
// ---------------------------------------------------------------------------

describe('AuthStatusService.isAuthenticated', () => {
  beforeEach(() => {
    flushMockRef.current?.mockClear();
    providerManagerRef.current?.getProviderByName.mockReset();
  });

  it('returns false for invalid providerName', async () => {
    const service = makeService();
    expect(await service.isAuthenticated('')).toBe(false);
    expect(await service.isAuthenticated(undefined as unknown as string)).toBe(
      false,
    );
  });

  it('uses provider.isAuthenticated() override when OAuth enabled', async () => {
    const isAuthMock = vi.fn().mockResolvedValue(true);
    const provider = makeProvider('gemini', { isAuthenticated: isAuthMock });
    const service = makeService({ providers: [provider], oauthEnabled: true });
    const result = await service.isAuthenticated('gemini');
    expect(result).toBe(true);
    expect(isAuthMock).toHaveBeenCalled();
  });

  it('does NOT consult provider.isAuthenticated() when OAuth disabled', async () => {
    const isAuthMock = vi.fn().mockResolvedValue(true);
    const provider = makeProvider('gemini', { isAuthenticated: isAuthMock });
    const service = makeService({ providers: [provider], oauthEnabled: false });
    const result = await service.isAuthenticated('gemini');
    // OAuth disabled → falls back to token store check → null token → false
    expect(result).toBe(false);
    expect(isAuthMock).not.toHaveBeenCalled();
  });

  it('falls back to token store check when override throws', async () => {
    const isAuthMock = vi.fn().mockRejectedValue(new Error('override failed'));
    const validToken: OAuthToken = {
      access_token: 'valid',
      refresh_token: 'r',
      expiry: Math.floor(Date.now() / 1000) + 3600,
      token_type: 'Bearer',
    };
    const tokenStore = makeTokenStore({
      getToken: vi.fn().mockResolvedValue(validToken),
    });
    const provider = makeProvider('qwen', { isAuthenticated: isAuthMock });
    const service = makeService({
      providers: [provider],
      tokenStore,
      oauthEnabled: true,
    });
    const result = await service.isAuthenticated('qwen');
    // Override threw → fallback → valid token found → true
    expect(result).toBe(true);
    expect(isAuthMock).toHaveBeenCalled();
  });

  it('falls back to token store check when override returns false', async () => {
    const isAuthMock = vi.fn().mockResolvedValue(false);
    const validToken: OAuthToken = {
      access_token: 'valid',
      refresh_token: 'r',
      expiry: Math.floor(Date.now() / 1000) + 3600,
      token_type: 'Bearer',
    };
    const tokenStore = makeTokenStore({
      getToken: vi.fn().mockResolvedValue(validToken),
    });
    const provider = makeProvider('qwen', { isAuthenticated: isAuthMock });
    const service = makeService({
      providers: [provider],
      tokenStore,
      oauthEnabled: true,
    });
    const result = await service.isAuthenticated('qwen');
    // Override returned false → fallback → valid token found → true
    expect(result).toBe(true);
  });

  it('returns false when token store has no token (OAuth disabled path)', async () => {
    const provider = makeProvider('anthropic');
    const service = makeService({ providers: [provider], oauthEnabled: false });
    const result = await service.isAuthenticated('anthropic');
    expect(result).toBe(false);
  });

  it('returns false when token is expired', async () => {
    const expiredToken: OAuthToken = {
      access_token: 'expired',
      refresh_token: 'r',
      expiry: Math.floor(Date.now() / 1000) - 100, // expired
      token_type: 'Bearer',
    };
    const tokenStore = makeTokenStore({
      getToken: vi.fn().mockResolvedValue(expiredToken),
    });
    const provider = makeProvider('anthropic');
    const service = makeService({
      providers: [provider],
      tokenStore,
      oauthEnabled: false,
    });
    const result = await service.isAuthenticated('anthropic');
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// logout
// ---------------------------------------------------------------------------

describe('AuthStatusService.logout', () => {
  beforeEach(() => {
    flushMockRef.current?.mockClear();
    providerManagerRef.current?.getProviderByName.mockReset();
  });

  it('throws on invalid providerName', async () => {
    const service = makeService();
    await expect(service.logout('')).rejects.toThrow(
      'Provider name must be a non-empty string',
    );
  });

  it('throws on unknown provider', async () => {
    const service = makeService();
    await expect(service.logout('nonexistent')).rejects.toThrow(
      'Unknown provider',
    );
  });

  it('calls provider.logout(token), removes token, and clears proactive renewals', async () => {
    const token: OAuthToken = {
      access_token: 'tok',
      refresh_token: 'r',
      expiry: Math.floor(Date.now() / 1000) + 3600,
      token_type: 'Bearer',
    };
    const tokenStore = makeTokenStore({
      getToken: vi.fn().mockResolvedValue(token),
      listBuckets: vi.fn().mockResolvedValue(['default']),
    });
    const provider = makeProvider('qwen');
    const proactiveRenewalManager = makeProactiveRenewalManager();
    const service = makeService({
      tokenStore,
      providers: [provider],
      proactiveRenewalManager,
    });

    await service.logout('qwen');

    expect(provider.logout).toHaveBeenCalledWith(token);
    expect(tokenStore.removeToken).toHaveBeenCalledWith('qwen', 'default');
    expect(
      proactiveRenewalManager.clearRenewalsForProvider as ReturnType<
        typeof vi.fn
      >,
    ).toHaveBeenCalledWith('qwen', 'default');
  });

  it('removes token even when provider.logout throws', async () => {
    const provider = makeProvider('qwen', {
      logout: vi.fn().mockRejectedValue(new Error('remote revoke failed')),
    });
    const tokenStore = makeTokenStore();
    const service = makeService({ tokenStore, providers: [provider] });

    await service.logout('qwen'); // should not throw

    expect(tokenStore.removeToken).toHaveBeenCalledWith('qwen', 'default');
  });

  it('does NOT perform Gemini filesystem cleanup in logout (G2: provider handles it)', async () => {
    // We do NOT mock fs.unlink — if the manager code tried to call it, it
    // would use the real fs and potentially fail. The test verifies the
    // service passes without any fs.unlink invocations at the manager layer.
    const provider = makeProvider('gemini');
    const tokenStore = makeTokenStore();
    const service = makeService({ tokenStore, providers: [provider] });

    // Should not throw and should NOT call any fs operations at the manager level
    await service.logout('gemini');

    expect(tokenStore.removeToken).toHaveBeenCalledWith('gemini', 'default');
    // The test passes if no unhandled fs errors occur (no manager-layer fs cleanup)
  });

  it('uses explicit bucket when provided', async () => {
    const tokenStore = makeTokenStore({
      listBuckets: vi.fn().mockResolvedValue(['default', 'bucket-a']),
    });
    const provider = makeProvider('qwen');
    const proactiveRenewalManager = makeProactiveRenewalManager();
    const service = makeService({
      tokenStore,
      providers: [provider],
      proactiveRenewalManager,
    });

    await service.logout('qwen', 'bucket-a');

    expect(tokenStore.removeToken).toHaveBeenCalledWith('qwen', 'bucket-a');
    expect(
      proactiveRenewalManager.clearRenewalsForProvider as ReturnType<
        typeof vi.fn
      >,
    ).toHaveBeenCalledWith('qwen', 'bucket-a');
  });

  it('flushes runtime auth scope after logout', async () => {
    const provider = makeProvider('qwen');
    const tokenStore = makeTokenStore();
    const service = makeService({ tokenStore, providers: [provider] });

    await service.logout('qwen');

    expect(flushMockRef.current).toBeDefined();
    flushMockRef.current && expect(flushMockRef.current).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// clearProviderAuthCaches — generic path (G3)
// ---------------------------------------------------------------------------

describe('AuthStatusService.clearProviderAuthCaches (via logout)', () => {
  beforeEach(() => {
    flushMockRef.current?.mockClear();
    providerManagerRef.current?.getProviderByName.mockReset();
  });

  it('calls clearAuth generically for non-gemini provider', async () => {
    const coreProvider = {
      name: 'qwen',
      clearAuthCache: vi.fn(),
      clearAuth: vi.fn(),
      clearState: vi.fn(),
    };
    providerRef.current = coreProvider;
    providerManagerRef.current?.getProviderByName.mockReturnValue(coreProvider);

    const provider = makeProvider('qwen');
    const tokenStore = makeTokenStore();
    const service = makeService({ tokenStore, providers: [provider] });

    await service.logout('qwen');

    // The generic path should call all three methods
    expect(coreProvider.clearAuthCache).toHaveBeenCalled();
    expect(coreProvider.clearAuth).toHaveBeenCalled();
    expect(coreProvider.clearState).toHaveBeenCalled();
  });

  it('isolated failures in clearProviderAuthCaches do not prevent flushRuntimeAuthScope', async () => {
    const coreProvider = {
      name: 'qwen',
      clearAuthCache: vi.fn().mockImplementation(() => {
        throw new Error('clearAuthCache failed');
      }),
      clearAuth: vi.fn().mockImplementation(() => {
        throw new Error('clearAuth failed');
      }),
      clearState: vi.fn().mockImplementation(() => {
        throw new Error('clearState failed');
      }),
    };
    providerRef.current = coreProvider;
    providerManagerRef.current?.getProviderByName.mockReturnValue(coreProvider);

    const provider = makeProvider('qwen');
    const tokenStore = makeTokenStore();
    const service = makeService({ tokenStore, providers: [provider] });

    // Should not throw even though all cache clearing fails
    await service.logout('qwen');

    // flush must still execute despite all failures
    expect(flushMockRef.current).toBeDefined();
    flushMockRef.current && expect(flushMockRef.current).toHaveBeenCalled();
  });

  it('no provider-name-specific branching for gemini in clearProviderAuthCaches (G3)', async () => {
    // Gemini core provider should use the same generic path
    const geminiCoreProvider = {
      name: 'gemini',
      clearAuthCache: vi.fn(),
      clearAuth: vi.fn(),
      clearState: vi.fn(),
    };
    providerRef.current = geminiCoreProvider;
    providerManagerRef.current?.getProviderByName.mockReturnValue(
      geminiCoreProvider,
    );

    const provider = makeProvider('gemini');
    const tokenStore = makeTokenStore();
    const service = makeService({ tokenStore, providers: [provider] });

    await service.logout('gemini');

    // The same generic calls should happen for gemini as any other provider
    expect(geminiCoreProvider.clearAuthCache).toHaveBeenCalled();
    expect(geminiCoreProvider.clearState).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// getAuthStatus
// ---------------------------------------------------------------------------

describe('AuthStatusService.getAuthStatus', () => {
  it('returns empty array when no providers registered', async () => {
    const service = makeService({ providers: [] });
    const statuses = await service.getAuthStatus();
    expect(statuses).toEqual([]);
  });

  it('reports authenticated=false when OAuth disabled', async () => {
    const provider = makeProvider('anthropic');
    const service = makeService({
      providers: [provider],
      oauthEnabled: false,
    });
    const statuses = await service.getAuthStatus();
    expect(statuses).toHaveLength(1);
    expect(statuses[0]).toMatchObject({
      provider: 'anthropic',
      authenticated: false,
      oauthEnabled: false,
    });
  });

  it('reports authenticated=true with expiresIn when token exists', async () => {
    const expiry = Math.floor(Date.now() / 1000) + 3600;
    const validToken: OAuthToken = {
      access_token: 'valid',
      refresh_token: 'r',
      expiry,
      token_type: 'Bearer',
    };
    const tokenStore = makeTokenStore({
      getToken: vi.fn().mockResolvedValue(validToken),
    });
    const provider = makeProvider('anthropic');
    const service = makeService({
      providers: [provider],
      tokenStore,
      oauthEnabled: true,
    });
    const statuses = await service.getAuthStatus();
    expect(statuses[0]).toMatchObject({
      provider: 'anthropic',
      authenticated: true,
      oauthEnabled: true,
    });
    expect(typeof statuses[0]?.expiresIn).toBe('number');
  });

  it('reports authenticated=false with expiresIn=0 when token is expired', async () => {
    const expiry = Math.floor(Date.now() / 1000) - 120;
    const expiredToken: OAuthToken = {
      access_token: 'expired',
      refresh_token: 'r',
      expiry,
      token_type: 'Bearer',
    };
    const tokenStore = makeTokenStore({
      getToken: vi.fn().mockResolvedValue(expiredToken),
    });
    const provider = makeProvider('anthropic');
    const service = makeService({
      providers: [provider],
      tokenStore,
      oauthEnabled: true,
    });

    const statuses = await service.getAuthStatus();

    expect(statuses[0]).toMatchObject({
      provider: 'anthropic',
      authenticated: false,
      oauthEnabled: true,
      expiresIn: 0,
    });
  });
});

// ---------------------------------------------------------------------------
// logoutAll / logoutAllBuckets / listBuckets / getAuthStatusWithBuckets
// ---------------------------------------------------------------------------

describe('AuthStatusService.logoutAll', () => {
  it('logs out every provider returned by tokenStore.listProviders', async () => {
    const tokenStore = makeTokenStore({
      listProviders: vi.fn().mockResolvedValue(['qwen', 'anthropic']),
      listBuckets: vi.fn().mockResolvedValue(['default']),
    });
    const qwen = makeProvider('qwen');
    const anthropic = makeProvider('anthropic');
    const service = makeService({
      tokenStore,
      providers: [qwen, anthropic],
    });

    await service.logoutAll();

    expect(tokenStore.removeToken).toHaveBeenCalledWith('qwen', 'default');
    expect(tokenStore.removeToken).toHaveBeenCalledWith('anthropic', 'default');
  });
});

describe('AuthStatusService.logoutAllBuckets', () => {
  it('removes all buckets for a provider', async () => {
    const tokenStore = makeTokenStore({
      listBuckets: vi
        .fn()
        .mockResolvedValue(['default', 'bucket-a', 'bucket-b']),
    });
    const provider = makeProvider('qwen');
    const service = makeService({ tokenStore, providers: [provider] });

    await service.logoutAllBuckets('qwen');

    expect(tokenStore.removeToken).toHaveBeenCalledWith('qwen', 'default');
    expect(tokenStore.removeToken).toHaveBeenCalledWith('qwen', 'bucket-a');
    expect(tokenStore.removeToken).toHaveBeenCalledWith('qwen', 'bucket-b');
  });
});

describe('AuthStatusService.listBuckets', () => {
  it('delegates to tokenStore.listBuckets', async () => {
    const tokenStore = makeTokenStore({
      listBuckets: vi.fn().mockResolvedValue(['default', 'bucket-a']),
    });
    const service = makeService({ tokenStore });
    const buckets = await service.listBuckets('qwen');
    expect(buckets).toEqual(['default', 'bucket-a']);
    expect(tokenStore.listBuckets).toHaveBeenCalledWith('qwen');
  });
});

describe('AuthStatusService.getAuthStatusWithBuckets', () => {
  it('returns per-bucket auth status', async () => {
    const expiry = Math.floor(Date.now() / 1000) + 3600;
    const validToken: OAuthToken = {
      access_token: 'tok',
      refresh_token: 'r',
      expiry,
      token_type: 'Bearer',
    };
    const tokenStore = makeTokenStore({
      listBuckets: vi.fn().mockResolvedValue(['default', 'bucket-a']),
      getToken: vi
        .fn()
        .mockImplementation(async (_provider: string, bucket?: string) => {
          return bucket === 'default' ? validToken : null;
        }),
    });
    const service = makeService({ tokenStore });

    const statuses = await service.getAuthStatusWithBuckets('qwen');

    expect(statuses).toHaveLength(2);
    const defaultStatus = statuses.find((s) => s.bucket === 'default');
    const bucketAStatus = statuses.find((s) => s.bucket === 'bucket-a');
    expect(defaultStatus?.authenticated).toBe(true);
    expect(bucketAStatus?.authenticated).toBe(false);
  });

  it('returns authenticated=false for an expired token', async () => {
    const expiredToken: OAuthToken = {
      access_token: 'old-tok',
      refresh_token: 'r',
      expiry: Math.floor(Date.now() / 1000) - 60, // expired 60 s ago
      token_type: 'Bearer',
    };
    const tokenStore = makeTokenStore({
      listBuckets: vi.fn().mockResolvedValue(['default']),
      getToken: vi.fn().mockResolvedValue(expiredToken),
    });
    const service = makeService({ tokenStore });

    const statuses = await service.getAuthStatusWithBuckets('qwen');

    expect(statuses).toHaveLength(1);
    const defaultStatus = statuses[0];
    expect(defaultStatus?.authenticated).toBe(false);
    // expiry field is still present even when token is expired
    expect(defaultStatus?.expiry).toBe(expiredToken.expiry);
  });
});

// ---------------------------------------------------------------------------
// logout — session-bucket clear behaviour
// ---------------------------------------------------------------------------

describe('AuthStatusService.logout session-bucket clear', () => {
  beforeEach(() => {
    flushMockRef.current?.mockClear();
  });

  it('clears metadata-scoped and unscoped session buckets when current session bucket matches bucketToUse', async () => {
    const sessionMetadata = {
      profileName: 'my-profile',
    } as import('@vybestack/llxprt-code-core').OAuthTokenRequestMetadata;
    const bucketManager = makeBucketManager();
    // Both scoped (with metadata) and unscoped (without) return the same bucket
    (
      bucketManager.getSessionBucket as ReturnType<typeof vi.fn>
    ).mockImplementation((_provider: string, meta?: unknown) => {
      return meta !== undefined ? 'target-bucket' : 'target-bucket';
    });

    const tokenAccessCoordinator: TokenAccessCoordinator = {
      getCurrentProfileSessionBucket: vi
        .fn()
        .mockResolvedValue('target-bucket'),
      getCurrentProfileSessionMetadata: vi
        .fn()
        .mockResolvedValue(sessionMetadata),
      getProfileBuckets: vi.fn().mockResolvedValue([]),
      doGetProfileBuckets: vi.fn().mockResolvedValue([]),
    } as unknown as TokenAccessCoordinator;

    const provider = makeProvider('qwen');
    const tokenStore = makeTokenStore();
    const service = new AuthStatusService(
      tokenStore,
      makeProviderRegistry([provider]),
      makeProactiveRenewalManager(),
      bucketManager,
      tokenAccessCoordinator,
    );

    await service.logout('qwen', 'target-bucket');

    expect(bucketManager.clearSessionBucket).toHaveBeenCalledWith(
      'qwen',
      sessionMetadata,
    );
    expect(bucketManager.clearSessionBucket).toHaveBeenCalledWith('qwen');
  });

  it('does not clear session buckets when current session bucket does not match bucketToUse', async () => {
    const sessionMetadata = {
      profileName: 'my-profile',
    } as import('@vybestack/llxprt-code-core').OAuthTokenRequestMetadata;
    const bucketManager = makeBucketManager();
    // Session bucket is a different bucket from the one being logged out
    (
      bucketManager.getSessionBucket as ReturnType<typeof vi.fn>
    ).mockReturnValue('other-bucket');

    const tokenAccessCoordinator: TokenAccessCoordinator = {
      getCurrentProfileSessionBucket: vi.fn().mockResolvedValue('other-bucket'),
      getCurrentProfileSessionMetadata: vi
        .fn()
        .mockResolvedValue(sessionMetadata),
      getProfileBuckets: vi.fn().mockResolvedValue([]),
      doGetProfileBuckets: vi.fn().mockResolvedValue([]),
    } as unknown as TokenAccessCoordinator;

    const provider = makeProvider('qwen');
    const tokenStore = makeTokenStore();
    const service = new AuthStatusService(
      tokenStore,
      makeProviderRegistry([provider]),
      makeProactiveRenewalManager(),
      bucketManager,
      tokenAccessCoordinator,
    );

    await service.logout('qwen', 'target-bucket');

    expect(bucketManager.clearSessionBucket).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// logout — proactive renewal cleanup precision
// ---------------------------------------------------------------------------

describe('AuthStatusService.logout proactive renewal cleanup', () => {
  it('calls clearRenewalsForProvider with exact provider+bucket and does not call broad timer methods', async () => {
    const token: OAuthToken = {
      access_token: 'tok',
      refresh_token: 'r',
      expiry: Math.floor(Date.now() / 1000) + 3600,
      token_type: 'Bearer',
    };
    const tokenStore = makeTokenStore({
      getToken: vi.fn().mockResolvedValue(token),
    });
    const provider = makeProvider('qwen');
    const proactiveRenewalManager = makeProactiveRenewalManager();
    const service = makeService({
      tokenStore,
      providers: [provider],
      proactiveRenewalManager,
    });

    await service.logout('qwen', 'bucket-x');

    // Must be called with the exact provider+bucket
    expect(
      proactiveRenewalManager.clearRenewalsForProvider as ReturnType<
        typeof vi.fn
      >,
    ).toHaveBeenCalledExactlyOnceWith('qwen', 'bucket-x');

    // Over-broad cleanup methods must NOT be called
    expect(
      proactiveRenewalManager.clearAllTimers as ReturnType<typeof vi.fn>,
    ).not.toHaveBeenCalled();
    expect(
      proactiveRenewalManager.clearProactiveRenewal as ReturnType<typeof vi.fn>,
    ).not.toHaveBeenCalled();
  });
});
