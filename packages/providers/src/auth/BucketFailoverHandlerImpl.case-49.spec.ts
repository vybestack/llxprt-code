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

describe('BucketFailoverHandlerImpl #49', () => {
  it('eagerly authenticates remaining buckets after successful pass-3 foreground reauth', async () => {
    // Arrange
    const tokenStore = new MemoryTokenStore();

    const oauthManager = {
      getOAuthToken: vi.fn((_provider: string, bucket?: string) =>
        tokenStore.getToken('anthropic', bucket),
      ),
      getTokenStore: vi.fn(() => tokenStore),
      setSessionBucket: vi.fn(),
      getSessionBucket: vi.fn(() => 'bucket-a'),
      authenticate: vi.fn(async (_p: string, bucket?: string) => {
        if (bucket === 'bucket-b') {
          await tokenStore.saveToken(
            'anthropic',
            makeToken('reauth-b'),
            bucket,
          );
        }
      }),
      authenticateMultipleBuckets: vi.fn(async () => {}),
    };

    const handler = new BucketFailoverHandlerImpl(
      ['bucket-a', 'bucket-b'],
      'anthropic',
      oauthManager as unknown as OAuthManager,
    );

    // Act
    const result = await handler.tryFailover({ triggeringStatus: 401 });

    // Assert
    expect(result).toBe(true);
    expect(handler.getCurrentBucket()).toBe('bucket-b');
    expect(oauthManager.authenticateMultipleBuckets).toHaveBeenCalledTimes(1);
    expect(oauthManager.authenticateMultipleBuckets).toHaveBeenCalledWith(
      'anthropic',
      ['bucket-a', 'bucket-b'],
      undefined,
    );
  });

  it('swallows eager auth failure after successful pass-3 reauth (best-effort)', async () => {
    // Arrange
    const tokenStore = new MemoryTokenStore();

    const oauthManager = {
      getOAuthToken: vi.fn((_provider: string, bucket?: string) =>
        tokenStore.getToken('anthropic', bucket),
      ),
      getTokenStore: vi.fn(() => tokenStore),
      setSessionBucket: vi.fn(),
      getSessionBucket: vi.fn(() => 'bucket-a'),
      authenticate: vi.fn(async (_p: string, bucket?: string) => {
        if (bucket === 'bucket-b') {
          await tokenStore.saveToken(
            'anthropic',
            makeToken('reauth-b'),
            bucket,
          );
        }
      }),
      authenticateMultipleBuckets: vi.fn(async () => {
        throw new Error('eager auth failed');
      }),
    };

    const handler = new BucketFailoverHandlerImpl(
      ['bucket-a', 'bucket-b'],
      'anthropic',
      oauthManager as unknown as OAuthManager,
    );

    // Act
    const result = await handler.tryFailover({ triggeringStatus: 401 });

    // Assert
    expect(result).toBe(true);
    expect(handler.getCurrentBucket()).toBe('bucket-b');
    expect(oauthManager.authenticateMultipleBuckets).toHaveBeenCalledTimes(1);
  });

  it('consolidates prompts so a later failover needs no second foreground reauth', async () => {
    // Arrange: three expired/unauthenticated buckets
    const tokenStore = new MemoryTokenStore();
    let sessionBucket: string | undefined = 'bucket-a';

    const oauthManager = {
      getOAuthToken: vi.fn((_provider: string, bucket?: string) =>
        tokenStore.getToken('anthropic', bucket),
      ),
      getTokenStore: vi.fn(() => tokenStore),
      setSessionBucket: vi.fn((_provider: string, bucket: string) => {
        sessionBucket = bucket;
      }),
      getSessionBucket: vi.fn(() => sessionBucket),
      authenticate: vi.fn(async (_p: string, bucket?: string) => {
        if (bucket === 'bucket-b') {
          await tokenStore.saveToken(
            'anthropic',
            makeToken('reauth-b'),
            bucket,
          );
        }
      }),
      // Eager auth authenticates the remaining unauthenticated buckets.
      authenticateMultipleBuckets: vi.fn(async () => {
        await tokenStore.saveToken(
          'anthropic',
          makeToken('eager-c'),
          'bucket-c',
        );
      }),
    };

    const handler = new BucketFailoverHandlerImpl(
      ['bucket-a', 'bucket-b', 'bucket-c'],
      'anthropic',
      oauthManager as unknown as OAuthManager,
    );

    // Act: first failover triggers a single foreground reauth (bucket-b)
    // plus eager auth of the rest (bucket-c).
    const firstResult = await handler.tryFailover({ triggeringStatus: 401 });

    // Act: bucket-b later hits quota, triggering a second failover.
    const secondResult = await handler.tryFailover({ triggeringStatus: 429 });

    // Assert: both failovers succeed and the second switches to the
    // already-authenticated bucket-c without any additional browser prompt.
    expect(firstResult).toBe(true);
    expect(secondResult).toBe(true);
    expect(handler.getCurrentBucket()).toBe('bucket-c');
    expect(oauthManager.authenticate).toHaveBeenCalledTimes(1);
    expect(oauthManager.authenticate).toHaveBeenCalledWith(
      'anthropic',
      'bucket-b',
      {
        signalAuthCompletion: false,
      },
    );
  });
});
