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

describe('Issue #1468 getProfileBuckets case 14', () => {
  /**
   * @requirement Issue #1468
   * @scenario Profile provider matches requested provider
   * @given Current profile is 'my-anthropic-profile' with provider='anthropic' and buckets=['gmail','work']
   * @when getProfileBuckets('anthropic') is called internally
   * @then The buckets ['gmail','work'] should be used
   */
  it('should use profile buckets when provider matches', async () => {
    const { manager } = createIssue1468Fixture();

    // Setup: Anthropic profile loaded
    mockGetCurrentProfileName.mockReturnValue('my-anthropic-profile');
    mockLoadProfile.mockResolvedValue({
      provider: 'anthropic',
      auth: {
        type: 'oauth',
        buckets: ['gmail', 'work'],
      },
    });

    // Access getProfileBuckets via the manager's private method
    const managerInternal = manager as unknown as {
      getProfileBuckets: (provider: string) => Promise<string[]>;
    };

    const buckets = await managerInternal.getProfileBuckets('anthropic');

    expect(buckets).toStrictEqual(['gmail', 'work']);
  });
});
