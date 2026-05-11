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

describe('BucketFailoverHandlerImpl #31', () => {
  /**
   * @requirement REQ-1598-FL07
   * @pseudocode failover-handler.md lines 127-136
   * Test that Pass 3 attempts reauth for first no-token bucket
   */
  it('should attempt reauth for first no-token bucket', async () => {
    const { tokenStore, oauthManager } = createBucketFailoverFixture();

    // Arrange: bucket-a current (no token), bucket-b no token, bucket-c no token
    oauthManager.setSessionBucket('anthropic', 'bucket-a');

    const handler = new BucketFailoverHandlerImpl(
      ['bucket-a', 'bucket-b', 'bucket-c'],
      'anthropic',
      oauthManager,
    );

    // Mock authenticate to succeed and provide token for bucket-b
    const authenticateSpy = vi.fn(async (provider: string, bucket?: string) => {
      if (bucket === 'bucket-b') {
        await tokenStore.saveToken('anthropic', makeToken('reauth-b'), bucket);
      }
    });
    oauthManager.authenticate = authenticateSpy;

    // Act: Trigger failover (Pass 2 will fail for all, Pass 3 should reauth bucket-b)
    const result = await handler.tryFailover();

    // Assert: Should attempt reauth for bucket-b (first no-token after bucket-a)
    expect(authenticateSpy).toHaveBeenCalledWith('anthropic', 'bucket-b');
    expect(result).toBe(true);
    expect(handler.getCurrentBucket()).toBe('bucket-b');
  });
});
