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

describe('BucketFailoverHandlerImpl #21', () => {
  /**
   * @requirement REQ-1598-CL04
   * @pseudocode bucket-classification.md lines 16-19
   * Test that token-store read errors are classified as no-token
   */
  it('should classify token-store error as no-token', async () => {
    const { tokenStore, oauthManager } = createBucketFailoverFixture();

    // Save a token so the null-token path won't trigger first
    await tokenStore.saveToken('anthropic', makeToken('t1'), 'bucket-a');
    await tokenStore.saveToken('anthropic', makeToken('t2'), 'bucket-b');

    oauthManager.setSessionBucket('anthropic', 'bucket-a');

    // Mock the token store's getToken to throw for bucket-a
    // This exercises the catch block in Pass 1 (lines 137-143)
    const originalStoreGetToken = tokenStore.getToken.bind(tokenStore);
    vi.spyOn(tokenStore, 'getToken').mockImplementation(
      async (provider, bucket) => {
        if (bucket === 'bucket-a') {
          throw new Error('Token store read error');
        }
        return originalStoreGetToken(provider, bucket);
      },
    );

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
