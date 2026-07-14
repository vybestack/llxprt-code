/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import type { OAuthToken } from '@vybestack/llxprt-code-auth';
import { BucketFailoverHandlerImpl } from './BucketFailoverHandlerImpl.js';
import {
  makeToken,
  MemoryTokenStore,
} from './BucketFailoverHandlerImpl.test-helpers.js';
import type { BucketFailoverOAuthManagerLike } from './types.js';

class PendingLookupTokenStore extends MemoryTokenStore {
  constructor(
    private readonly pendingLookup: Promise<OAuthToken | null>,
    private readonly lookupStarted: () => void,
  ) {
    super();
  }

  override async getToken(
    provider: string,
    bucket?: string,
  ): Promise<OAuthToken | null> {
    if (bucket === 'bucket-b') {
      this.lookupStarted();
      return this.pendingLookup;
    }
    return super.getToken(provider, bucket);
  }
}

describe('BucketFailoverHandlerImpl #50', () => {
  it('does not switch the active bucket when an aborted token lookup later resolves', async () => {
    let resolveLookup: ((token: OAuthToken | null) => void) | undefined;
    const pendingLookup = new Promise<OAuthToken | null>((resolve) => {
      resolveLookup = resolve;
    });
    let notifyLookupStarted: (() => void) | undefined;
    const lookupStarted = new Promise<void>((resolve) => {
      notifyLookupStarted = resolve;
    });
    const tokenStore = new PendingLookupTokenStore(pendingLookup, () =>
      notifyLookupStarted?.(),
    );
    let sessionBucket = 'bucket-a';
    let sessionWriteCount = 0;
    const oauthManager: BucketFailoverOAuthManagerLike = {
      getSessionBucket: () => sessionBucket,
      setSessionBucket: (_provider, bucket) => {
        sessionWriteCount++;
        sessionBucket = bucket;
      },
      getOAuthToken: (_provider, bucket) =>
        tokenStore.getToken('anthropic', bucket),
      authenticate: async () => undefined,
      authenticateMultipleBuckets: async () => undefined,
      getTokenStore: () => tokenStore,
      forceRefreshToken: async () => null,
    };
    const handler = new BucketFailoverHandlerImpl(
      ['bucket-a', 'bucket-b'],
      'anthropic',
      oauthManager,
    );
    const controller = new AbortController();
    const failover = handler.tryFailover({
      triggeringStatus: 429,
      signal: controller.signal,
    });

    await lookupStarted;
    controller.abort();
    await expect(failover).rejects.toMatchObject({ name: 'AbortError' });
    expect(resolveLookup).toBeTypeOf('function');
    resolveLookup?.(makeToken('late-token'));
    await pendingLookup;
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect({
      handlerBucket: handler.getCurrentBucket(),
      sessionBucket,
      sessionWriteCount,
    }).toStrictEqual({
      handlerBucket: 'bucket-a',
      sessionBucket: 'bucket-a',
      sessionWriteCount: 0,
    });
  });
});
