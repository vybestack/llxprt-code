/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  createIssue1468Fixture,
  mockGetCurrentProfileName,
} from './oauth-manager.issue1468.test-helpers.js';

describe('Issue #1468 getProfileBuckets case 17', () => {
  /**
   * @requirement Issue #1468
   * @scenario No current profile
   * @given No profile is currently loaded (getCurrentProfileName returns null)
   * @when getProfileBuckets('anthropic') is called
   * @then Empty array should be returned
   */
  it('should return empty array when no profile is loaded', async () => {
    const { manager } = createIssue1468Fixture();

    mockGetCurrentProfileName.mockReturnValue(null);

    const managerInternal = manager as unknown as {
      getProfileBuckets: (provider: string) => Promise<string[]>;
    };

    const buckets = await managerInternal.getProfileBuckets('anthropic');

    expect(buckets).toStrictEqual([]);
  });
});
