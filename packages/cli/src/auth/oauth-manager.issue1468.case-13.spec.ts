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

describe('Issue #1468 getProfileBuckets case 13', () => {
  it('prefers the current profile only bucket over a stale unscoped session bucket', async () => {
    const { tokenStore, manager } = createIssue1468Fixture();

    mockGetCurrentProfileName.mockReturnValue('single-bucket-profile');
    mockLoadProfile.mockResolvedValue({
      provider: 'anthropic',
      auth: {
        type: 'oauth',
        buckets: ['named-bucket'],
      },
    });

    const logout = vi.fn().mockResolvedValue(undefined);
    const provider: OAuthProvider & { logout?: typeof logout } = {
      name: 'anthropic',
      initiateAuth: vi.fn().mockResolvedValue({
        access_token: 'fresh-token',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) + 3600,
      }),
      getToken: vi.fn().mockResolvedValue(null),
      refreshToken: vi.fn().mockResolvedValue(null),
      logout,
    };
    manager.registerProvider(provider);

    await tokenStore.saveToken(
      'anthropic',
      {
        access_token: 'foreground-token',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) + 3600,
      },
      'foreground-bucket',
    );
    await tokenStore.saveToken(
      'anthropic',
      {
        access_token: 'named-bucket-token',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) + 3600,
      },
      'named-bucket',
    );
    manager.setSessionBucket('anthropic', 'foreground-bucket');
    mockFetchAnthropicUsage.mockResolvedValue({ bucket: 'named-bucket' });

    const statuses = await manager.getAuthStatusWithBuckets('anthropic');
    expect(
      statuses.find((status) => status.bucket === 'named-bucket')
        ?.isSessionBucket,
    ).toBe(true);
    expect(
      statuses.find((status) => status.bucket === 'foreground-bucket')
        ?.isSessionBucket,
    ).toBe(false);

    const usage = await manager.getAnthropicUsageInfo();
    expect(mockFetchAnthropicUsage).toHaveBeenCalledWith('named-bucket-token');
    expect(usage).toStrictEqual({ bucket: 'named-bucket' });

    await manager.logout('anthropic');

    expect(logout).toHaveBeenCalledTimes(1);
    await expect(
      tokenStore.getToken('anthropic', 'named-bucket'),
    ).resolves.toBeNull();
    await expect(
      tokenStore.getToken('anthropic', 'foreground-bucket'),
    ).resolves.not.toBeNull();
  });
});
