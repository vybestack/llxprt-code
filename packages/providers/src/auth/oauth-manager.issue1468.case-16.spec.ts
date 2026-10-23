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

describe('Issue #1468 getProfileBuckets case 16', () => {
  /**
   * @requirement Issue #1468
   * @scenario Codex profile loaded, but requesting Anthropic buckets
   * @given Current profile is 'my-codex-profile' with provider='codex' and buckets=['default']
   * @when getProfileBuckets('anthropic') is called internally
   * @then Empty array should be returned
   */
  it('should return empty array when codex profile loaded but anthropic requested', async () => {
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

    settingsService.setCurrentProfileName('my-codex-profile');
    mockLoadProfile.mockResolvedValue({
      provider: 'codex',
      auth: {
        type: 'oauth',
        buckets: ['default'],
      },
    });

    const managerInternal = manager as unknown as {
      getProfileBuckets: (provider: string) => Promise<string[]>;
    };

    const buckets = await managerInternal.getProfileBuckets('anthropic');

    expect(buckets).toStrictEqual([]);
  });
});
