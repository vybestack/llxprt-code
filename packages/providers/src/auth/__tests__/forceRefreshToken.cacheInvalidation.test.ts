/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * @fix issue2035
 * TokenAccessCoordinator forceRefreshToken runtime-cache invalidation tests.
 *
 * Issue #2035: anthropic token still occasionally invalidated during long
 * generations across multiple agents. Root cause: forceRefreshToken updates the
 * disk token store but leaves the in-memory runtimeScopedStates cache holding
 * the revoked token, so retries (and other agents) keep resolving the stale
 * token and get another 401.
 *
 * These behavioral tests use the REAL runtimeScopedStates singleton (no mock
 * theater): we seed a stale cache entry, run forceRefreshToken, and assert the
 * entry is actually cleared so the next resolution falls through to the freshly
 * refreshed disk token.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TokenAccessCoordinator } from '../token-access-coordinator.js';
import type { OAuthProvider, OAuthToken, TokenStore } from '../types.js';
import type { OAuthTokenRequestMetadata } from '@vybestack/llxprt-code-core';
import {
  runtimeScopedStates,
  storeRuntimeScopedToken,
  type RuntimeScopedState,
  AuthPrecedenceResolver,
  ensureRuntimeState,
  type AuthPrecedenceConfig,
  type OAuthManager,
  type ISettingsService,
  type IProviderRuntimeContext,
} from '@vybestack/llxprt-code-auth';

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
      const optsRecord =
        typeof _opts === 'object' && _opts
          ? (_opts as Record<string, unknown>)
          : null;
      const bucketCandidate = optsRecord?.bucket;
      const bucket =
        typeof bucketCandidate === 'string' ? bucketCandidate : undefined;
      const key = bucket ? `${_provider}::${bucket}` : _provider;
      if (locks.get(key) === true) return false;
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

function createMockRegistry(provider?: OAuthProvider, oauthEnabled = true) {
  return {
    getProvider: vi.fn((name: string) =>
      provider && name === provider.name ? provider : undefined,
    ),
    isOAuthEnabled: vi.fn(() => oauthEnabled),
    hasExplicitInMemoryOAuthState: vi.fn(() => false),
  };
}

function createMockRenewalManager() {
  return { scheduleProactiveRenewal: vi.fn() };
}

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

function makeCoordinator(opts?: {
  provider?: OAuthProvider;
  initialTokens?: Map<string, OAuthToken>;
}) {
  const tokenStore = createMockTokenStore(opts?.initialTokens);
  const provider = opts?.provider;
  const registry = createMockRegistry(provider, true);
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

  return { coordinator, tokenStore, registry, provider };
}

function seedRuntimeCacheEntry(
  runtimeId: string,
  providerId: string,
  profileId: string,
  token: string,
): RuntimeScopedState {
  const state: RuntimeScopedState = {
    runtimeAuthScopeId: runtimeId,
    entries: new Map(),
    metadata: {
      runtimeAuthScopeId: runtimeId,
      cacheEntries: [],
      cancellationHooks: [],
      revokedTokens: [],
      metrics: { hits: 0, misses: 0, lastUpdated: Date.now() },
    },
    settingsSubscriptions: [],
  };
  runtimeScopedStates.set(runtimeId, state);
  storeRuntimeScopedToken(state, providerId, profileId, token);
  return state;
}

describe('TokenAccessCoordinator forceRefreshToken runtime cache invalidation', () => {
  beforeEach(() => {
    for (const key of [...runtimeScopedStates.keys()]) {
      runtimeScopedStates.delete(key);
    }
  });

  afterEach(() => {
    for (const key of [...runtimeScopedStates.keys()]) {
      runtimeScopedStates.delete(key);
    }
  });

  /**
   * @fix issue2035
   * After a successful force refresh, the stale runtime-scoped cache entry must
   * be removed so the retry resolves the fresh token instead of the revoked one.
   */
  it('clears the runtime-scoped cache after a successful refresh', async () => {
    const failedToken = 'failed-access-token';
    const initialTokens = new Map([
      ['anthropic', makeToken(failedToken, 3600, 'refresh-token-123')],
    ]);
    const provider = createMockProvider('anthropic');
    const { coordinator } = makeCoordinator({ provider, initialTokens });

    const state = seedRuntimeCacheEntry(
      'agent-1',
      'anthropic',
      'no-profile',
      failedToken,
    );
    expect(state.entries.size).toBe(1);

    const result = await coordinator.forceRefreshToken(
      'anthropic',
      failedToken,
    );

    expect(result?.access_token).toBe('refreshed-failed-access-token');
    expect(state.entries.size).toBe(0);
  });

  /**
   * @fix issue2035
   * Multi-agent scenario: invalidation must propagate to every runtime so other
   * agents stop using the revoked token.
   */
  it('clears stale cache entries across all runtimes after refresh', async () => {
    const failedToken = 'failed-access-token';
    const initialTokens = new Map([
      ['anthropic', makeToken(failedToken, 3600, 'refresh-token-123')],
    ]);
    const provider = createMockProvider('anthropic');
    const { coordinator } = makeCoordinator({ provider, initialTokens });

    const agent1 = seedRuntimeCacheEntry(
      'agent-1',
      'anthropic',
      'no-profile',
      failedToken,
    );
    const agent2 = seedRuntimeCacheEntry(
      'agent-2',
      'anthropic',
      'no-profile',
      failedToken,
    );

    await coordinator.forceRefreshToken('anthropic', failedToken);

    expect(agent1.entries.size).toBe(0);
    expect(agent2.entries.size).toBe(0);
  });

  /**
   * @fix issue2035
   * TOCTOU: when another process already refreshed the disk token, the local
   * runtime cache is still stale and must be invalidated too.
   */
  it('clears the runtime cache when another process already refreshed the token', async () => {
    const failedToken = 'failed-access-token';
    const initialTokens = new Map([
      [
        'anthropic',
        makeToken('already-refreshed-by-other', 3600, 'refresh-token-123'),
      ],
    ]);
    const provider = createMockProvider('anthropic');
    const { coordinator } = makeCoordinator({ provider, initialTokens });

    const state = seedRuntimeCacheEntry(
      'agent-1',
      'anthropic',
      'no-profile',
      failedToken,
    );

    const result = await coordinator.forceRefreshToken(
      'anthropic',
      failedToken,
    );

    expect(result?.access_token).toBe('already-refreshed-by-other');
    expect(state.entries.size).toBe(0);
  });

  /**
   * @fix issue2035
   * Must not invalidate unrelated providers cached in the same runtime.
   */
  it('does not invalidate cache entries for other providers', async () => {
    const failedToken = 'failed-access-token';
    const initialTokens = new Map([
      ['anthropic', makeToken(failedToken, 3600, 'refresh-token-123')],
    ]);
    const provider = createMockProvider('anthropic');
    const { coordinator } = makeCoordinator({ provider, initialTokens });

    const state = seedRuntimeCacheEntry(
      'agent-1',
      'anthropic',
      'no-profile',
      failedToken,
    );
    storeRuntimeScopedToken(state, 'gemini', 'no-profile', 'gemini-token');

    await coordinator.forceRefreshToken('anthropic', failedToken);

    expect(state.entries.has('agent-1::gemini::no-profile')).toBe(true);
    expect(state.entries.has('agent-1::anthropic::no-profile')).toBe(false);
  });
});

/**
 * @fix issue2035
 * The OAuth chat path resolves the access token *below* the retry layer, so the
 * RetryOrchestrator cannot supply a concrete failed token and calls
 * forceRefreshToken with an empty string. Before the fix, the empty token never
 * matched the stored token, so the stored (revoked) token was returned verbatim
 * and the provider's refreshToken() was never invoked — producing the 401 loop.
 *
 * These tests pin the corrected behavior: an empty failedAccessToken must use
 * the current stored token as the refresh baseline and perform a real refresh.
 */
describe('TokenAccessCoordinator forceRefreshToken with empty failed token (issue #2035 OAuth path)', () => {
  beforeEach(() => {
    for (const key of [...runtimeScopedStates.keys()]) {
      runtimeScopedStates.delete(key);
    }
  });

  afterEach(() => {
    for (const key of [...runtimeScopedStates.keys()]) {
      runtimeScopedStates.delete(key);
    }
  });

  it('performs a real refresh when called with an empty failed token', async () => {
    const storedAccess = 'revoked-oauth-token';
    const initialTokens = new Map([
      ['anthropic', makeToken(storedAccess, 3600, 'refresh-token-123')],
    ]);
    const provider = createMockProvider('anthropic');
    const { coordinator, tokenStore } = makeCoordinator({
      provider,
      initialTokens,
    });

    const result = await coordinator.forceRefreshToken('anthropic', '');

    // The provider's refreshToken() must have run and produced a new token.
    expect(provider.refreshToken).toHaveBeenCalledTimes(1);
    expect(result?.access_token).toBe(`refreshed-${storedAccess}`);
    // And the refreshed token must be persisted to the store.
    expect(tokenStore.saveToken).toHaveBeenCalled();
    const persisted = await coordinator.peekStoredToken('anthropic');
    expect(persisted?.access_token).toBe(`refreshed-${storedAccess}`);
  });

  it('invalidates the runtime cache after refreshing with an empty failed token', async () => {
    const storedAccess = 'revoked-oauth-token';
    const initialTokens = new Map([
      ['anthropic', makeToken(storedAccess, 3600, 'refresh-token-123')],
    ]);
    const provider = createMockProvider('anthropic');
    const { coordinator } = makeCoordinator({ provider, initialTokens });

    const state = seedRuntimeCacheEntry(
      'agent-1',
      'anthropic',
      'no-profile',
      storedAccess,
    );
    expect(state.entries.size).toBe(1);

    await coordinator.forceRefreshToken('anthropic', '');

    expect(state.entries.size).toBe(0);
  });

  it('returns null without refreshing when no token is stored', async () => {
    const provider = createMockProvider('anthropic');
    const { coordinator } = makeCoordinator({ provider });

    const result = await coordinator.forceRefreshToken('anthropic', '');

    expect(result).toBeNull();
    expect(provider.refreshToken).not.toHaveBeenCalled();
  });

  it('does not acquire a refresh lock when there is no baseline token', async () => {
    const provider = createMockProvider('anthropic');
    const { coordinator, tokenStore } = makeCoordinator({ provider });

    await coordinator.forceRefreshToken('anthropic', '');

    expect(tokenStore.acquireRefreshLock).not.toHaveBeenCalled();
  });

  /**
   * @fix issue2035
   * Empty failed token + stored token that has NO refresh_token must return null
   * (the caller cannot recover) rather than looping or throwing. This is the
   * issue2035-specific variant of the existing non-empty no-refresh-token case.
   */
  it('returns null without looping when stored token has no refresh token', async () => {
    const storedAccess = 'revoked-oauth-token';
    const tokenWithoutRefresh: OAuthToken = {
      access_token: storedAccess,
      refresh_token: '',
      expiry: Math.floor(Date.now() / 1000) + 3600,
      token_type: 'Bearer',
      scope: null,
    };
    const initialTokens = new Map([['anthropic', tokenWithoutRefresh]]);
    const provider = createMockProvider('anthropic');
    const { coordinator } = makeCoordinator({ provider, initialTokens });

    const result = await coordinator.forceRefreshToken('anthropic', '');

    expect(result).toBeNull();
    expect(provider.refreshToken).not.toHaveBeenCalled();
  });

  /**
   * @fix issue2035
   * Anthropic rotates refresh tokens. When the provider returns a NEW
   * refresh_token, the merged/persisted token must carry the rotated refresh
   * token (not the old one), otherwise the next refresh would use a dead token.
   */
  it('preserves a rotated refresh token from the provider', async () => {
    const storedAccess = 'revoked-oauth-token';
    const initialTokens = new Map([
      ['anthropic', makeToken(storedAccess, 3600, 'old-refresh-token')],
    ]);
    const provider: OAuthProvider = {
      name: 'anthropic',
      initiateAuth: vi.fn(async () => makeToken('from-initiate')),
      getToken: vi.fn(async () => null),
      refreshToken: vi.fn(async () =>
        makeToken('rotated-access-token', 3600, 'rotated-refresh-token'),
      ),
    };
    const { coordinator } = makeCoordinator({ provider, initialTokens });

    const result = await coordinator.forceRefreshToken('anthropic', '');

    expect(result?.access_token).toBe('rotated-access-token');
    expect(result?.refresh_token).toBe('rotated-refresh-token');
    const persisted = await coordinator.peekStoredToken('anthropic');
    expect(persisted?.refresh_token).toBe('rotated-refresh-token');
  });

  /**
   * @fix issue2035
   * Empty failed token where the disk token already differs from the seeded
   * in-memory cache (another agent/process refreshed first). The baseline is the
   * current disk token, so loadTokenForForceRefresh sees a match and refreshes;
   * critically, the stale in-memory cache entry is invalidated so the retry
   * resolves the fresh token. This documents the chosen behavior (refresh over
   * a cooldown-skip) which guarantees no 401 loop even if the disk token was
   * itself just revoked.
   */
  it('refreshes from the current disk baseline and clears the stale cache', async () => {
    const diskAccess = 'disk-token-from-other-agent';
    const staleCachedAccess = 'older-cached-token';
    const initialTokens = new Map([
      ['anthropic', makeToken(diskAccess, 3600, 'refresh-token-123')],
    ]);
    const provider = createMockProvider('anthropic');
    const { coordinator } = makeCoordinator({ provider, initialTokens });

    const state = seedRuntimeCacheEntry(
      'agent-1',
      'anthropic',
      'no-profile',
      staleCachedAccess,
    );
    expect(state.entries.size).toBe(1);

    const result = await coordinator.forceRefreshToken('anthropic', '');

    expect(result?.access_token).toBe(`refreshed-${diskAccess}`);
    expect(state.entries.size).toBe(0);
  });
});

/**
 * End-to-end behavioral test that exercises the FULL issue #2035 cycle through
 * the real collaborators (TokenAccessCoordinator + AuthPrecedenceResolver) that
 * share the real runtimeScopedStates singleton — no mock theater on the cache.
 *
 * This proves the actual user-facing fix: after a 401 triggers forceRefreshToken,
 * the NEXT auth resolution (what the retry attempt performs) returns the FRESH
 * token rather than the revoked one that was previously cached.
 */

function createStubSettingsService(
  overrides?: Record<string, unknown>,
): ISettingsService {
  const store = new Map<string, unknown>(Object.entries(overrides ?? {}));
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  return {
    get: vi.fn((key: string) => store.get(key)),
    getProviderSettings: vi.fn(() => ({})),
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(handler);
    }),
    off: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      listeners.get(event)?.delete(handler);
    }),
  } as unknown as ISettingsService;
}

function createTestRuntimeContext(
  runtimeId: string,
  settingsService: ISettingsService,
): IProviderRuntimeContext {
  const context: IProviderRuntimeContext = {
    settingsService,
    runtimeId,
    metadata: {},
  } as IProviderRuntimeContext;
  ensureRuntimeState(context);
  return context;
}

describe('issue #2035 end-to-end: retry resolves fresh token after 401 refresh', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    for (const key of [...runtimeScopedStates.keys()]) {
      runtimeScopedStates.delete(key);
    }
  });

  afterEach(() => {
    for (const key of [...runtimeScopedStates.keys()]) {
      runtimeScopedStates.delete(key);
    }
  });

  /**
   * @fix issue2035
   * Full cycle:
   *  1. resolveAuthentication() caches the (soon-to-be-revoked) token.
   *  2. A 401 occurs -> forceRefreshToken() refreshes disk + invalidates cache.
   *  3. The retry's resolveAuthentication() must now return the FRESH token.
   */
  it('returns the refreshed token on the resolution following a forced refresh', async () => {
    const failedToken = 'failed-access-token';
    const refreshedAccessToken = 'refreshed-failed-access-token';
    const runtimeId = 'agent-e2e';

    const settingsService = createStubSettingsService();
    const runtimeContext = createTestRuntimeContext(runtimeId, settingsService);

    // Disk token store seeded with the soon-to-fail token (has a refresh token).
    const initialTokens = new Map<string, OAuthToken>([
      ['anthropic', makeToken(failedToken, 3600, 'refresh-token-123')],
    ]);
    const provider = createMockProvider('anthropic');
    const { coordinator } = makeCoordinator({ provider, initialTokens });

    // The OAuthManager that the resolver consults mirrors the disk token store:
    // it returns whatever access token currently lives on disk. This models the
    // real getToken() path which reads from the token store.
    const oauthManager: OAuthManager = {
      getToken: vi.fn(async () => {
        const stored = await coordinator.peekStoredToken('anthropic');
        return stored?.access_token ?? null;
      }),
      isAuthenticated: vi.fn().mockResolvedValue(true),
      getOAuthToken: vi.fn(async () =>
        coordinator.peekStoredToken('anthropic'),
      ),
    };

    const config: AuthPrecedenceConfig = {
      envKeyNames: [],
      isOAuthEnabled: true,
      supportsOAuth: true,
      oauthProvider: 'anthropic',
      providerId: 'anthropic',
    };
    const resolver = new AuthPrecedenceResolver(config, {
      oauthManager,
      settingsService,
      getActiveRuntimeContext: () => runtimeContext,
    });

    // Step 1: first resolution caches the failing token.
    const firstResolved = await resolver.resolveAuthentication({
      includeOAuth: true,
    });
    expect(firstResolved).toBe(failedToken);

    // A second resolution WITHOUT a refresh would serve the cached (stale) token.
    const cachedResolved = await resolver.resolveAuthentication({
      includeOAuth: true,
    });
    expect(cachedResolved).toBe(failedToken);
    // Only one underlying fetch so far -> proves the cache is in play.
    expect(oauthManager.getToken).toHaveBeenCalledTimes(1);

    // Step 2: the 401 handler forces a refresh (updates disk + invalidates cache).
    const refreshed = await coordinator.forceRefreshToken(
      'anthropic',
      failedToken,
    );
    expect(refreshed?.access_token).toBe(refreshedAccessToken);

    // Step 3: the retry's resolution must now return the FRESH token, proving
    // the in-memory cache no longer shadows the refreshed disk token.
    const afterRefresh = await resolver.resolveAuthentication({
      includeOAuth: true,
    });
    expect(afterRefresh).toBe(refreshedAccessToken);
    expect(oauthManager.getToken).toHaveBeenCalledTimes(2);
  });

  /**
   * @fix issue2035
   * Multi-agent: a refresh driven by one agent must let a SECOND agent's runtime
   * resolve the fresh token too (cross-runtime propagation end-to-end).
   */
  it('propagates the refreshed token to a second agent runtime', async () => {
    const failedToken = 'failed-access-token';
    const refreshedAccessToken = 'refreshed-failed-access-token';

    const initialTokens = new Map<string, OAuthToken>([
      ['anthropic', makeToken(failedToken, 3600, 'refresh-token-123')],
    ]);
    const provider = createMockProvider('anthropic');
    const { coordinator } = makeCoordinator({ provider, initialTokens });

    const makeResolver = (runtimeId: string) => {
      const settingsService = createStubSettingsService();
      const runtimeContext = createTestRuntimeContext(
        runtimeId,
        settingsService,
      );
      const oauthManager: OAuthManager = {
        getToken: vi.fn(async () => {
          const stored = await coordinator.peekStoredToken('anthropic');
          return stored?.access_token ?? null;
        }),
        isAuthenticated: vi.fn().mockResolvedValue(true),
        getOAuthToken: vi.fn(async () =>
          coordinator.peekStoredToken('anthropic'),
        ),
      };
      const config: AuthPrecedenceConfig = {
        envKeyNames: [],
        isOAuthEnabled: true,
        supportsOAuth: true,
        oauthProvider: 'anthropic',
        providerId: 'anthropic',
      };
      return new AuthPrecedenceResolver(config, {
        oauthManager,
        settingsService,
        getActiveRuntimeContext: () => runtimeContext,
      });
    };

    const agent1 = makeResolver('agent-1');
    const agent2 = makeResolver('agent-2');

    // Both agents cache the failing token.
    expect(await agent1.resolveAuthentication({ includeOAuth: true })).toBe(
      failedToken,
    );
    expect(await agent2.resolveAuthentication({ includeOAuth: true })).toBe(
      failedToken,
    );

    // Agent 1 hits a 401 and forces the refresh.
    await coordinator.forceRefreshToken('anthropic', failedToken);

    // Both agents' next resolution must see the fresh token.
    expect(await agent1.resolveAuthentication({ includeOAuth: true })).toBe(
      refreshedAccessToken,
    );
    expect(await agent2.resolveAuthentication({ includeOAuth: true })).toBe(
      refreshedAccessToken,
    );
  });
});
