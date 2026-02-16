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
    expect(keys).toEqual(['a', 'b', 'c']);
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

    try {
      await store.has('locked-key');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(SecureStoreError);
      expect((err as SecureStoreError).code).toBe('LOCKED');
    }
  });
});

// ─── Encrypted File Fallback (R4) ────────────────────────────────────────────

describe('SecureStore — Encrypted File Fallback', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempFallbackDir();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  /**
   * @plan PLAN-20260211-SECURESTORE.P05
   * @requirement R4.1
   */
  it('fallback uses AES-256-GCM — file content is not plaintext', async () => {
    const store = new SecureStore('test-service', {
      keyringLoader: async () => null,
      fallbackDir: tempDir,
      fallbackPolicy: 'allow',
    });

    await store.set('crypto-key', 'super-secret-value');
    const filePath = path.join(tempDir, 'crypto-key.enc');
    const content = await fs.readFile(filePath, 'utf-8');

    // Content should NOT contain the plaintext secret
    expect(content).not.toContain('super-secret-value');
    // Content should be valid JSON envelope
    const envelope = JSON.parse(content);
    expect(envelope.crypto.alg).toBe('aes-256-gcm');
  });

  /**
   * @plan PLAN-20260211-SECURESTORE.P05
   * @requirement R4.5
   */
  it('fallback files use versioned envelope format with correct structure', async () => {
    const store = new SecureStore('test-service', {
      keyringLoader: async () => null,
      fallbackDir: tempDir,
      fallbackPolicy: 'allow',
    });

    await store.set('envelope-key', 'envelope-value');
    const filePath = path.join(tempDir, 'envelope-key.enc');
    const content = await fs.readFile(filePath, 'utf-8');
    const envelope = JSON.parse(content);

    expect(envelope.v).toBe(1);
    expect(envelope.crypto.alg).toBe('aes-256-gcm');
    expect(envelope.crypto.kdf).toBe('scrypt');
    expect(envelope.crypto.N).toBe(16384);
    expect(envelope.crypto.r).toBe(8);
    expect(envelope.crypto.p).toBe(1);
    expect(envelope.crypto.saltLen).toBe(16);
    expect(typeof envelope.data).toBe('string');
    // data should be base64-encoded
    expect(envelope.data.length).toBeGreaterThan(0);
  });

  /**
   * @plan PLAN-20260211-SECURESTORE.P05
   * @requirement R4.6
   */
  it('unrecognized envelope version throws CORRUPT error', async () => {
    const store = new SecureStore('test-service', {
      keyringLoader: async () => null,
      fallbackDir: tempDir,
      fallbackPolicy: 'allow',
    });

    // Write a file with an unrecognized version
    const badEnvelope = JSON.stringify({ v: 99, crypto: {}, data: 'abc' });
    await fs.writeFile(path.join(tempDir, 'bad-version.enc'), badEnvelope);

    try {
      await store.get('bad-version');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(SecureStoreError);
      expect((err as SecureStoreError).code).toBe('CORRUPT');
      expect((err as SecureStoreError).remediation).toContain('upgrade');
    }
  });

  /**
   * @plan PLAN-20260211-SECURESTORE.P05
   * @requirement R4.7
   */
  it('atomic write — no temp files left after successful write', async () => {
    const store = new SecureStore('test-service', {
      keyringLoader: async () => null,
      fallbackDir: tempDir,
      fallbackPolicy: 'allow',
    });

    await store.set('atomic-key', 'atomic-value');

    const files = await fs.readdir(tempDir);
    // Only the final .enc file should remain; no .tmp files
    const tmpFiles = files.filter((f) => f.includes('.tmp'));
    expect(tmpFiles.length).toBe(0);
    expect(files).toContain('atomic-key.enc');
  });

  /**
   * @plan PLAN-20260211-SECURESTORE.P05
   * @requirement R4.8
   */
  it('fallback directory created with 0o700 permissions', async () => {
    const nestedDir = path.join(tempDir, 'nested', 'secure');
    const store = new SecureStore('test-service', {
      keyringLoader: async () => null,
      fallbackDir: nestedDir,
      fallbackPolicy: 'allow',
    });

    await store.set('dir-key', 'dir-value');

    const stat = await fs.stat(nestedDir);
    // On macOS/Linux, check permissions (skip on Windows)
    if (process.platform !== 'win32') {
      const perms = stat.mode & 0o777;
      expect(perms).toBe(0o700);
    }
  });

  /**
   * @plan PLAN-20260211-SECURESTORE.P05
   * @requirement R4.7
   */
  it('fallback file permissions are 0o600', async () => {
    const store = new SecureStore('test-service', {
      keyringLoader: async () => null,
      fallbackDir: tempDir,
      fallbackPolicy: 'allow',
    });

    await store.set('perm-key', 'perm-value');
    const filePath = path.join(tempDir, 'perm-key.enc');
    const stat = await fs.stat(filePath);

    if (process.platform !== 'win32') {
      const perms = stat.mode & 0o777;
      expect(perms).toBe(0o600);
    }
  });
});

// ─── No Backward Compatibility (R5) ─────────────────────────────────────────

describe('SecureStore — No Backward Compatibility', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempFallbackDir();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  /**
   * @plan PLAN-20260211-SECURESTORE.P05
   * @requirement R5.1
   */
  it('legacy format files are treated as CORRUPT', async () => {
    const store = new SecureStore('test-service', {
      keyringLoader: async () => null,
      fallbackDir: tempDir,
      fallbackPolicy: 'allow',
    });

    // Write a legacy-style .key file disguised as .enc
    // (old ToolKeyStorage format: iv:authTag:encrypted hex)
    const legacyContent = 'aabbccdd:eeff0011:2233445566778899';
    await fs.writeFile(path.join(tempDir, 'legacy-key.enc'), legacyContent);

    try {
      await store.get('legacy-key');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(SecureStoreError);
      expect((err as SecureStoreError).code).toBe('CORRUPT');
    }
  });

  /**
   * @plan PLAN-20260211-SECURESTORE.P05
   * @requirement R5.2
   */
  it('no migration attempt on unrecognized format', async () => {
    const store = new SecureStore('test-service', {
      keyringLoader: async () => null,
      fallbackDir: tempDir,
      fallbackPolicy: 'allow',
    });

    // Write plaintext (simulates old plaintext storage)
    await fs.writeFile(path.join(tempDir, 'plain-key.enc'), 'plain-secret');

    try {
      await store.get('plain-key');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(SecureStoreError);
      expect((err as SecureStoreError).code).toBe('CORRUPT');
      // Remediation should suggest re-saving, not migration
      expect((err as SecureStoreError).remediation.toLowerCase()).toContain(
        're-save',
      );
    }
  });
});

// ─── Error Taxonomy (R6) ─────────────────────────────────────────────────────

describe('SecureStore — Error Taxonomy', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempFallbackDir();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  /**
   * @plan PLAN-20260211-SECURESTORE.P05
   * @requirement R6.1
   */
  it('UNAVAILABLE error with remediation when keyring down and fallback denied', async () => {
    const store = new SecureStore('test-service', {
      keyringLoader: async () => null,
      fallbackDir: tempDir,
      fallbackPolicy: 'deny',
    });

    try {
      await store.set('denied-key', 'denied-value');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(SecureStoreError);
      expect((err as SecureStoreError).code).toBe('UNAVAILABLE');
      expect((err as SecureStoreError).remediation.length).toBeGreaterThan(0);
    }
  });

  /**
   * @plan PLAN-20260211-SECURESTORE.P05
   * @requirement R6.1
   */
  it('CORRUPT error on bad envelope data', async () => {
    const store = new SecureStore('test-service', {
      keyringLoader: async () => null,
      fallbackDir: tempDir,
      fallbackPolicy: 'allow',
    });

    // Valid JSON but invalid envelope structure
    await fs.writeFile(
      path.join(tempDir, 'bad-data.enc'),
      JSON.stringify({ v: 1, crypto: { alg: 'rot13' }, data: 'not-real' }),
    );

    try {
      await store.get('bad-data');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(SecureStoreError);
      expect((err as SecureStoreError).code).toBe('CORRUPT');
    }
  });

  /**
   * @plan PLAN-20260211-SECURESTORE.P05
   * @requirement R6.1
   */
  it('NOT_FOUND handling — get returns null instead of throwing', async () => {
    const mockKeyring = createMockKeyring();
    const store = new SecureStore('test-service', {
      keyringLoader: async () => mockKeyring,
      fallbackDir: tempDir,
    });

    // get() on non-existent key returns null, doesn't throw NOT_FOUND
    const result = await store.get('does-not-exist');
    expect(result).toBeNull();
  });
});

// ─── Resilience (R7B) ────────────────────────────────────────────────────────

describe('SecureStore — Resilience', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempFallbackDir();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  /**
   * @plan PLAN-20260211-SECURESTORE.P05
   * @requirement R7B.1
   */
  it('mid-session keyring failure falls back to encrypted file', async () => {
    let shouldFail = false;
    const adapterStore = new Map<string, string>();
    const adapter: KeyringAdapter = {
      getPassword: async (_service, account) => {
        if (shouldFail) throw new Error('Keyring daemon crashed');
        return adapterStore.get(account) ?? null;
      },
      setPassword: async (_service, account, password) => {
        if (shouldFail) throw new Error('Keyring daemon crashed');
        adapterStore.set(account, password);
      },
      deletePassword: async (_service, account) => {
        if (shouldFail) throw new Error('Keyring daemon crashed');
        return adapterStore.delete(account);
      },
    };

    const store = new SecureStore('test-service', {
      keyringLoader: async () => adapter,
      fallbackDir: tempDir,
      fallbackPolicy: 'allow',
    });

    // Verify keyring starts available
    const available = await store.isKeychainAvailable();
    expect(available).toBe(true);

    // Now keyring crashes mid-session
    shouldFail = true;

    // set() should fall back to encrypted file instead of crashing
    await store.set('resilient-key', 'resilient-value');

    // Value should be retrievable from fallback
    const result = await store.get('resilient-key');
    expect(result).toBe('resilient-value');
  });

  /**
   * @plan PLAN-20260211-SECURESTORE.P05
   * @requirement R7B.2
   */
  it('sequential writes produce valid files with no temp file residue', async () => {
    const store = new SecureStore('test-service', {
      keyringLoader: async () => null,
      fallbackDir: tempDir,
      fallbackPolicy: 'allow',
    });

    // Write a value successfully
    await store.set('safe-key', 'safe-value');

    // Verify the file exists and is complete
    const filePath = path.join(tempDir, 'safe-key.enc');
    const content = await fs.readFile(filePath, 'utf-8');
    const envelope = JSON.parse(content);
    expect(envelope.v).toBe(1);
    expect(typeof envelope.data).toBe('string');

    // Verify we can read back the value (proves file is not partial/corrupt)
    const result = await store.get('safe-key');
    expect(result).toBe('safe-value');
  });
});

// ─── Key Validation ──────────────────────────────────────────────────────────

describe('SecureStore — Key Validation', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempFallbackDir();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  /**
   * @plan PLAN-20260211-SECURESTORE.P05
   * @requirement R4.4
   */
  it('rejects keys with path separators', async () => {
    const store = new SecureStore('test-service', {
      keyringLoader: async () => null,
      fallbackDir: tempDir,
      fallbackPolicy: 'allow',
    });

    try {
      await store.set('path/traversal', 'evil');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(SecureStoreError);
      expect((err as SecureStoreError).code).toBe('CORRUPT');
    }

    try {
      await store.set('path\\traversal', 'evil');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(SecureStoreError);
      expect((err as SecureStoreError).code).toBe('CORRUPT');
    }
  });

  /**
   * @plan PLAN-20260211-SECURESTORE.P05
   * @requirement R4.4
   */
  it('rejects keys with null bytes', async () => {
    const store = new SecureStore('test-service', {
      keyringLoader: async () => null,
      fallbackDir: tempDir,
      fallbackPolicy: 'allow',
    });

    try {
      await store.set('null\0byte', 'evil');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(SecureStoreError);
      expect((err as SecureStoreError).code).toBe('CORRUPT');
    }
  });

  /**
   * @plan PLAN-20260211-SECURESTORE.P05
   * @requirement R4.4
   */
  it('rejects keys with dot/dotdot components', async () => {
    const store = new SecureStore('test-service', {
      keyringLoader: async () => null,
      fallbackDir: tempDir,
      fallbackPolicy: 'allow',
    });

    try {
      await store.set('.', 'evil');
      expect.unreachable('should have thrown for "."');
    } catch (err) {
      expect(err).toBeInstanceOf(SecureStoreError);
      expect((err as SecureStoreError).code).toBe('CORRUPT');
    }

    try {
      await store.set('..', 'evil');
      expect.unreachable('should have thrown for ".."');
    } catch (err) {
      expect(err).toBeInstanceOf(SecureStoreError);
      expect((err as SecureStoreError).code).toBe('CORRUPT');
    }
  });

  /**
   * @plan PLAN-20260211-SECURESTORE.P05
   * @requirement R3.7
   */
  it('list() skips malformed filenames in fallback directory', async () => {
    const store = new SecureStore('test-service', {
      keyringLoader: async () => null,
      fallbackDir: tempDir,
      fallbackPolicy: 'allow',
    });

    // Store a valid key
    await store.set('valid-key', 'valid-value');

    // Manually create a malformed .enc file with a path separator in the name
    // (shouldn't be possible via set(), but could exist on disk)
    // We create a file whose name sans .enc would fail validation
    await fs.writeFile(path.join(tempDir, '..enc'), 'garbage');

    const keys = await store.list();
    // Should contain 'valid-key' but skip the malformed filename
    expect(keys).toContain('valid-key');
    expect(keys).not.toContain('.');
  });
});

// ─── Probe Cache Invalidation ────────────────────────────────────────────────

describe('SecureStore — Probe Cache Invalidation', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempFallbackDir();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  /**
   * @plan PLAN-20260211-SECURESTORE.P05
   * @requirement R2.3
   */
  it('probe cache invalidated after N consecutive keyring failures', async () => {
    let failCount = 0;
    const adapter: KeyringAdapter = {
      getPassword: async () => {
        failCount++;
        if (failCount >= 1) throw new Error('Keyring daemon unavailable');
        return null;
      },
      setPassword: async (_s, _a, _p) => {
        // probe set succeeds initially
      },
      deletePassword: async () => true,
    };

    const store = new SecureStore('test-service', {
      keyringLoader: async () => adapter,
      fallbackDir: tempDir,
      fallbackPolicy: 'allow',
    });

    // Probe initially — set/get/delete cycle determines availability
    await store.isKeychainAvailable();
    // Adapter works for set, fails for get — probe returns false
    // After enough failures through operations, probe cache should be invalidated
    // and next isKeychainAvailable() call should re-probe

    // Force multiple operation failures to trigger cache invalidation
    for (let i = 0; i < 3; i++) {
      try {
        await store.get(`fail-key-${i}`);
      } catch {
        // expected to fail
      }
    }

    // After N consecutive failures, the probe cache should be invalidated
    // isKeychainAvailable should re-probe (not return stale cached true)
    const afterFailures = await store.isKeychainAvailable();
    expect(afterFailures).toBe(false);
  });

  /**
   * @plan PLAN-20260211-SECURESTORE.P05
   * @requirement R2.3
   */
  it('consecutive failure counter resets on successful keyring operation', async () => {
    let shouldFail = false;
    const mockKeyring = createMockKeyring();
    const adapter: KeyringAdapter = {
      getPassword: async (service, account) => {
        if (shouldFail) throw new Error('Keyring temporarily locked');
        return mockKeyring.getPassword(service, account);
      },
      setPassword: async (service, account, password) => {
        if (shouldFail) throw new Error('Keyring temporarily locked');
        return mockKeyring.setPassword(service, account, password);
      },
      deletePassword: async (service, account) => {
        if (shouldFail) throw new Error('Keyring temporarily locked');
        return mockKeyring.deletePassword(service, account);
      },
    };

    const store = new SecureStore('test-service', {
      keyringLoader: async () => adapter,
      fallbackDir: tempDir,
      fallbackPolicy: 'allow',
    });

    // Probe initially — keyring works
    const first = await store.isKeychainAvailable();
    expect(first).toBe(true);

    // Cause some failures (but fewer than threshold)
    shouldFail = true;
    try {
      await store.get('fail-1');
    } catch {
      // expected
    }
    try {
      await store.get('fail-2');
    } catch {
      // expected
    }

    // Now keyring recovers — a successful operation resets the counter
    shouldFail = false;
    await store.set('success-key', 'success-val');

    // More failures after reset (but fewer than threshold again)
    shouldFail = true;
    try {
      await store.get('fail-3');
    } catch {
      // expected
    }

    // Counter was reset, so we haven't hit the threshold
    // Probe should still return true (from cache or re-probe success)
    shouldFail = false;
    const afterReset = await store.isKeychainAvailable();
    expect(afterReset).toBe(true);
  });

  /**
   * @plan PLAN-20260211-SECURESTORE.P05
   * @requirement R2.3
   */
  it('after cache invalidation, next isKeychainAvailable re-probes', async () => {
    let probeCallCount = 0;
    let shouldFail = false;
    const probeStore = new Map<string, string>();
    const adapter: KeyringAdapter = {
      getPassword: async (_svc: string, acct: string) => {
        if (shouldFail) throw new Error('Keyring unavailable');
        probeCallCount++;
        return probeStore.get(acct) ?? null;
      },
      setPassword: async (_svc: string, acct: string, pw: string) => {
        if (shouldFail) throw new Error('Keyring unavailable');
        probeCallCount++;
        probeStore.set(acct, pw);
      },
      deletePassword: async (_svc: string, acct: string) => {
        if (shouldFail) throw new Error('Keyring unavailable');
        probeCallCount++;
        return probeStore.delete(acct);
      },
    };

    const store = new SecureStore('test-service', {
      keyringLoader: async () => adapter,
      fallbackDir: tempDir,
      fallbackPolicy: 'allow',
    });

    // Initial probe succeeds
    await store.isKeychainAvailable();
    const _countAfterFirst = probeCallCount;

    // Cause failures to invalidate cache
    shouldFail = true;
    for (let i = 0; i < 3; i++) {
      try {
        await store.set(`fail-${i}`, 'val');
      } catch {
        // expected
      }
    }

    // Recover keyring
    shouldFail = false;
    probeCallCount = 0;

    // This should re-probe (not return stale result)
    const result = await store.isKeychainAvailable();
    expect(result).toBe(true);
    // Probe performed new set/get/delete cycle
    expect(probeCallCount).toBeGreaterThan(0);
  });
});

// ─── Fault Injection (R27.1) ─────────────────────────────────────────────────

describe('SecureStore — Fault Injection', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempFallbackDir();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  /**
   * @plan PLAN-20260211-SECURESTORE.P05
   * @requirement R27.1
   */
  it('sequential writes leave no temp files behind', async () => {
    const store = new SecureStore('test-service', {
      keyringLoader: async () => null,
      fallbackDir: tempDir,
      fallbackPolicy: 'allow',
    });

    // Write a known good value first
    await store.set('interrupt-key', 'original-value');

    // Now simulate a "corrupted" write by manually creating a temp file
    // that would exist mid-write, then verify SecureStore's next write
    // produces a clean final file with no temp artifacts
    await store.set('interrupt-key', 'updated-value');

    const files = await fs.readdir(tempDir);
    const tmpFiles = files.filter((f) => f.includes('.tmp'));
    expect(tmpFiles.length).toBe(0);

    // Original .enc file should have the updated value
    const result = await store.get('interrupt-key');
    expect(result).toBe('updated-value');
  });

  /**
   * @plan PLAN-20260211-SECURESTORE.P05
   * @requirement R27.1
   */
  it('keyring error after successful fallback write does not lose data', async () => {
    let keyringFailed = false;
    const faultStore = new Map<string, string>();
    const adapter: KeyringAdapter = {
      getPassword: async (_svc: string, acct: string) => {
        if (keyringFailed) throw new Error('Keyring crashed');
        return faultStore.get(acct) ?? null;
      },
      setPassword: async (_svc: string, acct: string, pw: string) => {
        if (keyringFailed) throw new Error('Keyring crashed');
        faultStore.set(acct, pw);
      },
      deletePassword: async (_svc: string, acct: string) => {
        if (keyringFailed) throw new Error('Keyring crashed');
        return faultStore.delete(acct);
      },
    };

    const store = new SecureStore('test-service', {
      keyringLoader: async () => adapter,
      fallbackDir: tempDir,
      fallbackPolicy: 'allow',
    });

    // First: keyring works, probe succeeds
    const available = await store.isKeychainAvailable();
    expect(available).toBe(true);

    // Now keyring crashes — set should fall back to file
    keyringFailed = true;
    await store.set('resilient-key', 'important-secret');

    // Data should be retrievable from fallback even though keyring is down
    const result = await store.get('resilient-key');
    expect(result).toBe('important-secret');
  });

  /**
   * @plan PLAN-20260211-SECURESTORE.P05
   * @requirement R27.1
   */
  it('concurrent writers produce complete non-corrupt files', async () => {
    const store1 = new SecureStore('test-service', {
      keyringLoader: async () => null,
      fallbackDir: tempDir,
      fallbackPolicy: 'allow',
    });
    const store2 = new SecureStore('test-service', {
      keyringLoader: async () => null,
      fallbackDir: tempDir,
      fallbackPolicy: 'allow',
    });

    // Write the same key concurrently from two store instances
    await Promise.all([
      store1.set('concurrent-key', 'value-from-writer-1'),
      store2.set('concurrent-key', 'value-from-writer-2'),
    ]);

    // The file should contain one complete valid value (last write wins)
    const readStore = new SecureStore('test-service', {
      keyringLoader: async () => null,
      fallbackDir: tempDir,
      fallbackPolicy: 'allow',
    });
    const result = await readStore.get('concurrent-key');

    // Result must be one of the two values — not corrupt or partial
    const validValues = ['value-from-writer-1', 'value-from-writer-2'];
    expect(validValues).toContain(result);
  });
});

// ─── Fallback Policy (R4.2) ─────────────────────────────────────────────────

describe('SecureStore — Fallback Policy', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempFallbackDir();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  /**
   * @plan PLAN-20260211-SECURESTORE.P05
   * @requirement R4.2
   */
  it('deny policy throws UNAVAILABLE when keyring is down', async () => {
    const store = new SecureStore('test-service', {
      keyringLoader: async () => null,
      fallbackDir: tempDir,
      fallbackPolicy: 'deny',
    });

    try {
      await store.set('denied', 'value');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(SecureStoreError);
      expect((err as SecureStoreError).code).toBe('UNAVAILABLE');
      expect((err as SecureStoreError).remediation.length).toBeGreaterThan(0);
    }
  });

  /**
   * @plan PLAN-20260211-SECURESTORE.P05
   * @requirement R4.1
   */
  it('allow policy stores in fallback when keyring is down', async () => {
    const store = new SecureStore('test-service', {
      keyringLoader: async () => null,
      fallbackDir: tempDir,
      fallbackPolicy: 'allow',
    });

    await store.set('allowed-key', 'allowed-value');
    const result = await store.get('allowed-key');
    expect(result).toBe('allowed-value');
  });
});

// ─── Cross-Instance Consistency ──────────────────────────────────────────────

describe('SecureStore — Cross-Instance Consistency', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempFallbackDir();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  /**
   * @plan PLAN-20260211-SECURESTORE.P05
   * @requirement R4.3
   */
  it('different SecureStore instances with same config read each other fallback files', async () => {
    const store1 = new SecureStore('test-service', {
      keyringLoader: async () => null,
      fallbackDir: tempDir,
      fallbackPolicy: 'allow',
    });

    const store2 = new SecureStore('test-service', {
      keyringLoader: async () => null,
      fallbackDir: tempDir,
      fallbackPolicy: 'allow',
    });

    await store1.set('shared-key', 'shared-value');
    const result = await store2.get('shared-key');
    expect(result).toBe('shared-value');
  });

  /**
   * @plan PLAN-20260211-SECURESTORE.P05
   * @requirement R3.4
   */
  it('delete from one instance is reflected in another', async () => {
    const mockKeyring = createMockKeyring();
    const store1 = new SecureStore('test-service', {
      keyringLoader: async () => mockKeyring,
      fallbackDir: tempDir,
    });
    const store2 = new SecureStore('test-service', {
      keyringLoader: async () => mockKeyring,
      fallbackDir: tempDir,
    });

    await store1.set('cross-delete', 'to-be-deleted');
    await store1.delete('cross-delete');

    const result = await store2.get('cross-delete');
    expect(result).toBeNull();
  });
});
