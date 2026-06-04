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

describe('Issue #1468 getProfileBuckets case 8', () => {
  it('marks the current profile scoped session bucket as active in auth status', async () => {
    const { tokenStore, manager } = createIssue1468Fixture();

    mockGetCurrentProfileName.mockReturnValue('opusthinkingbucketed');
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
