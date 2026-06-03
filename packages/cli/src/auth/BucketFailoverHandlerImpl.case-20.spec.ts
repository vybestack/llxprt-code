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

describe('BucketFailoverHandlerImpl #20', () => {
  /**
   * @requirement REQ-1598-CL03
   * @pseudocode bucket-classification.md lines 22-24
   * Test that null token is classified as no-token
   */
  it('should classify null token as no-token', async () => {
    const { tokenStore, oauthManager } = createBucketFailoverFixture();

    // bucket-a has no token
    await tokenStore.saveToken('anthropic', makeToken('t2'), 'bucket-b');

    oauthManager.setSessionBucket('anthropic', 'bucket-a');

    const handler = new BucketFailoverHandlerImpl(
      ['bucket-a', 'bucket-b'],
      'anthropic',
      oauthManager,
    );

    // Act: Call tryFailover
    const result = await handler.tryFailover();

    // Assert: bucket-a should be classified as no-token
    const reasons = handler.getLastFailoverReasons();
    expect(reasons).toBeDefined();
    expect(reasons['bucket-a']).toBe('no-token');
    // Should have switched to bucket-b
    expect(result).toBe(true);
    expect(handler.getCurrentBucket()).toBe('bucket-b');
  });
});
