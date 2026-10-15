/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'bun:test';
import type { OAuthProvider } from './types.js';
import {
  mockLoadProfile,
  MockTokenStore,
  createFakeOAuthSettings,
  resetIssue1468Mocks,
} from './__tests__/oauth-manager.issue1468.test-helpers.js';
import { OAuthManager } from './oauth-manager.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { readFixtureSessionAuthPolicy } from './__tests__/session-auth-policy-fixture.js';
import {
  installOwnedConfig,
  installBorrowedConfigSettings,
} from '../__tests__/helpers/session-settings-owner-fixture.js';
const acquireIssueSettings = installBorrowedConfigSettings();
const acquireIssueConfig = installOwnedConfig();

function registerProvider(manager: OAuthManager, name = 'codex'): void {
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
  tokenStore: MockTokenStore,
  token: ReturnType<typeof validToken> | undefined,
): Promise<void> {
  if (token !== undefined) {
    await tokenStore.saveToken('codex', token, 'named');
  }
}

describe('named OAuth login runtime bucket activation', () => {
  it('activates the named bucket only for the matching active profile without persisting profile changes', async () => {
    const settingsService = new SettingsService();
    const config = acquireIssueConfig({
      sessionId: 'issue1468',
      targetDir: process.cwd(),
      cwd: process.cwd(),
      debugMode: false,
      model: 'gpt-5',
    });
    acquireIssueSettings(config, settingsService);
    const tokenStore = new MockTokenStore();
    const manager = new OAuthManager(tokenStore, createFakeOAuthSettings(), {
      config,
      readSessionAuthPolicy: readFixtureSessionAuthPolicy(settingsService),
    });
    resetIssue1468Mocks();
    registerProvider(manager);
    const profile = Object.freeze({ provider: 'codex', model: 'gpt-5' });
    mockLoadProfile.mockResolvedValue(profile);
    settingsService.setCurrentProfileName('work-profile');
    await tokenStore.saveToken('codex', validToken('work-token'), 'work');

    await manager.activateNamedLoginBucket('codex', 'work');

    expect((await manager.getOAuthToken('codex'))?.access_token).toBe(
      'work-token',
    );
    expect(profile).toStrictEqual({ provider: 'codex', model: 'gpt-5' });

    settingsService.setCurrentProfileName('other-profile');
    expect(await manager.getOAuthToken('codex')).toBeNull();
    expect(
      manager.getSessionBucket('codex', {
        providerId: 'codex',
        profileId: 'other-profile',
      }),
    ).toBeUndefined();
  });

  it('preserves explicit auth bucket policy and its first-bucket precedence', async () => {
    const settingsService = new SettingsService();
    const config = acquireIssueConfig({
      sessionId: 'issue1468',
      targetDir: process.cwd(),
      cwd: process.cwd(),
      debugMode: false,
      model: 'gpt-5',
    });
    acquireIssueSettings(config, settingsService);
    const tokenStore = new MockTokenStore();
    const manager = new OAuthManager(tokenStore, createFakeOAuthSettings(), {
      config,
      readSessionAuthPolicy: readFixtureSessionAuthPolicy(settingsService),
    });
    resetIssue1468Mocks();
    registerProvider(manager);
    settingsService.setCurrentProfileName('explicit-profile');
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
    const settingsService = new SettingsService();
    const config = acquireIssueConfig({
      sessionId: 'issue1468',
      targetDir: process.cwd(),
      cwd: process.cwd(),
      debugMode: false,
      model: 'gpt-5',
    });
    acquireIssueSettings(config, settingsService);
    const tokenStore = new MockTokenStore();
    const manager = new OAuthManager(tokenStore, createFakeOAuthSettings(), {
      config,
      readSessionAuthPolicy: readFixtureSessionAuthPolicy(settingsService),
    });
    resetIssue1468Mocks();
    registerProvider(manager);
    settingsService.setCurrentProfileName('claude-profile');
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
    const settingsService = new SettingsService();
    const config = acquireIssueConfig({
      sessionId: 'issue1468',
      targetDir: process.cwd(),
      cwd: process.cwd(),
      debugMode: false,
      model: 'gpt-5',
    });
    acquireIssueSettings(config, settingsService);
    const tokenStore = new MockTokenStore();
    const manager = new OAuthManager(tokenStore, createFakeOAuthSettings(), {
      config,
      readSessionAuthPolicy: readFixtureSessionAuthPolicy(settingsService),
    });
    resetIssue1468Mocks();
    registerProvider(manager);
    settingsService.setCurrentProfileName('profile-b');
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
    'authenticates an %s named bucket without writing the default bucket',
    async (_caseName, existingToken) => {
      const settingsService = new SettingsService();
      const config = acquireIssueConfig({
        sessionId: 'issue1468',
        targetDir: process.cwd(),
        cwd: process.cwd(),
        debugMode: false,
        model: 'gpt-5',
      });
      acquireIssueSettings(config, settingsService);
      const tokenStore = new MockTokenStore();
      const manager = new OAuthManager(tokenStore, createFakeOAuthSettings(), {
        config,
        readSessionAuthPolicy: readFixtureSessionAuthPolicy(settingsService),
      });
      resetIssue1468Mocks();
      const replacement = validToken('replacement-token');
      const provider: OAuthProvider = {
        name: 'codex',
        initiateAuth: vi.fn().mockResolvedValue(replacement),
        getToken: vi.fn(),
        refreshToken: vi.fn().mockResolvedValue(null),
      };
      manager.registerProvider(provider);
      await manager.toggleOAuthEnabled('codex');
      settingsService.setCurrentProfileName('work-profile');
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
