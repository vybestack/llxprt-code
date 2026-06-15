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

describe('BucketFailoverHandlerImpl #13', () => {
  it('clears triedBucketsThisSession so all buckets can be retried', async () => {
    const { tokenStore, oauthManager } = createBucketFailoverFixture();

    await tokenStore.saveToken('anthropic', makeToken('t1'), 'bucket-a');
    await tokenStore.saveToken('anthropic', makeToken('t2'), 'bucket-b');

    oauthManager.setSessionBucket('anthropic', 'bucket-a');

    const handler = new BucketFailoverHandlerImpl(
      ['bucket-a', 'bucket-b'],
      'anthropic',
      oauthManager,
    );

    await handler.tryFailover(); // switches to bucket-b
    const failoverAfterAllTried = await handler.tryFailover(); // all tried, returns false
    expect(failoverAfterAllTried).toBe(false);

    handler.reset();

    const canFailoverAgain = await handler.tryFailover();
    expect(canFailoverAgain).toBe(true);
  });
});
