/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'bun:test';
import type { OAuthProvider } from './types.js';
import {
  createIssue1468Fixture,
  mockLoadProfile,
  clearIssue1468Fixture,
  type MockTokenStore,
} from './__tests__/oauth-manager.issue1468.test-helpers.js';
import type { OAuthManager } from './oauth-manager.js';
import type { OAuthToken } from './types.js';

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

describe('activateNamedLoginBucket token resolution (issue #2819)', () => {
  let tokenStore: MockTokenStore;
  let manager: OAuthManager;
  let settingsService: ReturnType<
    typeof createIssue1468Fixture
  >['settingsService'];

  beforeEach(() => {
    const fixture = createIssue1468Fixture();
    tokenStore = fixture.tokenStore;
    manager = fixture.manager;
    settingsService = fixture.settingsService;
    registerProvider(manager);
  });

  afterEach(() => {
    clearIssue1468Fixture(tokenStore);
  });

  it('keeps the configured bucket when the profile has explicit nonempty bucket policy', async () => {
    settingsService.setCurrentProfileName('explicit-profile');
    mockLoadProfile.mockResolvedValue({
      provider: 'codex',
      auth: { type: 'oauth', buckets: ['configured'] },
    });

    await tokenStore.saveToken(
      'codex',
      validToken('configured-token'),
      'configured',
    );

    await manager.activateNamedLoginBucket('codex', 'named');

    expect((await manager.getOAuthToken('codex'))?.access_token).toBe(
      'configured-token',
    );
  });

  it('resolves the activated named bucket token for an unbucketed profile', async () => {
    const profile = { provider: 'codex', model: 'gpt-5' };
    mockLoadProfile.mockResolvedValue(profile);
    settingsService.setCurrentProfileName('gpt56solhigh');
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
    settingsService.setCurrentProfileName('empty-bucket-profile');
    mockLoadProfile.mockResolvedValue({
      provider: 'codex',
      auth: { type: 'oauth', buckets: [] },
    });

    await tokenStore.saveToken('codex', validToken('stale-default'));

    await manager.activateNamedLoginBucket('codex', 'named');

    await tokenStore.saveToken('codex', validToken('named-token'), 'named');
    const resolved = await manager.getOAuthToken('codex');
    expect(resolved?.access_token).toBe('named-token');
  });
});
