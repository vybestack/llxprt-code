/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import type { OAuthProvider } from './types.js';
import {
  mockGetCurrentProfileName,
  createIssue1468Fixture,
  mockLoadProfile,
  mockFetchAnthropicUsage,
} from './oauth-manager.issue1468.test-helpers.js';

describe('Issue #1468 getProfileBuckets case 10', () => {
  it('uses the current profile scoped session bucket for anthropic usage lookups', async () => {
    const { tokenStore, manager } = createIssue1468Fixture();

    mockGetCurrentProfileName.mockReturnValue('opusthinkingbucketed');
    mockLoadProfile.mockResolvedValue({
      provider: 'anthropic',
      auth: {
        type: 'oauth',
        buckets: ['bucket-a', 'bucket-b'],
      },
    });

    const provider: OAuthProvider = {
      name: 'anthropic',
      initiateAuth: vi.fn().mockResolvedValue({
        access_token: 'fresh-token',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) + 3600,
      }),
      getToken: vi.fn().mockResolvedValue(null),
      refreshToken: vi.fn().mockResolvedValue(null),
    };
    manager.registerProvider(provider);

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
    mockFetchAnthropicUsage.mockResolvedValue({ bucket: 'bucket-b' });

    const usage = await manager.getAnthropicUsageInfo();

    expect(mockFetchAnthropicUsage).toHaveBeenCalledWith('bucket-b-token');
    expect(usage).toStrictEqual({ bucket: 'bucket-b' });
  });
});
