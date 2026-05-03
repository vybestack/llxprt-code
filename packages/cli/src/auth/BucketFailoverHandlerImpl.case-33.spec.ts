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

describe('BucketFailoverHandlerImpl #33', () => {
  /**
   * @requirement REQ-1598-FL08
   * @pseudocode failover-handler.md lines 143-159
   * Test that Pass 3 validates token after reauth success
   */
  it('should validate token after reauth success', async () => {
    const { tokenStore, oauthManager } = createBucketFailoverFixture();

    // Arrange: All buckets have no tokens
    oauthManager.setSessionBucket('anthropic', 'bucket-a');

    const handler = new BucketFailoverHandlerImpl(
      ['bucket-a', 'bucket-b'],
      'anthropic',
      oauthManager,
    );

    // Mock authenticate to succeed and save token
    oauthManager.authenticate = vi.fn(
      async (provider: string, bucket?: string) => {
        if (bucket === 'bucket-b') {
          await tokenStore.saveToken(
            'anthropic',
            makeToken('reauth-b'),
            bucket,
          );
        }
      },
    );

    // Act: Trigger failover
    const result = await handler.tryFailover();

    // Assert: Should validate token exists after reauth and switch
    expect(result).toBe(true);
    expect(handler.getCurrentBucket()).toBe('bucket-b');
    expect(oauthManager.getSessionBucket('anthropic')).toBe('bucket-b');

    // Verify token actually exists in store
    const token = await tokenStore.getToken('anthropic', 'bucket-b');
    expect(token).not.toBeNull();
    expect(token?.access_token).toBe('reauth-b');
  });
});
