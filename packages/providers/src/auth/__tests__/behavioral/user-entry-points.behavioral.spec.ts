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

const PROVIDER = 'anthropic';

describe('User entry point behavioral scenarios', () => {
  let tokenStore: MemoryTokenStore;

  beforeEach(() => {
    tokenStore = new MemoryTokenStore();
  });

  describe('UE-01: Profile load configures proactive renewals', () => {
    let proactiveManager: ProactiveRenewalManager;
    let proactiveTokenStore: MemoryTokenStore;

    beforeEach(() => {
      vi.useFakeTimers();
      proactiveTokenStore = new MemoryTokenStore();
    });

    afterEach(() => {
      proactiveManager.clearAllTimers();
      vi.useRealTimers();
    });

    it('UE-01: Profile load configures proactive renewals', async () => {
      const token = makeToken('access-a', { expiresInSec: 600 });
      await proactiveTokenStore.saveToken(PROVIDER, token, 'bucket-a');
      await proactiveTokenStore.saveToken(PROVIDER, token, 'bucket-b');
      const acquireLockSpy = vi.spyOn(
        proactiveTokenStore,
        'acquireRefreshLock',
      );

      const provider = createTestProvider(PROVIDER, {
        refreshTokenResult: makeToken('refreshed', { expiresInSec: 3600 }),
      });

      proactiveManager = new ProactiveRenewalManager(
        proactiveTokenStore,
        (name: string) => (name === PROVIDER ? provider : undefined),
        () => true,
      );

      await proactiveManager.configureProactiveRenewalsForProfile({
        provider: PROVIDER,
        auth: { type: 'oauth', buckets: ['bucket-a', 'bucket-b'] },
      });

      await vi.advanceTimersByTimeAsync(305 * 1000);

      expect(acquireLockSpy).toHaveBeenCalled();
    });
  });

  describe('UE-02: Profile switch clears old state and configures new', () => {
    let proactiveManager: ProactiveRenewalManager;
    let proactiveTokenStore: MemoryTokenStore;

    beforeEach(() => {
      vi.useFakeTimers();
      proactiveTokenStore = new MemoryTokenStore();
    });

    afterEach(() => {
      proactiveManager.clearAllTimers();
      vi.useRealTimers();
    });

    it('UE-02: Profile switch clears old state and configures new', async () => {
      const oldToken = makeToken('old-access', { expiresInSec: 600 });
      const newToken = makeToken('new-access', { expiresInSec: 600 });

      await proactiveTokenStore.saveToken(PROVIDER, oldToken, 'old-bucket');
      await proactiveTokenStore.saveToken(PROVIDER, newToken, 'new-bucket');
      const acquireLockSpy = vi.spyOn(
        proactiveTokenStore,
        'acquireRefreshLock',
      );

      const provider = createTestProvider(PROVIDER, {
        refreshTokenResult: makeToken('refreshed', { expiresInSec: 3600 }),
      });

      proactiveManager = new ProactiveRenewalManager(
        proactiveTokenStore,
        (name: string) => (name === PROVIDER ? provider : undefined),
        () => true,
      );

      await proactiveManager.configureProactiveRenewalsForProfile({
        provider: PROVIDER,
        auth: { type: 'oauth', buckets: ['old-bucket'] },
      });

      await proactiveManager.configureProactiveRenewalsForProfile({
        provider: PROVIDER,
        auth: { type: 'oauth', buckets: ['new-bucket'] },
      });

      acquireLockSpy.mockClear();

      await vi.advanceTimersByTimeAsync(305 * 1000);

      expect(acquireLockSpy).not.toHaveBeenCalledWith(
        PROVIDER,
        expect.objectContaining({ bucket: 'old-bucket' }),
      );
      expect(acquireLockSpy).toHaveBeenCalledWith(
        PROVIDER,
        expect.objectContaining({ bucket: 'new-bucket' }),
      );
    });
  });

  it('UE-03: New turn resets session via handler resetSession', async () => {
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

    const first = await handler.tryFailover({ triggeringStatus: 429 });
    expect(first).toBe(true);
    expect(handler.getCurrentBucket()).toBe('bucket-b');

    const second = await handler.tryFailover({ triggeringStatus: 429 });
    expect(second).toBe(false);

    handler.resetSession();

    const third = await handler.tryFailover({ triggeringStatus: 429 });
    expect(third).toBe(true);
    expect(handler.getCurrentBucket()).toBe('bucket-a');
  });

  describe('UE-04: Token expires mid-turn, proactive renewal refreshes in background', () => {
    let proactiveManager: ProactiveRenewalManager;
    let proactiveTokenStore: MemoryTokenStore;

    beforeEach(() => {
      vi.useFakeTimers();
      proactiveTokenStore = new MemoryTokenStore();
    });

    afterEach(() => {
      proactiveManager.clearAllTimers();
      vi.useRealTimers();
    });

    it('UE-04: Token expires mid-turn, proactive renewal refreshes in background', async () => {
      const nearExpiryToken = makeToken('near-expiry', { expiresInSec: 600 });
      const refreshedToken = makeToken('refreshed-access', {
        expiresInSec: 3600,
      });

      await proactiveTokenStore.saveToken(PROVIDER, nearExpiryToken, 'default');
      const saveTokenSpy = vi.spyOn(proactiveTokenStore, 'saveToken');

      const refreshTokenSpy = vi.fn().mockResolvedValue(refreshedToken);
      const provider = createTestProvider(PROVIDER);
      provider.refreshToken = refreshTokenSpy;

      proactiveManager = new ProactiveRenewalManager(
        proactiveTokenStore,
        (name: string) => (name === PROVIDER ? provider : undefined),
        () => true,
      );

      proactiveManager.scheduleProactiveRenewal(
        PROVIDER,
        'default',
        nearExpiryToken,
      );

      await vi.advanceTimersByTimeAsync(305 * 1000);

      expect(refreshTokenSpy).toHaveBeenCalledWith(nearExpiryToken);
      expect(saveTokenSpy).toHaveBeenCalledWith(
        PROVIDER,
        expect.objectContaining({ access_token: 'refreshed-access' }),
        'default',
      );
    });
  });

  it('UE-05: 429 during tool loop triggers transparent failover', async () => {
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

    expect(handler.getCurrentBucket()).toBe('bucket-a');

    const result = await handler.tryFailover({ triggeringStatus: 429 });

    expect(result).toBe(true);
    expect(handler.getCurrentBucket()).toBe('bucket-b');
  });

  it('UE-06: User declines auth, authenticated buckets remain usable', async () => {
    await tokenStore.saveToken(PROVIDER, makeToken('token-a'), 'bucket-a');

    const provider = createTestProvider(PROVIDER, {
      refreshTokenResult: null,
    });

    const manager = createTestOAuthManager(tokenStore, {
      providers: [provider],
    });

    await manager.toggleOAuthEnabled(PROVIDER);

    manager.setSessionBucket(PROVIDER, 'bucket-a');

    const tokenBefore = await manager.getOAuthToken(PROVIDER, 'bucket-a');
    expect(tokenBefore).not.toBeNull();
    expect(tokenBefore!.access_token).toBe('token-a');
  });

  it('UE-07: All tokens die during turn, sequential failover exhausts all', async () => {
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

    manager.authenticate = vi.fn().mockRejectedValue(new Error('Auth failed'));

    const handler = createBucketFailoverHandler(
      ['bucket-a', 'bucket-b', 'bucket-c'],
      PROVIDER,
      manager,
    );

    const first = await handler.tryFailover();
    expect(first).toBe(false);

    const reasons = handler.getLastFailoverReasons();
    expect(Object.keys(reasons).length).toBeGreaterThan(0);
    expect(reasons['bucket-a']).toBeDefined();
    expect(reasons['bucket-b']).toBeDefined();
    expect(reasons['bucket-c']).toBeDefined();
  });

  it('UE-08: Profile switch clears old failover handler state', async () => {
    await tokenStore.saveToken(PROVIDER, makeToken('token-a'), 'bucket-a');
    await tokenStore.saveToken(PROVIDER, makeToken('token-b'), 'bucket-b');

    const provider = createTestProvider(PROVIDER);
    const manager = createTestOAuthManager(tokenStore, {
      providers: [provider],
    });

    manager.setSessionBucket(PROVIDER, 'bucket-a');
    expect(manager.getSessionBucket(PROVIDER)).toBe('bucket-a');

    manager.clearAllSessionBuckets(PROVIDER);
    expect(manager.getSessionBucket(PROVIDER)).toBeUndefined();

    manager.setSessionBucket(PROVIDER, 'bucket-b');
    expect(manager.getSessionBucket(PROVIDER)).toBe('bucket-b');
  });
});
