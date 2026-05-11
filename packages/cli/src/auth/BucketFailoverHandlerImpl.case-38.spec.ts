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

describe('BucketFailoverHandlerImpl #38', () => {
  /**
   * @requirement REQ-1598-FL08
   * @pseudocode failover-handler.md lines 150-159
   * Test that Pass 3 switches bucket after successful reauth with valid token
   */
  it('should switch bucket after successful reauth with valid token', async () => {
    const { tokenStore, oauthManager } = createBucketFailoverFixture();

    // Arrange: All buckets have no tokens
    oauthManager.setSessionBucket('anthropic', 'bucket-a');

    const handler = new BucketFailoverHandlerImpl(
      ['bucket-a', 'bucket-b'],
      'anthropic',
      oauthManager,
    );

    // Mock authenticate to succeed and save valid token
    const reauthToken = makeToken('reauth-success');
    oauthManager.authenticate = vi.fn(
      async (provider: string, bucket?: string) => {
        if (bucket === 'bucket-b') {
          await tokenStore.saveToken('anthropic', reauthToken, bucket);
        }
      },
    );

    // Act: Trigger failover
    const result = await handler.tryFailover();

    // Assert: Should switch to bucket-b and return true
    expect(result).toBe(true);
    expect(handler.getCurrentBucket()).toBe('bucket-b');
    expect(oauthManager.getSessionBucket('anthropic')).toBe('bucket-b');

    // Verify the token is the reauth token
    const storedToken = await tokenStore.getToken('anthropic', 'bucket-b');
    expect(storedToken?.access_token).toBe('reauth-success');
  });
});
