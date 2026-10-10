/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * @fix issue2035
 * TokenAccessCoordinator forceRefreshToken behavior tests.
 *
 * Issue #2035: anthropic token still occasionally invalidated during long
 * generations across multiple agents. forceRefreshToken must refresh from the
 * current disk baseline, and the next auth resolution must return the freshly
 * refreshed token rather than the revoked one.
 */

import { describe, it, expect, vi, beforeEach } from 'bun:test';
import { TokenAccessCoordinator } from '../token-access-coordinator.js';
import type { OAuthProvider, OAuthToken, TokenStore } from '../types.js';
import type { OAuthTokenRequestMetadata } from '@vybestack/llxprt-code-core';
import {
  AuthPrecedenceResolver,
  type AuthPrecedenceConfig,
  type OAuthManager,
  type ISettingsService,
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

async function peekStoredAccessToken(
  coordinator: TokenAccessCoordinator,
): Promise<string | null> {
  const stored = await coordinator.peekStoredToken('anthropic');
  return stored?.access_token ?? null;
}

describe('TokenAccessCoordinator forceRefreshToken refresh and baseline handling', () => {
  /**
   * @fix issue2035
   * A successful force refresh returns the refreshed token.
   */
  it('returns the refreshed token after a successful refresh', async () => {
    const failedToken = 'failed-access-token';
    const initialTokens = new Map([
      ['anthropic', makeToken(failedToken, 3600, 'refresh-token-123')],
    ]);
    const provider = createMockProvider('anthropic');
    const { coordinator } = makeCoordinator({ provider, initialTokens });

    const result = await coordinator.forceRefreshToken(
      'anthropic',
      failedToken,
    );

    expect(result?.access_token).toBe('refreshed-failed-access-token');
  });

  /**
   * @fix issue2035
   * TOCTOU: when another process already refreshed the disk token, the stored
   * token is returned without a second refresh.
   */
  it('returns the stored token when another process already refreshed it', async () => {
    const failedToken = 'failed-access-token';
    const initialTokens = new Map([
      [
        'anthropic',
        makeToken('already-refreshed-by-other', 3600, 'refresh-token-123'),
      ],
    ]);
    const provider = createMockProvider('anthropic');
    const { coordinator } = makeCoordinator({ provider, initialTokens });

    const result = await coordinator.forceRefreshToken(
      'anthropic',
      failedToken,
    );

    expect(result?.access_token).toBe('already-refreshed-by-other');
    expect(provider.refreshToken).not.toHaveBeenCalled();
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
   * Empty failed token where the disk token was written by another agent or
   * process. The baseline is the current disk token, so the coordinator
   * refreshes it. This documents the chosen behavior (refresh over a
   * cooldown-skip) which guarantees no 401 loop even if the disk token was
   * itself just revoked.
   */
  it('refreshes from the current disk baseline', async () => {
    const diskAccess = 'disk-token-from-other-agent';
    const initialTokens = new Map([
      ['anthropic', makeToken(diskAccess, 3600, 'refresh-token-123')],
    ]);
    const provider = createMockProvider('anthropic');
    const { coordinator } = makeCoordinator({ provider, initialTokens });

    const result = await coordinator.forceRefreshToken('anthropic', '');

    expect(result?.access_token).toBe(`refreshed-${diskAccess}`);
  });
});

/**
 * End-to-end behavioral test that exercises the FULL issue #2035 cycle through
 * the real collaborators (TokenAccessCoordinator + AuthPrecedenceResolver).
 *
 * This proves the actual user-facing fix: after a 401 triggers forceRefreshToken,
 * the NEXT auth resolution (what the retry attempt performs) returns the FRESH
 * token rather than the revoked one.
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

describe('issue #2035 end-to-end: retry resolves fresh token after 401 refresh', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * @fix issue2035
   * Full cycle:
   *  1. resolveAuthentication() returns the (soon-to-be-revoked) token.
   *  2. A 401 occurs -> forceRefreshToken() refreshes the disk token.
   *  3. The retry's resolveAuthentication() must now return the FRESH token.
   */
  it('returns the refreshed token on the resolution following a forced refresh', async () => {
    const failedToken = 'failed-access-token';
    const refreshedAccessToken = 'refreshed-failed-access-token';
    const settingsService = createStubSettingsService();

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
      getToken: vi.fn(() => peekStoredAccessToken(coordinator)),
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
    });

    // Step 1: first resolution returns the failing token.
    const firstResolved = await resolver.resolveAuthentication({
      includeOAuth: true,
    });
    expect(firstResolved).toBe(failedToken);

    // Step 2: the 401 handler forces a refresh (updates the disk token).
    const refreshed = await coordinator.forceRefreshToken(
      'anthropic',
      failedToken,
    );
    expect(refreshed?.access_token).toBe(refreshedAccessToken);

    // Step 3: the retry's resolution must now return the FRESH token.
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

    const makeResolver = () => {
      const settingsService = createStubSettingsService();
      const oauthManager: OAuthManager = {
        getToken: vi.fn(() => peekStoredAccessToken(coordinator)),
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
      });
    };

    const agent1 = makeResolver();
    const agent2 = makeResolver();

    // Both agents resolve the failing token.
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
