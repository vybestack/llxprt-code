/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'bun:test';
import type { OAuthProvider } from './types.js';
import {
  mockLoadProfile,
  mockFetchAnthropicUsage,
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

describe('Issue #1468 getProfileBuckets case 12', () => {
  it('uses the only configured profile bucket for logout, auth status, and anthropic usage after a fresh restart', async () => {
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

    settingsService.setCurrentProfileName('single-bucket-profile');
    mockLoadProfile.mockResolvedValue({
      provider: 'claudecode',
      auth: {
        type: 'oauth',
        buckets: ['named-bucket'],
      },
    });

    const logout = vi.fn().mockResolvedValue(undefined);
    const provider: OAuthProvider & { logout?: typeof logout } = {
      name: 'claudecode',
      initiateAuth: vi.fn().mockResolvedValue({
        access_token: 'fresh-token',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) + 3600,
      }),
      getToken: vi.fn().mockResolvedValue(null),
      refreshToken: vi.fn().mockResolvedValue(null),
      logout,
    };
    manager.registerProvider(provider);

    await tokenStore.saveToken(
      'claudecode',
      {
        access_token: 'named-bucket-token',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) + 3600,
      },
      'named-bucket',
    );
    // The fetch result is derived from the token it receives, so the value
    // asserted below can only match if the manager selected the profile
    // bucket's token.
    mockFetchAnthropicUsage.mockImplementation(
      async (_requestFetch: unknown, token: string) => ({
        fetchedToken: token,
      }),
    );

    // Verify the auth-status service path identifies the named bucket as a
    // session bucket — the getAuthStatusWithBuckets coverage is separate
    // from the usage fetch and must not regress.
    const statuses = await manager.getAuthStatusWithBuckets('claudecode');
    expect(
      statuses.find((status) => status.bucket === 'named-bucket')
        ?.isSessionBucket,
    ).toBe(true);

    const usage = await manager.getAnthropicUsageInfo(globalThis.fetch);
    expect(mockFetchAnthropicUsage).toHaveBeenCalledWith(
      globalThis.fetch,
      'named-bucket-token',
    );
    expect(usage).toStrictEqual({ fetchedToken: 'named-bucket-token' });

    await manager.logout('claudecode');

    expect(logout).toHaveBeenCalledTimes(1);
    await expect(
      tokenStore.getToken('claudecode', 'named-bucket'),
    ).resolves.toBeNull();
  });
});
