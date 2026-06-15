/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { BucketFailoverHandlerImpl } from './BucketFailoverHandlerImpl.js';
import {
  createBucketFailoverFixture,
  makeToken,
} from './BucketFailoverHandlerImpl.test-helpers.js';

describe('BucketFailoverHandlerImpl #27', () => {
  /**
   * @requirement REQ-1598-FL13
   * @pseudocode failover-handler.md lines 64-68
   * Test that Pass 2 skips buckets already in triedBucketsThisSession
   */
  it('should skip buckets already in triedBucketsThisSession', async () => {
    const { tokenStore, oauthManager } = createBucketFailoverFixture();

    // Arrange: All buckets have valid tokens
    await tokenStore.saveToken('anthropic', makeToken('t1'), 'bucket-a');
    await tokenStore.saveToken('anthropic', makeToken('t2'), 'bucket-b');
    await tokenStore.saveToken('anthropic', makeToken('t3'), 'bucket-c');

    oauthManager.setSessionBucket('anthropic', 'bucket-a');

    const handler = new BucketFailoverHandlerImpl(
      ['bucket-a', 'bucket-b', 'bucket-c'],
      'anthropic',
      oauthManager,
    );

    // Act: First failover switches to bucket-b
    const first = await handler.tryFailover();
    expect(first).toBe(true);
    expect(handler.getCurrentBucket()).toBe('bucket-b');

    // Second failover should skip bucket-a (already tried), go to bucket-c
    const second = await handler.tryFailover();
    expect(second).toBe(true);
    expect(handler.getCurrentBucket()).toBe('bucket-c');

    // Third failover should fail (all buckets tried)
    const third = await handler.tryFailover();
    expect(third).toBe(false);
  });
});
