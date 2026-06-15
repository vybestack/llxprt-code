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

describe('BucketFailoverHandlerImpl #30', () => {
  /**
   * @requirement REQ-1598-FL03
   * @pseudocode failover-handler.md lines 80-82
   * Test that Pass 2 classifies no-token when token is null
   */
  it('should classify no-token when token is null', async () => {
    const { tokenStore, oauthManager } = createBucketFailoverFixture();

    // Arrange: bucket-a current, bucket-b has no token, bucket-c valid
    await tokenStore.saveToken('anthropic', makeToken('t1'), 'bucket-a');
    // bucket-b has no token
    await tokenStore.saveToken('anthropic', makeToken('t3'), 'bucket-c');

    oauthManager.setSessionBucket('anthropic', 'bucket-a');

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
