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

describe('BucketFailoverHandlerImpl #47', () => {
  it('re-checks late-started eager auth before pass-3 foreground reauth', async () => {
    // Arrange
    const tokenStore = new MemoryTokenStore();

    let releaseFirstGetOAuthToken: (() => void) | undefined;
    const firstGetOAuthTokenGate = new Promise<void>((resolve) => {
      releaseFirstGetOAuthToken = resolve;
    });

    let releaseEagerAuth: (() => void) | undefined;
    const eagerAuthGate = new Promise<void>((resolve) => {
      releaseEagerAuth = resolve;
    });

    let getOAuthTokenCalls = 0;
    const oauthManager = {
      getOAuthToken: vi.fn(async (_provider: string, bucket?: string) => {
        getOAuthTokenCalls += 1;
        if (getOAuthTokenCalls === 1) {
          await firstGetOAuthTokenGate;
          return null;
        }
        return tokenStore.getToken('anthropic', bucket);
      }),
      getTokenStore: vi.fn(() => tokenStore),
      setSessionBucket: vi.fn(),
      getSessionBucket: vi.fn(() => 'bucket-b'),
      authenticate: vi.fn(async (_provider: string, bucket?: string) => {
        await tokenStore.saveToken(
          'anthropic',
          makeToken('pass3-token'),
          bucket ?? 'default',
        );
      }),
      authenticateMultipleBuckets: vi.fn(async () => {
        await eagerAuthGate;
        await tokenStore.saveToken(
          'anthropic',
          makeToken('late-eager-token'),
          'bucket-a',
        );
      }),
    };

    const handler = new BucketFailoverHandlerImpl(
      ['bucket-a', 'bucket-b'],
      'anthropic',
      oauthManager as unknown as OAuthManager,
    );

    const failoverPromise = handler.tryFailover({ triggeringStatus: 401 });

    // Start eager auth after pass-3 started, while first token check is blocked.
    const ensurePromise = handler.ensureBucketsAuthenticated();

    // Allow first check to complete with null so pass-3 executes late in-flight re-check.
    releaseFirstGetOAuthToken?.();

    // Keep eager auth in-flight until pass-3 reaches late guard.
    await Promise.resolve();
    releaseEagerAuth?.();
    await ensurePromise;

    await expect(failoverPromise).resolves.toBe(true);
    expect(getOAuthTokenCalls).toBe(2);
    expect(oauthManager.authenticate).not.toHaveBeenCalled();
    expect(handler.getCurrentBucket()).toBe('bucket-a');
  });
});
