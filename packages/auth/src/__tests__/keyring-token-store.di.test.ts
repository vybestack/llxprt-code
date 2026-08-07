/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * @plan PLAN-20260608-ISSUE1586.P10
 * @requirement REQ-AUTH-001.1, REQ-TEST-001.1, REQ-TEST-001.3
 *
 * KeyringTokenStore DI behavioral tests.
 * Tests use ISecureStore test doubles (in-memory and file-backed) to verify
 * KeyringTokenStore behavior independently of any concrete SecureStore
 * implementation. Assertions are on stored/retrieved token data and
 * observable state, not on mock call counts (no toHaveBeenCalled theater).
 */

import { describe, it, expect, afterEach } from 'bun:test';
import * as path from 'node:path';
import { mkdtempSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import { KeyringTokenStore } from '../keyring-token-store.js';
import type {
  IDebugLogger,
  ISecureStore,
  ISecureStoreError,
} from '../interfaces/index.js';
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

/**
 * File-backed ISecureStore double that simulates durable on-disk persistence:
 * writes survive across distinct double instances pointing at the same dir
 * (cross-instance consistency). Distinct from the in-memory Map double (which
 * has no on-disk artifacts). Both satisfy ISecureStore, so the backend
 * conformance describe.each verifies KeyringTokenStore against both shapes.
 */
function createFileBackedSecureStore(dir: string): ISecureStore {
  // Reversible filename encoding so the original key (including the ':'
  // separator KeyringTokenStore relies on) round-trips through list(),
  // mirroring how the real SecureStore fallback decodes filenames back to keys.
  const encodeKey = (key: string): string => encodeURIComponent(key) + '.dat';
  const decodeName = (name: string): string =>
    decodeURIComponent(name.slice(0, -4));
  const resolve = (key: string): string => path.join(dir, encodeKey(key));
  return {
    get: async (key) => {
      try {
        return await fs.readFile(resolve(key), 'utf8');
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw err;
      }
    },
    set: async (key, value) => {
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(resolve(key), value, 'utf8');
    },
    delete: async (key) => {
      try {
        await fs.unlink(resolve(key));
        return true;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
        throw err;
      }
    },
    list: async () => {
      try {
        const entries = await fs.readdir(dir);
        return entries
          .filter((f) => f.endsWith('.dat'))
          .map((f) => decodeName(f));
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw err;
      }
    },
    has: async (key) => {
      try {
        await fs.access(resolve(key));
        return true;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
        throw err;
      }
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

/**
 * Per-suite temp-lock-dir ownership. Each describe block owns its own tracker
 * (not a shared module-level array) so concurrent test files and sibling
 * suites do not share mutable state. The tracker collects dirs created by {@link freshLockDir}
 * within a single suite; {@link cleanupLockDirs} removes them in afterEach.
 *
 * Within a single suite, the tracker's `dirs` array is mutated by
 * {@link freshLockDir} (push) and {@link cleanupLockDirs} (splice). This is
 * safe ONLY under sequential execution — see the `describe.sequential`
 * usage below and its rationale.
 *
 * Cleanup errors stay observable: each rm failure is collected and surfaced
 * after the loop so a failed cleanup does not silently orphan temp dirs or
 * mask a real failure (cleanup-error observability contract).
 */
interface LockDirTracker {
  readonly dirs: string[];
  freshLockDir(): string;
  cleanupLockDirs(): Promise<void>;
}

function createLockDirTracker(): LockDirTracker {
  const dirs: string[] = [];
  return {
    dirs,
    freshLockDir(): string {
      const dir = mkdtempSync(path.join(os.tmpdir(), 'llxprt-auth-di-locks-'));
      dirs.push(dir);
      return dir;
    },
    async cleanupLockDirs(): Promise<void> {
      const cleanupErrors: unknown[] = [];
      for (const dir of dirs.splice(0)) {
        try {
          await fs.rm(dir, { recursive: true, force: true });
        } catch (error) {
          cleanupErrors.push(error);
        }
      }
      if (cleanupErrors.length > 0) {
        throw new Error(
          `afterEach cleanup failed for ${cleanupErrors.length} dir(s): ${cleanupErrors.map((e) => (e instanceof Error ? e.message : String(e))).join('; ')}`,
        );
      }
    },
  };
}

// ─── Sequential execution rationale ─────────────────────────────────────────
//
// Both suites below use plain `describe`. The per-suite `LockDirTracker.dirs`
// array is mutated by freshLockDir (push) and cleanupLockDirs (splice).
// Bun's test runner executes tests sequentially within a file by default, so
// these mutations are race-free without describe.sequential (which Bun does
// not support — it only exists in Vitest).
//
// The alternative (truly per-test ownership) would require each test to own
// and clean up its own dir directly rather than via a shared tracker; that is
// more verbose and loses the shared cleanup-error-observability guarantee.

describe('KeyringTokenStore DI behavioral tests', () => {
  // Per-suite ownership: this describe owns its own tracker so concurrent
  // test files / sibling suites do not share mutable lock-dir state.
  // Sequential execution keeps the tracker's mutable
  // `dirs` array race-free within this suite — see the rationale above.
  const locks = createLockDirTracker();
  afterEach(() => locks.cleanupLockDirs());

  it('saveToken → getToken round-trip: stored token data is retrievable', async () => {
    const store = createInMemorySecureStore();
    const tokenStore = new KeyringTokenStore({
      secureStore: store,
      lockDir: locks.freshLockDir(),
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
      lockDir: locks.freshLockDir(),
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
      lockDir: locks.freshLockDir(),
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
      lockDir: locks.freshLockDir(),
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
      lockDir: locks.freshLockDir(),
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
      lockDir: locks.freshLockDir(),
      logger: createNoOpLogger(),
    });

    // Should NOT throw — removeToken is best-effort
    await expect(tokenStore.removeToken('provider')).resolves.toBeUndefined();
  });

  it('listProviders returns saved providers in sorted order', async () => {
    const store = createInMemorySecureStore();
    const tokenStore = new KeyringTokenStore({
      secureStore: store,
      lockDir: locks.freshLockDir(),
      logger: createNoOpLogger(),
    });

    await tokenStore.saveToken('device-code-test', VALID_TOKEN);
    await tokenStore.saveToken('anthropic', VALID_TOKEN);
    await tokenStore.saveToken('gemini', VALID_TOKEN);

    const providers = await tokenStore.listProviders();
    expect(providers).toStrictEqual([
      'anthropic',
      'device-code-test',
      'gemini',
    ]);
  });

  it('listProviders deduplicates across buckets', async () => {
    const store = createInMemorySecureStore();
    const tokenStore = new KeyringTokenStore({
      secureStore: store,
      lockDir: locks.freshLockDir(),
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
      lockDir: locks.freshLockDir(),
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
      lockDir: locks.freshLockDir(),
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
      lockDir: locks.freshLockDir(),
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
      lockDir: locks.freshLockDir(),
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
      lockDir: locks.freshLockDir(),
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
      lockDir: locks.freshLockDir(),
      logger: createNoOpLogger(),
    });

    const result = await tokenStore.getToken('provider');
    expect(result).toBeNull();
  });

  it('saveToken persists validated token schema to ISecureStore', async () => {
    const store = createInMemorySecureStore();
    const tokenStore = new KeyringTokenStore({
      secureStore: store,
      lockDir: locks.freshLockDir(),
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
      lockDir: locks.freshLockDir(),
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
      lockDir: locks.freshLockDir(),
      logger: createNoOpLogger(),
    });
    await tokenStore.saveToken('provider', VALID_TOKEN);
    const result = await tokenStore.getToken('provider');
    expect(result).not.toBeNull();
    expect(result!.access_token).toBe('test-access-token');
  });
});

describe('KeyringTokenStore lockDir contract (P8)', () => {
  // Per-suite ownership: this sibling describe owns its own tracker so it does
  // not rely on (or mutate) the first suite's mutable state, and its
  // afterEach cleanup is wired directly here (sibling scopes do not inherit
  // the parent's afterEach). Bun executes tests sequentially within a file
  // by default, keeping the tracker's mutable `dirs` array race-free.
  const locks = createLockDirTracker();
  afterEach(() => locks.cleanupLockDirs());

  it('constructor requires lockDir and directs callers to createKeyringTokenStore()', () => {
    const store = createInMemorySecureStore();
    expect(
      () =>
        new KeyringTokenStore({
          secureStore: store,
          logger: createNoOpLogger(),
        }),
    ).toThrow(/createKeyringTokenStore/);
  });

  it('acquireRefreshLock creates the lock file inside the injected lockDir', async () => {
    const store = createInMemorySecureStore();
    const lockDir = locks.freshLockDir();
    const tokenStore = new KeyringTokenStore({
      secureStore: store,
      lockDir,
      logger: createNoOpLogger(),
    });

    const acquired = await tokenStore.acquireRefreshLock('codex', {
      waitMs: 1000,
    });
    expect(acquired).toBe(true);

    const lockFile = path.join(lockDir, 'codex-refresh.lock');
    const stat = await fs.stat(lockFile);
    expect(stat.isFile()).toBe(true);

    await tokenStore.releaseRefreshLock('codex');
  });

  it('acquireAuthLock creates an auth lock file inside the injected lockDir', async () => {
    const store = createInMemorySecureStore();
    const lockDir = locks.freshLockDir();
    const tokenStore = new KeyringTokenStore({
      secureStore: store,
      lockDir,
      logger: createNoOpLogger(),
    });

    const acquired = await tokenStore.acquireAuthLock('gemini', {
      waitMs: 1000,
    });
    expect(acquired).toBe(true);

    const lockFile = path.join(lockDir, 'gemini-auth.lock');
    const stat = await fs.stat(lockFile);
    expect(stat.isFile()).toBe(true);

    await tokenStore.releaseAuthLock('gemini');
  });
});

// ─── ISecureStore backend conformance (in-memory vs file-backed) ────────────
//
// KeyringTokenStore consumes any ISecureStore via DI. This suite verifies that
// KeyringTokenStore behaves correctly regardless of which ISecureStore backend
// is injected: an in-memory Map double (simulating a keyring-style store with
// no on-disk artifacts) and a file-backed double (simulating durable on-disk
// persistence). Both satisfy the ISecureStore contract. This is NOT coverage
// of the real SecureStore keyring/fallback implementations — that coverage
// lives in packages/storage and packages/core — but rather confirms
// KeyringTokenStore's backend-agnostic DI contract.

interface SecureStoreMode {
  readonly mode: string;
  readonly makeStore: (dir: string) => ISecureStore;
}

const DUAL_MODES: readonly SecureStoreMode[] = [
  {
    mode: 'in-memory',
    makeStore: () => createInMemorySecureStore(),
  },
  {
    mode: 'file-backed',
    makeStore: (dir) => createFileBackedSecureStore(dir),
  },
];

describe.each(DUAL_MODES)(
  'KeyringTokenStore ISecureStore backend conformance [$mode]',
  ({ makeStore }) => {
    // This suite owns its own temp-dir tracker so file-backed stores get
    // isolated, cleaned-up directories. Sequential execution keeps the
    // mutable `dirs` array race-free within the suite.
    const locks = createLockDirTracker();
    afterEach(() => locks.cleanupLockDirs());

    it('saveToken → getToken round-trips through the injected store', async () => {
      const store = makeStore(locks.freshLockDir());
      const tokenStore = new KeyringTokenStore({
        secureStore: store,
        lockDir: locks.freshLockDir(),
        logger: createNoOpLogger(),
      });

      await tokenStore.saveToken('dual', VALID_TOKEN);
      const loaded = await tokenStore.getToken('dual');
      expect(loaded).not.toBeNull();
      expect(loaded!.access_token).toBe('test-access-token');
      expect(loaded!.refresh_token).toBe('test-refresh-token');
      expect(loaded!.token_type).toBe('Bearer');
      expect(loaded!.scope).toBe('openid profile');
    });

    it('saveToken overwrites a previous token for the same provider+bucket', async () => {
      const store = makeStore(locks.freshLockDir());
      const tokenStore = new KeyringTokenStore({
        secureStore: store,
        lockDir: locks.freshLockDir(),
        logger: createNoOpLogger(),
      });

      await tokenStore.saveToken('dual', {
        ...VALID_TOKEN,
        access_token: 'first',
      });
      await tokenStore.saveToken('dual', {
        ...VALID_TOKEN,
        access_token: 'second',
      });
      const loaded = await tokenStore.getToken('dual');
      expect(loaded!.access_token).toBe('second');
    });

    it('removeToken deletes the token; subsequent getToken returns null', async () => {
      const store = makeStore(locks.freshLockDir());
      const tokenStore = new KeyringTokenStore({
        secureStore: store,
        lockDir: locks.freshLockDir(),
        logger: createNoOpLogger(),
      });

      await tokenStore.saveToken('dual', VALID_TOKEN);
      await tokenStore.removeToken('dual');
      expect(await tokenStore.getToken('dual')).toBeNull();
    });

    it('listProviders returns saved providers in sorted order', async () => {
      const store = makeStore(locks.freshLockDir());
      const tokenStore = new KeyringTokenStore({
        secureStore: store,
        lockDir: locks.freshLockDir(),
        logger: createNoOpLogger(),
      });

      await tokenStore.saveToken('gemini', VALID_TOKEN);
      await tokenStore.saveToken('anthropic', VALID_TOKEN);
      const providers = await tokenStore.listProviders();
      expect(providers).toStrictEqual(['anthropic', 'gemini']);
    });

    it('getToken returns null for invalid JSON in the store', async () => {
      const store = makeStore(locks.freshLockDir());
      // Seed corrupt data via the store's own set() (works for both doubles).
      await store.set('dual:default', 'not-valid-json{{{');
      const tokenStore = new KeyringTokenStore({
        secureStore: store,
        lockDir: locks.freshLockDir(),
        logger: createNoOpLogger(),
      });

      expect(await tokenStore.getToken('dual')).toBeNull();
    });

    it('getToken returns null when the store has no entry', async () => {
      const store = makeStore(locks.freshLockDir());
      const tokenStore = new KeyringTokenStore({
        secureStore: store,
        lockDir: locks.freshLockDir(),
        logger: createNoOpLogger(),
      });

      expect(await tokenStore.getToken('absent')).toBeNull();
    });

    it('getToken re-throws non-CORRUPT errors from the injected store', async () => {
      const base = makeStore(locks.freshLockDir());
      // Override get to throw a DENIED (non-CORRUPT) error.
      base.get = async () => {
        const error = new Error('Permission denied') as ISecureStoreError;
        error.code = 'DENIED';
        error.remediation = 'Check credentials';
        throw error;
      };
      const tokenStore = new KeyringTokenStore({
        secureStore: base,
        lockDir: locks.freshLockDir(),
        logger: createNoOpLogger(),
      });

      await expect(tokenStore.getToken('dual')).rejects.toThrow(
        'Permission denied',
      );
    });
  },
);

// ─── File-backed persistence (fallback-path distinction) ────────────────────
//
// The cross-instance persistence property distinguishes the file-backed double
// (simulating the encrypted-file fallback's durable on-disk artifacts) from
// the in-memory Map double (simulating the keyring path). It lives outside the
// shared describe.each because it is only meaningful for the file-backed store.

describe('KeyringTokenStore file-backed cross-instance persistence', () => {
  const locks = createLockDirTracker();
  afterEach(() => locks.cleanupLockDirs());

  it('a token saved by one KeyringTokenStore is visible to a second instance backed by the same dir', async () => {
    const dir = locks.freshLockDir();
    const writerStore = createFileBackedSecureStore(dir);
    const writer = new KeyringTokenStore({
      secureStore: writerStore,
      lockDir: locks.freshLockDir(),
      logger: createNoOpLogger(),
    });
    await writer.saveToken('persistent', VALID_TOKEN);

    const readerStore = createFileBackedSecureStore(dir);
    const reader = new KeyringTokenStore({
      secureStore: readerStore,
      lockDir: locks.freshLockDir(),
      logger: createNoOpLogger(),
    });
    const loaded = await reader.getToken('persistent');
    expect(loaded).not.toBeNull();
    expect(loaded!.access_token).toBe('test-access-token');
  });
});
