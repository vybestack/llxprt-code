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

describe('BucketFailoverHandlerImpl #16', () => {
  /**
   * @requirement REQ-1598-CL01
   * @pseudocode bucket-classification.md lines 8-10
   * Test that a 429 status is classified as quota-exhausted
   */
  it('should classify 429 as quota-exhausted', async () => {
    const { tokenStore, oauthManager } = createBucketFailoverFixture();

    await tokenStore.saveToken('anthropic', makeToken('t1'), 'bucket-a');
    await tokenStore.saveToken('anthropic', makeToken('t2'), 'bucket-b');

    oauthManager.setSessionBucket('anthropic', 'bucket-a');

    const handler = new BucketFailoverHandlerImpl(
      ['bucket-a', 'bucket-b'],
      'anthropic',
      oauthManager,
    );

    // Act: Call tryFailover with 429 status
    await handler.tryFailover({ triggeringStatus: 429 });

    // Assert: bucket-a should be classified as quota-exhausted
    const reasons = handler.getLastFailoverReasons();
    expect(reasons).toBeDefined();
    expect(reasons['bucket-a']).toBe('quota-exhausted');
  });
});
