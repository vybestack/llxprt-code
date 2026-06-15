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

describe('BucketFailoverHandlerImpl #8', () => {
  it('clears the tried-buckets tracking so failover can try buckets again', async () => {
    const { tokenStore, oauthManager } = createBucketFailoverFixture();

    await tokenStore.saveToken('anthropic', makeToken('t1'), 'bucket-a');
    await tokenStore.saveToken('anthropic', makeToken('t2'), 'bucket-b');

    oauthManager.setSessionBucket('anthropic', 'bucket-a');

    const handler = new BucketFailoverHandlerImpl(
      ['bucket-a', 'bucket-b'],
      'anthropic',
      oauthManager,
    );

    // First failover session: succeeds switching to bucket-b
    const firstResult = await handler.tryFailover();
    expect(firstResult).toBe(true);
    expect(handler.getCurrentBucket()).toBe('bucket-b');

    // Second tryFailover without resetSession: all buckets tried, returns false
    const secondResult = await handler.tryFailover();
    expect(secondResult).toBe(false);

    // After resetSession, failover can try buckets again
    handler.resetSession();
    const thirdResult = await handler.tryFailover();
    expect(thirdResult).toBe(true);
    expect(handler.getCurrentBucket()).toBe('bucket-a');
  });
});
