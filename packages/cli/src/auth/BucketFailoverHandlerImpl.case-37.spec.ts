/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import { BucketFailoverHandlerImpl } from './BucketFailoverHandlerImpl.js';
import { createBucketFailoverFixture } from './BucketFailoverHandlerImpl.test-helpers.js';

describe('BucketFailoverHandlerImpl #37', () => {
  /**
   * @requirement REQ-1598-FL07
   * @pseudocode failover-handler.md lines 127-136
   * Test that Pass 3 attempts reauth for only ONE candidate
   */
  it('should attempt reauth for only ONE candidate', async () => {
    const { oauthManager } = createBucketFailoverFixture();

    // Arrange: Multiple buckets with no tokens
    oauthManager.setSessionBucket('anthropic', 'bucket-a');

    const handler = new BucketFailoverHandlerImpl(
      ['bucket-a', 'bucket-b', 'bucket-c', 'bucket-d'],
      'anthropic',
      oauthManager,
    );

    const authenticateSpy = vi.fn(
      async (_provider: string, _bucket?: string) => {
        // Fail all reauth attempts - do NOT save token
      },
    );
    oauthManager.authenticate = authenticateSpy;

    // Act: Trigger failover (all buckets have no token)
    const result = await handler.tryFailover();

    // Assert: authenticate should be called exactly ONCE (not for every bucket)
    expect(authenticateSpy).toHaveBeenCalledTimes(1);
    expect(authenticateSpy).toHaveBeenCalledWith('anthropic', 'bucket-b'); // First eligible after bucket-a
    expect(result).toBe(false); // Failed because reauth didn't save token
  });
});
