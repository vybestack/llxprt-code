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

describe('BucketFailoverHandlerImpl #32', () => {
  /**
   * @requirement REQ-1598-FL07
   * @pseudocode failover-handler.md lines 127-136
   * Test that Pass 3 attempts reauth for first expired-refresh-failed bucket
   */
  it('should attempt reauth for first expired-refresh-failed bucket', async () => {
    const { tokenStore, oauthManager } = createBucketFailoverFixture();

    // Arrange: bucket-a current (expired, refresh fails), bucket-b expired (refresh fails)
    const expiredTokenA: OAuthToken = {
      access_token: 'expired-a',
      refresh_token: 'refresh-a',
      expiry: Math.floor(Date.now() / 1000) - 3600,
      token_type: 'Bearer',
      scope: '',
    };
    const expiredTokenB: OAuthToken = {
      access_token: 'expired-b',
      refresh_token: 'refresh-b',
      expiry: Math.floor(Date.now() / 1000) - 3600,
      token_type: 'Bearer',
      scope: '',
    };
    await tokenStore.saveToken('anthropic', expiredTokenA, 'bucket-a');
    await tokenStore.saveToken('anthropic', expiredTokenB, 'bucket-b');

    oauthManager.setSessionBucket('anthropic', 'bucket-a');

    // Mock refresh to fail for all
    const provider = oauthManager.getProvider('anthropic');
    expect(provider).toBeDefined();
    // eslint-disable-next-line vitest/no-conditional-in-test -- intentional: narrowing/filter/parameterized-test context
    if (provider) {
      provider.refreshToken = vi.fn(async () => null);
    }

    // Mock authenticate to succeed for bucket-b
    const authenticateSpy = vi.fn(async (provider: string, bucket?: string) => {
      if (bucket === 'bucket-b') {
        await tokenStore.saveToken('anthropic', makeToken('reauth-b'), bucket);
      }
    });
    oauthManager.authenticate = authenticateSpy;

    const handler = new BucketFailoverHandlerImpl(
      ['bucket-a', 'bucket-b', 'bucket-c'],
      'anthropic',
      oauthManager,
    );

    // Act: Trigger failover
    const result = await handler.tryFailover();

    // Assert: Should attempt reauth for bucket-b (first expired-refresh-failed after bucket-a)
    expect(authenticateSpy).toHaveBeenCalledWith('anthropic', 'bucket-b');
    expect(result).toBe(true);
    expect(handler.getCurrentBucket()).toBe('bucket-b');
  });
});
