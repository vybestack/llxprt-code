/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProactiveRenewalManager } from '../../proactive-renewal-manager.js';
import {
  MemoryTokenStore,
  makeToken,
  makeExpiredToken,
  createTestProvider,
  createTestOAuthManager,
  createBucketFailoverHandler,
} from './test-utils.js';
import type { OAuthToken } from '../../types.js';

const PROVIDER = 'anthropic';

describe('Single-bucket behavioral scenarios', () => {
  let tokenStore: MemoryTokenStore;

  beforeEach(() => {
    tokenStore = new MemoryTokenStore();
  });

  it('SB-01: Valid token returns access_token', async () => {
    const validToken = makeToken('valid-access-123');
    await tokenStore.saveToken(PROVIDER, validToken);

    const provider = createTestProvider(PROVIDER);
    const manager = createTestOAuthManager(tokenStore, {
      providers: [provider],
    });

    const result = await manager.getOAuthToken(PROVIDER);

    expect(result).not.toBeNull();
    expect(result!.access_token).toBe('valid-access-123');
  });

  it('SB-02: Expired token with valid refresh_token triggers refresh', async () => {
    const expiredToken = makeExpiredToken('expired-access');
    await tokenStore.saveToken(PROVIDER, expiredToken);

    const refreshedToken = makeToken('refreshed-access');
    const provider = createTestProvider(PROVIDER, {
      refreshTokenResult: refreshedToken,
    });
    const manager = createTestOAuthManager(tokenStore, {
      providers: [provider],
    });

    const result = await manager.getOAuthToken(PROVIDER);

    expect(result).not.toBeNull();
    expect(result!.access_token).toBe('refreshed-access');

    const stored = await tokenStore.getToken(PROVIDER);
    expect(stored).not.toBeNull();
    expect(stored!.access_token).toBe('refreshed-access');
  });

  it('SB-03: Expired token with failed refresh returns null', async () => {
    const expiredToken = makeExpiredToken('expired-access');
    await tokenStore.saveToken(PROVIDER, expiredToken);

    const provider = createTestProvider(PROVIDER, {
      refreshTokenResult: null,
    });
    const manager = createTestOAuthManager(tokenStore, {
      providers: [provider],
    });

    const result = await manager.getOAuthToken(PROVIDER);

    expect(result).toBeNull();
  });

  it('SB-04: Expired token without refresh_token returns null', async () => {
    const expiredNoRefresh: OAuthToken = {
      access_token: 'expired-no-refresh',
      refresh_token: '',
      expiry: Math.floor(Date.now() / 1000) - 3600,
      token_type: 'Bearer',
      scope: '',
    };
    await tokenStore.saveToken(PROVIDER, expiredNoRefresh);

    const provider = createTestProvider(PROVIDER, {
      refreshTokenResult: null,
    });
    const manager = createTestOAuthManager(tokenStore, {
      providers: [provider],
    });

    const result = await manager.getOAuthToken(PROVIDER);

    expect(result).toBeNull();
  });

  it('SB-05: 401 triggers failover reauth attempt', async () => {
    await tokenStore.saveToken(PROVIDER, makeToken('valid-a'), 'bucket-a');

    const provider = createTestProvider(PROVIDER, {
      refreshTokenResult: null,
    });
    const manager = createTestOAuthManager(tokenStore, {
      providers: [provider],
    });

    manager.setSessionBucket(PROVIDER, 'bucket-a');

    const handler = createBucketFailoverHandler(
      ['bucket-a'],
      PROVIDER,
      manager,
    );

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

    const result = await handler.tryFailover({ triggeringStatus: 401 });

    expect(result).toBe(true);
    expect(handler.getCurrentBucket()).toBe('bucket-a');
  });

  it('SB-06: 403 triggers failover reauth attempt', async () => {
    await tokenStore.saveToken(PROVIDER, makeToken('valid-a'), 'bucket-a');

    const provider = createTestProvider(PROVIDER, {
      refreshTokenResult: null,
    });
    const manager = createTestOAuthManager(tokenStore, {
      providers: [provider],
    });

    manager.setSessionBucket(PROVIDER, 'bucket-a');

    const handler = createBucketFailoverHandler(
      ['bucket-a'],
      PROVIDER,
      manager,
    );

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

    const result = await handler.tryFailover({ triggeringStatus: 403 });

    expect(result).toBe(true);
    expect(handler.getCurrentBucket()).toBe('bucket-a');
  });

  it('SB-07: Cross-process refresh reads refreshed token from store', async () => {
    const validToken = makeToken('process-a-token');
    await tokenStore.saveToken(PROVIDER, validToken);

    const provider = createTestProvider(PROVIDER);
    const managerA = createTestOAuthManager(tokenStore, {
      providers: [provider],
    });

    const result = await managerA.getOAuthToken(PROVIDER);

    expect(result).not.toBeNull();
    expect(result!.access_token).toBe('process-a-token');

    const refreshedToken = makeToken('process-b-refreshed');
    await tokenStore.saveToken(PROVIDER, refreshedToken);

    const resultA = await managerA.getOAuthToken(PROVIDER);

    expect(resultA).not.toBeNull();
    expect(resultA!.access_token).toBe('process-b-refreshed');
  });
});

describe('SB-08: Proactive renewal schedules for token with refresh_token', () => {
  let proactiveManager: ProactiveRenewalManager;
  let proactiveTokenStore: MemoryTokenStore;

  beforeEach(() => {
    vi.useFakeTimers();
    proactiveTokenStore = new MemoryTokenStore();

    const provider = createTestProvider(PROVIDER, {
      refreshTokenResult: makeToken('proactive-refreshed'),
    });

    proactiveManager = new ProactiveRenewalManager(
      proactiveTokenStore,
      (name: string) => (name === PROVIDER ? provider : undefined),
      () => true,
    );
  });

  afterEach(() => {
    proactiveManager.clearAllTimers();
    vi.useRealTimers();
  });

  it('SB-08: Proactive renewal schedules for token with refresh_token', async () => {
    const token = makeToken('valid-for-proactive', {
      expiresInSec: 600,
    });
    await proactiveTokenStore.saveToken(PROVIDER, token, 'default');
    const acquireLockSpy = vi.spyOn(proactiveTokenStore, 'acquireRefreshLock');

    proactiveManager.scheduleProactiveRenewal(PROVIDER, 'default', token);

    await vi.advanceTimersByTimeAsync(265 * 1000);
    expect(acquireLockSpy).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(40 * 1000);
    expect(acquireLockSpy).toHaveBeenCalled();
  });
});

describe('SB-09: Proactive renewal skipped for token without refresh_token', () => {
  let proactiveManager: ProactiveRenewalManager;
  let proactiveTokenStore: MemoryTokenStore;
  let acquireLockSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    proactiveTokenStore = new MemoryTokenStore();
    acquireLockSpy = vi.spyOn(proactiveTokenStore, 'acquireRefreshLock');

    const provider = createTestProvider(PROVIDER);
    proactiveManager = new ProactiveRenewalManager(
      proactiveTokenStore,
      (name: string) => (name === PROVIDER ? provider : undefined),
      () => true,
    );
  });

  afterEach(() => {
    proactiveManager.clearAllTimers();
    vi.useRealTimers();
  });

  it('SB-09: Proactive renewal skipped for token without refresh_token', async () => {
    const tokenNoRefresh: OAuthToken = {
      access_token: 'no-refresh-token',
      refresh_token: '',
      expiry: Math.floor(Date.now() / 1000) + 3600,
      token_type: 'Bearer',
      scope: '',
    };

    proactiveManager.scheduleProactiveRenewal(
      PROVIDER,
      'default',
      tokenNoRefresh,
    );

    await vi.advanceTimersByTimeAsync(3600 * 1000);

    expect(acquireLockSpy).not.toHaveBeenCalled();
  });
});

describe('SB-10: Auth flow mid-turn timeout returns null', () => {
  it('SB-10: Auth flow mid-turn timeout returns null', async () => {
    const tokenStore = new MemoryTokenStore();
    const provider = createTestProvider(PROVIDER, {
      refreshTokenResult: null,
    });
    provider.initiateAuth = async () => {
      throw new Error('Auth flow failed');
    };

    const manager = createTestOAuthManager(tokenStore, {
      providers: [provider],
    });

    const result = await manager.getToken(PROVIDER).catch(() => null);
    expect(result).toBeNull();
  });
});
