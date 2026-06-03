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

describe('BucketFailoverHandlerImpl #28', () => {
  /**
   * @requirement REQ-1598-FL13
   * @pseudocode failover-handler.md lines 64
   * Test that Pass 2 iterates buckets in profile order
   */
  it('should iterate buckets in profile order', async () => {
    const { tokenStore, oauthManager } = createBucketFailoverFixture();

    // Arrange: Set up buckets in specific order
    await tokenStore.saveToken('anthropic', makeToken('t1'), 'bucket-a');
    await tokenStore.saveToken('anthropic', makeToken('t2'), 'bucket-b');
    await tokenStore.saveToken('anthropic', makeToken('t3'), 'bucket-c');

    oauthManager.setSessionBucket('anthropic', 'bucket-a');

    const handler = new BucketFailoverHandlerImpl(
      ['bucket-a', 'bucket-b', 'bucket-c'],
      'anthropic',
      oauthManager,
    );

    // Act & Assert: Should iterate in exact profile order
    const first = await handler.tryFailover();
    expect(first).toBe(true);
    expect(handler.getCurrentBucket()).toBe('bucket-b'); // Next after bucket-a

    const second = await handler.tryFailover();
    expect(second).toBe(true);
    expect(handler.getCurrentBucket()).toBe('bucket-c'); // Next after bucket-b
  });
});
