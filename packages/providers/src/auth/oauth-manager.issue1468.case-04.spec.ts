/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'bun:test';
import type { OAuthProvider } from './types.js';
import type { OAuthTokenRequestMetadata } from '@vybestack/llxprt-code-core';
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

async function loadCaseFourProfile(profileName: string) {
  if (profileName === 'foreground-profile') {
    return {
      provider: 'anthropic',
      auth: { type: 'oauth', buckets: ['foreground-bucket'] },
    };
  }
  throw new Error(`Unexpected profile lookup: ${profileName}`);
}

describe('Issue #1468 getProfileBuckets case 4', () => {
  it('does not fall back to foreground buckets when an explicit request profile cannot be loaded', async () => {
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

    settingsService.setCurrentProfileName('foreground-profile');
    mockLoadProfile.mockImplementation(loadCaseFourProfile);

    const provider: OAuthProvider = {
      name: 'anthropic',
      initiateAuth: vi.fn().mockResolvedValue({
        access_token: 'fresh-token',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) + 3600,
      }),
      getToken: vi.fn().mockResolvedValue(null),
      refreshToken: vi.fn().mockResolvedValue(null),
    };
    manager.registerProvider(provider);
    await manager.toggleOAuthEnabled('anthropic');

    manager.setSessionBucket('anthropic', 'foreground-bucket');

    await tokenStore.saveToken(
      'anthropic',
      {
        access_token: 'foreground-token',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) + 3600,
      },
      'foreground-bucket',
    );

    const metadata: OAuthTokenRequestMetadata = {
      profileId: 'missing-profile',
      providerId: 'anthropic',
      runtimeMetadata: {
        source: 'SubagentOrchestrator',
        subagent: 'codeanalyzer',
      },
    };

    await expect(manager.getOAuthToken('anthropic', metadata)).rejects.toThrow(
      'Unexpected profile lookup: missing-profile',
    );
  });
});
