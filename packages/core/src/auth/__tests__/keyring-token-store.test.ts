/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for KeyringTokenStore.
 *
 * Tests drive the implementation (TDD): they should all FAIL against the
 * current stub, which throws NotYetImplemented for every method.
 *
 * @plan PLAN-20260213-KEYRINGTOKENSTORE.P05
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import * as fc from 'fast-check';
import { KeyringTokenStore } from '../keyring-token-store.js';
import {
  SecureStore,
  SecureStoreError,
  type KeyringAdapter,
} from '../../storage/secure-store.js';
import type { OAuthToken } from '../types.js';
import { DebugLogger } from '../../debug/index.js';

// ─── Dual-Mode Configuration ─────────────────────────────────────────────────

const FORCE_FALLBACK =
  process.env.LLXPRT_SECURE_STORE_FORCE_FALLBACK === 'true';
const MODE_LABEL = FORCE_FALLBACK ? 'fallback' : 'keyring';

// ─── Test Helpers ────────────────────────────────────────────────────────────

/**
 * Creates an in-memory mock keyring adapter for testing keychain operations.
 * This is injected via SecureStoreOptions.keyringLoader — no mock theater.
 */
function createMockKeyring(): KeyringAdapter & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    getPassword: async (service: string, account: string) =>
      store.get(`${service}:${account}`) ?? null,
    setPassword: async (service: string, account: string, password: string) => {
      store.set(`${service}:${account}`, password);
    },
    deletePassword: async (service: string, account: string) =>
      store.delete(`${service}:${account}`),
    findCredentials: async (service: string) => {
      const results: Array<{ account: string; password: string }> = [];
      for (const [key, value] of store.entries()) {
        if (key.startsWith(`${service}:`)) {
          results.push({
            account: key.slice(service.length + 1),
            password: value,
          });
        }
      }
      return results;
    },
  };
}

/**
 * Creates a keytarLoader based on the current dual-mode configuration.
 * When FORCE_FALLBACK is true, the loader throws MODULE_NOT_FOUND.
 * Otherwise, it returns a working in-memory mock keyring.
 */
function createKeytarLoader(): {
  loader: () => Promise<KeyringAdapter | null>;
  mockKeyring: (KeyringAdapter & { store: Map<string, string> }) | null;
} {
  if (FORCE_FALLBACK) {
    return {
      loader: async () => {
        const err = new Error('keytar not found');
        (err as NodeJS.ErrnoException).code = 'MODULE_NOT_FOUND';
        throw err;
      },
      mockKeyring: null,
    };
  }
  const mock = createMockKeyring();
  return {
    loader: async () => mock,
    mockKeyring: mock,
  };
}

/**
 * Creates a temp directory for use as SecureStore fallbackDir in tests.
 */
async function createTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'keyring-token-store-test-'));
}

/**
 * Creates a test-ready KeyringTokenStore with injected SecureStore.
 * Returns the store, the underlying SecureStore (for direct data manipulation
 * in corrupt-data tests), and the temp directory for cleanup.
 */
async function createTestStore(): Promise<{
  tokenStore: KeyringTokenStore;
  secureStore: SecureStore;
  tempDir: string;
  mockKeyring: (KeyringAdapter & { store: Map<string, string> }) | null;
}> {
  const tempDir = await createTempDir();
  const { loader, mockKeyring } = createKeytarLoader();
  const secureStore = new SecureStore('llxprt-code-oauth', {
    fallbackDir: tempDir,
    fallbackPolicy: 'allow',
    keyringLoader: loader,
  });
  const lockDir = path.join(tempDir, 'locks');
  const tokenStore = new KeyringTokenStore({ secureStore, lockDir });
  return { tokenStore, secureStore, tempDir, mockKeyring };
}

// ─── Test Data Factories ─────────────────────────────────────────────────────

function makeMinimalToken(overrides?: Partial<OAuthToken>): OAuthToken {
  return {
    access_token: 'at-' + crypto.randomUUID().substring(0, 8),
    refresh_token: 'rt-' + crypto.randomUUID().substring(0, 8),
    expiry: Math.floor(Date.now() / 1000) + 3600,
    scope: 'openid profile',
    token_type: 'Bearer',
    resource_url: 'https://api.example.com',
    ...overrides,
  };
}

function makeCodexToken(): OAuthToken & {
  account_id: string;
  id_token: string;
} {
  return {
    ...makeMinimalToken(),
    account_id: 'acct-' + crypto.randomUUID().substring(0, 8),
    id_token: 'ey.' + crypto.randomBytes(32).toString('base64'),
  };
}

// ─── fast-check Arbitraries ──────────────────────────────────────────────────

const validNameArb = fc.string({
  unit: fc.constantFrom(
    ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-'.split(
      '',
    ),
  ),
  minLength: 1,
  maxLength: 30,
});

const invalidNameArb = fc.oneof(
  fc.constant(''),
  fc.constant('has space'),
  fc.constant('has/slash'),
  fc.constant('has:colon'),
  fc.constant('has.dot'),
  fc.constant('has@at'),
  fc.constant('has!bang'),
);

const extraFieldsArb = fc.dictionary(
  fc.string({
    unit: fc.constantFrom(...'abcdefghijklmnop'.split('')),
    minLength: 1,
    maxLength: 10,
  }),
  fc.oneof(fc.string(), fc.integer(), fc.boolean()),
  { minKeys: 0, maxKeys: 5 },
);

// ─── Tests ───────────────────────────────────────────────────────────────────

console.log(
  `[keyring-token-store.test] Running in mode: ${MODE_LABEL} (LLXPRT_SECURE_STORE_FORCE_FALLBACK=${FORCE_FALLBACK})`,
);

describe(`KeyringTokenStore (mode: ${MODE_LABEL})`, () => {
  let tokenStore: KeyringTokenStore;
  let secureStore: SecureStore;
  let tempDir: string;
  let _mockKeyring: (KeyringAdapter & { store: Map<string, string> }) | null;

  beforeEach(async () => {
    const setup = await createTestStore();
    tokenStore = setup.tokenStore;
    secureStore = setup.secureStore;
    tempDir = setup.tempDir;
    _mockKeyring = setup.mockKeyring;
  });

  afterEach(async () => {
    DebugLogger.disposeAll();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  // ─── R1: Interface, Delegation, Injection ───────────────────────────────

  /**
   * @plan PLAN-20260213-KEYRINGTOKENSTORE.P05
   * @requirement R1.1
   * @given A KeyringTokenStore instance
   * @when All TokenStore interface methods are invoked
   * @then Each method performs a real operation (not just exists)
   */
  it('implements TokenStore: saveToken then getToken round-trips a token', async () => {
    const token = makeMinimalToken();
    await tokenStore.saveToken('anthropic', token);
    const retrieved = await tokenStore.getToken('anthropic');
    expect(retrieved).not.toBeNull();
    expect(retrieved!.access_token).toBe(token.access_token);
    expect(retrieved!.refresh_token).toBe(token.refresh_token);
    expect(retrieved!.expiry).toBe(token.expiry);
    expect(retrieved!.token_type).toBe(token.token_type);
  });

  /**
   * @plan PLAN-20260213-KEYRINGTOKENSTORE.P05
   * @requirement R1.2
   * @given A KeyringTokenStore with injected SecureStore
   * @when saveToken is called
   * @then Data appears in the underlying SecureStore
   */
  it('delegates storage to SecureStore: saved data retrievable via SecureStore.get', async () => {
    const token = makeMinimalToken();
    await tokenStore.saveToken('gemini', token);
    const raw = await secureStore.get('gemini:default');
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.access_token).toBe(token.access_token);
  });

  /**
   * @plan PLAN-20260213-KEYRINGTOKENSTORE.P05
   * @requirement R1.3
   * @given A pre-configured SecureStore injected via constructor options
   * @when Operations are performed on KeyringTokenStore
   * @then All operations use the injected store
   */
  it('uses injected SecureStore: data visible in same SecureStore instance', async () => {
    const token = makeMinimalToken();
    await tokenStore.saveToken('openai', token);
    const has = await secureStore.has('openai:default');
    expect(has).toBe(true);
  });

  // ─── R2: Account Key Format, Default Bucket, Validation ─────────────────

  /**
   * @plan PLAN-20260213-KEYRINGTOKENSTORE.P05
   * @requirement R2.1
   * @given provider='anthropic', bucket='work'
   * @when saveToken is called
   * @then Token stored under key 'anthropic:work' in SecureStore
   */
  it('maps provider+bucket to SecureStore key format provider:bucket', async () => {
    const token = makeMinimalToken();
    await tokenStore.saveToken('anthropic', token, 'work');
    const raw = await secureStore.get('anthropic:work');
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!).access_token).toBe(token.access_token);
  });

  /**
   * @plan PLAN-20260213-KEYRINGTOKENSTORE.P05
   * @requirement R2.2
   * @given provider='gemini', bucket is omitted
   * @when saveToken then getToken with no bucket
   * @then Token stored/retrieved under 'gemini:default'
   */
  it('uses default bucket when bucket is omitted', async () => {
    const token = makeMinimalToken();
    await tokenStore.saveToken('gemini', token);
    const raw = await secureStore.get('gemini:default');
    expect(raw).not.toBeNull();
    const retrieved = await tokenStore.getToken('gemini');
    expect(retrieved!.access_token).toBe(token.access_token);
  });

  /**
   * @plan PLAN-20260213-KEYRINGTOKENSTORE.P05
   * @requirement R2.3
   * @given provider='valid-name_123', bucket='also_valid-1'
   * @when saveToken is called
   * @then Operation succeeds without error
   */
  it('accepts valid provider and bucket names matching [a-zA-Z0-9_-]+', async () => {
    const token = makeMinimalToken();
    await tokenStore.saveToken('valid-name_123', token, 'also_valid-1');
    const retrieved = await tokenStore.getToken(
      'valid-name_123',
      'also_valid-1',
    );
    expect(retrieved).not.toBeNull();
    expect(retrieved!.access_token).toBe(token.access_token);
  });

  /**
   * @plan PLAN-20260213-KEYRINGTOKENSTORE.P05
   * @requirement R2.3
   * @given provider='invalid name' (has space)
   * @when saveToken is called
   * @then Error thrown with message identifying the invalid name
   */
  it('rejects invalid provider name with space', async () => {
    const token = makeMinimalToken();
    await expect(tokenStore.saveToken('invalid name', token)).rejects.toThrow(
      /invalid.*provider.*name/i,
    );
  });

  /**
   * @plan PLAN-20260213-KEYRINGTOKENSTORE.P05
   * @requirement R2.3
   * @given bucket='bad/bucket' (has slash)
   * @when saveToken is called
   * @then Error thrown with message identifying the invalid bucket
   */
  it('rejects invalid bucket name with special characters', async () => {
    const token = makeMinimalToken();
    await expect(
      tokenStore.saveToken('anthropic', token, 'bad/bucket'),
    ).rejects.toThrow(/invalid.*bucket.*name/i);
  });

  /**
   * @plan PLAN-20260213-KEYRINGTOKENSTORE.P05
   * @requirement R2.4
   * @given provider='bad/name'
   * @when saveToken is called
   * @then Error thrown before any SecureStore write occurs
   */
  it('throws before storage when name validation fails', async () => {
    const token = makeMinimalToken();
    // Pre-verify SecureStore is empty
    const keysBefore = await secureStore.list();
    await expect(tokenStore.saveToken('bad/name', token)).rejects.toThrow();
    // Verify no keys were written
    const keysAfter = await secureStore.list();
    expect(keysAfter).toEqual(keysBefore);
  });

  // ─── R3: Serialization, Parsing, Passthrough ────────────────────────────

  /**
   * @plan PLAN-20260213-KEYRINGTOKENSTORE.P05
   * @requirement R3.1
   * @given A valid OAuthToken with all standard fields
   * @when saveToken then getToken
   * @then Token round-trips with all fields preserved
   */
  it('saveToken validates and stores token as JSON', async () => {
    const token = makeMinimalToken({
      scope: 'read write',
      resource_url: 'https://api.example.com/v1',
    });
    await tokenStore.saveToken('anthropic', token);
    const raw = await secureStore.get('anthropic:default');
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.access_token).toBe(token.access_token);
    expect(parsed.scope).toBe('read write');
    expect(parsed.resource_url).toBe('https://api.example.com/v1');
  });

  /**
   * @plan PLAN-20260213-KEYRINGTOKENSTORE.P05
   * @requirement R3.2
   * @given A token was previously saved
   * @when getToken retrieves it
   * @then Returns a validated OAuthToken with all fields intact
   */
  it('getToken parses JSON and validates with OAuthTokenSchema', async () => {
    const token = makeMinimalToken();
    await tokenStore.saveToken('gemini', token);
    const retrieved = await tokenStore.getToken('gemini');
    expect(retrieved).not.toBeNull();
    expect(retrieved!.access_token).toBe(token.access_token);
    expect(retrieved!.token_type).toBe(token.token_type);
    expect(retrieved!.expiry).toBe(token.expiry);
  });

  /**
   * @plan PLAN-20260213-KEYRINGTOKENSTORE.P05
   * @requirement R3.3
   * @given A Codex token with extra fields (account_id, id_token)
   * @when saveToken then getToken
   * @then Extra fields (account_id, id_token) are preserved
   */
  it('preserves provider-specific extra fields via passthrough()', async () => {
    const codexToken = makeCodexToken();
    await tokenStore.saveToken('codex', codexToken as OAuthToken);
    const retrieved = await tokenStore.getToken('codex');
    expect(retrieved).not.toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const withExtras = retrieved as any;
    expect(withExtras.account_id).toBe(codexToken.account_id);
    expect(withExtras.id_token).toBe(codexToken.id_token);
  });

  // ─── R4: Corrupt Data Handling ──────────────────────────────────────────

  /**
   * @plan PLAN-20260213-KEYRINGTOKENSTORE.P05
   * @requirement R4.1
   * @given SecureStore contains non-JSON data for 'corrupt-provider:default'
   * @when getToken('corrupt-provider') is called
   * @then Returns null (not throws)
   */
  it('returns null for corrupt JSON in SecureStore', async () => {
    await secureStore.set('corrupt-provider:default', 'not-valid-json{{{');
    const result = await tokenStore.getToken('corrupt-provider');
    expect(result).toBeNull();
  });

  /**
   * @plan PLAN-20260213-KEYRINGTOKENSTORE.P05
   * @requirement R4.2
   * @given SecureStore contains valid JSON that fails schema validation
   * @when getToken is called
   * @then Returns null (not throws)
   */
  it('returns null for valid JSON with invalid schema', async () => {
    await secureStore.set(
      'bad-schema:default',
      JSON.stringify({ wrong: 'schema', not_a_token: true }),
    );
    const result = await tokenStore.getToken('bad-schema');
    expect(result).toBeNull();
  });

  /**
   * @plan PLAN-20260213-KEYRINGTOKENSTORE.P05
   * @requirement R4.3
   * @given SecureStore contains corrupt data for 'keep-corrupt:default'
   * @when getToken returns null
   * @then Corrupt data is still present in SecureStore
   */
  it('does NOT delete corrupt data from SecureStore', async () => {
    const corruptData = '{"totally": "invalid"}';
    await secureStore.set('keep-corrupt:default', corruptData);
    const result = await tokenStore.getToken('keep-corrupt');
    expect(result).toBeNull();
    // Verify data is still there
    const stillThere = await secureStore.get('keep-corrupt:default');
    expect(stillThere).toBe(corruptData);
  });

  /**
   * @plan PLAN-20260213-KEYRINGTOKENSTORE.P05
   * @requirement R4.4
   * @given Corrupt data exists for 'anthropic:default'
   * @when getToken reads it and logs a warning
   * @then Log message contains a hex hash, NOT the raw 'anthropic:default'
   */
  it('logs hashed identifier, not raw provider:bucket', async () => {
    const warnSpy = vi.spyOn(DebugLogger.prototype, 'warn');
    await secureStore.set('hashtest:default', 'not-json');
    await tokenStore.getToken('hashtest');
    // Compute expected FNV-1a hash (matches implementation)
    const key = 'hashtest:default';
    let h = 0x811c9dc5;
    for (let i = 0; i < key.length; i++) {
      h ^= key.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    const expectedHash = (h >>> 0).toString(16).padStart(8, '0');
    // Verify warn was called with hash, not raw key
    const warnCalls = warnSpy.mock.calls;
    const hasHashInLogs = warnCalls.some((call) => {
      const msg =
        typeof call[0] === 'function'
          ? (call[0] as () => string)()
          : String(call[0]);
      return msg.includes(expectedHash) && !msg.includes('hashtest:default');
    });
    expect(hasHashInLogs).toBe(true);
    warnSpy.mockRestore();
  });

  // ─── R5: removeToken ────────────────────────────────────────────────────

  /**
   * @plan PLAN-20260213-KEYRINGTOKENSTORE.P05
   * @requirement R5.1
   * @given A token was saved for 'gemini:default'
   * @when removeToken('gemini') is called, then getToken('gemini')
   * @then getToken returns null (token was deleted)
   */
  it('removeToken deletes the token from SecureStore', async () => {
    const token = makeMinimalToken();
    await tokenStore.saveToken('gemini', token);
    await tokenStore.removeToken('gemini');
    const result = await tokenStore.getToken('gemini');
    expect(result).toBeNull();
  });

  /**
   * @plan PLAN-20260213-KEYRINGTOKENSTORE.P05
   * @requirement R5.2
   * @given No token exists for 'nonexistent' provider
   * @when removeToken('nonexistent') is called
   * @then Method returns normally (does not throw)
   */
  it('removeToken swallows errors for missing tokens', async () => {
    // Should not throw even when there's nothing to remove
    await expect(
      tokenStore.removeToken('nonexistent'),
    ).resolves.toBeUndefined();
  });

  // ─── R6: List Operations ────────────────────────────────────────────────

  /**
   * @plan PLAN-20260213-KEYRINGTOKENSTORE.P05
   * @requirement R6.1
   * @given Tokens saved for 'anthropic:default', 'gemini:default', 'gemini:work'
   * @when listProviders() is called
   * @then Returns ['anthropic', 'gemini'] (sorted, unique)
   */
  it('listProviders returns sorted unique providers', async () => {
    await tokenStore.saveToken('anthropic', makeMinimalToken());
    await tokenStore.saveToken('gemini', makeMinimalToken());
    await tokenStore.saveToken('gemini', makeMinimalToken(), 'work');
    const providers = await tokenStore.listProviders();
    expect(providers).toEqual(['anthropic', 'gemini']);
  });

  /**
   * @plan PLAN-20260213-KEYRINGTOKENSTORE.P05
   * @requirement R6.2
   * @given Tokens saved for 'gemini:default', 'gemini:work', 'anthropic:default'
   * @when listBuckets('gemini') is called
   * @then Returns ['default', 'work'] (sorted, only gemini buckets)
   */
  it('listBuckets returns sorted buckets for a specific provider', async () => {
    await tokenStore.saveToken('gemini', makeMinimalToken());
    await tokenStore.saveToken('gemini', makeMinimalToken(), 'work');
    await tokenStore.saveToken('anthropic', makeMinimalToken());
    const buckets = await tokenStore.listBuckets('gemini');
    expect(buckets).toEqual(['default', 'work']);
  });

  /**
   * @plan PLAN-20260213-KEYRINGTOKENSTORE.P05
   * @requirement R6.3
   * @given SecureStore.list() would throw an error
   * @when listProviders() is called
   * @then Returns [] (not throws)
   */
  it('listProviders returns empty array on SecureStore error', async () => {
    // Create a store with a keyring that fails on findCredentials
    const errorTempDir = await createTempDir();
    const failKeyring = createMockKeyring();
    failKeyring.findCredentials = async () => {
      throw new SecureStoreError(
        'Keyring locked',
        'LOCKED',
        'Unlock your keyring',
      );
    };
    const failStore = new SecureStore('llxprt-code-oauth', {
      keyringLoader: async () => failKeyring,
      fallbackDir: path.join(errorTempDir, 'nonexistent-dir'),
      fallbackPolicy: 'allow',
    });
    const failTokenStore = new KeyringTokenStore({
      secureStore: failStore,
    });
    const result = await failTokenStore.listProviders();
    expect(result).toEqual([]);
    await fs.rm(errorTempDir, { recursive: true, force: true });
  });

  /**
   * @plan PLAN-20260213-KEYRINGTOKENSTORE.P05
   * @requirement R6.3
   * @given SecureStore errors on list
   * @when listBuckets() is called
   * @then Returns [] (not throws)
   */
  it('listBuckets returns empty array on SecureStore error', async () => {
    const errorTempDir = await createTempDir();
    const failKeyring = createMockKeyring();
    failKeyring.findCredentials = async () => {
      throw new SecureStoreError(
        'Keyring locked',
        'LOCKED',
        'Unlock your keyring',
      );
    };
    const failStore = new SecureStore('llxprt-code-oauth', {
      keyringLoader: async () => failKeyring,
      fallbackDir: path.join(errorTempDir, 'nonexistent-dir'),
      fallbackPolicy: 'allow',
    });
    const failTokenStore = new KeyringTokenStore({
      secureStore: failStore,
    });
    const result = await failTokenStore.listBuckets('gemini');
    expect(result).toEqual([]);
    await fs.rm(errorTempDir, { recursive: true, force: true });
  });

  // ─── R7: getBucketStats ─────────────────────────────────────────────────

  /**
   * @plan PLAN-20260213-KEYRINGTOKENSTORE.P05
   * @requirement R7.1
   * @given Token saved for 'gemini:default'
   * @when getBucketStats('gemini', 'default') is called
   * @then Returns { bucket: 'default', requestCount: 0, percentage: 0, lastUsed: undefined }
   */
  it('getBucketStats returns placeholder stats when token exists', async () => {
    await tokenStore.saveToken('gemini', makeMinimalToken());
    const stats = await tokenStore.getBucketStats('gemini', 'default');
    expect(stats).toEqual({
      bucket: 'default',
      requestCount: 0,
      percentage: 0,
      lastUsed: undefined,
    });
  });

  /**
   * @plan PLAN-20260213-KEYRINGTOKENSTORE.P05
   * @requirement R7.2
   * @given No token saved for 'gemini:work'
   * @when getBucketStats('gemini', 'work') is called
   * @then Returns null
   */
  it('getBucketStats returns null when no token exists', async () => {
    const stats = await tokenStore.getBucketStats('gemini', 'work');
    expect(stats).toBeNull();
  });

  // ─── R8: Lock Acquisition ──────────────────────────────────────────────

  /**
   * @plan PLAN-20260213-KEYRINGTOKENSTORE.P05
   * @requirement R8.1
   * @given No existing lock
   * @when acquireRefreshLock('gemini') is called
   * @then Returns true (lock acquired)
   */
  it('acquireRefreshLock succeeds when no lock exists', async () => {
    const acquired = await tokenStore.acquireRefreshLock('gemini');
    expect(acquired).toBe(true);
    // Clean up
    await tokenStore.releaseRefreshLock('gemini');
  });

  /**
   * @plan PLAN-20260213-KEYRINGTOKENSTORE.P05
   * @requirement R8.2
   * @given Lock already held (acquired)
   * @when acquireRefreshLock is called with short waitMs
   * @then Returns false (timeout)
   */
  it('acquireRefreshLock times out when lock is already held', async () => {
    // Acquire lock first
    const first = await tokenStore.acquireRefreshLock('gemini');
    expect(first).toBe(true);
    // Try to acquire again with short timeout — should fail
    const second = await tokenStore.acquireRefreshLock('gemini', {
      waitMs: 300,
      staleMs: 60_000, // Not stale
    });
    expect(second).toBe(false);
    // Clean up
    await tokenStore.releaseRefreshLock('gemini');
  });

  /**
   * @plan PLAN-20260213-KEYRINGTOKENSTORE.P05
   * @requirement R8.3
   * @given Stale lock file (old timestamp)
   * @when acquireRefreshLock is called
   * @then Breaks stale lock and acquires, returns true
   */
  it('acquireRefreshLock breaks stale locks', async () => {
    // Create a lock directory and file with an old timestamp
    const lockDir = path.join(tempDir, 'locks');
    await fs.mkdir(lockDir, { recursive: true, mode: 0o700 });
    const lockFile = path.join(lockDir, 'stale-test-refresh.lock');
    const staleLockInfo = {
      pid: 99999,
      timestamp: Date.now() - 120_000, // 2 minutes ago
    };
    await fs.writeFile(lockFile, JSON.stringify(staleLockInfo), {
      mode: 0o600,
    });
    // Acquire should break the stale lock
    const acquired = await tokenStore.acquireRefreshLock('stale-test', {
      staleMs: 30_000,
    });
    expect(acquired).toBe(true);
    // Clean up
    await tokenStore.releaseRefreshLock('stale-test');
  });

  /**
   * @plan PLAN-20260213-KEYRINGTOKENSTORE.P05
   * @requirement R8.6
   * @given Corrupt lock file (invalid JSON)
   * @when acquireRefreshLock is called
   * @then Breaks corrupt lock and acquires, returns true
   */
  it('acquireRefreshLock handles corrupt lock files', async () => {
    const lockDir = path.join(tempDir, 'locks');
    await fs.mkdir(lockDir, { recursive: true, mode: 0o700 });
    const lockFile = path.join(lockDir, 'corrupt-lock-test-refresh.lock');
    await fs.writeFile(lockFile, 'this is not json!!!', { mode: 0o600 });
    const acquired = await tokenStore.acquireRefreshLock('corrupt-lock-test');
    expect(acquired).toBe(true);
    // Clean up
    await tokenStore.releaseRefreshLock('corrupt-lock-test');
  });

  // ─── R9: Lock Release ──────────────────────────────────────────────────

  /**
   * @plan PLAN-20260213-KEYRINGTOKENSTORE.P05
   * @requirement R9.1
   * @given Lock was acquired
   * @when releaseRefreshLock is called
   * @then Lock file no longer exists and lock can be re-acquired
   */
  it('releaseRefreshLock removes the lock file', async () => {
    await tokenStore.acquireRefreshLock('release-test');
    await tokenStore.releaseRefreshLock('release-test');
    // Should be able to immediately re-acquire
    const reacquired = await tokenStore.acquireRefreshLock('release-test');
    expect(reacquired).toBe(true);
    await tokenStore.releaseRefreshLock('release-test');
  });

  /**
   * @plan PLAN-20260213-KEYRINGTOKENSTORE.P05
   * @requirement R9.2
   * @given Lock file doesn't exist
   * @when releaseRefreshLock is called
   * @then No error thrown (idempotent)
   */
  it('releaseRefreshLock is idempotent (no error if lock does not exist)', async () => {
    await expect(
      tokenStore.releaseRefreshLock('no-such-lock'),
    ).resolves.toBeUndefined();
  });

  // ─── R10: Lock File Naming and Directory ───────────────────────────────

  /**
   * @plan PLAN-20260213-KEYRINGTOKENSTORE.P05
   * @requirement R10.1
   * @given provider='gemini', default bucket
   * @when Lock is acquired
   * @then Lock file at ~/.llxprt/oauth/locks/gemini-refresh.lock
   */
  it('lock file uses {provider}-refresh.lock for default bucket', async () => {
    await tokenStore.acquireRefreshLock('lockname');
    const lockPath = path.join(tempDir, 'locks', 'lockname-refresh.lock');
    const exists = await fs
      .access(lockPath)
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(true);
    await tokenStore.releaseRefreshLock('lockname');
  });

  /**
   * @plan PLAN-20260213-KEYRINGTOKENSTORE.P05
   * @requirement R10.1
   * @given provider='gemini', bucket='work'
   * @when Lock is acquired
   * @then Lock file at ~/.llxprt/oauth/locks/gemini-work-refresh.lock
   */
  it('lock file uses {provider}-{bucket}-refresh.lock for non-default bucket', async () => {
    await tokenStore.acquireRefreshLock('lockbkt', { bucket: 'work' });
    const lockPath = path.join(tempDir, 'locks', 'lockbkt-work-refresh.lock');
    const exists = await fs
      .access(lockPath)
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(true);
    await tokenStore.releaseRefreshLock('lockbkt', 'work');
  });

  /**
   * @plan PLAN-20260213-KEYRINGTOKENSTORE.P05
   * @requirement R10.2
   * @given Lock directory doesn't exist
   * @when acquireRefreshLock is called
   * @then Directory ~/.llxprt/oauth/locks/ is created
   */
  it('creates lock directory on demand', async () => {
    const lockDirPath = path.join(tempDir, 'locks');
    // Ensure lock dir doesn't exist before test
    await fs.rm(lockDirPath, { recursive: true, force: true }).catch(() => {});
    const acquired = await tokenStore.acquireRefreshLock('dircreate');
    expect(acquired).toBe(true);
    const dirExists = await fs
      .access(lockDirPath)
      .then(() => true)
      .catch(() => false);
    expect(dirExists).toBe(true);
    await tokenStore.releaseRefreshLock('dircreate');
  });

  // ─── R11: saveToken Error Propagation ───────────────────────────────────

  /**
   * @plan PLAN-20260213-KEYRINGTOKENSTORE.P05
   * @requirement R11.1
   * @given SecureStore throws SecureStoreError(UNAVAILABLE)
   * @when saveToken is called
   * @then SecureStoreError(UNAVAILABLE) is thrown to caller
   */
  it('saveToken propagates SecureStoreError(UNAVAILABLE)', async () => {
    const errorTempDir = await createTempDir();
    const failKeyring = createMockKeyring();
    failKeyring.setPassword = async () => {
      throw new SecureStoreError(
        'Keyring unavailable',
        'UNAVAILABLE',
        'Install a keyring backend',
      );
    };
    const failStore = new SecureStore('llxprt-code-oauth', {
      keyringLoader: async () => failKeyring,
      fallbackDir: path.join(errorTempDir, 'nonexistent'),
      fallbackPolicy: 'deny',
    });
    const failTokenStore = new KeyringTokenStore({
      secureStore: failStore,
    });
    await expect(
      failTokenStore.saveToken('anthropic', makeMinimalToken()),
    ).rejects.toThrow(SecureStoreError);
    await fs.rm(errorTempDir, { recursive: true, force: true });
  });

  /**
   * @plan PLAN-20260213-KEYRINGTOKENSTORE.P05
   * @requirement R11.2
   * @given SecureStore throws SecureStoreError(DENIED)
   * @when saveToken is called
   * @then SecureStoreError(DENIED) is thrown to caller
   */
  it('saveToken propagates SecureStoreError(DENIED)', async () => {
    const errorTempDir = await createTempDir();
    const failKeyring = createMockKeyring();
    failKeyring.setPassword = async () => {
      throw new SecureStoreError(
        'Keyring denied',
        'DENIED',
        'Check permissions',
      );
    };
    const failStore = new SecureStore('llxprt-code-oauth', {
      keyringLoader: async () => failKeyring,
      fallbackDir: path.join(errorTempDir, 'nonexistent'),
      fallbackPolicy: 'deny',
    });
    const failTokenStore = new KeyringTokenStore({
      secureStore: failStore,
    });
    await expect(
      failTokenStore.saveToken('anthropic', makeMinimalToken()),
    ).rejects.toThrow(SecureStoreError);
    await fs.rm(errorTempDir, { recursive: true, force: true });
  });

  // ─── R12: getToken Error Handling ───────────────────────────────────────

  /**
   * @plan PLAN-20260213-KEYRINGTOKENSTORE.P05
   * @requirement R12.1
   * @given secureStore.get() returns null
   * @when getToken is called
   * @then Returns null
   */
  it('getToken returns null when SecureStore has no entry', async () => {
    const result = await tokenStore.getToken('nonexistent');
    expect(result).toBeNull();
  });

  /**
   * @plan PLAN-20260213-KEYRINGTOKENSTORE.P05
   * @requirement R12.2
   * @given secureStore.get() throws SecureStoreError(LOCKED)
   * @when getToken is called
   * @then SecureStoreError(LOCKED) is thrown
   */
  it('getToken propagates SecureStoreError(LOCKED)', async () => {
    const errorTempDir = await createTempDir();
    const failKeyring = createMockKeyring();
    failKeyring.getPassword = async () => {
      throw new SecureStoreError(
        'Keyring locked',
        'LOCKED',
        'Unlock your keyring',
      );
    };
    const failStore = new SecureStore('llxprt-code-oauth', {
      keyringLoader: async () => failKeyring,
      fallbackDir: path.join(errorTempDir, 'nonexistent'),
      fallbackPolicy: 'allow',
    });
    const failTokenStore = new KeyringTokenStore({
      secureStore: failStore,
    });
    await expect(failTokenStore.getToken('anthropic')).rejects.toThrow(
      SecureStoreError,
    );
    await fs.rm(errorTempDir, { recursive: true, force: true });
  });

  /**
   * @plan PLAN-20260213-KEYRINGTOKENSTORE.P05
   * @requirement R12.3
   * @given SecureStore returns data that fails JSON parse (CORRUPT scenario)
   * @when getToken is called
   * @then Returns null with warning log (corrupt data treated as missing)
   */
  it('getToken returns null for corrupt data (CORRUPT path)', async () => {
    await secureStore.set('corrupt-path:default', '<<<not-json>>>');
    const result = await tokenStore.getToken('corrupt-path');
    expect(result).toBeNull();
  });

  // ─── R19: Error Messages ───────────────────────────────────────────────

  /**
   * @plan PLAN-20260213-KEYRINGTOKENSTORE.P05
   * @requirement R19.1
   * @given provider='my provider' (has space)
   * @when saveToken is called
   * @then Error message includes 'my provider' and mentions allowed characters
   */
  it('error message includes invalid name and allowed character set', async () => {
    const token = makeMinimalToken();
    try {
      await tokenStore.saveToken('my provider', token);
      expect.unreachable('Should have thrown');
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain('my provider');
      expect(msg).toContain('Allowed: letters, numbers, dashes, underscores.');
    }
  });

  // ─── Property-Based Tests ──────────────────────────────────────────────

  /**
   * @plan PLAN-20260213-KEYRINGTOKENSTORE.P05
   * @requirement R2.1, R3.1
   * @given Any valid provider and bucket name
   * @when saveToken then getToken with same names
   * @then Token round-trips correctly
   */
  it('PROP: valid provider+bucket names always round-trip correctly', async () => {
    await fc.assert(
      fc.asyncProperty(validNameArb, validNameArb, async (provider, bucket) => {
        const setup = await createTestStore();
        try {
          const token = makeMinimalToken();
          await setup.tokenStore.saveToken(provider, token, bucket);
          const retrieved = await setup.tokenStore.getToken(provider, bucket);
          expect(retrieved).not.toBeNull();
          expect(retrieved!.access_token).toBe(token.access_token);
          expect(retrieved!.refresh_token).toBe(token.refresh_token);
          expect(retrieved!.expiry).toBe(token.expiry);
        } finally {
          await fs.rm(setup.tempDir, { recursive: true, force: true });
        }
      }),
      { numRuns: 10 },
    );
  });

  /**
   * @plan PLAN-20260213-KEYRINGTOKENSTORE.P05
   * @requirement R2.3
   * @given Any invalid name (with spaces, special chars)
   * @when Used as provider name in saveToken
   * @then Always rejected with an error
   */
  it('PROP: invalid names are always rejected', async () => {
    await fc.assert(
      fc.asyncProperty(invalidNameArb, async (badName) => {
        const token = makeMinimalToken();
        await expect(tokenStore.saveToken(badName, token)).rejects.toThrow();
      }),
      { numRuns: 20 },
    );
  });

  /**
   * @plan PLAN-20260213-KEYRINGTOKENSTORE.P05
   * @requirement R3.3
   * @given Token with arbitrary extra fields
   * @when saveToken then getToken
   * @then All extra fields survive round-trip
   */
  it('PROP: token with arbitrary extra fields survives round-trip', async () => {
    await fc.assert(
      fc.asyncProperty(extraFieldsArb, async (extraFields) => {
        const setup = await createTestStore();
        try {
          const token = {
            ...makeMinimalToken(),
            ...extraFields,
          } as OAuthToken;
          await setup.tokenStore.saveToken('proptest', token);
          const retrieved = await setup.tokenStore.getToken('proptest');
          expect(retrieved).not.toBeNull();
          for (const [key, value] of Object.entries(extraFields)) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            expect((retrieved as any)[key]).toEqual(value);
          }
        } finally {
          await fs.rm(setup.tempDir, { recursive: true, force: true });
        }
      }),
      { numRuns: 10 },
    );
  });

  /**
   * @plan PLAN-20260213-KEYRINGTOKENSTORE.P05
   * @requirement R9.1, R9.2
   * @given Any valid provider name
   * @when acquireRefreshLock then releaseRefreshLock
   * @then Lock acquire + release is idempotent (can repeat)
   */
  it('PROP: lock acquire + release is idempotent for any valid name', async () => {
    await fc.assert(
      fc.asyncProperty(validNameArb, async (provider) => {
        const acquired = await tokenStore.acquireRefreshLock(provider);
        expect(acquired).toBe(true);
        await tokenStore.releaseRefreshLock(provider);
        // Should be able to re-acquire immediately
        const reacquired = await tokenStore.acquireRefreshLock(provider);
        expect(reacquired).toBe(true);
        await tokenStore.releaseRefreshLock(provider);
      }),
      { numRuns: 5 },
    );
  });

  /**
   * @plan PLAN-20260213-KEYRINGTOKENSTORE.P05
   * @requirement R1.2, R3.1
   * @given Any valid provider name and a saved token
   * @when getToken is called
   * @then The saved token can be retrieved
   */
  it('PROP: any saved token can be retrieved', async () => {
    await fc.assert(
      fc.asyncProperty(validNameArb, async (provider) => {
        const setup = await createTestStore();
        try {
          const token = makeMinimalToken();
          await setup.tokenStore.saveToken(provider, token);
          const retrieved = await setup.tokenStore.getToken(provider);
          expect(retrieved).not.toBeNull();
          expect(retrieved!.access_token).toBe(token.access_token);
        } finally {
          await fs.rm(setup.tempDir, { recursive: true, force: true });
        }
      }),
      { numRuns: 10 },
    );
  });

  /**
   * @plan PLAN-20260213-KEYRINGTOKENSTORE.P05
   * @requirement R6.1
   * @given Multiple providers with saved tokens
   * @when listProviders is called
   * @then All providers are listed and the list is sorted
   */
  it('PROP: multiple providers can coexist and listProviders is sorted', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(validNameArb, { minLength: 1, maxLength: 5 }),
        async (providers) => {
          const setup = await createTestStore();
          try {
            for (const p of providers) {
              await setup.tokenStore.saveToken(p, makeMinimalToken());
            }
            const listed = await setup.tokenStore.listProviders();
            const sortedProviders = [...providers].sort();
            expect(listed).toEqual(sortedProviders);
          } finally {
            await fs.rm(setup.tempDir, { recursive: true, force: true });
          }
        },
      ),
      { numRuns: 10 },
    );
  });

  /**
   * @plan PLAN-20260213-KEYRINGTOKENSTORE.P05
   * @requirement R6.2
   * @given A provider with multiple buckets
   * @when listBuckets is called
   * @then Bucket listing is always sorted
   */
  it('PROP: bucket listing is always sorted', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(validNameArb, { minLength: 1, maxLength: 5 }),
        async (buckets) => {
          const setup = await createTestStore();
          try {
            for (const b of buckets) {
              await setup.tokenStore.saveToken(
                'sortprovider',
                makeMinimalToken(),
                b,
              );
            }
            const listed = await setup.tokenStore.listBuckets('sortprovider');
            const sorted = [...listed].sort();
            expect(listed).toEqual(sorted);
          } finally {
            await fs.rm(setup.tempDir, { recursive: true, force: true });
          }
        },
      ),
      { numRuns: 10 },
    );
  });

  /**
   * @plan PLAN-20260213-KEYRINGTOKENSTORE.P05
   * @requirement R2.3
   * @given Any valid bucket name
   * @when Used as bucket in saveToken
   * @then Accepted without error
   */
  it('PROP: all valid bucket names are accepted', async () => {
    await fc.assert(
      fc.asyncProperty(validNameArb, async (bucket) => {
        const setup = await createTestStore();
        try {
          const token = makeMinimalToken();
          await setup.tokenStore.saveToken('validbkt', token, bucket);
          const retrieved = await setup.tokenStore.getToken('validbkt', bucket);
          expect(retrieved).not.toBeNull();
        } finally {
          await fs.rm(setup.tempDir, { recursive: true, force: true });
        }
      }),
      { numRuns: 10 },
    );
  });

  /**
   * @plan PLAN-20260213-KEYRINGTOKENSTORE.P05
   * @requirement R2.3
   * @given Any invalid bucket name
   * @when Used as bucket in saveToken
   * @then Always rejected
   */
  it('PROP: all invalid bucket names are rejected', async () => {
    await fc.assert(
      fc.asyncProperty(invalidNameArb, async (badBucket) => {
        const token = makeMinimalToken();
        await expect(
          tokenStore.saveToken('validprov', token, badBucket),
        ).rejects.toThrow();
      }),
      { numRuns: 20 },
    );
  });

  /**
   * @plan PLAN-20260213-KEYRINGTOKENSTORE.P05
   * @requirement R5.1, R3.1
   * @given A token saved then removed for a generated provider
   * @when getToken is called
   * @then Returns null (removal works for any valid name)
   */
  it('PROP: removeToken then getToken returns null for any valid provider', async () => {
    await fc.assert(
      fc.asyncProperty(validNameArb, async (provider) => {
        const setup = await createTestStore();
        try {
          await setup.tokenStore.saveToken(provider, makeMinimalToken());
          await setup.tokenStore.removeToken(provider);
          const result = await setup.tokenStore.getToken(provider);
          expect(result).toBeNull();
        } finally {
          await fs.rm(setup.tempDir, { recursive: true, force: true });
        }
      }),
      { numRuns: 10 },
    );
  });

  /**
   * @plan PLAN-20260213-KEYRINGTOKENSTORE.P05
   * @requirement R2.2
   * @given Any valid provider name
   * @when saveToken with no bucket, then getToken with no bucket
   * @then Default bucket is always used (token round-trips)
   */
  it('PROP: default bucket is always used when bucket is omitted', async () => {
    await fc.assert(
      fc.asyncProperty(validNameArb, async (provider) => {
        const setup = await createTestStore();
        try {
          const token = makeMinimalToken();
          await setup.tokenStore.saveToken(provider, token);
          const retrieved = await setup.tokenStore.getToken(provider);
          expect(retrieved).not.toBeNull();
          expect(retrieved!.access_token).toBe(token.access_token);
          // Verify stored under provider:default
          const raw = await setup.secureStore.get(`${provider}:default`);
          expect(raw).not.toBeNull();
        } finally {
          await fs.rm(setup.tempDir, { recursive: true, force: true });
        }
      }),
      { numRuns: 10 },
    );
  });

  /**
   * @plan PLAN-20260213-KEYRINGTOKENSTORE.P05
   * @requirement R7.1, R7.2
   * @given A generated provider name
   * @when getBucketStats called with and without a saved token
   * @then Returns stats object or null respectively
   */
  it('PROP: getBucketStats returns correct shape for any valid provider', async () => {
    await fc.assert(
      fc.asyncProperty(validNameArb, async (provider) => {
        const setup = await createTestStore();
        try {
          // Without token
          const noStats = await setup.tokenStore.getBucketStats(
            provider,
            'default',
          );
          expect(noStats).toBeNull();
          // With token
          await setup.tokenStore.saveToken(provider, makeMinimalToken());
          const stats = await setup.tokenStore.getBucketStats(
            provider,
            'default',
          );
          expect(stats).not.toBeNull();
          expect(stats!.bucket).toBe('default');
          expect(stats!.requestCount).toBe(0);
          expect(stats!.percentage).toBe(0);
        } finally {
          await fs.rm(setup.tempDir, { recursive: true, force: true });
        }
      }),
      { numRuns: 5 },
    );
  });

  /**
   * @plan PLAN-20260213-KEYRINGTOKENSTORE.P05
   * @requirement R2.1
   * @given Two different providers with same bucket name
   * @when Tokens saved for both
   * @then They don't interfere — each is stored separately
   */
  it('PROP: different providers with same bucket are stored independently', async () => {
    await fc.assert(
      fc.asyncProperty(
        validNameArb,
        validNameArb,
        validNameArb,
        async (provider1, provider2, bucket) => {
          fc.pre(provider1 !== provider2);
          const setup = await createTestStore();
          try {
            const token1 = makeMinimalToken();
            const token2 = makeMinimalToken();
            await setup.tokenStore.saveToken(provider1, token1, bucket);
            await setup.tokenStore.saveToken(provider2, token2, bucket);
            const r1 = await setup.tokenStore.getToken(provider1, bucket);
            const r2 = await setup.tokenStore.getToken(provider2, bucket);
            expect(r1!.access_token).toBe(token1.access_token);
            expect(r2!.access_token).toBe(token2.access_token);
          } finally {
            await fs.rm(setup.tempDir, { recursive: true, force: true });
          }
        },
      ),
      { numRuns: 5 },
    );
  });

  /**
   * @plan PLAN-20260213-KEYRINGTOKENSTORE.P05
   * @requirement R4.1, R4.3
   * @given Corrupt (non-JSON) data set directly in SecureStore for a generated provider
   * @when getToken is called
   * @then Returns null without deleting the corrupt data
   */
  it('PROP: corrupt JSON returns null and preserves data for any provider', async () => {
    await fc.assert(
      fc.asyncProperty(validNameArb, async (provider) => {
        const setup = await createTestStore();
        try {
          const corruptData = '<<<not-valid-json>>>';
          await setup.secureStore.set(`${provider}:default`, corruptData);
          const result = await setup.tokenStore.getToken(provider);
          expect(result).toBeNull();
          const stillThere = await setup.secureStore.get(`${provider}:default`);
          expect(stillThere).toBe(corruptData);
        } finally {
          await fs.rm(setup.tempDir, { recursive: true, force: true });
        }
      }),
      { numRuns: 5 },
    );
  });

  /**
   * @plan PLAN-20260213-KEYRINGTOKENSTORE.P05
   * @requirement R4.2
   * @given Invalid-schema JSON set directly in SecureStore for a generated provider
   * @when getToken is called
   * @then Returns null (schema validation fails gracefully)
   */
  it('PROP: invalid schema JSON returns null for any provider', async () => {
    await fc.assert(
      fc.asyncProperty(validNameArb, async (provider) => {
        const setup = await createTestStore();
        try {
          await setup.secureStore.set(
            `${provider}:default`,
            JSON.stringify({ invalid: true }),
          );
          const result = await setup.tokenStore.getToken(provider);
          expect(result).toBeNull();
        } finally {
          await fs.rm(setup.tempDir, { recursive: true, force: true });
        }
      }),
      { numRuns: 5 },
    );
  });

  /**
   * @plan PLAN-20260213-KEYRINGTOKENSTORE.P05
   * @requirement R3.1
   * @given A token with different token_type values (Bearer, bearer)
   * @when saveToken then getToken
   * @then Token type is preserved exactly
   */
  it('PROP: token_type is preserved in round-trip', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('Bearer' as const, 'bearer' as const),
        async (tokenType) => {
          const setup = await createTestStore();
          try {
            const token = makeMinimalToken({ token_type: tokenType });
            await setup.tokenStore.saveToken('typeprov', token);
            const retrieved = await setup.tokenStore.getToken('typeprov');
            expect(retrieved).not.toBeNull();
            expect(retrieved!.token_type).toBe(tokenType);
          } finally {
            await fs.rm(setup.tempDir, { recursive: true, force: true });
          }
        },
      ),
      { numRuns: 5 },
    );
  });

  /**
   * @plan PLAN-20260213-KEYRINGTOKENSTORE.P05
   * @requirement R2.1, R6.2
   * @given A provider with a generated bucket name
   * @when saveToken then listBuckets
   * @then The bucket appears in the listing
   */
  it('PROP: saved bucket always appears in listBuckets', async () => {
    await fc.assert(
      fc.asyncProperty(validNameArb, async (bucket) => {
        const setup = await createTestStore();
        try {
          await setup.tokenStore.saveToken(
            'listprov',
            makeMinimalToken(),
            bucket,
          );
          const buckets = await setup.tokenStore.listBuckets('listprov');
          expect(buckets).toContain(bucket);
        } finally {
          await fs.rm(setup.tempDir, { recursive: true, force: true });
        }
      }),
      { numRuns: 10 },
    );
  });

  /**
   * @plan PLAN-20260213-KEYRINGTOKENSTORE.P05
   * @requirement R3.1
   * @given A token with varying expiry values
   * @when saveToken then getToken
   * @then Expiry value is preserved exactly (numeric precision)
   */
  it('PROP: expiry numeric precision is preserved in round-trip', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 2147483647 }),
        async (expiry) => {
          const setup = await createTestStore();
          try {
            const token = makeMinimalToken({ expiry });
            await setup.tokenStore.saveToken('expiryprov', token);
            const retrieved = await setup.tokenStore.getToken('expiryprov');
            expect(retrieved).not.toBeNull();
            expect(retrieved!.expiry).toBe(expiry);
          } finally {
            await fs.rm(setup.tempDir, { recursive: true, force: true });
          }
        },
      ),
      { numRuns: 10 },
    );
  });

  /**
   * @plan PLAN-20260213-KEYRINGTOKENSTORE.P05
   * @requirement R3.1
   * @given A token with scope set to null or a string
   * @when saveToken then getToken
   * @then Scope value is preserved (including null)
   */
  it('PROP: scope null/string values are preserved in round-trip', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(fc.constant(null), fc.string({ minLength: 1, maxLength: 50 })),
        async (scope) => {
          const setup = await createTestStore();
          try {
            const token = makeMinimalToken({ scope });
            await setup.tokenStore.saveToken('scopeprov', token);
            const retrieved = await setup.tokenStore.getToken('scopeprov');
            expect(retrieved).not.toBeNull();
            expect(retrieved!.scope).toBe(scope);
          } finally {
            await fs.rm(setup.tempDir, { recursive: true, force: true });
          }
        },
      ),
      { numRuns: 10 },
    );
  });
});
