/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for ProviderKeyStorage.
 *
 * Tests drive the implementation (TDD): they should all FAIL against the
 * current stub, which throws NotYetImplemented for every CRUD method.
 * Validation tests may pass since validateKeyName has real implementation.
 *
 * @plan PLAN-20260211-SECURESTORE.P11
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { SecureStore, type KeyringAdapter } from './secure-store.js';
import {
  ProviderKeyStorage,
  getProviderKeyStorage,
  resetProviderKeyStorage,
  validateKeyName,
  KEY_NAME_REGEX,
} from './provider-key-storage.js';

// ─── Test Helpers ────────────────────────────────────────────────────────────

/**
 * Creates an in-memory mock keytar adapter for testing keychain operations.
 * Injected via SecureStoreOptions.keyringLoader — no mock theater.
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
  return fs.mkdtemp(path.join(os.tmpdir(), 'provider-key-storage-test-'));
}

/**
 * Creates a ProviderKeyStorage backed by a real SecureStore with
 * an in-memory mock keytar adapter and a temp fallback directory.
 */
function createTestStorage(
  mockKeyring: KeyringAdapter,
  fallbackDir: string,
): ProviderKeyStorage {
  const secureStore = new SecureStore('llxprt-code-provider-keys', {
    keyringLoader: async () => mockKeyring,
    fallbackDir,
    fallbackPolicy: 'allow',
  });
  return new ProviderKeyStorage({ secureStore });
}

// ─── Key Name Validation (R10) ───────────────────────────────────────────────

describe('ProviderKeyStorage — Key Name Validation', () => {
  /**
   * @plan PLAN-20260211-SECURESTORE.P11
   * @requirement R10.1
   */
  it('accepts valid alphanumeric key names', () => {
    expect(() => validateKeyName('mykey123')).not.toThrow();
  });

  /**
   * @plan PLAN-20260211-SECURESTORE.P11
   * @requirement R10.1
   */
  it('accepts key names with dashes, underscores, and dots', () => {
    expect(() => validateKeyName('my-api_key.v2')).not.toThrow();
  });

  /**
   * @plan PLAN-20260211-SECURESTORE.P11
   * @requirement R10.1
   */
  it('accepts a key name exactly 64 characters long', () => {
    const name = 'a'.repeat(64);
    expect(() => validateKeyName(name)).not.toThrow();
  });

  /**
   * @plan PLAN-20260211-SECURESTORE.P11
   * @requirement R10.1, R10.2
   */
  it('rejects empty key name with descriptive error', () => {
    expect(() => validateKeyName('')).toThrow(
      "Key name '' is invalid. Use only letters, numbers, dashes, underscores, and dots (1-64 chars).",
    );
  });

  /**
   * @plan PLAN-20260211-SECURESTORE.P11
   * @requirement R10.1, R10.2
   */
  it('rejects key name with spaces', () => {
    expect(() => validateKeyName('my key')).toThrow(
      "Key name 'my key' is invalid.",
    );
  });

  /**
   * @plan PLAN-20260211-SECURESTORE.P11
   * @requirement R10.1, R10.2
   */
  it('rejects key name with special characters', () => {
    expect(() => validateKeyName('key@#!')).toThrow(
      "Key name 'key@#!' is invalid.",
    );
  });

  /**
   * @plan PLAN-20260211-SECURESTORE.P11
   * @requirement R10.1, R10.2
   */
  it('rejects key name longer than 64 characters', () => {
    const longName = 'a'.repeat(65);
    expect(() => validateKeyName(longName)).toThrow('is invalid.');
  });

  /**
   * @plan PLAN-20260211-SECURESTORE.P11
   * @requirement R10.1
   */
  it('KEY_NAME_REGEX matches the expected pattern', () => {
    expect(KEY_NAME_REGEX.source).toBe('^[a-zA-Z0-9._-]{1,64}$');
    expect(KEY_NAME_REGEX.test('valid-name')).toBe(true);
    expect(KEY_NAME_REGEX.test('invalid name!')).toBe(false);
  });
});

// ─── CRUD Operations (R9) ────────────────────────────────────────────────────

describe('ProviderKeyStorage — CRUD Operations', () => {
  let tempDir: string;
  let mockKeyring: KeyringAdapter & { store: Map<string, string> };
  let storage: ProviderKeyStorage;

  beforeEach(async () => {
    tempDir = await createTempFallbackDir();
    mockKeyring = createMockKeyring();
    storage = createTestStorage(mockKeyring, tempDir);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  /**
   * @plan PLAN-20260211-SECURESTORE.P11
   * @requirement R9.1, R9.2
   */
  it('saveKey stores and getKey retrieves a key', async () => {
    await storage.saveKey('claude', 'sk-ant-abc123');
    const result = await storage.getKey('claude');
    expect(result).toBe('sk-ant-abc123');
  });

  /**
   * @plan PLAN-20260211-SECURESTORE.P11
   * @requirement R9.2
   */
  it('saveKey trims leading and trailing whitespace from value', async () => {
    await storage.saveKey('trimtest', '  sk-abc123  ');
    const result = await storage.getKey('trimtest');
    expect(result).toBe('sk-abc123');
  });

  /**
   * @plan PLAN-20260211-SECURESTORE.P11
   * @requirement R9.2
   */
  it('saveKey strips trailing newlines and carriage returns', async () => {
    await storage.saveKey('newlinetest', 'sk-abc123\r\n\n');
    const result = await storage.getKey('newlinetest');
    expect(result).toBe('sk-abc123');
  });

  /**
   * @plan PLAN-20260211-SECURESTORE.P11
   * @requirement R9.2
   */
  it('saveKey preserves embedded newlines (only trailing stripped)', async () => {
    await storage.saveKey('embedded', 'sk-abc\n123\n');
    const result = await storage.getKey('embedded');
    expect(result).toBe('sk-abc\n123');
  });

  /**
   * @plan PLAN-20260211-SECURESTORE.P11
   * @requirement R9.2
   */
  it('saveKey rejects empty API key value after trimming', async () => {
    await expect(storage.saveKey('emptyval', '   \n\r  ')).rejects.toThrow(
      'API key value cannot be empty.',
    );
  });

  /**
   * @plan PLAN-20260211-SECURESTORE.P11
   * @requirement R9.1
   */
  it('saveKey overwrites an existing key', async () => {
    await storage.saveKey('overwrite', 'old-key-value');
    await storage.saveKey('overwrite', 'new-key-value');
    const result = await storage.getKey('overwrite');
    expect(result).toBe('new-key-value');
  });

  /**
   * @plan PLAN-20260211-SECURESTORE.P11
   * @requirement R9.3
   */
  it('getKey returns null for a non-existent key', async () => {
    const result = await storage.getKey('nonexistent');
    expect(result).toBeNull();
  });

  /**
   * @plan PLAN-20260211-SECURESTORE.P11
   * @requirement R9.4
   */
  it('deleteKey returns true when key is deleted', async () => {
    await storage.saveKey('todelete', 'sk-delete-me');
    const deleted = await storage.deleteKey('todelete');
    expect(deleted).toBe(true);

    const result = await storage.getKey('todelete');
    expect(result).toBeNull();
  });

  /**
   * @plan PLAN-20260211-SECURESTORE.P11
   * @requirement R9.4
   */
  it('deleteKey returns false when key does not exist', async () => {
    const deleted = await storage.deleteKey('neverexisted');
    expect(deleted).toBe(false);
  });

  /**
   * @plan PLAN-20260211-SECURESTORE.P11
   * @requirement R9.5
   */
  it('listKeys returns sorted key names', async () => {
    await storage.saveKey('gamma', 'value-3');
    await storage.saveKey('alpha', 'value-1');
    await storage.saveKey('beta', 'value-2');

    const keys = await storage.listKeys();
    expect(keys).toEqual(['alpha', 'beta', 'gamma']);
  });

  /**
   * @plan PLAN-20260211-SECURESTORE.P11
   * @requirement R9.5
   */
  it('listKeys returns empty array when no keys stored', async () => {
    const keys = await storage.listKeys();
    expect(keys).toEqual([]);
  });

  /**
   * @plan PLAN-20260211-SECURESTORE.P11
   * @requirement R9.6
   */
  it('hasKey returns true for an existing key', async () => {
    await storage.saveKey('exists', 'sk-value');
    const result = await storage.hasKey('exists');
    expect(result).toBe(true);
  });

  /**
   * @plan PLAN-20260211-SECURESTORE.P11
   * @requirement R9.6
   */
  it('hasKey returns false for a non-existing key', async () => {
    const result = await storage.hasKey('missing');
    expect(result).toBe(false);
  });

  /**
   * @plan PLAN-20260211-SECURESTORE.P11
   * @requirement R10.1
   */
  it('CRUD methods validate key name before operating', async () => {
    await expect(storage.saveKey('bad name!', 'value')).rejects.toThrow(
      "Key name 'bad name!' is invalid.",
    );
    await expect(storage.getKey('bad name!')).rejects.toThrow(
      "Key name 'bad name!' is invalid.",
    );
    await expect(storage.deleteKey('bad name!')).rejects.toThrow(
      "Key name 'bad name!' is invalid.",
    );
    await expect(storage.hasKey('bad name!')).rejects.toThrow(
      "Key name 'bad name!' is invalid.",
    );
  });
});

// ─── Case Sensitivity (R11) ─────────────────────────────────────────────────

describe('ProviderKeyStorage — Case Sensitivity', () => {
  let tempDir: string;
  let mockKeyring: KeyringAdapter & { store: Map<string, string> };
  let storage: ProviderKeyStorage;

  beforeEach(async () => {
    tempDir = await createTempFallbackDir();
    mockKeyring = createMockKeyring();
    storage = createTestStorage(mockKeyring, tempDir);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  /**
   * @plan PLAN-20260211-SECURESTORE.P11
   * @requirement R11.1
   */
  it('treats MyKey and mykey as different keys', async () => {
    await storage.saveKey('MyKey', 'value-upper');
    await storage.saveKey('mykey', 'value-lower');

    const upper = await storage.getKey('MyKey');
    const lower = await storage.getKey('mykey');
    expect(upper).toBe('value-upper');
    expect(lower).toBe('value-lower');
  });
});

// ─── Encrypted Fallback (R11) ────────────────────────────────────────────────

describe('ProviderKeyStorage — Encrypted Fallback', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempFallbackDir();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  /**
   * @plan PLAN-20260211-SECURESTORE.P11
   * @requirement R9.1
   */
  it('stores and retrieves keys via encrypted fallback when keyring unavailable', async () => {
    const secureStore = new SecureStore('llxprt-code-provider-keys', {
      keyringLoader: async () => null,
      fallbackDir: tempDir,
      fallbackPolicy: 'allow',
    });
    const storage = new ProviderKeyStorage({ secureStore });

    await storage.saveKey('fallback-key', 'sk-fallback-value');
    const result = await storage.getKey('fallback-key');
    expect(result).toBe('sk-fallback-value');
  });

  /**
   * @plan PLAN-20260211-SECURESTORE.P11
   * @requirement R9.5
   */
  it('listKeys deduplicates across keyring and fallback', async () => {
    const mockKeyring = createMockKeyring();

    // Create a SecureStore where keyring will fail after initial set
    let shouldFailKeyring = false;
    const flakyKeyring: KeyringAdapter = {
      getPassword: async (service, account) => {
        if (shouldFailKeyring) throw new Error('keyring locked');
        return mockKeyring.getPassword(service, account);
      },
      setPassword: async (service, account, password) => {
        if (shouldFailKeyring) throw new Error('keyring locked');
        return mockKeyring.setPassword(service, account, password);
      },
      deletePassword: async (service, account) => {
        if (shouldFailKeyring) throw new Error('keyring locked');
        return mockKeyring.deletePassword(service, account);
      },
      findCredentials: async (service) => {
        if (shouldFailKeyring) throw new Error('keyring locked');
        return mockKeyring.findCredentials!(service);
      },
    };

    const secureStore = new SecureStore('llxprt-code-provider-keys', {
      keyringLoader: async () => flakyKeyring,
      fallbackDir: tempDir,
      fallbackPolicy: 'allow',
    });
    const storage = new ProviderKeyStorage({ secureStore });

    // Store key while keyring is available (goes to keyring)
    await storage.saveKey('shared-key', 'value1');

    // Now make keyring fail so second store goes to fallback
    shouldFailKeyring = true;
    await storage.saveKey('fallback-only', 'value2');

    // Restore keyring — list should include both, deduplicated
    shouldFailKeyring = false;
    const keys = await storage.listKeys();
    expect(keys).toContain('shared-key');
    expect(keys).toContain('fallback-only');
    // No duplicates
    const uniqueKeys = [...new Set(keys)];
    expect(keys).toEqual(uniqueKeys);
    // Sorted
    expect(keys).toEqual([...keys].sort());
  });
});

// ─── Singleton (R11) ─────────────────────────────────────────────────────────

describe('ProviderKeyStorage — Singleton', () => {
  afterEach(() => {
    resetProviderKeyStorage();
  });

  /**
   * @plan PLAN-20260211-SECURESTORE.P11
   * @requirement R11.2
   */
  it('getProviderKeyStorage returns the same instance on repeated calls', () => {
    const first = getProviderKeyStorage();
    const second = getProviderKeyStorage();
    expect(first).toBe(second);
  });

  /**
   * @plan PLAN-20260211-SECURESTORE.P11
   * @requirement R11.2
   */
  it('resetProviderKeyStorage clears the singleton for test isolation', () => {
    const first = getProviderKeyStorage();
    resetProviderKeyStorage();
    const second = getProviderKeyStorage();
    expect(first).not.toBe(second);
  });
});
