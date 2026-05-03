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

describe('BucketFailoverHandlerImpl #46', () => {
  it('coalesces concurrent pass-3 foreground reauth for the same bucket', async () => {
    // Arrange
    const tokenStore = new MemoryTokenStore();

    // Current bucket starts with no token to force pass-3 foreground auth.

    let releaseForegroundAuth: (() => void) | undefined;
    const foregroundAuthGate = new Promise<void>((resolve) => {
      releaseForegroundAuth = resolve;
    });

    const oauthManager = {
      getOAuthToken: vi.fn(async (_provider: string, bucket?: string) =>
        tokenStore.getToken('anthropic', bucket),
      ),
      getTokenStore: vi.fn(() => tokenStore),
      setSessionBucket: vi.fn(),
      getSessionBucket: vi.fn(() => 'bucket-a'),
      authenticate: vi.fn(async (_provider: string, bucket?: string) => {
        await foregroundAuthGate;
        await tokenStore.saveToken(
          'anthropic',
          makeToken('pass3-token'),
          bucket ?? 'default',
        );
      }),
      authenticateMultipleBuckets: vi.fn(async () => undefined),
    };

    const handler = new BucketFailoverHandlerImpl(
      ['bucket-a'],
      'anthropic',
      oauthManager as unknown as OAuthManager,
    );

    // Act: Launch two failovers concurrently that both need pass-3 reauth.
    const first = handler.tryFailover({ triggeringStatus: 401 });
    const second = handler.tryFailover({ triggeringStatus: 401 });

    // Allow the shared pass-3 authenticate call to complete.
    releaseForegroundAuth?.();

    // Assert: both calls succeed but only one foreground authenticate occurs.
    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(true);
    expect(oauthManager.authenticate).toHaveBeenCalledTimes(1);
    expect(oauthManager.authenticate).toHaveBeenCalledWith(
      'anthropic',
      'bucket-a',
    );
  });
});
