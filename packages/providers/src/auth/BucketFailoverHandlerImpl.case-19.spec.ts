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

describe('BucketFailoverHandlerImpl #19', () => {
  /**
   * @requirement REQ-1598-CL07
   * @pseudocode bucket-classification.md lines 30-42
   * Test that successful refresh in Pass 1 returns true immediately
   */
  it('should return true immediately when refresh succeeds in pass 1', async () => {
    const { tokenStore, oauthManager } = createBucketFailoverFixture();

    // Create an expired token
    const expiredToken: OAuthToken = {
      access_token: 'expired-token',
      refresh_token: 'refresh-valid',
      expiry: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago
      token_type: 'Bearer',
      scope: '',
    };
    await tokenStore.saveToken('anthropic', expiredToken, 'bucket-a');
    await tokenStore.saveToken('anthropic', makeToken('t2'), 'bucket-b');

    oauthManager.setSessionBucket('anthropic', 'bucket-a');

    // Mock refresh to succeed
    const refreshedToken = makeToken('refreshed-token');
    const provider = oauthManager.getProvider('anthropic');
    expect(provider).toBeDefined();
    // eslint-disable-next-line vitest/no-conditional-in-test -- intentional: narrowing/filter/parameterized-test context
    if (provider) {
      provider.refreshToken = vi.fn(async () => refreshedToken);
    }

    const handler = new BucketFailoverHandlerImpl(
      ['bucket-a', 'bucket-b'],
      'anthropic',
      oauthManager,
    );

    // Act: Call tryFailover (should succeed in Pass 1)
    const result = await handler.tryFailover();

    // Assert: Should return true immediately, stay on bucket-a
    expect(result).toBe(true);
    expect(handler.getCurrentBucket()).toBe('bucket-a');
  });
});
