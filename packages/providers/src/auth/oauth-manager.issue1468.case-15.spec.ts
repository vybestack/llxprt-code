/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  mockGetCurrentProfileName,
  createIssue1468Fixture,
  mockLoadProfile,
} from './oauth-manager.issue1468.test-helpers.js';

describe('Issue #1468 getProfileBuckets case 15', () => {
  /**
   * @requirement Issue #1468
   * @scenario Profile provider does NOT match requested provider
   * @given Current profile is 'my-anthropic-profile' with provider='anthropic' and buckets=['gmail','vybestack']
   * @when getProfileBuckets('codex') is called internally
   * @then Empty array should be returned (NOT the anthropic buckets)
   */
  it('should return empty array when provider does not match profile', async () => {
    const { manager } = createIssue1468Fixture();

    // Setup: Anthropic profile loaded, but we request codex buckets
    mockGetCurrentProfileName.mockReturnValue('my-anthropic-profile');
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
