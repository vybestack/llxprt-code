/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { BucketFailoverHandlerImpl } from './BucketFailoverHandlerImpl.js';
import type { BucketFailureReason } from '@vybestack/llxprt-code-core';
import {
  createBucketFailoverFixture,
  makeToken,
} from './BucketFailoverHandlerImpl.test-helpers.js';

describe('BucketFailoverHandlerImpl #23', () => {
  /**
   * @requirement REQ-1598-IC09
   * @pseudocode error-reporting.md lines 14-15
   * Test that getLastFailoverReasons returns immutable copy
   */
  it('should return immutable copy from getLastFailoverReasons', async () => {
    const { tokenStore, oauthManager } = createBucketFailoverFixture();

    await tokenStore.saveToken('anthropic', makeToken('t1'), 'bucket-a');
    await tokenStore.saveToken('anthropic', makeToken('t2'), 'bucket-b');

    oauthManager.setSessionBucket('anthropic', 'bucket-a');

    const handler = new BucketFailoverHandlerImpl(
      ['bucket-a', 'bucket-b'],
      'anthropic',
      oauthManager,
    );

    // Call tryFailover to establish reasons
    await handler.tryFailover({ triggeringStatus: 429 });

    // Get reasons and try to mutate
    const reasons = handler.getLastFailoverReasons();
    expect(reasons).toBeDefined();

    const originalBucketAReason = reasons['bucket-a'];
    // Try to mutate the returned object
    reasons['bucket-a'] = 'no-token' as BucketFailureReason;

    // Get reasons again - should not be affected by mutation
    const reasonsAgain = handler.getLastFailoverReasons();
    expect(reasonsAgain['bucket-a']).toBe(originalBucketAReason);
    expect(reasonsAgain['bucket-a']).not.toBe('no-token');
  });
});
