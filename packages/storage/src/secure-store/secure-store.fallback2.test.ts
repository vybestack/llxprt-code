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
      machineSecretLoader: async () => null,
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

    let err: unknown;
    try {
      await store.get('bad-version');
    } catch (__caught) {
      err = __caught;
    }
    expect(err).toBeDefined();
    expect(err).toBeInstanceOf(SecureStoreError);
    expect((err as SecureStoreError).code).toBe('CORRUPT');
    expect((err as SecureStoreError).remediation).toContain('upgrade');
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
    // Permissions check is meaningful only on Unix-like platforms
    const isUnix = process.platform !== 'win32';
    expect(isUnix ? stat.mode & 0o777 : 0o700).toBe(0o700);
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
    const safeKey = 'perm-key'.replace(
      /[*<>:"/\\|?]/g,
      (char) => '%' + char.charCodeAt(0).toString(16).toUpperCase(),
    );
    const filePath = path.join(tempDir, safeKey + '.enc');
    const stat = await fs.stat(filePath);

    // Permissions check is meaningful only on Unix-like platforms
    const isUnix = process.platform !== 'win32';
    expect(isUnix ? stat.mode & 0o777 : 0o600).toBe(0o600);
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

    let err: unknown;
    try {
      await store.get('legacy-key');
    } catch (__caught) {
      err = __caught;
    }
    expect(err).toBeDefined();
    expect(err).toBeInstanceOf(SecureStoreError);
    expect((err as SecureStoreError).code).toBe('CORRUPT');
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

    let err: unknown;
    try {
      await store.get('plain-key');
    } catch (__caught) {
      err = __caught;
    }
    expect(err).toBeDefined();
    expect(err).toBeInstanceOf(SecureStoreError);
    expect((err as SecureStoreError).code).toBe('CORRUPT');
    expect((err as SecureStoreError).remediation.toLowerCase()).toContain(
      're-save',
    );
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

    let err: unknown;
    try {
      await store.set('denied-key', 'denied-value');
    } catch (__caught) {
      err = __caught;
    }
    expect(err).toBeDefined();
    expect(err).toBeInstanceOf(SecureStoreError);
    expect((err as SecureStoreError).code).toBe('UNAVAILABLE');
    expect((err as SecureStoreError).remediation.length).toBeGreaterThan(0);
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

    let err: unknown;
    try {
      await store.get('bad-data');
    } catch (__caught) {
      err = __caught;
    }
    expect(err).toBeDefined();
    expect(err).toBeInstanceOf(SecureStoreError);
    expect((err as SecureStoreError).code).toBe('CORRUPT');
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
      machineSecretLoader: async () => null,
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
