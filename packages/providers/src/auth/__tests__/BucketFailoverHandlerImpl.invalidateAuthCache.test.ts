/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('@vybestack/llxprt-code-auth', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@vybestack/llxprt-code-auth')>();
  return {
    ...actual,
    flushRuntimeAuthScope: vi.fn(),
  };
});

import { flushRuntimeAuthScope } from '@vybestack/llxprt-code-auth';
import type { OAuthTokenRequestMetadata } from '@vybestack/llxprt-code-auth';
import { BucketFailoverHandlerImpl } from '../BucketFailoverHandlerImpl.js';
import type { BucketFailoverOAuthManagerLike } from '../types.js';

describe('BucketFailoverHandlerImpl.invalidateAuthCache', () => {
  it('rejects with cancellation when failover is pending and the request aborts', async () => {
    const oauthManager: BucketFailoverOAuthManagerLike = {
      getSessionBucket: vi.fn().mockReturnValue(undefined),
      setSessionBucket: vi.fn(),
      getTokenStore: vi.fn().mockReturnValue({
        getToken: () => new Promise<never>(() => {}),
      }),
      getOAuthToken: vi.fn(),
      authenticate: vi.fn(),
      authenticateMultipleBuckets: vi.fn(),
      forceRefreshToken: vi.fn(),
    };
    const controller = new AbortController();
    const handler = new BucketFailoverHandlerImpl(
      ['default'],
      'anthropic',
      oauthManager,
    );

    const failover = handler.tryFailover({
      triggeringStatus: 500,
      signal: controller.signal,
    });
    controller.abort(new Error('request deadline expired'));

    await expect(failover).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('flushes the runtime auth scope for unbucketed profiles', () => {
    const oauthManager: BucketFailoverOAuthManagerLike = {
      getSessionBucket: vi.fn().mockReturnValue(undefined),
      setSessionBucket: vi.fn(),
      getTokenStore: vi.fn(),
      getOAuthToken: vi.fn(),
      authenticate: vi.fn(),
      authenticateMultipleBuckets: vi.fn(),
      forceRefreshToken: vi.fn(),
    };

    const metadata: OAuthTokenRequestMetadata = {
      profileId: 'opusthinking',
      providerId: 'anthropic',
      runtimeMetadata: { source: 'test' },
    };

    const handler = new BucketFailoverHandlerImpl(
      ['default'],
      'anthropic',
      oauthManager,
      metadata,
    );

    handler.invalidateAuthCache('runtime-1739');

    expect(flushRuntimeAuthScope).toHaveBeenCalledWith('runtime-1739');
  });
});
