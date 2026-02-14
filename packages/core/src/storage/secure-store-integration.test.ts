/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Forward-looking integration tests for SecureStore in wrapper-like usage patterns.
 *
 * These tests verify SecureStore can serve as the backend for:
 * - ToolKeyStorage (raw string values, service-scoped keys)
 * - KeychainTokenStorage (JSON-serialized credentials, findCredentials)
 * - ExtensionSettingsStorage (extension-specific service names, fallback policy)
 *
 * All tests should PASS against the fully-implemented SecureStore (Phase 06).
 *
 * @plan PLAN-20260211-SECURESTORE.P07
 * @requirement R7.6, R7C.1
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
import { maskKeyForDisplay } from '../tools/tool-key-storage.js';

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
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'secure-store-integration-test-'),
  );
  return tmpDir;
}

// ─── ToolKeyStorage Pattern Tests (R7.6) ─────────────────────────────────────

describe('SecureStore — ToolKeyStorage Pattern', () => {
  let tempDir: string;
  let mockKeyring: KeyringAdapter & { store: Map<string, string> };

  beforeEach(async () => {
    tempDir = await createTempFallbackDir();
    mockKeyring = createMockKeyring();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  /**
   * ToolKeyStorage stores raw API key strings (not JSON).
   * SecureStore must round-trip them exactly.
   *
   * @plan PLAN-20260211-SECURESTORE.P07
   * @requirement R7.6
   */
  it('stores raw string value and retrieves it', async () => {
    const store = new SecureStore('llxprt-code-tool-keys', {
      keyringLoader: async () => mockKeyring,
      fallbackDir: tempDir,
    });

    await store.set('exa', 'sk-1234567890abcdef');
    const result = await store.get('exa');
    expect(result).toBe('sk-1234567890abcdef');
  });

  /**
   * ToolKeyStorage.deleteKey removes a stored key.
   *
   * @plan PLAN-20260211-SECURESTORE.P07
   * @requirement R7.6
   */
  it('deletes a stored key', async () => {
    const store = new SecureStore('llxprt-code-tool-keys', {
      keyringLoader: async () => mockKeyring,
      fallbackDir: tempDir,
    });

    await store.set('exa', 'sk-to-delete');
    const deleted = await store.delete('exa');
    expect(deleted).toBe(true);

    const result = await store.get('exa');
    expect(result).toBeNull();
  });

  /**
   * ToolKeyStorage.hasKey checks existence via get().
   *
   * @plan PLAN-20260211-SECURESTORE.P07
   * @requirement R7.6
   */
  it('has returns true for existing key', async () => {
    const store = new SecureStore('llxprt-code-tool-keys', {
      keyringLoader: async () => mockKeyring,
      fallbackDir: tempDir,
    });

    await store.set('exa', 'sk-exists');
    const exists = await store.has('exa');
    expect(exists).toBe(true);

    const missing = await store.has('nonexistent');
    expect(missing).toBe(false);
  });

  /**
   * ToolKeyStorage uses KEYCHAIN_SERVICE = 'llxprt-code-tool-keys'.
   * Different service names must isolate data.
   *
   * @plan PLAN-20260211-SECURESTORE.P07
   * @requirement R7.6
   */
  it('service name scoping isolates data', async () => {
    const toolStore = new SecureStore('llxprt-code-tool-keys', {
      keyringLoader: async () => mockKeyring,
      fallbackDir: path.join(tempDir, 'tools'),
    });
    const otherStore = new SecureStore('other-service', {
      keyringLoader: async () => mockKeyring,
      fallbackDir: path.join(tempDir, 'other'),
    });

    await toolStore.set('exa', 'tool-key-value');
    await otherStore.set('exa', 'other-value');

    const fromTool = await toolStore.get('exa');
    const fromOther = await otherStore.get('exa');
    expect(fromTool).toBe('tool-key-value');
    expect(fromOther).toBe('other-value');
  });

  /**
   * maskKeyForDisplay should work on values retrieved from SecureStore,
   * proving the wrapper can still mask keys after refactoring.
   *
   * @plan PLAN-20260211-SECURESTORE.P07
   * @requirement R7.6
   */
  it('maskKeyForDisplay works on retrieved values', async () => {
    const store = new SecureStore('llxprt-code-tool-keys', {
      keyringLoader: async () => mockKeyring,
      fallbackDir: tempDir,
    });

    const apiKey = 'sk-1234567890abcdef';
    await store.set('exa', apiKey);
    const retrieved = await store.get('exa');
    expect(retrieved).not.toBeNull();

    const masked = maskKeyForDisplay(retrieved!);
    // 19 chars: first 2 ('sk') + 15 stars + last 2 ('ef')
    expect(masked).toBe('sk***************ef');
    expect(masked.length).toBe(apiKey.length);
  });
});

// ─── KeychainTokenStorage Pattern Tests (R7.6) ──────────────────────────────

describe('SecureStore — KeychainTokenStorage Pattern', () => {
  let tempDir: string;
  let mockKeyring: KeyringAdapter & { store: Map<string, string> };

  beforeEach(async () => {
    tempDir = await createTempFallbackDir();
    mockKeyring = createMockKeyring();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  /**
   * KeychainTokenStorage stores JSON-serialized OAuthCredentials.
   * SecureStore must handle JSON values as opaque strings.
   *
   * @plan PLAN-20260211-SECURESTORE.P07
   * @requirement R7.6
   */
  it('stores JSON-serialized credentials and retrieves + parses', async () => {
    const store = new SecureStore('llxprt-code-mcp-tokens', {
      keyringLoader: async () => mockKeyring,
      fallbackDir: tempDir,
    });

    const credentials = {
      accessToken: 'access-tok-123',
      refreshToken: 'refresh-tok-456',
      expiresAt: 1700000000,
      serverName: 'my-server',
    };
    const serialized = JSON.stringify(credentials);

    await store.set('my-server', serialized);
    const retrieved = await store.get('my-server');
    expect(retrieved).not.toBeNull();

    const parsed = JSON.parse(retrieved!);
    expect(parsed.accessToken).toBe('access-tok-123');
    expect(parsed.refreshToken).toBe('refresh-tok-456');
    expect(parsed.expiresAt).toBe(1700000000);
    expect(parsed.serverName).toBe('my-server');
  });

  /**
   * KeychainTokenStorage uses sanitized server names as account names.
   * SecureStore must handle special chars in key names.
   *
   * @plan PLAN-20260211-SECURESTORE.P07
   * @requirement R7.6
   */
  it('account name with special chars works', async () => {
    const store = new SecureStore('llxprt-code-mcp-tokens', {
      keyringLoader: async () => mockKeyring,
      fallbackDir: tempDir,
    });

    // Sanitized server name with dots, dashes, underscores (no slashes)
    const accountName = 'my-server.example.com_8080';
    await store.set(accountName, '{"accessToken":"tok"}');

    const result = await store.get(accountName);
    expect(result).toBe('{"accessToken":"tok"}');
  });

  /**
   * KeychainTokenStorage.listServers uses findCredentials to enumerate.
   * SecureStore.list() provides equivalent functionality.
   *
   * @plan PLAN-20260211-SECURESTORE.P07
   * @requirement R7.6
   */
  it('findCredentials lists all stored entries via list()', async () => {
    const store = new SecureStore('llxprt-code-mcp-tokens', {
      keyringLoader: async () => mockKeyring,
      fallbackDir: tempDir,
    });

    await store.set('server-a', '{"token":"a"}');
    await store.set('server-b', '{"token":"b"}');
    await store.set('server-c', '{"token":"c"}');

    const keys = await store.list();
    expect(keys).toContain('server-a');
    expect(keys).toContain('server-b');
    expect(keys).toContain('server-c');
    expect(keys.length).toBe(3);
  });

  /**
   * KeychainTokenStorage.deleteCredentials removes by server name.
   *
   * @plan PLAN-20260211-SECURESTORE.P07
   * @requirement R7.6
   */
  it('deletes credentials by account name', async () => {
    const store = new SecureStore('llxprt-code-mcp-tokens', {
      keyringLoader: async () => mockKeyring,
      fallbackDir: tempDir,
    });

    await store.set('to-delete-server', '{"token":"deleteme"}');
    const deleted = await store.delete('to-delete-server');
    expect(deleted).toBe(true);

    const result = await store.get('to-delete-server');
    expect(result).toBeNull();
  });
});

// ─── ExtensionSettingsStorage Pattern Tests (R7.6) ───────────────────────────

describe('SecureStore — ExtensionSettingsStorage Pattern', () => {
  let tempDir: string;
  let mockKeyring: KeyringAdapter & { store: Map<string, string> };

  beforeEach(async () => {
    tempDir = await createTempFallbackDir();
    mockKeyring = createMockKeyring();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  /**
   * ExtensionSettingsStorage uses extension-specific service names like
   * "LLxprt Code Extension {name}". SecureStore must work with these.
   *
   * @plan PLAN-20260211-SECURESTORE.P07
   * @requirement R7.6
   */
  it('stores and retrieves with extension-specific service name', async () => {
    const extensionServiceName = 'LLxprt Code Extension my-cool-extension';
    const store = new SecureStore(extensionServiceName, {
      keyringLoader: async () => mockKeyring,
      fallbackDir: tempDir,
    });

    await store.set('API_KEY', 'ext-secret-value');
    const result = await store.get('API_KEY');
    expect(result).toBe('ext-secret-value');
  });

  /**
   * ExtensionSettingsStorage with fallbackPolicy 'deny' should throw
   * UNAVAILABLE when keyring is absent.
   *
   * @plan PLAN-20260211-SECURESTORE.P07
   * @requirement R7.6
   */
  it("fallbackPolicy 'deny' throws UNAVAILABLE when keyring absent", async () => {
    const store = new SecureStore('LLxprt Code Extension secure-ext', {
      keyringLoader: async () => null,
      fallbackDir: tempDir,
      fallbackPolicy: 'deny',
    });

    try {
      await store.set('SECRET', 'should-fail');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(SecureStoreError);
      expect((err as SecureStoreError).code).toBe('UNAVAILABLE');
      expect((err as SecureStoreError).remediation.length).toBeGreaterThan(0);
    }
  });
});

// ─── Cross-Wrapper Isolation ─────────────────────────────────────────────────

describe('SecureStore — Cross-Wrapper Isolation', () => {
  let tempDir: string;
  let mockKeyring: KeyringAdapter & { store: Map<string, string> };

  beforeEach(async () => {
    tempDir = await createTempFallbackDir();
    mockKeyring = createMockKeyring();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  /**
   * ToolKeyStorage, KeychainTokenStorage, and ExtensionSettingsStorage
   * each use distinct service names. Data must not leak across services.
   *
   * @plan PLAN-20260211-SECURESTORE.P07
   * @requirement R7.6
   */
  it("different service names don't interfere", async () => {
    const toolStore = new SecureStore('llxprt-code-tool-keys', {
      keyringLoader: async () => mockKeyring,
      fallbackDir: path.join(tempDir, 'tools'),
    });
    const mcpStore = new SecureStore('llxprt-code-mcp-tokens', {
      keyringLoader: async () => mockKeyring,
      fallbackDir: path.join(tempDir, 'mcp'),
    });
    const extStore = new SecureStore('LLxprt Code Extension my-ext', {
      keyringLoader: async () => mockKeyring,
      fallbackDir: path.join(tempDir, 'ext'),
    });

    await toolStore.set('api-key', 'tool-secret');
    await mcpStore.set('api-key', 'mcp-secret');
    await extStore.set('api-key', 'ext-secret');

    expect(await toolStore.get('api-key')).toBe('tool-secret');
    expect(await mcpStore.get('api-key')).toBe('mcp-secret');
    expect(await extStore.get('api-key')).toBe('ext-secret');
  });

  /**
   * Same key name used in different service-scoped stores must be independent:
   * deleting from one must not affect others.
   *
   * @plan PLAN-20260211-SECURESTORE.P07
   * @requirement R7.6
   */
  it('same key name in different services are independent', async () => {
    const storeA = new SecureStore('service-a', {
      keyringLoader: async () => mockKeyring,
      fallbackDir: path.join(tempDir, 'a'),
    });
    const storeB = new SecureStore('service-b', {
      keyringLoader: async () => mockKeyring,
      fallbackDir: path.join(tempDir, 'b'),
    });

    await storeA.set('shared-name', 'value-a');
    await storeB.set('shared-name', 'value-b');

    await storeA.delete('shared-name');

    const fromA = await storeA.get('shared-name');
    const fromB = await storeB.get('shared-name');
    expect(fromA).toBeNull();
    expect(fromB).toBe('value-b');
  });
});

// ─── Legacy Format Detection (R7C.1) ─────────────────────────────────────────

describe('SecureStore — Legacy Format Detection', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempFallbackDir();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  /**
   * A file that doesn't parse as JSON should throw CORRUPT with remediation.
   * This catches old ToolKeyStorage encrypted files (iv:authTag:hex format).
   *
   * @plan PLAN-20260211-SECURESTORE.P07
   * @requirement R7C.1
   */
  it("file that doesn't parse as JSON → CORRUPT error with remediation", async () => {
    const store = new SecureStore('test-service', {
      keyringLoader: async () => null,
      fallbackDir: tempDir,
      fallbackPolicy: 'allow',
    });

    // Write a non-JSON file (old ToolKeyStorage iv:authTag:encrypted format)
    await fs.writeFile(
      path.join(tempDir, 'old-key.enc'),
      'aabbccdd11223344:eeff001122334455aabbccdd11223344:66778899aabbccdd',
    );

    try {
      await store.get('old-key');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(SecureStoreError);
      expect((err as SecureStoreError).code).toBe('CORRUPT');
      expect((err as SecureStoreError).remediation.length).toBeGreaterThan(0);
    }
  });

  /**
   * A valid JSON file with wrong envelope version should throw CORRUPT
   * with upgrade instructions in the remediation.
   *
   * @plan PLAN-20260211-SECURESTORE.P07
   * @requirement R7C.1
   */
  it('file with wrong envelope version → CORRUPT error with upgrade instructions', async () => {
    const store = new SecureStore('test-service', {
      keyringLoader: async () => null,
      fallbackDir: tempDir,
      fallbackPolicy: 'allow',
    });

    const futureEnvelope = JSON.stringify({
      v: 99,
      crypto: { alg: 'aes-256-gcm', kdf: 'scrypt' },
      data: 'base64data',
    });
    await fs.writeFile(path.join(tempDir, 'future-key.enc'), futureEnvelope);

    try {
      await store.get('future-key');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(SecureStoreError);
      expect((err as SecureStoreError).code).toBe('CORRUPT');
      expect((err as SecureStoreError).remediation).toContain('upgrade');
    }
  });

  /**
   * A plain text file (old .key format) should throw CORRUPT
   * since it cannot be parsed as the expected envelope JSON.
   *
   * @plan PLAN-20260211-SECURESTORE.P07
   * @requirement R7C.1
   */
  it('plain text file (old .key format) → CORRUPT error', async () => {
    const store = new SecureStore('test-service', {
      keyringLoader: async () => null,
      fallbackDir: tempDir,
      fallbackPolicy: 'allow',
    });

    // Simulate an old plaintext .key file renamed to .enc
    await fs.writeFile(
      path.join(tempDir, 'plaintext-key.enc'),
      'sk-plaintext-api-key-12345',
    );

    try {
      await store.get('plaintext-key');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(SecureStoreError);
      expect((err as SecureStoreError).code).toBe('CORRUPT');
      expect((err as SecureStoreError).remediation.toLowerCase()).toContain(
        're-save',
      );
    }
  });

  /**
   * A valid envelope with tampered ciphertext should throw CORRUPT
   * because AES-GCM decryption will fail (auth tag mismatch).
   *
   * @plan PLAN-20260211-SECURESTORE.P07
   * @requirement R7C.1
   */
  it('valid envelope but tampered data → CORRUPT error (decryption fails)', async () => {
    const store = new SecureStore('test-service', {
      keyringLoader: async () => null,
      fallbackDir: tempDir,
      fallbackPolicy: 'allow',
    });

    // First write a legitimate value to get a valid envelope
    await store.set('tamper-key', 'original-value');

    // Read the envelope and tamper with the data field
    const filePath = path.join(tempDir, 'tamper-key.enc');
    const content = await fs.readFile(filePath, 'utf8');
    const envelope = JSON.parse(content);

    // Tamper: modify the base64 data to corrupt the ciphertext
    const buf = Buffer.from(envelope.data, 'base64');
    buf[buf.length - 1] ^= 0xff;
    envelope.data = buf.toString('base64');

    await fs.writeFile(filePath, JSON.stringify(envelope));

    try {
      await store.get('tamper-key');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(SecureStoreError);
      expect((err as SecureStoreError).code).toBe('CORRUPT');
    }
  });
});
