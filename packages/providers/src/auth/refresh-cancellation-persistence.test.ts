/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { ProviderRegistry } from './provider-registry.js';
import { ProactiveRenewalManager } from './proactive-renewal-manager.js';
import {
  RefreshLockReleases,
  refreshTokenUnderLock,
} from './token-refresh-helper.js';
import { refreshStoredToken } from './token-force-refresh-helper.js';
import {
  MemoryTokenStore,
  makeExpiredToken,
  makeToken,
} from './__tests__/behavioral/test-utils.js';

describe('refresh cancellation persistence', () => {
  it.each(['expired', 'forced'])(
    'persists a successful %s rotation before reporting cancellation',
    async (mode) => {
      const store = new MemoryTokenStore();
      const original = makeExpiredToken('original');
      const rotated = makeToken('rotated');
      await store.saveToken('codex', original, 'work');
      const owner = new AbortController();
      const cancellation = new Error('Owner retired after upstream rotation');
      const registry = new ProviderRegistry();
      registry.registerProvider({
        name: 'codex',
        initiateAuth: async () => original,
        getToken: async () => store.getToken('codex', 'work'),
        refreshToken: async () => {
          owner.abort(cancellation);
          return rotated;
        },
      });
      const renewals = new ProactiveRenewalManager(
        store,
        (name) => registry.getProvider(name),
        () => true,
      );
      let lockReleaseToken: string | undefined;
      store.releaseRefreshLock = async () => {
        lockReleaseToken = (await store.getToken('codex', 'work'))
          ?.refresh_token;
      };
      const work =
        mode === 'expired'
          ? refreshTokenUnderLock(
              'codex',
              'work',
              original,
              Math.floor(Date.now() / 1000) + 30,
              store,
              registry,
              renewals,
              new RefreshLockReleases(store),
              owner.signal,
            )
          : refreshStoredToken(
              'codex',
              original,
              'work',
              store,
              registry,
              renewals,
              owner.signal,
            );
      try {
        const outcome = await work.then(
          () => undefined,
          (error: unknown) => error,
        );
        const saved = await store.getToken('codex', 'work');
        expect(saved?.refresh_token).not.toBe(original.refresh_token);
        expect(saved?.refresh_token).toBe(rotated.refresh_token);
        expect(saved?.access_token).toBe(rotated.access_token);
        expect(outcome).toBe(cancellation);
        expect(lockReleaseToken).toBe(
          mode === 'expired' ? rotated.refresh_token : undefined,
        );
      } finally {
        await renewals.cancelAndJoin();
      }
    },
  );
});
