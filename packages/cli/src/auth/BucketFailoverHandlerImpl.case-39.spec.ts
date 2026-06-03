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

describe('BucketFailoverHandlerImpl #39', () => {
  it('should allow reauth of the triggering bucket in single-bucket profiles', async () => {
    const { tokenStore, oauthManager } = createBucketFailoverFixture();

    // Scenario: Only one bucket, token expired, refresh failed.
    // Pass 1 classifies it as expired-refresh-failed AND adds it to
    // triedBucketsThisSession. Pass 3 must still consider it for reauth.
    const expiredToken = makeToken('expired-access');
    expiredToken.expiry = Math.floor(Date.now() / 1000) - 100;
    await tokenStore.saveToken('anthropic', expiredToken, 'only-bucket');
    oauthManager.setSessionBucket('anthropic', 'only-bucket');

    const handler = new BucketFailoverHandlerImpl(
      ['only-bucket'],
      'anthropic',
      oauthManager,
    );

    // Mock authenticate to save a fresh token
    const freshToken = makeToken('fresh-after-reauth');
    oauthManager.authenticate = vi.fn(
      async (_provider: string, bucket?: string) => {
        if (bucket === 'only-bucket') {
          await tokenStore.saveToken('anthropic', freshToken, bucket);
        }
      },
    );

    const result = await handler.tryFailover();

    expect(result).toBe(true);
    expect(handler.getCurrentBucket()).toBe('only-bucket');
    expect(oauthManager.authenticate).toHaveBeenCalledWith(
      'anthropic',
      'only-bucket',
    );
  });
});
