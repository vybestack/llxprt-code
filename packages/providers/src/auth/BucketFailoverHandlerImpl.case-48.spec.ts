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

describe('BucketFailoverHandlerImpl #48', () => {
  it('times out hanging authenticate in Pass 3 with configurable timeout, records reauth-timeout reason, returns false', async () => {
    const tokenStore = new MemoryTokenStore();

    let releaseAuthenticate: (() => void) | undefined;
    const authenticateGate = new Promise<void>((resolve) => {
      releaseAuthenticate = resolve;
    });

    const oauthManager = {
      getOAuthToken: vi.fn((_provider: string, bucket?: string) =>
        tokenStore.getToken('anthropic', bucket),
      ),
      getTokenStore: vi.fn(() => tokenStore),
      setSessionBucket: vi.fn(),
      getSessionBucket: vi.fn(() => 'bucket-a'),
      authenticate: vi.fn(async () => {
        await authenticateGate;
      }),
      authenticateMultipleBuckets: vi.fn(async () => {}),
    };

    const handler = new BucketFailoverHandlerImpl(
      ['bucket-a', 'bucket-b'],
      'anthropic',
      oauthManager as unknown as OAuthManager,
      undefined,
      { authRetryTimeoutMs: 100 },
    );

    const failoverPromise = handler.tryFailover({ triggeringStatus: 401 });

    const result = await failoverPromise;

    expect(result).toBe(false);
    expect(oauthManager.authenticate).toHaveBeenCalledWith(
      'anthropic',
      'bucket-b',
      { signalAuthCompletion: false },
    );
    expect(handler.getCurrentBucket()).toBe('bucket-a');
    const reasons = handler.getLastFailoverReasons();
    expect(reasons['bucket-b']).toBe('reauth-timeout');

    releaseAuthenticate?.();
  });

  it('uses default 30000ms timeout when authRetryTimeoutMs is not provided', () => {
    const tokenStore = new MemoryTokenStore();
    const oauthManager = {
      getOAuthToken: vi.fn(async () => null),
      getTokenStore: vi.fn(() => tokenStore),
      setSessionBucket: vi.fn(),
      getSessionBucket: vi.fn(() => 'bucket-a'),
      authenticate: vi.fn(async () => {}),
      authenticateMultipleBuckets: vi.fn(async () => {}),
    };

    const handler = new BucketFailoverHandlerImpl(
      ['bucket-a', 'bucket-b'],
      'anthropic',
      oauthManager as unknown as OAuthManager,
    );

    expect(handler.getAuthRetryTimeoutMs()).toBe(30000);
  });

  it('cleans up foregroundReauthInFlightByBucket entry after timeout', async () => {
    const tokenStore = new MemoryTokenStore();

    let releaseAuthenticate: (() => void) | undefined;
    const authenticateGate = new Promise<void>((resolve) => {
      releaseAuthenticate = resolve;
    });

    const oauthManager = {
      getOAuthToken: vi.fn((_provider: string, bucket?: string) =>
        tokenStore.getToken('anthropic', bucket),
      ),
      getTokenStore: vi.fn(() => tokenStore),
      setSessionBucket: vi.fn(),
      getSessionBucket: vi.fn(() => 'bucket-a'),
      authenticate: vi.fn(async () => {
        await authenticateGate;
      }),
      authenticateMultipleBuckets: vi.fn(async () => {}),
    };

    const handler = new BucketFailoverHandlerImpl(
      ['bucket-a', 'bucket-b'],
      'anthropic',
      oauthManager as unknown as OAuthManager,
      undefined,
      { authRetryTimeoutMs: 50 },
    );

    const result = await handler.tryFailover({ triggeringStatus: 401 });
    expect(result).toBe(false);

    const reasons = handler.getLastFailoverReasons();
    expect(reasons['bucket-b']).toBe('reauth-timeout');

    releaseAuthenticate?.();
    handler.resetSession();

    const retryResult = await handler.tryFailover({ triggeringStatus: 401 });
    expect(retryResult).toBe(false);
    expect(oauthManager.authenticate).toHaveBeenCalledTimes(2);
    expect(oauthManager.authenticate).toHaveBeenLastCalledWith(
      'anthropic',
      'bucket-b',
      { signalAuthCompletion: false },
    );
    expect(handler.getLastFailoverReasons()['bucket-b']).toBe('reauth-failed');
  });

  it('does not switch bucket on timeout even if authenticate eventually resolves', async () => {
    const tokenStore = new MemoryTokenStore();

    let resolveAuthenticate: (() => void) | undefined;
    const authenticateGate = new Promise<void>((resolve) => {
      resolveAuthenticate = resolve;
    });

    const oauthManager = {
      getOAuthToken: vi.fn((_provider: string, bucket?: string) =>
        tokenStore.getToken('anthropic', bucket),
      ),
      getTokenStore: vi.fn(() => tokenStore),
      setSessionBucket: vi.fn(),
      getSessionBucket: vi.fn(() => 'bucket-a'),
      authenticate: vi.fn(async () => {
        await authenticateGate;
        await tokenStore.saveToken(
          'anthropic',
          makeToken('late-token'),
          'bucket-b',
        );
      }),
      authenticateMultipleBuckets: vi.fn(async () => {}),
    };

    const handler = new BucketFailoverHandlerImpl(
      ['bucket-a', 'bucket-b'],
      'anthropic',
      oauthManager as unknown as OAuthManager,
      undefined,
      { authRetryTimeoutMs: 50 },
    );

    const failoverPromise = handler.tryFailover({ triggeringStatus: 401 });

    const result = await failoverPromise;
    expect(result).toBe(false);
    expect(handler.getCurrentBucket()).toBe('bucket-a');

    resolveAuthenticate?.();
  });
});
