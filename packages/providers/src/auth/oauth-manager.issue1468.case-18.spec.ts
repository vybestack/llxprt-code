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

describe('Issue #1468 getProfileBuckets case 18', () => {
  /**
   * @requirement Issue #1468
   * @scenario Profile has no buckets configured
   * @given Current profile has provider='anthropic' but no auth.buckets
   * @when getProfileBuckets('anthropic') is called
   * @then Empty array should be returned
   */
  it('should return empty array when profile has no buckets', async () => {
    const { manager } = createIssue1468Fixture();

    mockGetCurrentProfileName.mockReturnValue('my-anthropic-profile');
    mockLoadProfile.mockResolvedValue({
      provider: 'anthropic',
      // No auth section
    });

    const managerInternal = manager as unknown as {
      getProfileBuckets: (provider: string) => Promise<string[]>;
    };

    const buckets = await managerInternal.getProfileBuckets('anthropic');

    expect(buckets).toStrictEqual([]);
  });
});
