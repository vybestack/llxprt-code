/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MemoryTokenStore,
  makeToken,
  createTestProvider,
  createTestOAuthManager,
  createBucketFailoverHandler,
} from './test-utils.js';
import type { OAuthTokenRequestMetadata } from '@vybestack/llxprt-code-core';

const PROVIDER = 'anthropic';

describe('Subagent isolation behavioral scenarios', () => {
  let tokenStore: MemoryTokenStore;

  beforeEach(() => {
    tokenStore = new MemoryTokenStore();
  });

  it('SA-01: Subagent gets scoped session bucket', async () => {
    const provider = createTestProvider(PROVIDER);
    const manager = createTestOAuthManager(tokenStore, {
      providers: [provider],
    });

    manager.setSessionBucket(PROVIDER, 'bucket-a');

    const subMetadata: OAuthTokenRequestMetadata = { profileId: 'sub-1' };
    manager.setSessionBucket(PROVIDER, 'bucket-b', subMetadata);

    expect(manager.getSessionBucket(PROVIDER, subMetadata)).toBe('bucket-b');
    expect(manager.getSessionBucket(PROVIDER)).toBe('bucket-a');
  });

  it('SA-02: Concurrent subagents same provider no cross-contamination', async () => {
    const provider = createTestProvider(PROVIDER);
    const manager = createTestOAuthManager(tokenStore, {
      providers: [provider],
    });

    const sub1Metadata: OAuthTokenRequestMetadata = { profileId: 'sub-alpha' };
    const sub2Metadata: OAuthTokenRequestMetadata = { profileId: 'sub-beta' };

    manager.setSessionBucket(PROVIDER, 'bucket-alpha', sub1Metadata);
    manager.setSessionBucket(PROVIDER, 'bucket-beta', sub2Metadata);

    expect(manager.getSessionBucket(PROVIDER, sub1Metadata)).toBe(
      'bucket-alpha',
    );
    expect(manager.getSessionBucket(PROVIDER, sub2Metadata)).toBe(
      'bucket-beta',
    );
    expect(manager.getSessionBucket(PROVIDER)).toBeUndefined();
  });

  it('SA-03: Subagent failover does not affect parent', async () => {
    await tokenStore.saveToken(PROVIDER, makeToken('token-a'), 'bucket-a');
    await tokenStore.saveToken(PROVIDER, makeToken('token-b'), 'bucket-b');

    const provider = createTestProvider(PROVIDER);
    const manager = createTestOAuthManager(tokenStore, {
      providers: [provider],
    });

    manager.setSessionBucket(PROVIDER, 'bucket-a');

    const subMetadata: OAuthTokenRequestMetadata = { profileId: 'sub-1' };
    manager.setSessionBucket(PROVIDER, 'bucket-a', subMetadata);

    const handler = createBucketFailoverHandler(
      ['bucket-a', 'bucket-b'],
      PROVIDER,
      manager,
      subMetadata,
    );

    expect(handler.getCurrentBucket()).toBe('bucket-a');

    const result = await handler.tryFailover({ triggeringStatus: 429 });

    expect(result).toBe(true);
    expect(handler.getCurrentBucket()).toBe('bucket-b');

    expect(manager.getSessionBucket(PROVIDER, subMetadata)).toBe('bucket-b');
    expect(manager.getSessionBucket(PROVIDER)).toBe('bucket-a');
  });

  it('SA-04: Subagent eager auth with metadata scope', async () => {
    const provider = createTestProvider(PROVIDER);
    const manager = createTestOAuthManager(tokenStore, {
      providers: [provider],
    });

    const subMetadata: OAuthTokenRequestMetadata = {
      profileId: 'sub-1',
    };

    const authenticateMultipleBucketsSpy = vi
      .spyOn(manager, 'authenticateMultipleBuckets')
      .mockResolvedValue(undefined);

    const handler = createBucketFailoverHandler(
      ['bucket-a', 'bucket-b'],
      PROVIDER,
      manager,
      subMetadata,
    );

    await handler.ensureBucketsAuthenticated();

    expect(authenticateMultipleBucketsSpy).toHaveBeenCalledWith(
      PROVIDER,
      ['bucket-a', 'bucket-b'],
      subMetadata,
    );

    expect(handler.getRequestMetadata()).toStrictEqual(subMetadata);
  });
});
