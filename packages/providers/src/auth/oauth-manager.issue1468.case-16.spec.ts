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

describe('Issue #1468 getProfileBuckets case 16', () => {
  /**
   * @requirement Issue #1468
   * @scenario Codex profile loaded, but requesting Anthropic buckets
   * @given Current profile is 'my-codex-profile' with provider='codex' and buckets=['default']
   * @when getProfileBuckets('anthropic') is called internally
   * @then Empty array should be returned
   */
  it('should return empty array when codex profile loaded but anthropic requested', async () => {
    const { manager } = createIssue1468Fixture();

    mockGetCurrentProfileName.mockReturnValue('my-codex-profile');
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
