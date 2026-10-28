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

describe('Issue #1468 getProfileBuckets case 15', () => {
  /**
   * @requirement Issue #1468
   * @scenario Profile provider does NOT match requested provider
   * @given Current profile is 'my-anthropic-profile' with provider='anthropic' and buckets=['gmail','vybestack']
   * @when getProfileBuckets('codex') is called internally
   * @then Empty array should be returned (NOT the anthropic buckets)
   */
  it('should return empty array when provider does not match profile', async () => {
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

    // Setup: Anthropic profile loaded, but we request codex buckets
    settingsService.setCurrentProfileName('my-anthropic-profile');
    mockLoadProfile.mockResolvedValue({
      provider: 'anthropic',
      auth: {
        type: 'oauth',
        buckets: ['gmail', 'vybestack'],
      },
    });

    const managerInternal = manager as unknown as {
      getProfileBuckets: (provider: string) => Promise<string[]>;
    };

    // This is the bug fix: requesting 'codex' buckets while anthropic profile is loaded
    // SHOULD return [] because the providers don't match
    const buckets = await managerInternal.getProfileBuckets('codex');

    expect(buckets).toStrictEqual([]);
  });
});
