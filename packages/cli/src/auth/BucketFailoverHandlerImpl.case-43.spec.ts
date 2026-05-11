/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import { BucketFailoverHandlerImpl } from './BucketFailoverHandlerImpl.js';
import { OAuthManager } from './oauth-manager.js';
import { MemoryTokenStore } from './BucketFailoverHandlerImpl.test-helpers.js';

describe('BucketFailoverHandlerImpl #43', () => {
  it('coalesces concurrent ensureBucketsAuthenticated calls into one in-flight auth run', async () => {
    // Arrange
    const tokenStore = new MemoryTokenStore();

    let resolveAuthRun: (() => void) | undefined;
    const authRunPromise = new Promise<void>((resolve) => {
      resolveAuthRun = resolve;
    });

    const oauthManager = {
      getOAuthToken: vi.fn(async () => null),
      getTokenStore: vi.fn(() => tokenStore),
      setSessionBucket: vi.fn(),
      getSessionBucket: vi.fn(() => undefined),
      authenticate: vi.fn(async () => {}),
      authenticateMultipleBuckets: vi.fn(async () => authRunPromise),
    };

    const handler = new BucketFailoverHandlerImpl(
      ['bucket-a', 'bucket-b', 'bucket-c'],
      'anthropic',
      oauthManager as unknown as OAuthManager,
    );

    // Act
    const first = handler.ensureBucketsAuthenticated();
    const second = handler.ensureBucketsAuthenticated();

    // Assert (before completion): only one underlying auth run started
    expect(oauthManager.authenticateMultipleBuckets).toHaveBeenCalledTimes(1);

    // Complete in-flight run and verify both callers resolve
    resolveAuthRun?.();
    await Promise.all([first, second]);
    expect(oauthManager.authenticateMultipleBuckets).toHaveBeenCalledTimes(1);
  });
});
