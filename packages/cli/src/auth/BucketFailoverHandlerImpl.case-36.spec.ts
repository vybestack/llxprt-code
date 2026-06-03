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

describe('BucketFailoverHandlerImpl #36', () => {
  /**
   * @requirement REQ-1598-FR03
   * @pseudocode failover-handler.md lines 129-135
   * Test that Pass 3 does NOT attempt reauth for quota-exhausted buckets
   */
  it('should not attempt reauth for quota-exhausted buckets', async () => {
    const { tokenStore, oauthManager } = createBucketFailoverFixture();

    // Arrange: bucket-a classified as quota-exhausted, bucket-b no token
    await tokenStore.saveToken('anthropic', makeToken('t1'), 'bucket-a');
    // bucket-b has no token

    oauthManager.setSessionBucket('anthropic', 'bucket-a');

    const handler = new BucketFailoverHandlerImpl(
      ['bucket-a', 'bucket-b'],
      'anthropic',
      oauthManager,
    );

    const authenticateSpy = vi.fn(async (provider: string, bucket?: string) => {
      if (bucket === 'bucket-b') {
        await tokenStore.saveToken('anthropic', makeToken('reauth-b'), bucket);
      }
    });
    oauthManager.authenticate = authenticateSpy;

    // Act: Trigger failover with 429 status (quota-exhausted for bucket-a)
    const result = await handler.tryFailover({ triggeringStatus: 429 });

    // Assert: Should skip bucket-a (quota-exhausted) and reauth bucket-b (no-token)
    expect(authenticateSpy).toHaveBeenCalledWith('anthropic', 'bucket-b');
    expect(result).toBe(true);
    expect(handler.getCurrentBucket()).toBe('bucket-b');

    // Verify bucket-a was classified as quota-exhausted
    const reasons = handler.getLastFailoverReasons();
    expect(reasons['bucket-a']).toBe('quota-exhausted');
  });
});
