/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { OAuthManager } from './oauth-manager.js';
import type { OAuthToken, TokenStore } from './types.js';

function gate(): { promise: Promise<void>; release: () => void } {
  let release = (): void => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

function tokenStore(): TokenStore {
  let token: OAuthToken = {
    access_token: 'expired',
    refresh_token: 'refresh',
    expiry: 0,
    token_type: 'Bearer',
  };
  return {
    getToken: async () => token,
    saveToken: async (_provider, next) => {
      token = next;
    },
    removeToken: async () => {},
    listProviders: async () => ['held'],
    listBuckets: async () => ['default'],
    getBucketStats: async () => null,
    acquireRefreshLock: async () => true,
    releaseRefreshLock: async () => {},
    acquireAuthLock: async () => true,
    releaseAuthLock: async () => {},
  };
}

for (const forced of [false, true]) {
  describe('Foreground OAuth shutdown', () => {
    it('rejects late reads, cancels and joins the held refresh, and leaves a sibling usable', async () => {
      const store = tokenStore();
      const manager = new OAuthManager(store);
      const sibling = new OAuthManager(store);
      const entered = gate();
      const held = gate();
      let signal: AbortSignal | undefined;
      const provider = {
        name: 'held',
        initiateAuth: async (): Promise<OAuthToken> => {
          throw new Error('Unexpected authentication');
        },
        getToken: async () => null,
        refreshToken: async (
          _token: OAuthToken,
          cancellation?: AbortSignal,
        ): Promise<OAuthToken> => {
          signal = cancellation;
          entered.release();
          await held.promise;
          throw new Error('foreground refresh failed');
        },
      };
      manager.registerProvider(provider);
      sibling.registerProvider({
        ...provider,
        refreshToken: async (token) => ({
          ...token,
          access_token: 'renewed',
          expiry: Date.now() / 1000 + 3600,
        }),
      });
      const pending = (
        forced
          ? manager.forceRefreshToken('held', 'expired', 'default')
          : manager.getOAuthToken('held', 'default')
      ).then(
        () => undefined,
        (error: unknown) => error,
      );
      await entered.promise;
      let settled = false;
      const disposing = manager.dispose().then(
        () => {
          settled = true;
          return undefined;
        },
        (error: unknown) => {
          settled = true;
          return error;
        },
      );
      try {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        expect(settled).toBe(false);
        await expect(manager.getOAuthToken('held', 'default')).rejects.toThrow(
          'disposed',
        );
        expect(signal?.aborted).toBe(true);
        held.release();
        expect(await pending).toBeInstanceOf(Error);
        expect(await disposing).toBeInstanceOf(AggregateError);
        expect(
          (await sibling.getOAuthToken('held', 'default'))?.expiry,
        ).toBeGreaterThan(Date.now() / 1000);
      } finally {
        held.release();
        await pending;
        await disposing;
        await sibling.dispose();
      }
    });
  });
}
