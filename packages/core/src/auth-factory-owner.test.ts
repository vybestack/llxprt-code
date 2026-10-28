/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { createAuthPrecedenceResolver } from './auth-factories.js';
import { ProviderKeyStorage } from './storage/provider-key-storage.js';
import { SecureStore, type KeyringAdapter } from './storage/secure-store.js';

function createStorage(): ProviderKeyStorage {
  const keys = new Map<string, string>();
  const keyring: KeyringAdapter = {
    getPassword: async (service, account) =>
      keys.get(`${service}:${account}`) ?? null,
    setPassword: async (service, account, value) => {
      keys.set(`${service}:${account}`, value);
    },
    deletePassword: async (service, account) =>
      keys.delete(`${service}:${account}`),
  };
  return new ProviderKeyStorage({
    secureStore: new SecureStore('auth-owner-test', {
      keyringLoader: async () => keyring,
      fallbackPolicy: 'deny',
    }),
  });
}

describe('auth factory credential ownership', () => {
  it('resolves same-name keys from the supplied owner and preserves its sibling after deletion', async () => {
    const firstStorage = createStorage();
    const secondStorage = createStorage();
    await firstStorage.saveKey('shared', 'first-secret');
    await secondStorage.saveKey('shared', 'second-secret');
    const settingsService = {
      get: (key: string) => (key === 'auth-key-name' ? 'shared' : undefined),
      getProviderSettings: () => ({}),
      on: () => {},
      off: () => {},
    };
    const first = createAuthPrecedenceResolver(
      { providerId: 'owner-test' },
      {
        settingsService,
        oauthManager: undefined,
        providerKeyStorage: firstStorage,
      },
    );
    const second = createAuthPrecedenceResolver(
      { providerId: 'owner-test' },
      {
        settingsService,
        oauthManager: undefined,
        providerKeyStorage: secondStorage,
      },
    );
    expect(await first.resolveAuthentication()).toBe('first-secret');
    expect(await second.resolveAuthentication()).toBe('second-secret');
    await firstStorage.deleteKey('shared');
    expect(await first.resolveAuthentication()).toBeNull();
    expect(await second.resolveAuthentication()).toBe('second-secret');
  });
});
