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

describe('BucketFailoverHandlerImpl #17', () => {
  /**
   * @requirement REQ-1598-CL02
   * Test that 401/403 with non-expired token is treated as auth failure, not skipped
   */
  it('should classify 401 with valid token as expired-refresh-failed for reauth', async () => {
    const { tokenStore, oauthManager } = createBucketFailoverFixture();

    // Token is still valid (not expired) but server returned 401 (revoked)
    await tokenStore.saveToken('anthropic', makeToken('t1'), 'bucket-a');
    await tokenStore.saveToken('anthropic', makeToken('t2'), 'bucket-b');

    oauthManager.setSessionBucket('anthropic', 'bucket-a');

    // Mock refresh to fail (token was revoked server-side)
    const provider = oauthManager.getProvider('anthropic');
    expect(provider).toBeDefined();
    // eslint-disable-next-line vitest/no-conditional-in-test -- intentional: narrowing/filter/parameterized-test context
    if (provider) {
      provider.refreshToken = vi.fn(async () => null);
    }

    const handler = new BucketFailoverHandlerImpl(
      ['bucket-a', 'bucket-b'],
      'anthropic',
      oauthManager,
    );

    // Act: Call tryFailover with 401 status
    const result = await handler.tryFailover({ triggeringStatus: 401 });

    // Assert: bucket-a should be classified as expired-refresh-failed (not 'skipped')
    const reasons = handler.getLastFailoverReasons();
    expect(reasons).toBeDefined();
    expect(reasons['bucket-a']).toBe('expired-refresh-failed');
    // Should have switched to bucket-b
    expect(result).toBe(true);
    expect(handler.getCurrentBucket()).toBe('bucket-b');
  });
});
