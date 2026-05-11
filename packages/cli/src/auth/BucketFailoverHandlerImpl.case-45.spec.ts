/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import { BucketFailoverHandlerImpl } from './BucketFailoverHandlerImpl.js';
import { OAuthManager } from './oauth-manager.js';
import {
  makeToken,
  MemoryTokenStore,
} from './BucketFailoverHandlerImpl.test-helpers.js';

describe('BucketFailoverHandlerImpl #45', () => {
  it('reuses token from in-flight eager auth in tryFailover pass 3 without duplicate authenticate call', async () => {
    // Arrange
    const tokenStore = new MemoryTokenStore();

    let releaseEagerAuth: (() => void) | undefined;
    const eagerAuthPromise = new Promise<void>((resolve) => {
      releaseEagerAuth = resolve;
    });

    const oauthManager = {
      getOAuthToken: vi.fn(async (_provider: string, bucket?: string) =>
        tokenStore.getToken('anthropic', bucket),
      ),
      getTokenStore: vi.fn(() => tokenStore),
      setSessionBucket: vi.fn(),
      getSessionBucket: vi.fn(() => 'bucket-a'),
      authenticate: vi.fn(async () => {
        throw new Error('pass-3 authenticate should not be called');
      }),
      authenticateMultipleBuckets: vi.fn(async () => {
        await eagerAuthPromise;
        await tokenStore.saveToken(
          'anthropic',
          makeToken('eager-token'),
          'bucket-b',
        );
      }),
    };

    const handler = new BucketFailoverHandlerImpl(
      ['bucket-a', 'bucket-b'],
      'anthropic',
      oauthManager as unknown as OAuthManager,
    );

    // Start eager auth and leave it in-flight while failover starts
    const ensurePromise = handler.ensureBucketsAuthenticated();
    const failoverPromise = handler.tryFailover({ triggeringStatus: 401 });

    releaseEagerAuth?.();
    await ensurePromise;

    // Assert
    await expect(failoverPromise).resolves.toBe(true);
    expect(handler.getCurrentBucket()).toBe('bucket-b');
    expect(oauthManager.authenticate).not.toHaveBeenCalled();
    expect(oauthManager.setSessionBucket).toHaveBeenCalledWith(
      'anthropic',
      'bucket-b',
      undefined,
    );
  });
});
