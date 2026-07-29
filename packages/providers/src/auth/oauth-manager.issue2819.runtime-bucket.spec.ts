/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import type { OAuthProvider } from './types.js';
import {
  createIssue1468Fixture,
  mockGetCurrentProfileName,
  mockLoadProfile,
} from './oauth-manager.issue1468.test-helpers.js';

function registerProvider(
  manager: ReturnType<typeof createIssue1468Fixture>['manager'],
  name = 'codex',
): void {
  const provider: OAuthProvider = {
    name,
    initiateAuth: vi.fn(),
    getToken: vi.fn(),
    refreshToken: vi.fn(),
  };
  manager.registerProvider(provider);
}

function validToken(accessToken: string) {
  return {
    access_token: accessToken,
    token_type: 'Bearer',
    expiry: Math.floor(Date.now() / 1000) + 3600,
  };
}

async function seedNamedToken(
  tokenStore: ReturnType<typeof createIssue1468Fixture>['tokenStore'],
  token: ReturnType<typeof validToken> | undefined,
): Promise<void> {
  if (token !== undefined) {
    await tokenStore.saveToken('codex', token, 'named');
  }
}

describe('named OAuth login runtime bucket activation', () => {
  it('activates the named bucket only for the matching active profile without persisting profile changes', async () => {
    const { manager, tokenStore } = createIssue1468Fixture();
    registerProvider(manager);
    const profile = Object.freeze({ provider: 'codex', model: 'gpt-5' });
    mockLoadProfile.mockResolvedValue(profile);
    mockGetCurrentProfileName.mockReturnValue('work-profile');
    await tokenStore.saveToken('codex', validToken('work-token'), 'work');

    await manager.activateNamedLoginBucket('codex', 'work');

    expect((await manager.getOAuthToken('codex'))?.access_token).toBe(
      'work-token',
    );
    expect(profile).toStrictEqual({ provider: 'codex', model: 'gpt-5' });

    mockGetCurrentProfileName.mockReturnValue('other-profile');
    expect(await manager.getOAuthToken('codex')).toBeNull();
  });

  it('preserves explicit auth bucket policy and its first-bucket precedence', async () => {
    const { manager, tokenStore } = createIssue1468Fixture();
    registerProvider(manager);
    mockGetCurrentProfileName.mockReturnValue('explicit-profile');
    mockLoadProfile.mockResolvedValue({
      provider: 'codex',
      auth: { type: 'oauth', buckets: ['configured', 'fallback'] },
    });
    await tokenStore.saveToken(
      'codex',
      validToken('configured-token'),
      'configured',
    );
    await tokenStore.saveToken('codex', validToken('named-token'), 'named');

    await manager.activateNamedLoginBucket('codex', 'named');

    expect((await manager.getOAuthToken('codex'))?.access_token).toBe(
      'configured-token',
    );
    expect(
      manager.getSessionBucket('codex', {
        providerId: 'codex',
        profileId: 'explicit-profile',
      }),
    ).toBe('configured');
  });

  it('does not activate a bucket when the active profile uses another provider', async () => {
    const { manager } = createIssue1468Fixture();
    registerProvider(manager);
    mockGetCurrentProfileName.mockReturnValue('claude-profile');
    mockLoadProfile.mockResolvedValue({ provider: 'claudecode' });

    await manager.activateNamedLoginBucket('codex', 'work');

    expect(
      manager.getSessionBucket('codex', {
        providerId: 'codex',
        profileId: 'claude-profile',
      }),
    ).toBeUndefined();
  });

  it('prefers a named profile-scoped login over existing unscoped session state', async () => {
    const { manager, tokenStore } = createIssue1468Fixture();
    registerProvider(manager);
    mockGetCurrentProfileName.mockReturnValue('profile-b');
    mockLoadProfile.mockResolvedValue({ provider: 'codex', model: 'gpt-5' });
    await tokenStore.saveToken('codex', validToken('unscoped-token'), 'legacy');
    await tokenStore.saveToken('codex', validToken('named-token'), 'named');
    manager.setSessionBucket('codex', 'legacy');

    await manager.activateNamedLoginBucket('codex', 'named');

    expect((await manager.getOAuthToken('codex'))?.access_token).toBe(
      'named-token',
    );
  });

  it.each([
    ['missing', undefined],
    [
      'expired',
      {
        access_token: 'expired-token',
        token_type: 'Bearer' as const,
        expiry: Math.floor(Date.now() / 1000) - 60,
        refresh_token: 'expired-refresh',
      },
    ],
  ])(
    'reauthenticates an %s named bucket without writing the default bucket',
    async (_caseName, existingToken) => {
      const { manager, tokenStore } = createIssue1468Fixture();
      const replacement = validToken('replacement-token');
      const provider: OAuthProvider = {
        name: 'codex',
        initiateAuth: vi.fn().mockResolvedValue(replacement),
        getToken: vi.fn(),
        refreshToken: vi.fn().mockResolvedValue(null),
      };
      manager.registerProvider(provider);
      await manager.toggleOAuthEnabled('codex');
      mockGetCurrentProfileName.mockReturnValue('work-profile');
      mockLoadProfile.mockResolvedValue({ provider: 'codex', model: 'gpt-5' });
      await manager.activateNamedLoginBucket('codex', 'named');
      await seedNamedToken(tokenStore, existingToken);

      expect(await manager.getToken('codex')).toBe('replacement-token');
      expect((await tokenStore.getToken('codex', 'named'))?.access_token).toBe(
        'replacement-token',
      );
      expect(await tokenStore.getToken('codex')).toBeNull();
    },
  );
});
