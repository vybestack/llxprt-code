/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import {
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

describe('Issue #1468 getProfileBuckets case 17', () => {
  /**
   * @requirement Issue #1468
   * @scenario No current profile
   * @given No profile is currently loaded (getCurrentProfileName returns null)
   * @when getProfileBuckets('anthropic') is called
   * @then Empty array should be returned
   */
  it('should return empty array when no profile is loaded', async () => {
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

    settingsService.setCurrentProfileName(null);

    const managerInternal = manager as unknown as {
      getProfileBuckets: (provider: string) => Promise<string[]>;
    };

    const buckets = await managerInternal.getProfileBuckets('anthropic');

    expect(buckets).toStrictEqual([]);
  });
});
