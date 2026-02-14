/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Integration tests for KeyringTokenStore.
 *
 * Unlike the P05 unit tests that verify individual methods in isolation,
 * these tests exercise multi-step workflows, cross-method consistency,
 * multi-instance coherence, and temporal workflows (save → update → verify).
 *
 * @plan PLAN-20260213-KEYRINGTOKENSTORE.P08
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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

// ─── Test Helpers ────────────────────────────────────────────────────────────

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

async function createTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'keyring-token-store-integ-'));
}

function makeToken(overrides?: Partial<OAuthToken>): OAuthToken {
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
    ...makeToken(),
    account_id: 'acct-' + crypto.randomUUID().substring(0, 8),
    id_token: 'ey.' + crypto.randomBytes(32).toString('base64'),
  };
}

/**
 * Creates a shared SecureStore and two KeyringTokenStore instances that
 * both delegate to the same underlying storage (for multi-instance tests).
 */
async function createSharedStoreSetup(): Promise<{
  storeA: KeyringTokenStore;
  storeB: KeyringTokenStore;
  secureStore: SecureStore;
  tempDir: string;
}> {
  const tempDir = await createTempDir();
  const mock = createMockKeyring();
  const secureStore = new SecureStore('llxprt-code-oauth', {
    fallbackDir: tempDir,
    fallbackPolicy: 'allow',
    keyringLoader: async () => mock,
  });
  const lockDir = path.join(tempDir, 'locks');
  const storeA = new KeyringTokenStore({ secureStore, lockDir });
  const storeB = new KeyringTokenStore({ secureStore, lockDir });
  return { storeA, storeB, secureStore, tempDir };
}

async function createTestStore(): Promise<{
  tokenStore: KeyringTokenStore;
  secureStore: SecureStore;
  tempDir: string;
  mockKeyring: KeyringAdapter & { store: Map<string, string> };
}> {
  const tempDir = await createTempDir();
  const mockKeyring = createMockKeyring();
  const secureStore = new SecureStore('llxprt-code-oauth', {
    fallbackDir: tempDir,
    fallbackPolicy: 'allow',
    keyringLoader: async () => mockKeyring,
  });
  const lockDir = path.join(tempDir, 'locks');
  const tokenStore = new KeyringTokenStore({ secureStore, lockDir });
  return { tokenStore, secureStore, tempDir, mockKeyring };
}

// ─── fast-check Arbitraries ──────────────────────────────────────────────────

const validNameArb = fc.string({
  unit: fc.constantFrom(
    ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-'.split(
      '',
    ),
  ),
  minLength: 1,
  maxLength: 20,
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('KeyringTokenStore Integration', () => {
  let tokenStore: KeyringTokenStore;
  let secureStore: SecureStore;
  let tempDir: string;

  beforeEach(async () => {
    const setup = await createTestStore();
    tokenStore = setup.tokenStore;
    secureStore = setup.secureStore;
    tempDir = setup.tempDir;
  });

  afterEach(async () => {
    DebugLogger.disposeAll();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  // ─── Lifecycle Tests ────────────────────────────────────────────────────

  /**
   * @plan PLAN-20260213-KEYRINGTOKENSTORE.P08
   * @requirement R17.3, R18.1
   * @given A new KeyringTokenStore instance
   * @when Full lifecycle is executed: save → get → verify → update → get → verify → remove → get
   * @then Each step produces correct state; final getToken returns null
   */
  it('full lifecycle: save → get → update → get → remove → get(null)', async () => {
    const originalToken = makeToken({ access_token: 'original-at' });

    // Step 1: Save
    await tokenStore.saveToken('anthropic', originalToken);

    // Step 2: Get and verify
    const retrieved1 = await tokenStore.getToken('anthropic');
    expect(retrieved1).not.toBeNull();
    expect(retrieved1!.access_token).toBe('original-at');
    expect(retrieved1!.refresh_token).toBe(originalToken.refresh_token);
    expect(retrieved1!.expiry).toBe(originalToken.expiry);

    // Step 3: Update (overwrite with new token)
    const updatedToken = makeToken({
      access_token: 'updated-at',
      expiry: originalToken.expiry + 7200,
    });
    await tokenStore.saveToken('anthropic', updatedToken);

    // Step 4: Get and verify update overwrote
    const retrieved2 = await tokenStore.getToken('anthropic');
    expect(retrieved2).not.toBeNull();
    expect(retrieved2!.access_token).toBe('updated-at');
    expect(retrieved2!.expiry).toBe(originalToken.expiry + 7200);

    // Step 5: Remove
    await tokenStore.removeToken('anthropic');

    // Step 6: Get returns null
    const retrieved3 = await tokenStore.getToken('anthropic');
    expect(retrieved3).toBeNull();
  });

  /**
   * @plan PLAN-20260213-KEYRINGTOKENSTORE.P08
   * @requirement R17.4, R18.2
   * @given Tokens saved for anthropic, gemini, and codex providers
   * @when listProviders, get each, remove one, listProviders again
   * @then All 3 present initially sorted; after removal only 2 remain
   */
  it('multi-provider coexistence: save 3 → list → get each → remove one → list 2', async () => {
    const anthropicToken = makeToken({ access_token: 'anthropic-at' });
    const geminiToken = makeToken({ access_token: 'gemini-at' });
    const codexToken = makeToken({ access_token: 'codex-at' });

    await tokenStore.saveToken('anthropic', anthropicToken);
    await tokenStore.saveToken('gemini', geminiToken);
    await tokenStore.saveToken('codex', codexToken);

    // List returns all 3 sorted
    const providers = await tokenStore.listProviders();
    expect(providers).toEqual(['anthropic', 'codex', 'gemini']);

    // Get each returns correct token
    const a = await tokenStore.getToken('anthropic');
    expect(a!.access_token).toBe('anthropic-at');
    const g = await tokenStore.getToken('gemini');
    expect(g!.access_token).toBe('gemini-at');
    const c = await tokenStore.getToken('codex');
    expect(c!.access_token).toBe('codex-at');

    // Remove gemini
    await tokenStore.removeToken('gemini');

    // List now returns 2
    const remaining = await tokenStore.listProviders();
    expect(remaining).toEqual(['anthropic', 'codex']);

    // gemini getToken returns null
    expect(await tokenStore.getToken('gemini')).toBeNull();
  });

  /**
   * @plan PLAN-20260213-KEYRINGTOKENSTORE.P08
   * @requirement R18.6
   * @given gemini:default and gemini:work tokens saved
   * @when listBuckets, get each, getBucketStats for each
   * @then Both buckets listed sorted; each returns correct token; stats for each
   */
  it('multi-bucket: save gemini:default + gemini:work → list → get → stats', async () => {
    const defaultToken = makeToken({ access_token: 'gemini-default-at' });
    const workToken = makeToken({ access_token: 'gemini-work-at' });

    await tokenStore.saveToken('gemini', defaultToken);
    await tokenStore.saveToken('gemini', workToken, 'work');

    // List buckets
    const buckets = await tokenStore.listBuckets('gemini');
    expect(buckets).toEqual(['default', 'work']);

    // Get each
    const d = await tokenStore.getToken('gemini');
    expect(d!.access_token).toBe('gemini-default-at');
    const w = await tokenStore.getToken('gemini', 'work');
    expect(w!.access_token).toBe('gemini-work-at');

    // Stats for each
    const dStats = await tokenStore.getBucketStats('gemini', 'default');
    expect(dStats).not.toBeNull();
    expect(dStats!.bucket).toBe('default');
    const wStats = await tokenStore.getBucketStats('gemini', 'work');
    expect(wStats).not.toBeNull();
    expect(wStats!.bucket).toBe('work');
  });

  /**
   * @plan PLAN-20260213-KEYRINGTOKENSTORE.P08
   * @requirement R17.3, R18.4
   * @given A codex token with account_id and id_token extra fields
   * @when saveToken then getToken
   * @then Extra fields are preserved exactly through the round-trip
   */
  it('codex passthrough round-trip preserves account_id and id_token', async () => {
    const codexToken = makeCodexToken();
    await tokenStore.saveToken('codex', codexToken as OAuthToken);

    const retrieved = await tokenStore.getToken('codex');
    expect(retrieved).not.toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const withExtras = retrieved as any;
    expect(withExtras.account_id).toBe(codexToken.account_id);
    expect(withExtras.id_token).toBe(codexToken.id_token);
    expect(withExtras.access_token).toBe(codexToken.access_token);
    expect(withExtras.refresh_token).toBe(codexToken.refresh_token);
  });

  // ─── Refresh Lock Integration ───────────────────────────────────────────

  /**
   * @plan PLAN-20260213-KEYRINGTOKENSTORE.P08
   * @requirement R17.7, R18.3
   * @given A KeyringTokenStore with an existing token
   * @when Lock acquired → token refreshed (saved) → lock released
   * @then Token is updated and lock is released cleanly
   */
  it('lock → refresh → save → unlock cycle', async () => {
    // Initial token
    const initialToken = makeToken({ access_token: 'initial-at' });
    await tokenStore.saveToken('gemini', initialToken);

    // Acquire lock
    const locked = await tokenStore.acquireRefreshLock('gemini');
    expect(locked).toBe(true);

    // Simulate refresh: save new token while holding lock
    const refreshedToken = makeToken({
      access_token: 'refreshed-at',
      expiry: initialToken.expiry + 7200,
    });
    await tokenStore.saveToken('gemini', refreshedToken);

    // Release lock
    await tokenStore.releaseRefreshLock('gemini');

    // Verify token was updated
    const result = await tokenStore.getToken('gemini');
    expect(result!.access_token).toBe('refreshed-at');
    expect(result!.expiry).toBe(initialToken.expiry + 7200);

    // Verify lock can be re-acquired (was properly released)
    const reacquired = await tokenStore.acquireRefreshLock('gemini');
    expect(reacquired).toBe(true);
    await tokenStore.releaseRefreshLock('gemini');
  });

  /**
   * @plan PLAN-20260213-KEYRINGTOKENSTORE.P08
   * @requirement R17.7, R18.7
   * @given A stale lock file with an old timestamp
   * @when acquireRefreshLock is called
   * @then Stale lock is broken and new lock is acquired
   */
  it('stale lock recovery: breaks stale lock and acquires', async () => {
    const lockDirPath = path.join(tempDir, 'locks');
    await fs.mkdir(lockDirPath, { recursive: true, mode: 0o700 });
    const lockFile = path.join(lockDirPath, 'stale-integ-refresh.lock');

    // Write a lock file with old timestamp
    const staleLockInfo = {
      pid: 99999,
      timestamp: Date.now() - 120_000, // 2 minutes ago
    };
    await fs.writeFile(lockFile, JSON.stringify(staleLockInfo), {
      mode: 0o600,
    });

    // Acquire should break the stale lock
    const acquired = await tokenStore.acquireRefreshLock('stale-integ', {
      staleMs: 30_000,
    });
    expect(acquired).toBe(true);

    // Verify the lock file now contains our PID
    const lockContent = await fs.readFile(lockFile, 'utf8');
    const lockInfo = JSON.parse(lockContent);
    expect(lockInfo.pid).toBe(process.pid);

    // Cleanup
    await tokenStore.releaseRefreshLock('stale-integ');
  });

  // ─── Error Handling Integration ─────────────────────────────────────────

  /**
   * @plan PLAN-20260213-KEYRINGTOKENSTORE.P08
   * @requirement R11, R12
   * @given SecureStore contains non-JSON corrupt data
   * @when getToken is called
   * @then Returns null without throwing
   */
  it('getToken with corrupt data returns null', async () => {
    await secureStore.set('corrupt-integ:default', '<<<not-valid-json>>>');
    const result = await tokenStore.getToken('corrupt-integ');
    expect(result).toBeNull();
  });

  /**
   * @plan PLAN-20260213-KEYRINGTOKENSTORE.P08
   * @requirement R11, R12
   * @given SecureStore contains valid JSON that fails OAuthToken schema
   * @when getToken is called
   * @then Returns null without throwing
   */
  it('getToken with invalid schema returns null', async () => {
    await secureStore.set(
      'bad-schema-integ:default',
      JSON.stringify({ not_a_token: true, random_field: 42 }),
    );
    const result = await tokenStore.getToken('bad-schema-integ');
    expect(result).toBeNull();
  });

  /**
   * @plan PLAN-20260213-KEYRINGTOKENSTORE.P08
   * @requirement R11, R12
   * @given A KeyringTokenStore backed by a SecureStore with a failing adapter
   * @when removeToken is called
   * @then Returns normally (swallows error)
   */
  it('removeToken with failing SecureStore returns normally', async () => {
    const errorTempDir = await createTempDir();
    const failKeyring = createMockKeyring();
    failKeyring.deletePassword = async () => {
      throw new Error('Keyring delete failed');
    };
    const failStore = new SecureStore('llxprt-code-oauth', {
      keyringLoader: async () => failKeyring,
      fallbackDir: path.join(errorTempDir, 'nonexistent'),
      fallbackPolicy: 'allow',
    });
    const failTokenStore = new KeyringTokenStore({ secureStore: failStore });

    await expect(
      failTokenStore.removeToken('anthropic'),
    ).resolves.toBeUndefined();

    await fs.rm(errorTempDir, { recursive: true, force: true });
  });

  /**
   * @plan PLAN-20260213-KEYRINGTOKENSTORE.P08
   * @requirement R11, R12
   * @given A KeyringTokenStore backed by a SecureStore with a failing list
   * @when listProviders is called
   * @then Returns empty array
   */
  it('listProviders with failing SecureStore returns []', async () => {
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
    const failTokenStore = new KeyringTokenStore({ secureStore: failStore });

    const result = await failTokenStore.listProviders();
    expect(result).toEqual([]);

    await fs.rm(errorTempDir, { recursive: true, force: true });
  });

  // ─── Multi-Instance Coherence ───────────────────────────────────────────

  /**
   * @plan PLAN-20260213-KEYRINGTOKENSTORE.P08
   * @requirement R18.7
   * @given Two KeyringTokenStore instances sharing the same SecureStore
   * @when Token is saved via instance A
   * @then Token is retrievable via instance B
   */
  it('multi-instance: save in A, get in B → consistent', async () => {
    const {
      storeA,
      storeB,
      tempDir: sharedTempDir,
    } = await createSharedStoreSetup();

    const token = makeToken({ access_token: 'shared-at' });
    await storeA.saveToken('anthropic', token);

    const retrieved = await storeB.getToken('anthropic');
    expect(retrieved).not.toBeNull();
    expect(retrieved!.access_token).toBe('shared-at');

    await fs.rm(sharedTempDir, { recursive: true, force: true });
  });

  /**
   * @plan PLAN-20260213-KEYRINGTOKENSTORE.P08
   * @requirement R18.7
   * @given Two KeyringTokenStore instances sharing the same SecureStore
   * @when Tokens saved via instance A for multiple providers
   * @then listProviders via instance B sees all saved providers
   */
  it('multi-instance: save in A, listProviders in B → B sees all', async () => {
    const {
      storeA,
      storeB,
      tempDir: sharedTempDir,
    } = await createSharedStoreSetup();

    await storeA.saveToken('anthropic', makeToken());
    await storeA.saveToken('gemini', makeToken());
    await storeA.saveToken('codex', makeToken());

    const providers = await storeB.listProviders();
    expect(providers).toEqual(['anthropic', 'codex', 'gemini']);

    await fs.rm(sharedTempDir, { recursive: true, force: true });
  });

  /**
   * @plan PLAN-20260213-KEYRINGTOKENSTORE.P08
   * @requirement R18.7
   * @given Two KeyringTokenStore instances sharing the same SecureStore with a saved token
   * @when Token is removed via instance A
   * @then getToken via instance B returns null
   */
  it('multi-instance: remove in A, get in B → null', async () => {
    const {
      storeA,
      storeB,
      tempDir: sharedTempDir,
    } = await createSharedStoreSetup();

    await storeA.saveToken('anthropic', makeToken());

    // Verify B can see it
    const beforeRemove = await storeB.getToken('anthropic');
    expect(beforeRemove).not.toBeNull();

    // Remove via A
    await storeA.removeToken('anthropic');

    // B should see null now
    const afterRemove = await storeB.getToken('anthropic');
    expect(afterRemove).toBeNull();

    await fs.rm(sharedTempDir, { recursive: true, force: true });
  });

  // ─── Property-Based Integration Tests ───────────────────────────────────

  /**
   * @plan PLAN-20260213-KEYRINGTOKENSTORE.P08
   * @requirement R17.3, R18.1
   * @given Any sequence of N save/get/remove operations for random providers
   * @when Executed against a single KeyringTokenStore
   * @then Final state is consistent: get returns last saved token or null if removed
   */
  it('PROP: any save/get/remove sequence produces consistent final state', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            provider: validNameArb,
            op: fc.constantFrom('save', 'remove') as fc.Arbitrary<
              'save' | 'remove'
            >,
          }),
          { minLength: 1, maxLength: 15 },
        ),
        async (operations) => {
          const setup = await createTestStore();
          try {
            // Track expected state
            const expectedState = new Map<string, OAuthToken | null>();

            for (const { provider, op } of operations) {
              if (op === 'save') {
                const token = makeToken();
                await setup.tokenStore.saveToken(provider, token);
                expectedState.set(provider, token);
              } else {
                await setup.tokenStore.removeToken(provider);
                expectedState.set(provider, null);
              }
            }

            // Verify final state
            for (const [provider, expectedToken] of expectedState) {
              const actual = await setup.tokenStore.getToken(provider);
              if (expectedToken === null) {
                expect(actual).toBeNull();
              } else {
                expect(actual).not.toBeNull();
                expect(actual!.access_token).toBe(expectedToken.access_token);
              }
            }
          } finally {
            await fs.rm(setup.tempDir, { recursive: true, force: true });
          }
        },
      ),
      { numRuns: 15 },
    );
  });

  /**
   * @plan PLAN-20260213-KEYRINGTOKENSTORE.P08
   * @requirement R17.3, R18.6
   * @given Any sequence of save+get for random provider:bucket pairs
   * @when Executed against a KeyringTokenStore
   * @then Each pair always round-trips correctly
   */
  it('PROP: save+get for random provider:bucket pairs always round-trips', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            provider: validNameArb,
            bucket: validNameArb,
          }),
          { minLength: 1, maxLength: 10 },
        ),
        async (pairs) => {
          const setup = await createTestStore();
          try {
            const savedTokens = new Map<string, OAuthToken>();

            for (const { provider, bucket } of pairs) {
              const token = makeToken();
              await setup.tokenStore.saveToken(provider, token, bucket);
              savedTokens.set(`${provider}:${bucket}`, token);
            }

            for (const [key, expectedToken] of savedTokens) {
              const [provider, bucket] = key.split(':');
              const actual = await setup.tokenStore.getToken(provider, bucket);
              expect(actual).not.toBeNull();
              expect(actual!.access_token).toBe(expectedToken.access_token);
              expect(actual!.refresh_token).toBe(expectedToken.refresh_token);
              expect(actual!.expiry).toBe(expectedToken.expiry);
            }
          } finally {
            await fs.rm(setup.tempDir, { recursive: true, force: true });
          }
        },
      ),
      { numRuns: 15 },
    );
  });

  /**
   * @plan PLAN-20260213-KEYRINGTOKENSTORE.P08
   * @requirement R17.4, R18.2
   * @given K random unique providers with saved tokens
   * @when listProviders is called
   * @then Returns exactly those K providers sorted alphabetically
   */
  it('PROP: listProviders after saving for K random providers returns exactly K sorted', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(validNameArb, { minLength: 1, maxLength: 8 }),
        async (providers) => {
          const setup = await createTestStore();
          try {
            for (const p of providers) {
              await setup.tokenStore.saveToken(p, makeToken());
            }
            const listed = await setup.tokenStore.listProviders();
            expect(listed).toEqual([...providers].sort());
          } finally {
            await fs.rm(setup.tempDir, { recursive: true, force: true });
          }
        },
      ),
      { numRuns: 15 },
    );
  });

  /**
   * @plan PLAN-20260213-KEYRINGTOKENSTORE.P08
   * @requirement R18.6
   * @given K random unique buckets saved for a single provider
   * @when listBuckets is called
   * @then Returns exactly those K buckets sorted alphabetically
   */
  it('PROP: listBuckets after saving for K random buckets returns exactly K sorted', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(validNameArb, { minLength: 1, maxLength: 8 }),
        async (buckets) => {
          const setup = await createTestStore();
          try {
            for (const b of buckets) {
              await setup.tokenStore.saveToken('bucketprov', makeToken(), b);
            }
            const listed = await setup.tokenStore.listBuckets('bucketprov');
            expect(listed).toEqual([...buckets].sort());
          } finally {
            await fs.rm(setup.tempDir, { recursive: true, force: true });
          }
        },
      ),
      { numRuns: 15 },
    );
  });

  /**
   * @plan PLAN-20260213-KEYRINGTOKENSTORE.P08
   * @requirement R17.7, R18.3
   * @given Random valid provider names
   * @when acquireRefreshLock then releaseRefreshLock is performed sequentially
   * @then Lock cycle is always consistent: acquire succeeds, release completes, re-acquire succeeds
   */
  it('PROP: sequential lock acquire+release for random providers is always consistent', async () => {
    await fc.assert(
      fc.asyncProperty(validNameArb, async (provider) => {
        const acquired = await tokenStore.acquireRefreshLock(provider);
        expect(acquired).toBe(true);
        await tokenStore.releaseRefreshLock(provider);

        // Re-acquire to verify release was effective
        const reacquired = await tokenStore.acquireRefreshLock(provider);
        expect(reacquired).toBe(true);
        await tokenStore.releaseRefreshLock(provider);
      }),
      { numRuns: 10 },
    );
  });

  /**
   * @plan PLAN-20260213-KEYRINGTOKENSTORE.P08
   * @requirement R17.3, R18.1
   * @given Any valid provider and a sequence of save operations
   * @when Multiple saves to the same provider:bucket
   * @then getToken always returns the last-saved token (update overwrites)
   */
  it('PROP: multiple saves to same key always yield the last-saved token', async () => {
    await fc.assert(
      fc.asyncProperty(
        validNameArb,
        fc.integer({ min: 2, max: 5 }),
        async (provider, numSaves) => {
          const setup = await createTestStore();
          try {
            let lastToken: OAuthToken | null = null;
            for (let i = 0; i < numSaves; i++) {
              lastToken = makeToken({ access_token: `save-${i}` });
              await setup.tokenStore.saveToken(provider, lastToken);
            }
            const retrieved = await setup.tokenStore.getToken(provider);
            expect(retrieved).not.toBeNull();
            expect(retrieved!.access_token).toBe(lastToken!.access_token);
          } finally {
            await fs.rm(setup.tempDir, { recursive: true, force: true });
          }
        },
      ),
      { numRuns: 10 },
    );
  });
});
