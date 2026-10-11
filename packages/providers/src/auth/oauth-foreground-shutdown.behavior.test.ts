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

describe('Injected interactive OAuth shutdown', () => {
  it('detaches a retiring child waiter without cancelling its live sibling', async () => {
    const store = tokenStore();
    const emptyStore: TokenStore = { ...store, getToken: async () => null };
    const root = new OAuthManager(emptyStore);
    const child = new OAuthManager(emptyStore, undefined, {
      requestInteractiveAuth: (prompt) => root.requestInteractiveAuth(prompt),
      readAuthIdentity: () => ({ runtimeId: 'child', runtimeKind: 'subagent' }),
    });
    const sibling = new OAuthManager(emptyStore, undefined, {
      requestInteractiveAuth: (prompt) => root.requestInteractiveAuth(prompt),
      readAuthIdentity: () => ({
        runtimeId: 'sibling',
        runtimeKind: 'subagent',
      }),
    });
    const provider = {
      name: 'held',
      initiateAuth: async (): Promise<OAuthToken> => {
        throw new Error('Children cannot launch authentication');
      },
      getToken: async () => null,
      refreshToken: async () => null,
    };
    child.registerProvider(provider);
    sibling.registerProvider(provider);
    const held = gate();
    let hostSignal: AbortSignal | undefined;
    root.bindInteractiveAuthHost(async (_challenge, signal) => {
      hostSignal = signal;
      await held.promise;
    });
    const childRequest = child
      .getToken('held', 'default')
      .catch((error: unknown) => error);
    const siblingRequest = sibling
      .getToken('held', 'default')
      .catch((error: unknown) => error);
    let disposed = false;
    let retirement: Promise<unknown> | undefined;
    try {
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(root.getInteractiveAuthSessions()[0]?.waiterCount).toBe(2);
      retirement = child.dispose().then(
        () => {
          disposed = true;
        },
        (error: unknown) => {
          disposed = true;
          return error;
        },
      );
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(disposed).toBe(true);
      expect(await childRequest).toMatchObject({ outcomeKind: 'cancelled' });
      expect(await retirement).toBeInstanceOf(AggregateError);
      expect(root.getInteractiveAuthSessions()[0]?.waiterCount).toBe(1);
      expect(hostSignal?.aborted).toBe(false);
      held.release();
      expect(await siblingRequest).toBeNull();
      await expect(child.getToken('held')).rejects.toThrow('disposed');
    } finally {
      held.release();
      await Promise.all([childRequest, siblingRequest, retirement]);
      await Promise.allSettled([
        child.dispose(),
        sibling.dispose(),
        root.dispose(),
      ]);
    }
  });
});
