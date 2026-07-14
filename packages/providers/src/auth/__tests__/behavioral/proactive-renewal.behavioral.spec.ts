/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ProactiveRenewalManager,
  MAX_PROACTIVE_RENEWAL_FAILURES,
} from '../../proactive-renewal-manager.js';
import {
  MemoryTokenStore,
  makeToken,
  createTestProvider,
} from './test-utils.js';
import type { OAuthToken } from '../../types.js';

const PROVIDER = 'test-provider';

describe('Proactive renewal behavioral scenarios', () => {
  let manager: ProactiveRenewalManager;
  let tokenStore: MemoryTokenStore;
  let refreshTokenSpy: ReturnType<typeof vi.fn>;
  let acquireLockSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    tokenStore = new MemoryTokenStore();
    acquireLockSpy = vi.spyOn(tokenStore, 'acquireRefreshLock');

    refreshTokenSpy = vi.fn();
    const provider = createTestProvider(PROVIDER);
    provider.refreshToken = refreshTokenSpy;

    manager = new ProactiveRenewalManager(
      tokenStore,
      (name: string) => (name === PROVIDER ? provider : undefined),
      () => true,
    );
  });

  afterEach(() => {
    manager.clearAllTimers();
    vi.useRealTimers();
  });

  it('PR-01: Schedule renewal for valid token with 600s remaining', async () => {
    const token = makeToken('access-600', { expiresInSec: 600 });
    await tokenStore.saveToken(PROVIDER, token, 'default');

    manager.scheduleProactiveRenewal(PROVIDER, 'default', token);

    await vi.advanceTimersByTimeAsync(269 * 1000);
    expect(acquireLockSpy).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(36 * 1000);
    expect(acquireLockSpy).toHaveBeenCalled();
  });

  it('PR-02: Skip renewal for short-lived token (<300s remaining)', async () => {
    const token = makeToken('short-lived', { expiresInSec: 250 });

    manager.scheduleProactiveRenewal(PROVIDER, 'default', token);

    await vi.advanceTimersByTimeAsync(600 * 1000);

    expect(acquireLockSpy).not.toHaveBeenCalled();
    expect(refreshTokenSpy).not.toHaveBeenCalled();
  });

  it('PR-03: Skip renewal for token without refresh_token', async () => {
    const token: OAuthToken = {
      access_token: 'no-refresh',
      refresh_token: '',
      expiry: Math.floor(Date.now() / 1000) + 3600,
      token_type: 'Bearer',
      scope: '',
    };

    manager.scheduleProactiveRenewal(PROVIDER, 'default', token);

    await vi.advanceTimersByTimeAsync(600 * 1000);

    expect(acquireLockSpy).not.toHaveBeenCalled();
    expect(refreshTokenSpy).not.toHaveBeenCalled();
  });

  it('PR-04: Renewal succeeds and reschedules with new token', async () => {
    const originalToken = makeToken('original-access', { expiresInSec: 600 });
    const refreshedToken = makeToken('refreshed-access', {
      expiresInSec: 3600,
    });

    await tokenStore.saveToken(PROVIDER, originalToken, 'default');
    const saveTokenSpy = vi.spyOn(tokenStore, 'saveToken');
    refreshTokenSpy.mockResolvedValue(refreshedToken);

    manager.scheduleProactiveRenewal(PROVIDER, 'default', originalToken);

    await vi.advanceTimersByTimeAsync(305 * 1000);

    expect(refreshTokenSpy).toHaveBeenCalledWith(originalToken);
    expect(saveTokenSpy).toHaveBeenCalledWith(
      PROVIDER,
      expect.objectContaining({ access_token: 'refreshed-access' }),
      'default',
    );
  });

  it('PR-05: Renewal failure triggers retry backoff', async () => {
    const token = makeToken('failing-access', { expiresInSec: 600 });

    await tokenStore.saveToken(PROVIDER, token, 'default');
    refreshTokenSpy.mockResolvedValue(null);

    manager.scheduleProactiveRenewal(PROVIDER, 'default', token);

    await vi.advanceTimersByTimeAsync(305 * 1000);
    expect(refreshTokenSpy).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(65 * 1000);
    expect(refreshTokenSpy).toHaveBeenCalledTimes(2);
  });

  it('PR-06: Renewal stops after MAX_PROACTIVE_RENEWAL_FAILURES', async () => {
    const token = makeToken('max-fail-access', { expiresInSec: 600 });

    await tokenStore.saveToken(PROVIDER, token, 'default');
    refreshTokenSpy.mockResolvedValue(null);

    manager.scheduleProactiveRenewal(PROVIDER, 'default', token);

    await vi.advanceTimersByTimeAsync(305 * 1000);
    expect(refreshTokenSpy).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(65 * 1000);
    expect(refreshTokenSpy).toHaveBeenCalledTimes(2);

    expect(MAX_PROACTIVE_RENEWAL_FAILURES).toBe(3);

    await vi.advanceTimersByTimeAsync(130 * 1000);
    expect(refreshTokenSpy).toHaveBeenCalledTimes(3);

    await vi.advanceTimersByTimeAsync(600 * 1000);
    expect(refreshTokenSpy).toHaveBeenCalledTimes(3);
  });

  it('PR-07: External refresh detected and reschedules', async () => {
    const originalToken = makeToken('original-access', { expiresInSec: 600 });
    const externallyRefreshedToken = makeToken('external-new-access', {
      expiresInSec: 3600,
    });

    await tokenStore.saveToken(PROVIDER, originalToken, 'default');
    const saveTokenSpy = vi.spyOn(tokenStore, 'saveToken');

    manager.scheduleProactiveRenewal(PROVIDER, 'default', originalToken);

    await tokenStore.saveToken(PROVIDER, externallyRefreshedToken, 'default');
    saveTokenSpy.mockClear();

    await vi.advanceTimersByTimeAsync(305 * 1000);

    expect(saveTokenSpy).not.toHaveBeenCalled();
    expect(refreshTokenSpy).not.toHaveBeenCalled();
  });

  it('PR-08: Proxy mode skips proactive renewal', () => {
    const saved = process.env.LLXPRT_CREDENTIAL_SOCKET;
    try {
      process.env.LLXPRT_CREDENTIAL_SOCKET = '/tmp/test-socket';

      const token = makeToken('proxy-access', { expiresInSec: 600 });
      const acquireLockSpy = vi.spyOn(tokenStore, 'acquireRefreshLock');

      manager.scheduleProactiveRenewal(PROVIDER, 'default', token);

      expect(acquireLockSpy).not.toHaveBeenCalled();
    } finally {
      if (saved !== undefined) {
        process.env.LLXPRT_CREDENTIAL_SOCKET = saved;
      } else {
        delete process.env.LLXPRT_CREDENTIAL_SOCKET;
      }
    }
  });

  it('PR-09: Profile reconfiguration clears old timers and sets new ones', async () => {
    const oldToken = makeToken('old-bucket-token', { expiresInSec: 600 });
    await tokenStore.saveToken(PROVIDER, oldToken, 'old-bucket');
    await tokenStore.saveToken(
      PROVIDER,
      makeToken('new-bucket-token', { expiresInSec: 600 }),
      'new-bucket',
    );

    const acquireLockSpy = vi.spyOn(tokenStore, 'acquireRefreshLock');

    const profile = {
      provider: PROVIDER,
      auth: { type: 'oauth', buckets: ['old-bucket'] },
    };

    await manager.configureProactiveRenewalsForProfile(profile);

    const newProfile = {
      provider: PROVIDER,
      auth: { type: 'oauth', buckets: ['new-bucket'] },
    };

    await manager.configureProactiveRenewalsForProfile(newProfile);

    await vi.advanceTimersByTimeAsync(600 * 1000);

    expect(acquireLockSpy).not.toHaveBeenCalledWith(
      PROVIDER,
      expect.objectContaining({ bucket: 'old-bucket' }),
    );
  });

  it('PR-10: Dedup -- same expiry already scheduled is a no-op', async () => {
    const token = makeToken('dedup-access', { expiresInSec: 600 });
    await tokenStore.saveToken(PROVIDER, token, 'default');

    manager.scheduleProactiveRenewal(PROVIDER, 'default', token);
    manager.scheduleProactiveRenewal(PROVIDER, 'default', token);

    await vi.advanceTimersByTimeAsync(305 * 1000);

    expect(refreshTokenSpy).toHaveBeenCalledTimes(1);
  });
});
