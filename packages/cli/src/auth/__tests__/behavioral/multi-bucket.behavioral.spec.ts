/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  MemoryTokenStore,
  makeToken,
  makeExpiredToken,
  createTestProvider,
  createTestOAuthManager,
  createBucketFailoverHandler,
} from './test-utils.js';

const PROVIDER = 'anthropic';
const REAUTH_FAILED = 'reauth-failed' as const;
const QUOTA_EXHAUSTED = 'quota-exhausted' as const;
const REFRESHED_TOKEN = 'refreshed-by-a';

describe('Multi-bucket behavioral scenarios', () => {
  let tokenStore: MemoryTokenStore;

  beforeEach(() => {
    tokenStore = new MemoryTokenStore();
  });

  it('MB-01: Primary bucket valid returns bucket1 token', async () => {
    const token = makeToken('bucket1-access');
    await tokenStore.saveToken(PROVIDER, token, 'bucket1');

    const provider = createTestProvider(PROVIDER);
    const manager = createTestOAuthManager(tokenStore, {
      providers: [provider],
    });
    manager.setSessionBucket(PROVIDER, 'bucket1');

    const handler = createBucketFailoverHandler(
      ['bucket1', 'bucket2', 'bucket3'],
      PROVIDER,
      manager,
    );

    expect(handler.getCurrentBucket()).toBe('bucket1');
  });

  it('MB-02: Primary 429 triggers failover to bucket2', async () => {
    await tokenStore.saveToken(PROVIDER, makeToken('token-a'), 'bucket-a');
    await tokenStore.saveToken(PROVIDER, makeToken('token-b'), 'bucket-b');

    const provider = createTestProvider(PROVIDER);
    const manager = createTestOAuthManager(tokenStore, {
      providers: [provider],
    });
    manager.setSessionBucket(PROVIDER, 'bucket-a');

    const handler = createBucketFailoverHandler(
      ['bucket-a', 'bucket-b'],
      PROVIDER,
      manager,
    );

    const result = await handler.tryFailover({ triggeringStatus: 429 });

    expect(result).toBe(true);
    expect(handler.getCurrentBucket()).toBe('bucket-b');
  });

  it('MB-03: Primary 401 triggers failover', async () => {
    await tokenStore.saveToken(PROVIDER, makeToken('token-a'), 'bucket-a');
    await tokenStore.saveToken(PROVIDER, makeToken('token-b'), 'bucket-b');

    const provider = createTestProvider(PROVIDER, {
      refreshTokenResult: null,
    });
    const manager = createTestOAuthManager(tokenStore, {
      providers: [provider],
    });
    manager.setSessionBucket(PROVIDER, 'bucket-a');

    const handler = createBucketFailoverHandler(
      ['bucket-a', 'bucket-b'],
      PROVIDER,
      manager,
    );

    const result = await handler.tryFailover({ triggeringStatus: 401 });

    expect(result).toBe(true);
    expect(handler.getCurrentBucket()).toBe('bucket-b');
  });

  it('MB-04: All buckets 429 exhausts all buckets', async () => {
    await tokenStore.saveToken(PROVIDER, makeToken('token-a'), 'bucket-a');
    await tokenStore.saveToken(PROVIDER, makeToken('token-b'), 'bucket-b');
    await tokenStore.saveToken(PROVIDER, makeToken('token-c'), 'bucket-c');

    const provider = createTestProvider(PROVIDER);
    const manager = createTestOAuthManager(tokenStore, {
      providers: [provider],
    });
    manager.setSessionBucket(PROVIDER, 'bucket-a');

    const handler = createBucketFailoverHandler(
      ['bucket-a', 'bucket-b', 'bucket-c'],
      PROVIDER,
      manager,
    );

    const r1 = await handler.tryFailover({ triggeringStatus: 429 });
    expect(r1).toBe(true);
    const reasons1 = handler.getLastFailoverReasons();
    expect(reasons1['bucket-a']).toBe(QUOTA_EXHAUSTED);

    const r2 = await handler.tryFailover({ triggeringStatus: 429 });
    expect(r2).toBe(true);
    const reasons2 = handler.getLastFailoverReasons();
    expect(reasons2['bucket-b']).toBe(QUOTA_EXHAUSTED);

    const r3 = await handler.tryFailover({ triggeringStatus: 429 });
    expect(r3).toBe(false);
    const reasons3 = handler.getLastFailoverReasons();
    expect(reasons3['bucket-c']).toBe(QUOTA_EXHAUSTED);
  });

  it('MB-05: All buckets expired, refresh succeeds for one', async () => {
    await tokenStore.saveToken(
      PROVIDER,
      makeExpiredToken('expired-a'),
      'bucket-a',
    );
    await tokenStore.saveToken(
      PROVIDER,
      makeExpiredToken('expired-b'),
      'bucket-b',
    );
    await tokenStore.saveToken(
      PROVIDER,
      makeExpiredToken('expired-c'),
      'bucket-c',
    );

    const refreshedToken = makeToken('refreshed-b');
    const provider = createTestProvider(PROVIDER, {
      refreshTokenResult: refreshedToken,
    });
    const manager = createTestOAuthManager(tokenStore, {
      providers: [provider],
    });
    manager.setSessionBucket(PROVIDER, 'bucket-a');

    const handler = createBucketFailoverHandler(
      ['bucket-a', 'bucket-b', 'bucket-c'],
      PROVIDER,
      manager,
    );

    const result = await handler.tryFailover();

    expect(result).toBe(true);
    expect(handler.getCurrentBucket()).toBe('bucket-a');
    const stored = await tokenStore.getToken(PROVIDER, 'bucket-a');
    expect(stored).not.toBeNull();
    expect(stored!.access_token).toBe('refreshed-b');
  });

  it('MB-06: All buckets expired, all refresh fail, pass 3 reauth', async () => {
    await tokenStore.saveToken(
      PROVIDER,
      makeExpiredToken('expired-a'),
      'bucket-a',
    );
    await tokenStore.saveToken(
      PROVIDER,
      makeExpiredToken('expired-b'),
      'bucket-b',
    );
    await tokenStore.saveToken(
      PROVIDER,
      makeExpiredToken('expired-c'),
      'bucket-c',
    );

    const provider = createTestProvider(PROVIDER, {
      refreshTokenResult: null,
    });
    const manager = createTestOAuthManager(tokenStore, {
      providers: [provider],
    });
    manager.setSessionBucket(PROVIDER, 'bucket-a');

    const authenticateSpy = vi.fn(
      async (_provider: string, bucket?: string) => {
        await tokenStore.saveToken(
          PROVIDER,
          makeToken('reauth-token'),
          bucket ?? 'bucket-a',
        );
      },
    );
    manager.authenticate = authenticateSpy;

    const handler = createBucketFailoverHandler(
      ['bucket-a', 'bucket-b', 'bucket-c'],
      PROVIDER,
      manager,
    );

    await handler.tryFailover();

    expect(authenticateSpy).toHaveBeenCalledTimes(1);
  });

  it('MB-07: Foreground reauth succeeds', async () => {
    await tokenStore.saveToken(
      PROVIDER,
      makeExpiredToken('expired-a'),
      'bucket-a',
    );
    await tokenStore.saveToken(
      PROVIDER,
      makeExpiredToken('expired-b'),
      'bucket-b',
    );
    await tokenStore.saveToken(
      PROVIDER,
      makeExpiredToken('expired-c'),
      'bucket-c',
    );

    const provider = createTestProvider(PROVIDER, {
      refreshTokenResult: null,
    });
    const manager = createTestOAuthManager(tokenStore, {
      providers: [provider],
    });
    manager.setSessionBucket(PROVIDER, 'bucket-a');

    const authenticateSpy = vi.fn(
      async (_provider: string, bucket?: string) => {
        await tokenStore.saveToken(
          PROVIDER,
          makeToken('reauth-token'),
          bucket ?? 'bucket-a',
        );
      },
    );
    manager.authenticate = authenticateSpy;

    const handler = createBucketFailoverHandler(
      ['bucket-a', 'bucket-b', 'bucket-c'],
      PROVIDER,
      manager,
    );

    const result = await handler.tryFailover();

    expect(result).toBe(true);
    const bucket = handler.getCurrentBucket();
    expect(bucket).toBe('bucket-b');
  });

  it('MB-08: Foreground reauth fails', async () => {
    await tokenStore.saveToken(
      PROVIDER,
      makeExpiredToken('expired-a'),
      'bucket-a',
    );
    await tokenStore.saveToken(
      PROVIDER,
      makeExpiredToken('expired-b'),
      'bucket-b',
    );
    await tokenStore.saveToken(
      PROVIDER,
      makeExpiredToken('expired-c'),
      'bucket-c',
    );

    const provider = createTestProvider(PROVIDER, {
      refreshTokenResult: null,
    });
    const manager = createTestOAuthManager(tokenStore, {
      providers: [provider],
    });
    manager.setSessionBucket(PROVIDER, 'bucket-a');

    const authenticateSpy = vi.fn(async () => {
      throw new Error('User cancelled authentication');
    });
    manager.authenticate = authenticateSpy;

    const handler = createBucketFailoverHandler(
      ['bucket-a', 'bucket-b', 'bucket-c'],
      PROVIDER,
      manager,
    );

    const result = await handler.tryFailover();

    expect(result).toBe(false);
    const reasons = handler.getLastFailoverReasons();
    expect(Object.values(reasons).some((r) => r === REAUTH_FAILED)).toBe(true);
  });

  it('MB-09: Bucket removed mid-session', async () => {
    await tokenStore.saveToken(PROVIDER, makeToken('token-a'), 'bucket-a');
    await tokenStore.saveToken(PROVIDER, makeToken('token-c'), 'bucket-c');

    const provider = createTestProvider(PROVIDER);
    const manager = createTestOAuthManager(tokenStore, {
      providers: [provider],
    });
    manager.setSessionBucket(PROVIDER, 'bucket-a');

    const handler = createBucketFailoverHandler(
      ['bucket-a', 'bucket-b', 'bucket-c'],
      PROVIDER,
      manager,
    );

    const result = await handler.tryFailover();

    expect(result).toBe(true);
    expect(handler.getCurrentBucket()).toBe('bucket-c');
  });

  it('MB-10: Session bucket override', async () => {
    await tokenStore.saveToken(PROVIDER, makeToken('token-a'), 'bucket-a');
    await tokenStore.saveToken(PROVIDER, makeToken('token-b'), 'bucket-b');

    const provider = createTestProvider(PROVIDER);
    const manager = createTestOAuthManager(tokenStore, {
      providers: [provider],
    });
    manager.setSessionBucket(PROVIDER, 'bucket-b');

    const handler = createBucketFailoverHandler(
      ['bucket-a', 'bucket-b'],
      PROVIDER,
      manager,
    );

    expect(handler.getCurrentBucket()).toBe('bucket-b');
  });

  it('MB-11: Peek other buckets finds valid token', async () => {
    await tokenStore.saveToken(
      PROVIDER,
      makeToken('bucket-b-token'),
      'bucket-b',
    );

    const provider = createTestProvider(PROVIDER);
    const manager = createTestOAuthManager(tokenStore, {
      providers: [provider],
    });
    await manager.toggleOAuthEnabled(PROVIDER);

    const getProfileBucketsSpy = vi
      .spyOn(
        manager as unknown as {
          getProfileBuckets: () => Promise<string[]>;
        },
        'getProfileBuckets',
      )
      .mockResolvedValue(['bucket-a', 'bucket-b', 'bucket-c']);

    const result = await manager.getToken(PROVIDER);

    expect(result).toBe('bucket-b-token');
    expect(getProfileBucketsSpy).toHaveBeenCalled();
  });

  it('MB-12: ensureBucketsAuthenticated delegates to authenticateMultipleBuckets', async () => {
    const provider = createTestProvider(PROVIDER);
    const manager = createTestOAuthManager(tokenStore, {
      providers: [provider],
    });

    const authenticateMultipleBucketsSpy = vi
      .spyOn(manager, 'authenticateMultipleBuckets')
      .mockResolvedValue(undefined);

    const handler = createBucketFailoverHandler(
      ['bucket-a', 'bucket-b', 'bucket-c'],
      PROVIDER,
      manager,
    );

    await handler.ensureBucketsAuthenticated();

    expect(authenticateMultipleBucketsSpy).toHaveBeenCalledWith(
      PROVIDER,
      ['bucket-a', 'bucket-b', 'bucket-c'],
      undefined,
    );
  });

  it('MB-13: Concurrent failover coalesces foreground reauth', async () => {
    const provider = createTestProvider(PROVIDER);
    const manager = createTestOAuthManager(tokenStore, {
      providers: [provider],
    });
    manager.setSessionBucket(PROVIDER, 'bucket-a');

    let releaseForegroundAuth: (() => void) | undefined;
    const foregroundAuthGate = new Promise<void>((resolve) => {
      releaseForegroundAuth = resolve;
    });

    const authenticateSpy = vi.fn(
      async (_provider: string, bucket?: string) => {
        await foregroundAuthGate;
        await tokenStore.saveToken(
          PROVIDER,
          makeToken('pass3-token'),
          bucket ?? 'bucket-a',
        );
      },
    );
    manager.authenticate = authenticateSpy;

    const handler = createBucketFailoverHandler(
      ['bucket-a'],
      PROVIDER,
      manager,
    );

    const first = handler.tryFailover({ triggeringStatus: 401 });
    const second = handler.tryFailover({ triggeringStatus: 401 });

    releaseForegroundAuth?.();

    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult).toBe(true);
    expect(secondResult).toBe(true);
    expect(authenticateSpy).toHaveBeenCalledTimes(1);
  });

  it('MB-14: Cross-process refresh per-bucket via shared store', async () => {
    const sharedStore = new MemoryTokenStore();
    await sharedStore.saveToken(
      PROVIDER,
      makeExpiredToken('expired-a'),
      'bucket-a',
    );

    const refreshedToken = makeToken(REFRESHED_TOKEN);
    const provider = createTestProvider(PROVIDER, {
      refreshTokenResult: refreshedToken,
    });

    const managerA = createTestOAuthManager(sharedStore, {
      providers: [provider],
    });
    const managerB = createTestOAuthManager(sharedStore, {
      providers: [provider],
    });

    const resultA = await managerA.getOAuthToken(PROVIDER, 'bucket-a');
    expect(resultA).not.toBeNull();
    expect(resultA!.access_token).toBe(REFRESHED_TOKEN);

    const resultB = await managerB.getOAuthToken(PROVIDER, 'bucket-a');
    expect(resultB).not.toBeNull();
    expect(resultB!.access_token).toBe(REFRESHED_TOKEN);
  });
});

describe('Retry orchestrator integration scenarios', () => {
  let tokenStore: MemoryTokenStore;

  beforeEach(() => {
    tokenStore = new MemoryTokenStore();
  });

  it('RO-01: 401 with failover handler classifies and switches', async () => {
    await tokenStore.saveToken(PROVIDER, makeToken('token-a'), 'bucket-a');
    await tokenStore.saveToken(PROVIDER, makeToken('token-b'), 'bucket-b');

    const provider = createTestProvider(PROVIDER, {
      refreshTokenResult: null,
    });
    const manager = createTestOAuthManager(tokenStore, {
      providers: [provider],
    });
    manager.setSessionBucket(PROVIDER, 'bucket-a');

    const handler = createBucketFailoverHandler(
      ['bucket-a', 'bucket-b'],
      PROVIDER,
      manager,
    );

    const result = await handler.tryFailover({ triggeringStatus: 401 });

    expect(result).toBe(true);
    const reasons = handler.getLastFailoverReasons();
    expect(reasons['bucket-a']).toBe('expired-refresh-failed');
    expect(handler.getCurrentBucket()).toBe('bucket-b');
  });

  it('RO-02: 429 with failover handler switches bucket', async () => {
    await tokenStore.saveToken(PROVIDER, makeToken('token-a'), 'bucket-a');
    await tokenStore.saveToken(PROVIDER, makeToken('token-b'), 'bucket-b');

    const provider = createTestProvider(PROVIDER);
    const manager = createTestOAuthManager(tokenStore, {
      providers: [provider],
    });
    manager.setSessionBucket(PROVIDER, 'bucket-a');

    const handler = createBucketFailoverHandler(
      ['bucket-a', 'bucket-b'],
      PROVIDER,
      manager,
    );

    const result = await handler.tryFailover({ triggeringStatus: 429 });

    expect(result).toBe(true);
    const reasons = handler.getLastFailoverReasons();
    expect(reasons['bucket-a']).toBe(QUOTA_EXHAUSTED);
    expect(handler.getCurrentBucket()).toBe('bucket-b');
  });

  it('RO-03: resetSession clears triedBuckets for next request', async () => {
    await tokenStore.saveToken(PROVIDER, makeToken('token-a'), 'bucket-a');
    await tokenStore.saveToken(PROVIDER, makeToken('token-b'), 'bucket-b');

    const provider = createTestProvider(PROVIDER);
    const manager = createTestOAuthManager(tokenStore, {
      providers: [provider],
    });
    manager.setSessionBucket(PROVIDER, 'bucket-a');

    const handler = createBucketFailoverHandler(
      ['bucket-a', 'bucket-b'],
      PROVIDER,
      manager,
    );

    const first = await handler.tryFailover();
    expect(first).toBe(true);
    expect(handler.getCurrentBucket()).toBe('bucket-b');

    const second = await handler.tryFailover();
    expect(second).toBe(false);

    handler.resetSession();

    const third = await handler.tryFailover();
    expect(third).toBe(true);
    expect(handler.getCurrentBucket()).toBe('bucket-a');
  });
});
