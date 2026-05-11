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

describe('BucketFailoverHandlerImpl #12', () => {
  it('resets to first bucket and restores session bucket to primary for fresh turn', async () => {
    const { tokenStore, oauthManager } = createBucketFailoverFixture();

    await tokenStore.saveToken('anthropic', makeToken('t1'), 'bucket-a');
    await tokenStore.saveToken('anthropic', makeToken('t2'), 'bucket-b');
    await tokenStore.saveToken('anthropic', makeToken('t3'), 'bucket-c');

    oauthManager.setSessionBucket('anthropic', 'bucket-a');

    const handler = new BucketFailoverHandlerImpl(
      ['bucket-a', 'bucket-b', 'bucket-c'],
      'anthropic',
      oauthManager,
    );

    await handler.tryFailover(); // switches to bucket-b

    expect(handler.getCurrentBucket()).toBe('bucket-b');
    expect(oauthManager.getSessionBucket('anthropic')).toBe('bucket-b');

    handler.reset();

    expect(handler.getCurrentBucket()).toBe('bucket-a');
    expect(oauthManager.getSessionBucket('anthropic')).toBe('bucket-a');
  });
});
