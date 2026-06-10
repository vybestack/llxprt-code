/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * @plan PLAN-20260608-ISSUE1586.P10
 * @requirement REQ-AUTH-001.1, REQ-TEST-001.1, REQ-TEST-001.3
 *
 * KeyringTokenStore DI behavioral tests.
 * All tests use in-memory ISecureStore test doubles.
 * Assertions are on stored/retrieved token data and observable state,
 * not on mock call counts (no toHaveBeenCalled theater).
 */

import { describe, it, expect } from 'vitest';
import { KeyringTokenStore } from '../keyring-token-store.js';
import type {
  ISecureStore,
  ISecureStoreError,
} from '../interfaces/secure-store.js';
import type { IDebugLogger } from '../interfaces/debug-logger.js';
import type { OAuthToken } from '../types.js';

// ─── Test doubles ────────────────────────────────────────────────────────────

function createInMemorySecureStore(): ISecureStore & {
  readonly entries: Map<string, string>;
} {
  const entries = new Map<string, string>();
  return {
    entries,
    get: async (key) => entries.get(key) ?? null,
    set: async (key, value) => {
      entries.set(key, value);
    },
    delete: async (key) => entries.delete(key),
    list: async () => [...entries.keys()],
    has: async (key) => entries.has(key),
  };
}

function createFailingSecureStore(
  errorFactory: (op: string) => Error,
): ISecureStore {
  return {
    get: async () => {
      throw errorFactory('get');
    },
    set: async () => {
      throw errorFactory('set');
    },
    delete: async () => {
      throw errorFactory('delete');
    },
    list: async () => {
      throw errorFactory('list');
    },
    has: async () => {
      throw errorFactory('has');
    },
  };
}

function createNoOpLogger(): IDebugLogger {
  return {
    debug: () => {},
    error: () => {},
    warn: () => {},
    log: () => {},
  };
}

const VALID_TOKEN: OAuthToken = {
  access_token: 'test-access-token',
  refresh_token: 'test-refresh-token',
  expiry: Math.floor(Date.now() / 1000) + 3600,
  token_type: 'Bearer',
  scope: 'openid profile',
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('KeyringTokenStore DI behavioral tests', () => {
  it('saveToken → getToken round-trip: stored token data is retrievable', async () => {
    const store = createInMemorySecureStore();
    const tokenStore = new KeyringTokenStore({
      secureStore: store,
      logger: createNoOpLogger(),
    });

    await tokenStore.saveToken('anthropic', VALID_TOKEN);

    // Assert on the ISecureStore in-memory state
    expect(store.entries.has('anthropic:default')).toBe(true);

    // Assert on the retrieved token data
    const retrieved = await tokenStore.getToken('anthropic');
    expect(retrieved).not.toBeNull();
    expect(retrieved!.access_token).toBe('test-access-token');
    expect(retrieved!.refresh_token).toBe('test-refresh-token');
    expect(retrieved!.token_type).toBe('Bearer');
    expect(retrieved!.scope).toBe('openid profile');
  });

  it('saveToken → getToken round-trip with named bucket', async () => {
    const store = createInMemorySecureStore();
    const tokenStore = new KeyringTokenStore({
      secureStore: store,
      logger: createNoOpLogger(),
    });

    await tokenStore.saveToken('anthropic', VALID_TOKEN, 'work');

    // Bucket should be encoded in the storage key
    expect(store.entries.has('anthropic:work')).toBe(true);

    const retrieved = await tokenStore.getToken('anthropic', 'work');
    expect(retrieved).not.toBeNull();
    expect(retrieved!.access_token).toBe('test-access-token');

    // Default bucket should be empty
    const defaultRetrieved = await tokenStore.getToken('anthropic');
    expect(defaultRetrieved).toBeNull();
  });

  it('saveToken overwrites previous token for same provider+bucket', async () => {
    const store = createInMemorySecureStore();
    const tokenStore = new KeyringTokenStore({
      secureStore: store,
      logger: createNoOpLogger(),
    });

    const firstToken: OAuthToken = {
      ...VALID_TOKEN,
      access_token: 'first-token',
    };
    const secondToken: OAuthToken = {
      ...VALID_TOKEN,
      access_token: 'second-token',
    };

    await tokenStore.saveToken('provider', firstToken);
    await tokenStore.saveToken('provider', secondToken);

    // Only one entry in the store (overwritten, not duplicated)
    expect(store.entries.size).toBe(1);

    const retrieved = await tokenStore.getToken('provider');
    expect(retrieved!.access_token).toBe('second-token');
  });

  it('removeToken deletes from ISecureStore; subsequent getToken returns null', async () => {
    const store = createInMemorySecureStore();
    const tokenStore = new KeyringTokenStore({
      secureStore: store,
      logger: createNoOpLogger(),
    });

    await tokenStore.saveToken('anthropic', VALID_TOKEN);
    expect(store.entries.has('anthropic:default')).toBe(true);

    await tokenStore.removeToken('anthropic');

    // Assert ISecureStore state: key removed
    expect(store.entries.has('anthropic:default')).toBe(false);

    // Assert retrieval returns null
    const retrieved = await tokenStore.getToken('anthropic');
    expect(retrieved).toBeNull();
  });

  it('removeToken removes only the specified bucket, not other buckets', async () => {
    const store = createInMemorySecureStore();
    const tokenStore = new KeyringTokenStore({
      secureStore: store,
      logger: createNoOpLogger(),
    });

    const workToken: OAuthToken = {
      ...VALID_TOKEN,
      access_token: 'work-token',
    };
    const personalToken: OAuthToken = {
      ...VALID_TOKEN,
      access_token: 'personal-token',
    };

    await tokenStore.saveToken('provider', VALID_TOKEN);
    await tokenStore.saveToken('provider', workToken, 'work');
    await tokenStore.saveToken('provider', personalToken, 'personal');

    await tokenStore.removeToken('provider', 'work');

    // Only 'work' bucket removed; 'default' and 'personal' intact
    expect(await tokenStore.getToken('provider')).not.toBeNull();
    expect(await tokenStore.getToken('provider', 'work')).toBeNull();
    expect(await tokenStore.getToken('provider', 'personal')).not.toBeNull();
  });

  it('removeToken is best-effort: does not throw when ISecureStore.delete throws', async () => {
    const store = createFailingSecureStore(
      (op) => new Error(`SecureStore ${op} failed`) as ISecureStoreError,
    );
    // Override delete to throw
    store.delete = async () => {
      throw new Error(
        'SecureStore delete permission denied',
      ) as unknown as ISecureStoreError;
    };

    const tokenStore = new KeyringTokenStore({
      secureStore: store,
      logger: createNoOpLogger(),
    });

    // Should NOT throw — removeToken is best-effort
    await expect(tokenStore.removeToken('provider')).resolves.toBeUndefined();
  });

  it('listProviders returns saved providers in sorted order', async () => {
    const store = createInMemorySecureStore();
    const tokenStore = new KeyringTokenStore({
      secureStore: store,
      logger: createNoOpLogger(),
    });

    await tokenStore.saveToken('qwen', VALID_TOKEN);
    await tokenStore.saveToken('anthropic', VALID_TOKEN);
    await tokenStore.saveToken('gemini', VALID_TOKEN);

    const providers = await tokenStore.listProviders();
    expect(providers).toStrictEqual(['anthropic', 'gemini', 'qwen']);
  });

  it('listProviders deduplicates across buckets', async () => {
    const store = createInMemorySecureStore();
    const tokenStore = new KeyringTokenStore({
      secureStore: store,
      logger: createNoOpLogger(),
    });

    await tokenStore.saveToken('anthropic', VALID_TOKEN);
    await tokenStore.saveToken('anthropic', VALID_TOKEN, 'work');
    await tokenStore.saveToken('anthropic', VALID_TOKEN, 'personal');

    const providers = await tokenStore.listProviders();
    expect(providers).toStrictEqual(['anthropic']);
  });

  it('listProviders returns empty array when ISecureStore.list throws', async () => {
    const store = createFailingSecureStore(
      () =>
        new Error('SecureStore unavailable') as unknown as ISecureStoreError,
    );
    const tokenStore = new KeyringTokenStore({
      secureStore: store,
      logger: createNoOpLogger(),
    });

    // Should return empty, not throw
    const providers = await tokenStore.listProviders();
    expect(providers).toStrictEqual([]);
  });

  it('getToken returns null when ISecureStore.get throws CORRUPT error', async () => {
    const store = createInMemorySecureStore();
    // Override get to throw CORRUPT
    store.get = async () => {
      const error = new Error('Data corruption detected') as ISecureStoreError;
      error.code = 'CORRUPT';
      error.remediation = 'Re-authenticate';
      throw error;
    };

    const tokenStore = new KeyringTokenStore({
      secureStore: store,
      logger: createNoOpLogger(),
    });

    // Should return null for corrupt data, not throw
    const result = await tokenStore.getToken('provider');
    expect(result).toBeNull();
  });

  it('getToken returns null when ISecureStore.get returns null', async () => {
    const store = createInMemorySecureStore();
    const tokenStore = new KeyringTokenStore({
      secureStore: store,
      logger: createNoOpLogger(),
    });

    const result = await tokenStore.getToken('nonexistent');
    expect(result).toBeNull();
  });

  it('getToken re-throws non-CORRUPT errors from ISecureStore', async () => {
    const store = createInMemorySecureStore();
    store.get = async () => {
      const error = new Error('Permission denied') as ISecureStoreError;
      error.code = 'DENIED';
      error.remediation = 'Check credentials';
      throw error;
    };

    const tokenStore = new KeyringTokenStore({
      secureStore: store,
      logger: createNoOpLogger(),
    });

    await expect(tokenStore.getToken('provider')).rejects.toThrow(
      'Permission denied',
    );
  });

  it('getToken returns null for invalid JSON in store', async () => {
    const store = createInMemorySecureStore();
    store.entries.set('provider:default', 'not-valid-json{{{');

    const tokenStore = new KeyringTokenStore({
      secureStore: store,
      logger: createNoOpLogger(),
    });

    const result = await tokenStore.getToken('provider');
    expect(result).toBeNull();
  });

  it('getToken returns null for JSON that does not match OAuthTokenSchema', async () => {
    const store = createInMemorySecureStore();
    store.entries.set('provider:default', JSON.stringify({ wrong: 'shape' }));

    const tokenStore = new KeyringTokenStore({
      secureStore: store,
      logger: createNoOpLogger(),
    });

    const result = await tokenStore.getToken('provider');
    expect(result).toBeNull();
  });

  it('saveToken persists validated token schema to ISecureStore', async () => {
    const store = createInMemorySecureStore();
    const tokenStore = new KeyringTokenStore({
      secureStore: store,
      logger: createNoOpLogger(),
    });

    const token: OAuthToken = {
      access_token: 'at',
      expiry: 1700000000,
      token_type: 'Bearer',
      scope: null,
    };

    await tokenStore.saveToken('provider', token);

    // The stored raw value should be parseable JSON containing validated fields
    const raw = store.entries.get('provider:default');
    expect(raw).toBeDefined();
    const parsed = JSON.parse(raw!);
    expect(parsed.access_token).toBe('at');
    expect(parsed.token_type).toBe('Bearer');
  });

  it('listBuckets returns all buckets for a provider', async () => {
    const store = createInMemorySecureStore();
    const tokenStore = new KeyringTokenStore({
      secureStore: store,
      logger: createNoOpLogger(),
    });

    await tokenStore.saveToken('provider', VALID_TOKEN);
    await tokenStore.saveToken('provider', VALID_TOKEN, 'work');
    await tokenStore.saveToken('provider', VALID_TOKEN, 'personal');

    const buckets = await tokenStore.listBuckets('provider');
    expect(buckets).toStrictEqual(['default', 'personal', 'work']);
  });

  it('constructor requires secureStore: operations fail gracefully when DI is incomplete', async () => {
    // Observable behavior: constructing without secureStore throws, ensuring
    // callers cannot accidentally use an incompletely-wired store.
    // This is a DI guard contract — the constructor enforces required dependencies.
    expect(() => new KeyringTokenStore()).toThrow('ISecureStore');

    // With proper DI, all operations work through injected ISecureStore
    const store = createInMemorySecureStore();
    const tokenStore = new KeyringTokenStore({
      secureStore: store,
      logger: createNoOpLogger(),
    });
    await tokenStore.saveToken('provider', VALID_TOKEN);
    const result = await tokenStore.getToken('provider');
    expect(result).not.toBeNull();
    expect(result!.access_token).toBe('test-access-token');
  });
});
