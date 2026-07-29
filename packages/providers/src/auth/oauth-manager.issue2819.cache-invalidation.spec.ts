/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { OAuthProvider } from './types.js';
import {
  createIssue1468Fixture,
  mockGetCurrentProfileName,
  mockLoadProfile,
  clearIssue1468Fixture,
  type MockTokenStore,
} from './oauth-manager.issue1468.test-helpers.js';
import type { OAuthManager } from './oauth-manager.js';
import type { OAuthToken } from './types.js';
import {
  ensureRuntimeState,
  getValidCachedEntry,
  runtimeScopedStates,
  storeRuntimeScopedToken,
  type IProviderRuntimeContext,
  type ISettingsService,
} from '@vybestack/llxprt-code-auth';

function registerProvider(manager: OAuthManager, name = 'codex'): void {
  const provider: OAuthProvider = {
    name,
    initiateAuth: vi.fn(),
    getToken: vi.fn(),
    refreshToken: vi.fn(),
  };
  manager.registerProvider(provider);
}

function validToken(accessToken: string): OAuthToken {
  return {
    access_token: accessToken,
    token_type: 'Bearer',
    expiry: Math.floor(Date.now() / 1000) + 3600,
  };
}

function makeSettingsService(profileId: string): ISettingsService {
  return {
    get: () => undefined,
    getCurrentProfileName: () => profileId,
  } as ISettingsService;
}

function makeRuntimeContext(
  runtimeId: string,
  profileId: string,
): IProviderRuntimeContext {
  return {
    runtimeId,
    settingsService: makeSettingsService(profileId),
  };
}

describe('activateNamedLoginBucket cache invalidation (issue #2819)', () => {
  let tokenStore: MockTokenStore;
  let manager: OAuthManager;

  beforeEach(() => {
    runtimeScopedStates.clear();
    const fixture = createIssue1468Fixture();
    tokenStore = fixture.tokenStore;
    manager = fixture.manager;
    registerProvider(manager);
  });

  afterEach(() => {
    runtimeScopedStates.clear();
    clearIssue1468Fixture(tokenStore);
  });

  it('invalidates the cached runtime-scoped credential so the next resolution uses the new named bucket', async () => {
    const profile = { provider: 'codex', model: 'gpt-5' };
    mockLoadProfile.mockResolvedValue(profile);
    mockGetCurrentProfileName.mockReturnValue('gpt56solhigh');

    const runtimeId = 'rt-issue2819-cache-invalidation';
    const profileId = 'gpt56solhigh';

    await tokenStore.saveToken('codex', validToken('default-token'));
    await tokenStore.saveToken(
      'codex',
      validToken('vybestack-token'),
      'vybestack',
    );

    const ctx = makeRuntimeContext(runtimeId, profileId);
    const state = ensureRuntimeState(ctx);
    storeRuntimeScopedToken(state, 'codex', profileId, 'default-token', {
      expiry: Math.floor(Date.now() / 1000) + 3600,
      access_token: 'default-token',
      token_type: 'Bearer',
    } as OAuthToken);

    expect(getValidCachedEntry(state, 'codex', profileId)).not.toBeNull();

    await manager.activateNamedLoginBucket('codex', 'vybestack');

    expect(getValidCachedEntry(state, 'codex', profileId)).toBeNull();

    const resolved = await manager.getOAuthToken('codex');
    expect(resolved?.access_token).toBe('vybestack-token');
  });

  it('does not invalidate when the profile has explicit nonempty bucket policy', async () => {
    mockGetCurrentProfileName.mockReturnValue('explicit-profile');
    mockLoadProfile.mockResolvedValue({
      provider: 'codex',
      auth: { type: 'oauth', buckets: ['configured'] },
    });

    const runtimeId = 'rt-issue2819-explicit';
    const profileId = 'explicit-profile';

    const ctx = makeRuntimeContext(runtimeId, profileId);
    const state = ensureRuntimeState(ctx);
    storeRuntimeScopedToken(state, 'codex', profileId, 'configured-token', {
      expiry: Math.floor(Date.now() / 1000) + 3600,
      access_token: 'configured-token',
      token_type: 'Bearer',
    } as OAuthToken);

    await manager.activateNamedLoginBucket('codex', 'named');

    expect(getValidCachedEntry(state, 'codex', profileId)).not.toBeNull();
  });

  it('resolves the activated named bucket token for an unbucketed profile', async () => {
    const profile = { provider: 'codex', model: 'gpt-5' };
    mockLoadProfile.mockResolvedValue(profile);
    mockGetCurrentProfileName.mockReturnValue('gpt56solhigh');
    await tokenStore.saveToken(
      'codex',
      validToken('vybestack-token'),
      'vybestack',
    );

    await manager.activateNamedLoginBucket('codex', 'vybestack');

    const resolved = await manager.getOAuthToken('codex');
    expect(resolved?.access_token).toBe('vybestack-token');
  });

  it('treats explicitly-present empty auth.buckets array as unbucketed', async () => {
    mockGetCurrentProfileName.mockReturnValue('empty-bucket-profile');
    mockLoadProfile.mockResolvedValue({
      provider: 'codex',
      auth: { type: 'oauth', buckets: [] },
    });

    const runtimeId = 'rt-issue2819-empty';
    const profileId = 'empty-bucket-profile';

    const ctx = makeRuntimeContext(runtimeId, profileId);
    const state = ensureRuntimeState(ctx);
    storeRuntimeScopedToken(state, 'codex', profileId, 'stale-default', {
      expiry: Math.floor(Date.now() / 1000) + 3600,
      access_token: 'stale-default',
      token_type: 'Bearer',
    } as OAuthToken);

    expect(getValidCachedEntry(state, 'codex', profileId)).not.toBeNull();

    await manager.activateNamedLoginBucket('codex', 'named');

    expect(getValidCachedEntry(state, 'codex', profileId)).toBeNull();

    await tokenStore.saveToken('codex', validToken('named-token'), 'named');
    const resolved = await manager.getOAuthToken('codex');
    expect(resolved?.access_token).toBe('named-token');
  });
});
