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

describe('BucketFailoverHandlerImpl #6', () => {
  it('wraps around to earlier buckets when later buckets are exhausted', async () => {
    const { tokenStore, oauthManager } = createBucketFailoverFixture();

    await tokenStore.saveToken('anthropic', makeToken('t1'), 'bucket-a');
    await tokenStore.saveToken('anthropic', makeToken('t3'), 'bucket-c');

    // Start on bucket-c (the last one)
    oauthManager.setSessionBucket('anthropic', 'bucket-c');

    const handler = new BucketFailoverHandlerImpl(
      ['bucket-a', 'bucket-b', 'bucket-c'],
      'anthropic',
      oauthManager,
    );

    const result = await handler.tryFailover();

    expect(result).toBe(true);
    expect(handler.getCurrentBucket()).toBe('bucket-a');
    expect(oauthManager.getSessionBucket('anthropic')).toBe('bucket-a');
  });
});
