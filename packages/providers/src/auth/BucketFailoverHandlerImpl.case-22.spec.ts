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

describe('BucketFailoverHandlerImpl #22', () => {
  /**
   * @requirement REQ-1598-CL09
   * @pseudocode error-reporting.md lines 17-18
   * Test that lastFailoverReasons is cleared at start of tryFailover
   */
  it('should clear lastFailoverReasons at start of tryFailover', async () => {
    const { tokenStore, oauthManager } = createBucketFailoverFixture();

    await tokenStore.saveToken('anthropic', makeToken('t1'), 'bucket-a');
    await tokenStore.saveToken('anthropic', makeToken('t2'), 'bucket-b');

    oauthManager.setSessionBucket('anthropic', 'bucket-a');

    const handler = new BucketFailoverHandlerImpl(
      ['bucket-a', 'bucket-b'],
      'anthropic',
      oauthManager,
    );

    // First call: establish some reasons
    await handler.tryFailover({ triggeringStatus: 429 });
    const firstReasons = handler.getLastFailoverReasons();
    expect(firstReasons['bucket-a']).toBe('quota-exhausted');

    // Reset session to allow retry
    handler.resetSession();

    // Second call: reasons should be cleared
    await handler.tryFailover();
    const secondReasons = handler.getLastFailoverReasons();
    // Should not have reasons from first call
    expect(secondReasons).toBeDefined();
    // First call had bucket-a as quota-exhausted, second call should have different/new reasons
    expect(secondReasons).not.toStrictEqual(firstReasons);
  });
});
