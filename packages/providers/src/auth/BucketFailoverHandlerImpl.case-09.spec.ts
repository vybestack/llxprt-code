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

describe('BucketFailoverHandlerImpl #9', () => {
  it('prevents infinite cycling when all buckets have valid tokens', async () => {
    const { tokenStore, oauthManager } = createBucketFailoverFixture();

    await tokenStore.saveToken('anthropic', makeToken('t1'), 'bucket-a');
    await tokenStore.saveToken('anthropic', makeToken('t2'), 'bucket-b');

    oauthManager.setSessionBucket('anthropic', 'bucket-a');

    const handler = new BucketFailoverHandlerImpl(
      ['bucket-a', 'bucket-b'],
      'anthropic',
      oauthManager,
    );

    // First failover: switches to bucket-b (valid token)
    const first = await handler.tryFailover();
    expect(first).toBe(true);
    expect(handler.getCurrentBucket()).toBe('bucket-b');

    // Second failover without reset: bucket-a already tried this session, returns false
    const second = await handler.tryFailover();
    expect(second).toBe(false);
    // Should remain on bucket-b, not cycle back to bucket-a
    expect(handler.getCurrentBucket()).toBe('bucket-b');
  });
});
