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
} from './test-utils.js';

const PROVIDER = 'anthropic';

describe('Error and edge case behavioral scenarios', () => {
  let tokenStore: MemoryTokenStore;

  beforeEach(() => {
    tokenStore = new MemoryTokenStore();
  });

  it('EC-01: Network error during refresh (throws, not null)', async () => {
    const expiredToken = makeExpiredToken('expired-access');
    await tokenStore.saveToken(PROVIDER, expiredToken);

    const provider = createTestProvider(PROVIDER);
    provider.refreshToken = async () => {
      throw new Error('network timeout');
    };

    const manager = createTestOAuthManager(tokenStore, {
      providers: [provider],
    });

    const result = await manager.getOAuthToken(PROVIDER);

    expect(result).toBeNull();

    const stored = await tokenStore.getToken(PROVIDER);
    expect(stored).not.toBeNull();
    expect(stored!.access_token).toBe('expired-access');
  });

  describe('EC-02: Token store lock stale detection', () => {
    let proactiveManager: ProactiveRenewalManager;
    let proactiveTokenStore: MemoryTokenStore;
    let acquireRefreshLockSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      vi.useFakeTimers();
      proactiveTokenStore = new MemoryTokenStore();
    });

    afterEach(() => {
      proactiveManager?.clearAllTimers();
      vi.useRealTimers();
    });

    it('retries refresh after lock acquisition fails then succeeds', async () => {
      const token = makeToken('lock-test', { expiresInSec: 600 });
      const refreshedToken = makeToken('refreshed-lock', {
        expiresInSec: 3600,
      });

      await proactiveTokenStore.saveToken(PROVIDER, token, 'default');

      acquireRefreshLockSpy = vi
        .spyOn(proactiveTokenStore, 'acquireRefreshLock')
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);

      const refreshTokenSpy = vi.fn().mockResolvedValue(refreshedToken);

      const provider = createTestProvider(PROVIDER);
      provider.refreshToken = refreshTokenSpy;

      proactiveManager = new ProactiveRenewalManager(
        proactiveTokenStore,
        (name: string) => (name === PROVIDER ? provider : undefined),
        () => true,
      );

      proactiveManager.scheduleProactiveRenewal(PROVIDER, 'default', token);

      await vi.advanceTimersByTimeAsync(305 * 1000);

      expect(acquireRefreshLockSpy).toHaveBeenCalledTimes(1);
      expect(refreshTokenSpy).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(65 * 1000);

      expect(acquireRefreshLockSpy).toHaveBeenCalledTimes(2);
      expect(refreshTokenSpy).toHaveBeenCalled();
    });
  });

  it('EC-03: Auth flow interrupted returns null gracefully', async () => {
    await tokenStore.saveToken(PROVIDER, makeExpiredToken('expired-token'));

    const provider = createTestProvider(PROVIDER, {
      refreshTokenResult: null,
    });
    provider.initiateAuth = async () => {
      throw new Error('SIGINT');
    };

    const manager = createTestOAuthManager(tokenStore, {
      providers: [provider],
    });

    const result = await manager.getToken(PROVIDER).catch(() => null);
    expect(result).toBeNull();

    const stored = await tokenStore.getToken(PROVIDER);
    expect(stored).not.toBeNull();
    expect(stored!.access_token).toBe('expired-token');
  });

  it('EC-04: Logout then re-auth same session', async () => {
    const token = makeToken('session-token');
    await tokenStore.saveToken(PROVIDER, token);

    const newToken = makeToken('reauth-token');
    const provider = createTestProvider(PROVIDER, {
      initiateAuthResult: newToken,
      refreshTokenResult: null,
    });

    const manager = createTestOAuthManager(tokenStore, {
      providers: [provider],
    });
    await manager.toggleOAuthEnabled(PROVIDER);

    const before = await manager.getOAuthToken(PROVIDER);
    expect(before).not.toBeNull();
    expect(before!.access_token).toBe('session-token');

    await manager.logout(PROVIDER);

    const afterLogout = await manager.getOAuthToken(PROVIDER);
    expect(afterLogout).toBeNull();

    await manager.authenticate(PROVIDER);

    const afterReauth = await manager.getOAuthToken(PROVIDER);
    expect(afterReauth).not.toBeNull();
    expect(afterReauth!.access_token).toBe('reauth-token');
  });
});
