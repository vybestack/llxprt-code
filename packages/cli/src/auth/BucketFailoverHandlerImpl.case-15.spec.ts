/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import { BucketFailoverHandlerImpl } from './BucketFailoverHandlerImpl.js';
import { createBucketFailoverFixture } from './BucketFailoverHandlerImpl.test-helpers.js';

describe('BucketFailoverHandlerImpl #15', () => {
  it('handles empty buckets array gracefully', async () => {
    const { oauthManager } = createBucketFailoverFixture();

    const setSessionBucketSpy = vi.spyOn(oauthManager, 'setSessionBucket');

    const handler = new BucketFailoverHandlerImpl(
      [],
      'anthropic',
      oauthManager,
    );

    handler.reset();

    expect(handler.getCurrentBucket()).toBeUndefined();
    expect(setSessionBucketSpy).not.toHaveBeenCalled();
  });
});
