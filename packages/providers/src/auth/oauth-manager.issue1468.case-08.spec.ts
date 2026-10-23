/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
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

describe('Issue #1468 getProfileBuckets case 8', () => {
  it('marks the current profile scoped session bucket as active in auth status', async () => {
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
      provider: 'anthropic',
      auth: {
        type: 'oauth',
        buckets: ['bucket-a', 'bucket-b'],
      },
    });

    await tokenStore.saveToken(
      'anthropic',
      {
        access_token: 'bucket-a-token',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) + 3600,
      },
      'bucket-a',
    );
    await tokenStore.saveToken(
      'anthropic',
      {
        access_token: 'bucket-b-token',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) + 3600,
      },
      'bucket-b',
    );
    manager.setSessionBucket('anthropic', 'bucket-b', {
      profileId: 'opusthinkingbucketed',
      providerId: 'anthropic',
    });

    const statuses = await manager.getAuthStatusWithBuckets('anthropic');

    expect(
      statuses.find((status) => status.bucket === 'bucket-a')?.isSessionBucket,
    ).toBe(false);
    expect(
      statuses.find((status) => status.bucket === 'bucket-b')?.isSessionBucket,
    ).toBe(true);
  });
});
