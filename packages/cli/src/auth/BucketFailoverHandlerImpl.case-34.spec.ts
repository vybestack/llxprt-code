/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import { BucketFailoverHandlerImpl } from './BucketFailoverHandlerImpl.js';
import { createBucketFailoverFixture } from './BucketFailoverHandlerImpl.test-helpers.js';

describe('BucketFailoverHandlerImpl #34', () => {
  /**
   * @requirement REQ-1598-FL08, FL09
   * @pseudocode failover-handler.md lines 145-149
   * Test that Pass 3 classifies reauth-failed if token null after reauth
   */
  it('should classify reauth-failed if token is null after reauth', async () => {
    const { oauthManager } = createBucketFailoverFixture();

    // Arrange: All buckets have no tokens
    oauthManager.setSessionBucket('anthropic', 'bucket-a');

    const handler = new BucketFailoverHandlerImpl(
      ['bucket-a', 'bucket-b', 'bucket-c'],
      'anthropic',
      oauthManager,
    );

    // Mock authenticate to succeed but NOT save token (simulates auth success with null token)
    oauthManager.authenticate = vi.fn(
      async (_provider: string, _bucket?: string) => {
        // Do nothing - auth "succeeds" but no token is saved
      },
    );

    // Act: Trigger failover
    const result = await handler.tryFailover();

    // Assert: Should classify bucket-b as reauth-failed
    const reasons = handler.getLastFailoverReasons();
    expect(reasons['bucket-b']).toBe('reauth-failed');
    expect(result).toBe(false); // No buckets succeeded
  });
});
