/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for SecureStore.
 *
 * Tests drive the implementation (TDD): they should all FAIL against the
 * current stub, which throws NotYetImplemented for every method.
 *
 * @plan PLAN-20260211-SECURESTORE.P05
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  SecureStore,
  SecureStoreError,
  type KeyringAdapter,
} from './secure-store.js';

// ─── Test Helpers ────────────────────────────────────────────────────────────

/**
 * Creates an in-memory mock keytar adapter for testing keychain operations.
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
 * Creates a temp directory for use as fallbackDir in tests.
 */
async function createTempFallbackDir(): Promise<string> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'secure-store-test-'));
  return tmpDir;
}

// ─── Keyring Access (R1) ─────────────────────────────────────────────────────

describe('SecureStore — Keyring Access', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempFallbackDir();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  /**
   * @plan PLAN-20260211-SECURESTORE.P05
   * @requirement R1.1
   */
  it('stores a value in keyring when available', async () => {
    const mockKeyring = createMockKeyring();
    const store = new SecureStore('test-service', {
      keyringLoader: async () => mockKeyring,
      fallbackDir: tempDir,
    });

    await store.set('mykey', 'myvalue');
    const result = await store.get('mykey');
    expect(result).toBe('myvalue');
  });

  /**
   * @plan PLAN-20260211-SECURESTORE.P05
   * @requirement R1.1
   */
  it('retrieves a value from keyring', async () => {
    const mockKeyring = createMockKeyring();
    const store = new SecureStore('test-service', {
      keyringLoader: async () => mockKeyring,
      fallbackDir: tempDir,
    });

    await store.set('retrieve-test', 'secret-123');
    const result = await store.get('retrieve-test');
    expect(result).toBe('secret-123');
  });

  /**
   * @plan PLAN-20260211-SECURESTORE.P05
   * @requirement R1.2
   */
  it('handles keyring unavailable when keyringLoader returns null', async () => {
    const store = new SecureStore('test-service', {
      keyringLoader: async () => null,
      fallbackDir: tempDir,
    });

    const available = await store.isKeychainAvailable();
    expect(available).toBe(false);
  });

  /**
   * @plan PLAN-20260211-SECURESTORE.P05
   * @requirement R1.3
   */
  it('keyringLoader injection provides the adapter used for storage', async () => {
    const mockKeyring = createMockKeyring();
    const store = new SecureStore('test-service', {
      keyringLoader: async () => mockKeyring,
      fallbackDir: tempDir,
    });

    await store.set('injected-key', 'injected-value');
    // Verify the value was actually stored via the injected adapter
    const storedInAdapter = mockKeyring.store.get('test-service:injected-key');
    expect(storedInAdapter).toBe('injected-value');
  });
});

// ─── Availability Probe (R2) ─────────────────────────────────────────────────

describe('SecureStore — Availability Probe', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempFallbackDir();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  /**
   * @plan PLAN-20260211-SECURESTORE.P05
   * @requirement R2.1
   */
  it('probe returns true when keyring works', async () => {
    const mockKeyring = createMockKeyring();
    const store = new SecureStore('test-service', {
      keyringLoader: async () => mockKeyring,
      fallbackDir: tempDir,
    });

    const available = await store.isKeychainAvailable();
    expect(available).toBe(true);
  });

  /**
   * @plan PLAN-20260211-SECURESTORE.P05
   * @requirement R2.1
   */
  it('probe returns false when keyring adapter is null', async () => {
    const store = new SecureStore('test-service', {
      keyringLoader: async () => null,
      fallbackDir: tempDir,
    });

    const available = await store.isKeychainAvailable();
    expect(available).toBe(false);
  });

  /**
   * @plan PLAN-20260211-SECURESTORE.P05
   * @requirement R2.2
   */
  it('probe result is cached for 60 seconds', async () => {
    let callCount = 0;
    let probeSetCalls = 0;
    const mockKeyring = createMockKeyring();
    const spiedKeyring: KeyringAdapter = {
      ...mockKeyring,
      setPassword: async (...args: [string, string, string]) => {
        probeSetCalls++;
        return mockKeyring.setPassword(...args);
      },
    };
    const countingLoader = async () => {
      callCount++;
      return spiedKeyring;
    };
    const store = new SecureStore('test-service', {
      keyringLoader: countingLoader,
      fallbackDir: tempDir,
    });

    const first = await store.isKeychainAvailable();
    const second = await store.isKeychainAvailable();
    expect(first).toBe(true);
    expect(second).toBe(true);
    // The loader is called once (adapter is cached)
    expect(callCount).toBe(1);
    // The probe cycle (set/get/delete) runs only once — second call uses cached result
    expect(probeSetCalls).toBe(1);
  });

  /**
   * @plan PLAN-20260211-SECURESTORE.P05
   * @requirement R2.3
   */
  it('transient error invalidates the cache', async () => {
    let shouldFail = false;
    const probeStore = new Map<string, string>();
    const adapter: KeyringAdapter = {
      getPassword: async (_svc: string, acct: string) => {
        if (shouldFail) throw new Error('timed out');
        return probeStore.get(acct) ?? null;
      },
      setPassword: async (_svc: string, acct: string, pw: string) => {
        if (shouldFail) throw new Error('timed out');
        probeStore.set(acct, pw);
      },
      deletePassword: async (_svc: string, acct: string) => {
        if (shouldFail) throw new Error('timed out');
        return probeStore.delete(acct);
      },
    };
    const store = new SecureStore('test-service', {
      keyringLoader: async () => adapter,
      fallbackDir: tempDir,
    });

    // First probe succeeds
    const first = await store.isKeychainAvailable();
    expect(first).toBe(true);

    // Now make the adapter fail transiently
    shouldFail = true;

    // Trigger consecutive keyring failures via set() to invalidate the cache
    // (3 consecutive failures = KEYRING_FAILURE_THRESHOLD)
    for (let i = 0; i < 3; i++) {
      try {
        await store.set(`fail-${i}`, 'val');
      } catch {
        // expected — fallback policy is 'allow' so some may write to file
      }
    }

    // After cache invalidation, isKeychainAvailable re-probes and fails
    const second = await store.isKeychainAvailable();
    expect(second).toBe(false);
  });
});

// ─── CRUD Operations (R3) ────────────────────────────────────────────────────

describe('SecureStore — CRUD Operations', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempFallbackDir();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  /**
   * @plan PLAN-20260211-SECURESTORE.P05
   * @requirement R3.1a
   */
  it('set() stores in keyring when available', async () => {
    const mockKeyring = createMockKeyring();
    const store = new SecureStore('test-service', {
      keyringLoader: async () => mockKeyring,
      fallbackDir: tempDir,
    });

    await store.set('mykey', 'myvalue');
    const result = await store.get('mykey');
    expect(result).toBe('myvalue');
  });

  /**
   * @plan PLAN-20260211-SECURESTORE.P05
   * @requirement R3.1b
   */
  it('set() stores in fallback when keyring unavailable', async () => {
    const store = new SecureStore('test-service', {
      keyringLoader: async () => null,
      fallbackDir: tempDir,
      fallbackPolicy: 'allow',
    });

    await store.set('fallback-key', 'fallback-value');
    const result = await store.get('fallback-key');
    expect(result).toBe('fallback-value');
  });

  /**
   * @plan PLAN-20260211-SECURESTORE.P05
   * @requirement R3.2
   */
  it('get() retrieves from keyring', async () => {
    const mockKeyring = createMockKeyring();
    const store = new SecureStore('test-service', {
      keyringLoader: async () => mockKeyring,
      fallbackDir: tempDir,
    });

    await store.set('keyring-get', 'keyring-value');
    const result = await store.get('keyring-get');
    expect(result).toBe('keyring-value');
  });

  /**
   * @plan PLAN-20260211-SECURESTORE.P05
   * @requirement R3.3
   */
  it('get() retrieves from fallback when not in keyring', async () => {
    // Store via fallback (no keyring)
    const fallbackStore = new SecureStore('test-service', {
      keyringLoader: async () => null,
      fallbackDir: tempDir,
      fallbackPolicy: 'allow',
    });
    await fallbackStore.set('fallback-only', 'fb-value');

    // Read with a new store instance that also has no keyring
    const readStore = new SecureStore('test-service', {
      keyringLoader: async () => null,
      fallbackDir: tempDir,
      fallbackPolicy: 'allow',
    });
    const result = await readStore.get('fallback-only');
    expect(result).toBe('fb-value');
  });

  /**
   * @plan PLAN-20260211-SECURESTORE.P05
   * @requirement R3.4
   */
  it('get() returns null when not found anywhere', async () => {
    const mockKeyring = createMockKeyring();
    const store = new SecureStore('test-service', {
      keyringLoader: async () => mockKeyring,
      fallbackDir: tempDir,
    });

    const result = await store.get('nonexistent');
    expect(result).toBeNull();
  });

  /**
   * @plan PLAN-20260211-SECURESTORE.P05
   * @requirement R3.5
   */
  it('get() keyring value wins over fallback value', async () => {
    const mockKeyring = createMockKeyring();

    // Write to fallback only (no keyring)
    const fallbackStore = new SecureStore('test-service', {
      keyringLoader: async () => null,
      fallbackDir: tempDir,
      fallbackPolicy: 'allow',
    });
    await fallbackStore.set('both-key', 'fallback-val');

    // Write to keyring (now with keyring available)
    const keyringStore = new SecureStore('test-service', {
      keyringLoader: async () => mockKeyring,
      fallbackDir: tempDir,
    });
    await keyringStore.set('both-key', 'keyring-val');

    // Read should return keyring value
    const result = await keyringStore.get('both-key');
    expect(result).toBe('keyring-val');
  });

  /**
   * @plan PLAN-20260211-SECURESTORE.P05
   * @requirement R3.5
   */
  it('handles keys with colons (Windows compatibility)', async () => {
    const store = new SecureStore('test-service', {
      keyringLoader: async () => null, // force fallback
      fallbackDir: tempDir,
    });

    const keyWithColon = 'service:account';
    await store.set(keyWithColon, 'secret-val');
    const result = await store.get(keyWithColon);
    expect(result).toBe('secret-val');

    const list = await store.list();
    expect(list).toContain(keyWithColon);
  });

  /**
   * @plan PLAN-20260211-SECURESTORE.P05
   * @requirement R3.6
   */
  it('delete() removes from both keyring and fallback', async () => {
    const mockKeyring = createMockKeyring();

    // Store in fallback first (no keyring)
    const fallbackStore = new SecureStore('test-service', {
      keyringLoader: async () => null,
      fallbackDir: tempDir,
      fallbackPolicy: 'allow',
    });
    await fallbackStore.set('delete-me', 'fb-value');

    // Also store in keyring
    const store = new SecureStore('test-service', {
      keyringLoader: async () => mockKeyring,
      fallbackDir: tempDir,
    });
    await store.set('delete-me', 'kr-value');

    // Delete from both
    const deleted = await store.delete('delete-me');
    expect(deleted).toBe(true);

    // Verify gone from keyring
    const fromKeyring = await store.get('delete-me');
    expect(fromKeyring).toBeNull();

    // Verify gone from fallback (new store with no keyring)
    const fallbackRead = new SecureStore('test-service', {
      keyringLoader: async () => null,
      fallbackDir: tempDir,
      fallbackPolicy: 'allow',
    });
    const fromFallback = await fallbackRead.get('delete-me');
    expect(fromFallback).toBeNull();
  });

  /**
   * @plan PLAN-20260211-SECURESTORE.P05
   * @requirement R3.7
   */
  it('list() combines keyring and fallback, deduplicated and sorted', async () => {
    const mockKeyring = createMockKeyring();

    // Store 'a' and 'b' in keyring
    const keyringStore = new SecureStore('test-service', {
      keyringLoader: async () => mockKeyring,
      fallbackDir: tempDir,
    });
    await keyringStore.set('a', 'val-a');
    await keyringStore.set('b', 'val-b');

    // Store 'b' and 'c' in fallback
    const fallbackStore = new SecureStore('test-service', {
      keyringLoader: async () => null,
      fallbackDir: tempDir,
      fallbackPolicy: 'allow',
    });
    await fallbackStore.set('b', 'val-b-fb');
    await fallbackStore.set('c', 'val-c');

    // List with keyring available should return deduplicated sorted list
    const keys = await keyringStore.list();
    expect(keys).toStrictEqual(['a', 'b', 'c']);
  });

  /**
   * @plan PLAN-20260211-SECURESTORE.P05
   * @requirement R3.8
   */
  it('has() returns true when key exists', async () => {
    const mockKeyring = createMockKeyring();
    const store = new SecureStore('test-service', {
      keyringLoader: async () => mockKeyring,
      fallbackDir: tempDir,
    });

    await store.set('has-key', 'some-value');
    const result = await store.has('has-key');
    expect(result).toBe(true);
  });

  /**
   * @plan PLAN-20260211-SECURESTORE.P05
   * @requirement R3.8
   */
  it('has() returns false when key not found', async () => {
    const mockKeyring = createMockKeyring();
    const store = new SecureStore('test-service', {
      keyringLoader: async () => mockKeyring,
      fallbackDir: tempDir,
    });

    const result = await store.has('nonexistent');
    expect(result).toBe(false);
  });

  /**
   * @plan PLAN-20260211-SECURESTORE.P05
   * @requirement R3.8
   */
  it('has() throws SecureStoreError on non-NOT_FOUND keyring errors', async () => {
    const adapter: KeyringAdapter = {
      getPassword: async () => {
        throw new Error('Keyring locked');
      },
      setPassword: async () => {
        throw new Error('Keyring locked');
      },
      deletePassword: async () => {
        throw new Error('Keyring locked');
      },
    };
    const store = new SecureStore('test-service', {
      keyringLoader: async () => adapter,
      fallbackDir: tempDir,
    });

    let err: unknown;
    try {
      await store.has('locked-key');
    } catch (__caught) {
      err = __caught;
    }
    expect(err).toBeDefined();
    expect(err).toBeInstanceOf(SecureStoreError);
    expect((err as SecureStoreError).code).toBe('LOCKED');
  });
});

// ─── Encrypted File Fallback (R4) ────────────────────────────────────────────
