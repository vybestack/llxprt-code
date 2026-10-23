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

describe('Issue #1468 getProfileBuckets case 10', () => {
  it('uses the current profile scoped session bucket for anthropic usage lookups', async () => {
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

    settingsService.setCurrentProfileName('opusthinkingbucketed');
    mockLoadProfile.mockResolvedValue({
      provider: 'claudecode',
      auth: {
        type: 'oauth',
        buckets: ['bucket-a', 'bucket-b'],
      },
    });

    const provider: OAuthProvider = {
      name: 'claudecode',
      initiateAuth: vi.fn().mockResolvedValue({
        access_token: 'fresh-token',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) + 3600,
      }),
      getToken: vi.fn().mockResolvedValue(null),
      refreshToken: vi.fn().mockResolvedValue(null),
    };
    manager.registerProvider(provider);

    await tokenStore.saveToken(
      'claudecode',
      {
        access_token: 'bucket-b-token',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) + 3600,
      },
      'bucket-b',
    );
    manager.setSessionBucket('claudecode', 'bucket-b', {
      profileId: 'opusthinkingbucketed',
      providerId: 'claudecode',
    });
    // The fetch result is derived from the token it receives, so the value
    // asserted below can only match if the manager selected bucket-b's token.
    mockFetchAnthropicUsage.mockImplementation(
      async (_requestFetch: unknown, token: string) => ({
        fetchedToken: token,
      }),
    );

    const usage = await manager.getAnthropicUsageInfo(globalThis.fetch);

    expect(mockFetchAnthropicUsage).toHaveBeenCalledWith(
      globalThis.fetch,
      'bucket-b-token',
    );
    expect(usage).toStrictEqual({ fetchedToken: 'bucket-b-token' });
  });
});
