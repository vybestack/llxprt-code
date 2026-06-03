/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import { BucketFailoverHandlerImpl } from './BucketFailoverHandlerImpl.js';
import { OAuthManager } from './oauth-manager.js';
import { MemoryTokenStore } from './BucketFailoverHandlerImpl.test-helpers.js';

describe('BucketFailoverHandlerImpl #42', () => {
  it('should be a no-op when handler has only one bucket', async () => {
    // Arrange
    const tokenStore = new MemoryTokenStore();
    const oauthManager = {
      getOAuthToken: vi.fn(async () => null),
      getTokenStore: vi.fn(() => tokenStore),
      setSessionBucket: vi.fn(),
      getSessionBucket: vi.fn(() => undefined),
      authenticate: vi.fn(async () => {}),
      authenticateMultipleBuckets: vi.fn(async () => {}),
    };

    const handler = new BucketFailoverHandlerImpl(
      ['bucket-a'],
      'anthropic',
      oauthManager as unknown as OAuthManager,
    );

    // Act
    await handler.ensureBucketsAuthenticated();

    // Assert
    expect(oauthManager.authenticateMultipleBuckets).not.toHaveBeenCalled();
  });
});
