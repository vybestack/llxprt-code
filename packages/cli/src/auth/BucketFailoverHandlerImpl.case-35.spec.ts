/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import { BucketFailoverHandlerImpl } from './BucketFailoverHandlerImpl.js';
import { createBucketFailoverFixture } from './BucketFailoverHandlerImpl.test-helpers.js';

describe('BucketFailoverHandlerImpl #35', () => {
  /**
   * @requirement REQ-1598-FL10
   * @pseudocode failover-handler.md lines 161-165
   * Test that Pass 3 classifies reauth-failed if authenticate throws
   */
  it('should classify reauth-failed if authenticate throws', async () => {
    const { oauthManager } = createBucketFailoverFixture();

    // Arrange: All buckets have no tokens
    oauthManager.setSessionBucket('anthropic', 'bucket-a');

    const handler = new BucketFailoverHandlerImpl(
      ['bucket-a', 'bucket-b', 'bucket-c'],
      'anthropic',
      oauthManager,
    );

    // Mock authenticate to throw
    oauthManager.authenticate = vi.fn(async () => {
      throw new Error('User cancelled authentication');
    });

    // Act: Trigger failover
    const result = await handler.tryFailover();

    // Assert: Should classify bucket-b as reauth-failed
    const reasons = handler.getLastFailoverReasons();
    expect(reasons['bucket-b']).toBe('reauth-failed');
    expect(result).toBe(false); // No buckets succeeded
  });
});
