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

describe('BucketFailoverHandlerImpl #7', () => {
  it('tries all other buckets before giving up', async () => {
    const { tokenStore, oauthManager } = createBucketFailoverFixture();

    // Only the current bucket has a token; no other bucket has one
    await tokenStore.saveToken('anthropic', makeToken('t2'), 'bucket-b');
    oauthManager.setSessionBucket('anthropic', 'bucket-b');

    // Phase 4: Mock authenticate to fail - no tokens available for bucket-a or bucket-c
    // Pass 3 foreground reauth will attempt authenticate but should fail
    // The mock must be set BEFORE creating the handler
    const authenticateSpy = vi
      .spyOn(oauthManager, 'authenticate')
      .mockImplementation(async () => {
        // Simulate user canceling auth or auth failure - do not save token
        throw new Error('Authentication failed');
      });

    const handler = new BucketFailoverHandlerImpl(
      ['bucket-a', 'bucket-b', 'bucket-c'],
      'anthropic',
      oauthManager,
    );

    const result = await handler.tryFailover();

    expect(result).toBe(false);
    // Should remain on the current bucket since all others failed
    expect(handler.getCurrentBucket()).toBe('bucket-b');
    // Verify authenticate was called (tried to reauth bucket-a or bucket-c)
    expect(authenticateSpy).toHaveBeenCalled();
  });
});
