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

describe('BucketFailoverHandlerImpl #4', () => {
  it('skips buckets with missing tokens and updates session bucket on success', async () => {
    const { tokenStore, oauthManager } = createBucketFailoverFixture();

    await tokenStore.saveToken('anthropic', makeToken('t1'), 'bucket-a');
    await tokenStore.saveToken('anthropic', makeToken('t3'), 'bucket-c');

    oauthManager.setSessionBucket('anthropic', 'bucket-a');

    const handler = new BucketFailoverHandlerImpl(
      ['bucket-a', 'bucket-b', 'bucket-c'],
      'anthropic',
      oauthManager,
    );

    const result = await handler.tryFailover();

    expect(result).toBe(true);
    expect(handler.getCurrentBucket()).toBe('bucket-c');
    expect(oauthManager.getSessionBucket('anthropic')).toBe('bucket-c');
  });
});
