/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import { BucketFailoverHandlerImpl } from './BucketFailoverHandlerImpl.js';
import {
  createBucketFailoverFixture,
  makeToken,
} from './BucketFailoverHandlerImpl.test-helpers.js';

describe('BucketFailoverHandlerImpl #29', () => {
  /**
   * @requirement REQ-1598-FL03
   * @pseudocode failover-handler.md lines 74-82
   * Test that Pass 2 classifies no-token when getOAuthToken throws
   */
  it('should classify no-token when getOAuthToken throws', async () => {
    const { tokenStore, oauthManager } = createBucketFailoverFixture();

    // Arrange: bucket-a current, bucket-b will throw on getOAuthToken, bucket-c valid
    await tokenStore.saveToken('anthropic', makeToken('t1'), 'bucket-a');
    // bucket-b must have a stored token so Pass 2 reaches the getOAuthToken call
    await tokenStore.saveToken('anthropic', makeToken('t2'), 'bucket-b');
    await tokenStore.saveToken('anthropic', makeToken('t3'), 'bucket-c');

    oauthManager.setSessionBucket('anthropic', 'bucket-a');

    // Mock getOAuthToken to throw for bucket-b
    // This exercises the catch at lines 277-283 in Pass 2
    const originalGetToken = oauthManager.getOAuthToken.bind(oauthManager);
    oauthManager.getOAuthToken = vi.fn(async (provider, bucket) => {
      if (bucket === 'bucket-b') {
        throw new Error('Token store error');
      }
      return originalGetToken(provider, bucket);
    });

    const handler = new BucketFailoverHandlerImpl(
      ['bucket-a', 'bucket-b', 'bucket-c'],
      'anthropic',
      oauthManager,
    );

    // Act: Trigger failover
    const result = await handler.tryFailover();

    // Assert: Should classify bucket-b as no-token and continue to bucket-c
    expect(result).toBe(true);
    expect(handler.getCurrentBucket()).toBe('bucket-c');
    const reasons = handler.getLastFailoverReasons();
    expect(reasons['bucket-b']).toBe('no-token');
  });
});
