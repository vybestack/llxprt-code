/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'bun:test';
import type { OAuthProvider } from './types.js';
import {
  mockGetCurrentProfileName,
  createIssue1468Fixture,
  mockLoadProfile,
  mockFetchAnthropicUsage,
} from './oauth-manager.issue1468.test-helpers.js';

describe('Issue #1468 getProfileBuckets case 11', () => {
  it('falls back to the unscoped foreground session bucket for anthropic usage lookups when no scoped bucket exists', async () => {
    const { tokenStore, manager } = createIssue1468Fixture();

    mockGetCurrentProfileName.mockReturnValue('opusthinkingbucketed');
    mockLoadProfile.mockResolvedValue({
      provider: 'claudecode',
      auth: {
        type: 'oauth',
        buckets: ['bucket-a', 'bucket-b'],
      },
    });

    const provider: OAuthProvider = {
      name: 'claudecode',
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
      'claudecode',
      {
        access_token: 'bucket-b-token',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) + 3600,
      },
      'bucket-b',
    );
    manager.setSessionBucket('claudecode', 'bucket-b');
    // The fetch implementation derives its response from the token it
    // receives, so the asserted value can only match if the manager
    // selected the foreground session bucket's token.
    mockFetchAnthropicUsage.mockImplementation(async (token: string) => ({
      fetchedToken: token,
    }));

    const usage = await manager.getAnthropicUsageInfo();

    expect(mockFetchAnthropicUsage).toHaveBeenCalledWith('bucket-b-token');
    expect(usage).toStrictEqual({ fetchedToken: 'bucket-b-token' });
  });
});
