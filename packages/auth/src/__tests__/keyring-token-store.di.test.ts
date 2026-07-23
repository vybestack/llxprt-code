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

import { describe, it, expect, afterEach } from 'vitest';
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
// Both suites below use `describe.sequential` rather than `describe`. The
// per-suite `LockDirTracker.dirs` array is mutated by freshLockDir (push) and
// cleanupLockDirs (splice). Under vitest's default concurrent test execution
// these mutations would race (lost pushes, splice-on-stale-length, torn
// cleanup), orphaning temp dirs or corrupting the tracker. Sequential
// execution guarantees:
//   - only one test mutates `dirs` at a time,
//   - afterEach cleanup sees a stable snapshot of created dirs.
//
// The alternative (truly per-test ownership) would require each test to own
// and clean up its own dir directly rather than via a shared tracker; that is
// more verbose and loses the shared cleanup-error-observability guarantee.
// `describe.sequential` is the minimal, explicit enforcement that keeps the
// tracker pattern safe while preserving observable cleanup failures.

describe.sequential('KeyringTokenStore DI behavioral tests', () => {
  // Per-suite ownership: this describe owns its own tracker so concurrent
  // test files / sibling suites do not share mutable lock-dir state.
  // Sequential execution (describe.sequential) keeps the tracker's mutable
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

describe.sequential('KeyringTokenStore lockDir contract (P8)', () => {
  // Per-suite ownership: this sibling describe owns its own tracker so it does
  // not rely on (or mutate) the first suite's mutable state, and its
  // afterEach cleanup is wired directly here (sibling scopes do not inherit
  // the parent's afterEach). Sequential execution (describe.sequential) keeps
  // the tracker's mutable `dirs` array race-free within this suite — see the
  // rationale above.
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
