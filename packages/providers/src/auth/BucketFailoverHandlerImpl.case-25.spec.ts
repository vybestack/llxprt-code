/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import { BucketFailoverHandlerImpl } from './BucketFailoverHandlerImpl.js';
import type { OAuthToken } from '@vybestack/llxprt-code-core';
import {
  createBucketFailoverFixture,
  makeToken,
} from './BucketFailoverHandlerImpl.test-helpers.js';

describe('BucketFailoverHandlerImpl #25', () => {
  /**
   * @requirement REQ-1598-FL17
   * @pseudocode failover-handler.md lines 88-102
   * Test that Pass 2 refreshes expired token and switches on success
   */
  it('should refresh expired token and switch on success', async () => {
    const { tokenStore, oauthManager } = createBucketFailoverFixture();

    // Arrange: bucket-a current, bucket-b has expired token, bucket-c has valid token
    await tokenStore.saveToken('anthropic', makeToken('t1'), 'bucket-a');

    const expiredToken: OAuthToken = {
      access_token: 'expired-b',
      refresh_token: 'refresh-b',
      expiry: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago
      token_type: 'Bearer',
      scope: '',
    };
    await tokenStore.saveToken('anthropic', expiredToken, 'bucket-b');
    await tokenStore.saveToken('anthropic', makeToken('t3'), 'bucket-c');

    oauthManager.setSessionBucket('anthropic', 'bucket-a');

    // Mock refresh to succeed for bucket-b
    const refreshedToken = makeToken('refreshed-b');
    const provider = oauthManager.getProvider('anthropic');
    expect(provider).toBeDefined();
    // eslint-disable-next-line vitest/no-conditional-in-test -- intentional: narrowing/filter/parameterized-test context
    if (provider) {
      provider.refreshToken = vi.fn(async () => refreshedToken);
    }

    const handler = new BucketFailoverHandlerImpl(
      ['bucket-a', 'bucket-b', 'bucket-c'],
      'anthropic',
      oauthManager,
    );

    // Act: Trigger failover
    const result = await handler.tryFailover();

    // Assert: Should switch to bucket-b after successful refresh
    expect(result).toBe(true);
    expect(handler.getCurrentBucket()).toBe('bucket-b');
    expect(oauthManager.getSessionBucket('anthropic')).toBe('bucket-b');
  });
});
