/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import { BucketFailoverHandlerImpl } from './BucketFailoverHandlerImpl.js';
import { OAuthManager } from './oauth-manager.js';
import { MemoryTokenStore } from './BucketFailoverHandlerImpl.test-helpers.js';

describe('BucketFailoverHandlerImpl #44', () => {
  it('clears in-flight state after failure so a later call can retry', async () => {
    // Arrange
    const tokenStore = new MemoryTokenStore();

    const oauthManager = {
      getOAuthToken: vi.fn(async () => null),
      getTokenStore: vi.fn(() => tokenStore),
      setSessionBucket: vi.fn(),
      getSessionBucket: vi.fn(() => undefined),
      authenticate: vi.fn(async () => {}),
      authenticateMultipleBuckets: vi
        .fn()
        .mockRejectedValueOnce(new Error('first auth attempt failed'))
        .mockResolvedValueOnce(undefined),
    };

    const handler = new BucketFailoverHandlerImpl(
      ['bucket-a', 'bucket-b'],
      'anthropic',
      oauthManager as unknown as OAuthManager,
    );

    // Act / Assert
    await expect(handler.ensureBucketsAuthenticated()).rejects.toThrow(
      'first auth attempt failed',
    );

    await expect(handler.ensureBucketsAuthenticated()).resolves.toBeUndefined();
    expect(oauthManager.authenticateMultipleBuckets).toHaveBeenCalledTimes(2);
  });
});
