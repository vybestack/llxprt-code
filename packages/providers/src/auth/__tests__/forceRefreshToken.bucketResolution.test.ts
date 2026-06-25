/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * @fix issue2131
 * TokenAccessCoordinator forceRefreshToken bucket-resolution tests.
 *
 * Issue #2131: a 401 forces a token refresh, but the forced-refresh path was
 * handed NO bucket (RetryOrchestrator -> OnAuthErrorHandlerImpl ->
 * OAuthManager -> TokenAccessCoordinator all forward `undefined`). The
 * coordinator then read/refreshed the DEFAULT bucket while the active OAuth
 * token had been selected and stored under a NON-DEFAULT session bucket during
 * the prior request. The default bucket lookup found nothing, so no refresh
 * happened, the runtime cache was never invalidated, and the retry re-resolved
 * the same revoked token -> persistent 401.
 *
 * These behavioral tests verify forceRefreshToken resolves the SAME bucket the
 * active request used (the session bucket recorded during the prior successful
 * resolution, falling back to a single configured profile bucket) when no
 * explicit bucket is supplied.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TokenAccessCoordinator } from '../token-access-coordinator.js';
import type { OAuthProvider, OAuthToken, TokenStore } from '../types.js';
import type { OAuthTokenRequestMetadata } from '@vybestack/llxprt-code-core';
import { oauthRuntimeBridge } from '../runtime-accessor-bridge.js';

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
  return {
    scheduleProactiveRenewal: vi.fn(),
  };
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

const FAILED_TOKEN = 'failed-access-token';

describe('TokenAccessCoordinator forceRefreshToken bucket resolution (issue #2131)', () => {
  beforeEach(() => {
    oauthRuntimeBridge.setAccessors({
      getEphemeralSetting: () => undefined,
      getProviderManager: () => ({
        getProviderByName: () => null,
      }),
      getRuntimeContext: () => ({
        runtimeId: 'test-runtime',
      }),
      getCurrentProfileName: () => null,
    });
  });

  afterEach(() => {
    oauthRuntimeBridge.setAccessors(undefined);
  });

  it('forceRefreshToken refreshes the active session bucket when no bucket is supplied (issue #2131)', async () => {
    const bucketAToken = makeToken(FAILED_TOKEN, 3600, 'refresh-bucket-a');
    const initialTokens = new Map([['anthropic::bucket-a', bucketAToken]]);
    const provider = createMockProvider('anthropic');
    const { coordinator, tokenStore, facade } = makeCoordinator({
      provider,
      initialTokens,
    });

    facade.getSessionBucket = vi.fn(() => 'bucket-a');

    const result = await coordinator.forceRefreshToken(
      'anthropic',
      FAILED_TOKEN,
    );

    // Observable state: refreshed token returned and stored under the session
    // bucket (not the default bucket). Per dev-docs/RULES.md we assert on
    // observable token-store state rather than mock-invocation details.
    expect(result).not.toBeNull();
    expect(result?.access_token).toBe('refreshed-failed-access-token');

    const stored = await tokenStore.getToken('anthropic', 'bucket-a');
    expect(stored?.access_token).toBe('refreshed-failed-access-token');

    const defaultStored = await tokenStore.getToken('anthropic');
    expect(defaultStored).toBeNull();
  });

  it('forceRefreshToken returns null and does not refresh when the session bucket has no token (issue #2131)', async () => {
    const initialTokens = new Map([
      ['anthropic', makeToken('some-default-token', 3600, 'refresh-default')],
    ]);
    const provider = createMockProvider('anthropic');
    const { coordinator, tokenStore, facade } = makeCoordinator({
      provider,
      initialTokens,
    });

    facade.getSessionBucket = vi.fn(() => 'bucket-a');

    const result = await coordinator.forceRefreshToken(
      'anthropic',
      FAILED_TOKEN,
    );

    // No refresh occurred: nothing returned and the default bucket token is
    // untouched (observable state over mock-invocation assertions).
    expect(result).toBeNull();
    const defaultStored = await tokenStore.getToken('anthropic');
    expect(defaultStored?.access_token).toBe('some-default-token');
  });

  it('forceRefreshToken falls back to a single configured profile bucket when no session bucket is set (issue #2131)', async () => {
    const bucketBToken = makeToken(FAILED_TOKEN, 3600, 'refresh-bucket-b');
    const initialTokens = new Map([['anthropic::bucket-b', bucketBToken]]);
    const provider = createMockProvider('anthropic');
    const { coordinator, tokenStore, facade } = makeCoordinator({
      provider,
      initialTokens,
    });

    facade.getSessionBucket = vi.fn(() => undefined);
    coordinator.setGetProfileBucketsDelegate(async () => ['bucket-b']);

    const result = await coordinator.forceRefreshToken(
      'anthropic',
      FAILED_TOKEN,
    );

    // Observable state: refreshed token stored under the single profile bucket
    // (not the default bucket).
    expect(result).not.toBeNull();
    expect(result?.access_token).toBe('refreshed-failed-access-token');

    const stored = await tokenStore.getToken('anthropic', 'bucket-b');
    expect(stored?.access_token).toBe('refreshed-failed-access-token');

    const defaultStored = await tokenStore.getToken('anthropic');
    expect(defaultStored).toBeNull();
  });

  it('forceRefreshToken honors an explicit bucket argument and ignores the session bucket (no regression)', async () => {
    const explicitToken = makeToken(FAILED_TOKEN, 3600, 'refresh-explicit');
    const initialTokens = new Map([['anthropic::explicit-x', explicitToken]]);
    const provider = createMockProvider('anthropic');
    const { coordinator, tokenStore, facade } = makeCoordinator({
      provider,
      initialTokens,
    });

    facade.getSessionBucket = vi.fn(() => 'session-bucket');

    const result = await coordinator.forceRefreshToken(
      'anthropic',
      FAILED_TOKEN,
      'explicit-x',
    );

    // Observable state: refreshed token stored under the explicit bucket, and
    // the session bucket (which the resolver must ignore when an explicit
    // bucket is supplied) remains empty.
    expect(result).not.toBeNull();
    expect(result?.access_token).toBe('refreshed-failed-access-token');

    const stored = await tokenStore.getToken('anthropic', 'explicit-x');
    expect(stored?.access_token).toBe('refreshed-failed-access-token');

    const sessionStored = await tokenStore.getToken(
      'anthropic',
      'session-bucket',
    );
    expect(sessionStored).toBeNull();
  });

  it('forceRefreshToken falls back to the default bucket when no session bucket, no profile buckets (no regression)', async () => {
    const defaultToken = makeToken(FAILED_TOKEN, 3600, 'refresh-default');
    const initialTokens = new Map([['anthropic', defaultToken]]);
    const provider = createMockProvider('anthropic');
    const { coordinator, tokenStore, facade } = makeCoordinator({
      provider,
      initialTokens,
    });

    facade.getSessionBucket = vi.fn(() => undefined);
    coordinator.setGetProfileBucketsDelegate(async () => []);

    const result = await coordinator.forceRefreshToken(
      'anthropic',
      FAILED_TOKEN,
    );

    // Observable state: no session/profile bucket resolved -> default bucket
    // refreshed in place.
    expect(result).not.toBeNull();
    expect(result?.access_token).toBe('refreshed-failed-access-token');

    const defaultStored = await tokenStore.getToken('anthropic');
    expect(defaultStored?.access_token).toBe('refreshed-failed-access-token');
  });

  it('forceRefreshToken with a non-default session bucket writes the refreshed token under that bucket (issue #2131)', async () => {
    const bucketAToken = makeToken(FAILED_TOKEN, 3600, 'refresh-bucket-a');
    const initialTokens = new Map([['anthropic::bucket-a', bucketAToken]]);
    const provider = createMockProvider('anthropic');
    const { coordinator, tokenStore, facade } = makeCoordinator({
      provider,
      initialTokens,
    });

    facade.getSessionBucket = vi.fn(() => 'bucket-a');

    const refreshed = await coordinator.forceRefreshToken(
      'anthropic',
      FAILED_TOKEN,
    );

    expect(refreshed?.access_token).toBe('refreshed-failed-access-token');

    const stored = await tokenStore.getToken('anthropic', 'bucket-a');
    expect(stored?.access_token).toBe('refreshed-failed-access-token');

    const defaultStored = await tokenStore.getToken('anthropic');
    expect(defaultStored).toBeNull();
  });

  it('forceRefreshToken refreshes the profile-scoped session bucket when the unscoped session bucket is absent (issue #2131)', async () => {
    // Simulate an active multi-bucket profile whose request used a SCOPED
    // session bucket (recorded under profile-scoped metadata), while the
    // UNSCOPED session bucket is undefined. This is the exact gap in the
    // original issue2131 resolver, which only consulted the unscoped session
    // bucket and thus defaulted to the global default bucket.
    oauthRuntimeBridge.setAccessors({
      getEphemeralSetting: () => undefined,
      getProviderManager: () => ({
        getProviderByName: () => null,
      }),
      getRuntimeContext: () => ({
        runtimeId: 'test-runtime',
      }),
      getCurrentProfileName: () => 'my-profile',
    });

    const scopedBucketToken = makeToken(FAILED_TOKEN, 3600, 'refresh-bucket-b');
    // Token seeded ONLY under the scoped bucket; default and unscoped buckets
    // are empty.
    const initialTokens = new Map([['anthropic::bucket-b', scopedBucketToken]]);
    const provider = createMockProvider('anthropic');
    const { coordinator, tokenStore, facade } = makeCoordinator({
      provider,
      initialTokens,
    });

    // The scoped session bucket only resolves when metadata carries the active
    // profile. The unscoped lookup (no metadata) returns undefined, mirroring
    // subagent-isolation.behavioral.spec.ts where a scoped session bucket can
    // exist while the unscoped one is undefined.
    facade.getSessionBucket = vi.fn(
      (_p: string, metadata?: OAuthTokenRequestMetadata) =>
        metadata?.profileId === 'my-profile'
          ? 'bucket-b'
          : (undefined as string | undefined),
    );

    const result = await coordinator.forceRefreshToken(
      'anthropic',
      FAILED_TOKEN,
    );

    // OBSERVABLE behavior: the scoped bucket was refreshed, and the default
    // bucket (which the old unscoped-only resolver would have fallen back to)
    // remains empty. This assertion fails against the old resolver (which
    // returns undefined for the effective bucket, looks up the default bucket,
    // finds no token there, and returns null).
    expect(result).not.toBeNull();
    expect(result?.access_token).toBe('refreshed-failed-access-token');

    const scopedStored = await tokenStore.getToken('anthropic', 'bucket-b');
    expect(scopedStored?.access_token).toBe('refreshed-failed-access-token');

    const defaultStored = await tokenStore.getToken('anthropic');
    expect(defaultStored).toBeNull();
  });
});
