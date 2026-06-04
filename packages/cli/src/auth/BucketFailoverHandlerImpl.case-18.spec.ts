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

describe('BucketFailoverHandlerImpl #18', () => {
  /**
   * @requirement REQ-1598-CL02
   * @pseudocode bucket-classification.md lines 30-42
   * Test that expired token with failed refresh is classified as expired-refresh-failed
   */
  it('should classify expired+refresh-failed as expired-refresh-failed', async () => {
    const { tokenStore, oauthManager } = createBucketFailoverFixture();

    // Create an expired token
    const expiredToken: OAuthToken = {
      access_token: 'expired-token',
      refresh_token: 'refresh-expired',
      expiry: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago
      token_type: 'Bearer',
      scope: '',
    };
    await tokenStore.saveToken('anthropic', expiredToken, 'bucket-a');
    await tokenStore.saveToken('anthropic', makeToken('t2'), 'bucket-b');

    oauthManager.setSessionBucket('anthropic', 'bucket-a');

    // Mock refresh to fail
    const provider = oauthManager.getProvider('anthropic');
    expect(provider).toBeDefined();
    // eslint-disable-next-line vitest/no-conditional-in-test -- intentional: narrowing/filter/parameterized-test context
    if (provider) {
      provider.refreshToken = vi.fn(async () => null);
    }

    const handler = new BucketFailoverHandlerImpl(
      ['bucket-a', 'bucket-b'],
      'anthropic',
      oauthManager,
    );

    // Act: Call tryFailover
    const result = await handler.tryFailover();

    // Assert: bucket-a should be classified as expired-refresh-failed
    const reasons = handler.getLastFailoverReasons();
    expect(reasons).toBeDefined();
    expect(reasons['bucket-a']).toBe('expired-refresh-failed');
    // Should have switched to bucket-b
    expect(result).toBe(true);
    expect(handler.getCurrentBucket()).toBe('bucket-b');
  });
});
