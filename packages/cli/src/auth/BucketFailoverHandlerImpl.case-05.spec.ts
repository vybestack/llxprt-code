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

describe('BucketFailoverHandlerImpl #5', () => {
  it('returns false when no further buckets are usable', async () => {
    const { tokenStore, oauthManager } = createBucketFailoverFixture();

    await tokenStore.saveToken('anthropic', makeToken('t1'), 'bucket-a');
    oauthManager.setSessionBucket('anthropic', 'bucket-a');

    // Phase 4: Mock authenticate to fail - no token available for bucket-b
    // Pass 3 foreground reauth will attempt authenticate for bucket-b (no-token)
    // The mock must be set BEFORE creating the handler
    const authenticateSpy = vi
      .spyOn(oauthManager, 'authenticate')
      .mockImplementation(async () => {
        // Simulate user canceling auth or auth failure - do not save token
        throw new Error('Authentication failed');
      });

    const handler = new BucketFailoverHandlerImpl(
      ['bucket-a', 'bucket-b'],
      'anthropic',
      oauthManager,
    );

    const result = await handler.tryFailover();

    expect(result).toBe(false);
    expect(handler.getCurrentBucket()).toBe('bucket-a');
    expect(oauthManager.getSessionBucket('anthropic')).toBe('bucket-a');
    // Verify authenticate was called (tried to reauth bucket-b)
    expect(authenticateSpy).toHaveBeenCalled();
  });
});
