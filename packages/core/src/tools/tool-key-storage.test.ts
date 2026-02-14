/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for ToolKeyStorage, ToolKeyRegistry, and maskKeyForDisplay.
 *
 * @plan PLAN-20260206-TOOLKEY.P04
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  ToolKeyStorage,
  isValidToolKeyName,
  getToolKeyEntry,
  getSupportedToolNames,
  maskKeyForDisplay,
  type KeyringAdapter,
} from './tool-key-storage.js';

// ─── Test Helpers ────────────────────────────────────────────────────────────

/**
 * Creates an in-memory mock keytar adapter for testing keychain operations.
 * This is injected via ToolKeyStorageOptions.keyringLoader — no mock theater.
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
  };
}

/**
 * Creates a temp directory for use as toolsDir in tests.
 */
async function createTempToolsDir(): Promise<string> {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'tool-key-storage-test-'),
  );
  return tmpDir;
}

// ─── Registry Tests ──────────────────────────────────────────────────────────

describe('ToolKeyRegistry', () => {
  /**
   * @plan PLAN-20260206-TOOLKEY.P04
   * @requirement REQ-007.1
   */
  it('isValidToolKeyName returns true for registered tools', () => {
    expect(isValidToolKeyName('exa')).toBe(true);
  });

  /**
   * @plan PLAN-20260206-TOOLKEY.P04
   * @requirement REQ-007.1
   */
  it('isValidToolKeyName returns false for unregistered tools', () => {
    expect(isValidToolKeyName('nonexistent-tool')).toBe(false);
    expect(isValidToolKeyName('')).toBe(false);
    expect(isValidToolKeyName('EXA')).toBe(false);
  });

  /**
   * @plan PLAN-20260206-TOOLKEY.P04
   * @requirement REQ-007.2
   */
  it('getToolKeyEntry returns metadata for exa', () => {
    const entry = getToolKeyEntry('exa');
    expect(entry).toBeDefined();
    expect(entry!.toolKeyName).toBe('exa');
    expect(entry!.displayName).toBe('Exa Search');
    expect(entry!.urlParamName).toBe('exaApiKey');
    expect(entry!.description).toBe('API key for Exa web and code search');
  });

  /**
   * @plan PLAN-20260206-TOOLKEY.P04
   * @requirement REQ-007.2
   */
  it('getToolKeyEntry returns undefined for unknown tools', () => {
    expect(getToolKeyEntry('unknown')).toBeUndefined();
  });

  /**
   * @plan PLAN-20260206-TOOLKEY.P04
   * @requirement REQ-007.1
   */
  it('getSupportedToolNames returns all registered names', () => {
    const names = getSupportedToolNames();
    expect(names).toContain('exa');
    expect(names.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── maskKeyForDisplay Tests ─────────────────────────────────────────────────

describe('maskKeyForDisplay', () => {
  /**
   * @plan PLAN-20260206-TOOLKEY.P04
   * @requirement REQ-006.4
   */
  it('masks keys longer than 8 chars showing first 2 and last 2', () => {
    const result = maskKeyForDisplay('sk-1234567890');
    expect(result).toBe('sk*********90');
    expect(result.length).toBe('sk-1234567890'.length);
  });

  /**
   * @plan PLAN-20260206-TOOLKEY.P04
   * @requirement REQ-006.4
   */
  it('fully masks keys of 8 chars or fewer', () => {
    expect(maskKeyForDisplay('12345678')).toBe('********');
    expect(maskKeyForDisplay('abc')).toBe('***');
  });

  /**
   * @plan PLAN-20260206-TOOLKEY.P04
   * @requirement REQ-006.4
   */
  it('handles empty string', () => {
    expect(maskKeyForDisplay('')).toBe('');
  });

  /**
   * @plan PLAN-20260206-TOOLKEY.P04
   * @requirement REQ-006.4
   */
  it('handles exactly 9 character key (boundary)', () => {
    // 9 chars: first 2 + 5 stars + last 2 = 9
    const result = maskKeyForDisplay('123456789');
    expect(result).toBe('12*****89');
    expect(result.length).toBe(9);
  });
});

// ─── ToolKeyStorage Tests ────────────────────────────────────────────────────

describe('ToolKeyStorage', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempToolsDir();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  // ─── Keychain Storage Tests ──────────────────────────────────────────────

  describe('keychain storage', () => {
    /**
     * @plan PLAN-20260206-TOOLKEY.P04
     * @requirement REQ-001.1
     */
    it('saves and retrieves a key via keychain when available', async () => {
      const mockKeyring = createMockKeyring();
      const storage = new ToolKeyStorage({
        toolsDir: tempDir,
        keyringLoader: async () => mockKeyring,
      });

      await storage.saveKey('exa', 'sk-123');
      const result = await storage.getKey('exa');
      expect(result).toBe('sk-123');
    });

    /**
     * @plan PLAN-20260206-TOOLKEY.P04
     * @requirement REQ-001.1
     */
    it('returns null when no key stored in keychain', async () => {
      const mockKeyring = createMockKeyring();
      const storage = new ToolKeyStorage({
        toolsDir: tempDir,
        keyringLoader: async () => mockKeyring,
      });

      const result = await storage.getKey('exa');
      expect(result).toBeNull();
    });

    /**
     * @plan PLAN-20260206-TOOLKEY.P04
     * @requirement REQ-001.4
     */
    it('deleteKey removes key from keychain', async () => {
      const mockKeyring = createMockKeyring();
      const storage = new ToolKeyStorage({
        toolsDir: tempDir,
        keyringLoader: async () => mockKeyring,
      });

      await storage.saveKey('exa', 'sk-to-delete');
      await storage.deleteKey('exa');
      const result = await storage.getKey('exa');
      expect(result).toBeNull();
    });

    /**
     * @plan PLAN-20260206-TOOLKEY.P04
     * @requirement REQ-001.4
     */
    it('deleteKey on non-existent key does not throw', async () => {
      const mockKeyring = createMockKeyring();
      const storage = new ToolKeyStorage({
        toolsDir: tempDir,
        keyringLoader: async () => mockKeyring,
      });

      await expect(storage.deleteKey('exa')).resolves.not.toThrow();
    });

    /**
     * @plan PLAN-20260206-TOOLKEY.P04
     * @requirement REQ-001.5
     */
    it('uses service name llxprt-code-tool-keys (not llxprt-code)', async () => {
      const mockKeyring = createMockKeyring();
      const storage = new ToolKeyStorage({
        toolsDir: tempDir,
        keyringLoader: async () => mockKeyring,
      });

      await storage.saveKey('exa', 'sk-isolation-test');

      // Verify the key was stored under the correct service name
      const correctServiceKey = mockKeyring.store.has(
        'llxprt-code-tool-keys:exa',
      );
      const wrongServiceKey = mockKeyring.store.has('llxprt-code:exa');
      expect(correctServiceKey).toBe(true);
      expect(wrongServiceKey).toBe(false);
    });
  });

  // ─── Encrypted File Fallback Tests ───────────────────────────────────────

  describe('encrypted file fallback', () => {
    /**
     * @plan PLAN-20260206-TOOLKEY.P04
     * @requirement REQ-001.2
     */
    it('saves and retrieves a key via encrypted file when keychain unavailable', async () => {
      const storage = new ToolKeyStorage({
        toolsDir: tempDir,
        keyringLoader: async () => null, // keychain unavailable
      });

      await storage.saveKey('exa', 'sk-file-fallback');
      const result = await storage.getKey('exa');
      expect(result).toBe('sk-file-fallback');
    });

    /**
     * @plan PLAN-20260206-TOOLKEY.P04
     * @requirement REQ-001.2
     */
    it('encrypted file is created in tools directory', async () => {
      const storage = new ToolKeyStorage({
        toolsDir: tempDir,
        keyringLoader: async () => null,
      });

      await storage.saveKey('exa', 'sk-check-file');
      const filePath = path.join(tempDir, 'exa.key');
      const stat = await fs.stat(filePath);
      expect(stat.isFile()).toBe(true);
    });

    /**
     * @plan PLAN-20260206-TOOLKEY.P04
     * @requirement REQ-001.2
     */
    it('encrypted file content is not plaintext', async () => {
      const storage = new ToolKeyStorage({
        toolsDir: tempDir,
        keyringLoader: async () => null,
      });

      await storage.saveKey('exa', 'sk-secret-value');
      const filePath = path.join(tempDir, 'exa.key');
      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).not.toContain('sk-secret-value');
      // AES-256-GCM format: iv:authTag:encrypted (hex strings)
      expect(content).toMatch(/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/);
    });

    /**
     * @plan PLAN-20260206-TOOLKEY.P04
     * @requirement REQ-001.2
     */
    it('returns null when no encrypted file exists', async () => {
      const storage = new ToolKeyStorage({
        toolsDir: tempDir,
        keyringLoader: async () => null,
      });

      const result = await storage.getKey('exa');
      expect(result).toBeNull();
    });

    /**
     * @plan PLAN-20260206-TOOLKEY.P04
     * @requirement REQ-001.4
     */
    it('deleteKey removes encrypted file', async () => {
      const storage = new ToolKeyStorage({
        toolsDir: tempDir,
        keyringLoader: async () => null,
      });

      await storage.saveKey('exa', 'sk-to-remove');
      const filePath = path.join(tempDir, 'exa.key');
      // Verify file exists first
      await expect(fs.stat(filePath)).resolves.toBeDefined();

      await storage.deleteKey('exa');

      // File should be gone
      await expect(fs.stat(filePath)).rejects.toThrow();
    });
  });

  // ─── Keyfile Path Tests ──────────────────────────────────────────────────

  describe('keyfile path management', () => {
    /**
     * @plan PLAN-20260206-TOOLKEY.P04
     * @requirement REQ-003.7
     */
    it('setKeyfilePath persists path in keyfiles.json', async () => {
      const storage = new ToolKeyStorage({
        toolsDir: tempDir,
        keyringLoader: async () => null,
      });

      await storage.setKeyfilePath('exa', '/path/to/key');

      const jsonPath = path.join(tempDir, 'keyfiles.json');
      const content = await fs.readFile(jsonPath, 'utf-8');
      const parsed = JSON.parse(content);
      expect(parsed.exa).toBe('/path/to/key');
    });

    /**
     * @plan PLAN-20260206-TOOLKEY.P04
     * @requirement REQ-003.7
     */
    it('getKeyfilePath retrieves persisted path', async () => {
      const storage = new ToolKeyStorage({
        toolsDir: tempDir,
        keyringLoader: async () => null,
      });

      await storage.setKeyfilePath('exa', '/path/to/exa.key');
      const result = await storage.getKeyfilePath('exa');
      expect(result).toBe('/path/to/exa.key');
    });

    /**
     * @plan PLAN-20260206-TOOLKEY.P04
     * @requirement REQ-003.7
     */
    it('clearKeyfilePath removes entry from keyfiles.json', async () => {
      const storage = new ToolKeyStorage({
        toolsDir: tempDir,
        keyringLoader: async () => null,
      });

      await storage.setKeyfilePath('exa', '/path/to/key');
      await storage.clearKeyfilePath('exa');
      const result = await storage.getKeyfilePath('exa');
      expect(result).toBeNull();
    });

    /**
     * @plan PLAN-20260206-TOOLKEY.P04
     * @requirement REQ-003.7
     */
    it('getKeyfilePath returns null when not configured', async () => {
      const storage = new ToolKeyStorage({
        toolsDir: tempDir,
        keyringLoader: async () => null,
      });

      const result = await storage.getKeyfilePath('exa');
      expect(result).toBeNull();
    });

    /**
     * @plan PLAN-20260206-TOOLKEY.P04
     * @requirement REQ-003.7
     */
    it('overwrites keyfile path for same tool on repeated setKeyfilePath', async () => {
      const storage = new ToolKeyStorage({
        toolsDir: tempDir,
        keyringLoader: async () => null,
      });

      await storage.setKeyfilePath('exa', '/path/to/exa.key');
      await storage.setKeyfilePath('exa', '/updated/exa.key');

      const result = await storage.getKeyfilePath('exa');
      expect(result).toBe('/updated/exa.key');
    });
  });

  // ─── Key Resolution Tests ───────────────────────────────────────────────

  describe('resolveKey', () => {
    /**
     * @plan PLAN-20260206-TOOLKEY.P04
     * @requirement REQ-001.3
     */
    it('returns keychain key when available (priority 1)', async () => {
      const mockKeyring = createMockKeyring();
      const storage = new ToolKeyStorage({
        toolsDir: tempDir,
        keyringLoader: async () => mockKeyring,
      });

      await storage.saveKey('exa', 'sk-keychain-value');
      const result = await storage.resolveKey('exa');
      expect(result).toBe('sk-keychain-value');
    });

    /**
     * @plan PLAN-20260206-TOOLKEY.P04
     * @requirement REQ-001.3
     */
    it('returns encrypted file key when keychain unavailable (priority 2)', async () => {
      const storage = new ToolKeyStorage({
        toolsDir: tempDir,
        keyringLoader: async () => null, // keychain unavailable
      });

      await storage.saveKey('exa', 'sk-file-value');
      const result = await storage.resolveKey('exa');
      expect(result).toBe('sk-file-value');
    });

    /**
     * @plan PLAN-20260206-TOOLKEY.P04
     * @requirement REQ-003.5
     */
    it('returns keyfile content when no stored key (priority 3)', async () => {
      const keyfilePath = path.join(tempDir, 'external-exa.key');
      await fs.writeFile(keyfilePath, 'sk-from-keyfile\n', 'utf-8');

      const storage = new ToolKeyStorage({
        toolsDir: tempDir,
        keyringLoader: async () => null,
      });

      await storage.setKeyfilePath('exa', keyfilePath);
      const result = await storage.resolveKey('exa');
      expect(result).toBe('sk-from-keyfile');
    });

    /**
     * @plan PLAN-20260206-TOOLKEY.P04
     * @requirement REQ-003.5
     */
    it('reads keyfile content fresh on each call', async () => {
      const keyfilePath = path.join(tempDir, 'mutable-exa.key');
      await fs.writeFile(keyfilePath, 'sk-original\n', 'utf-8');

      const storage = new ToolKeyStorage({
        toolsDir: tempDir,
        keyringLoader: async () => null,
      });

      await storage.setKeyfilePath('exa', keyfilePath);
      const first = await storage.resolveKey('exa');
      expect(first).toBe('sk-original');

      // Overwrite the keyfile
      await fs.writeFile(keyfilePath, 'sk-updated\n', 'utf-8');
      const second = await storage.resolveKey('exa');
      expect(second).toBe('sk-updated');
    });

    /**
     * @plan PLAN-20260206-TOOLKEY.P04
     * @requirement REQ-003.5
     */
    it('uses first line only from multi-line keyfile', async () => {
      const keyfilePath = path.join(tempDir, 'multiline-exa.key');
      await fs.writeFile(
        keyfilePath,
        'sk-abc\nsecond-line\nthird-line\n',
        'utf-8',
      );

      const storage = new ToolKeyStorage({
        toolsDir: tempDir,
        keyringLoader: async () => null,
      });

      await storage.setKeyfilePath('exa', keyfilePath);
      const result = await storage.resolveKey('exa');
      expect(result).toBe('sk-abc');
    });

    /**
     * @plan PLAN-20260206-TOOLKEY.P04
     * @requirement REQ-003.5
     */
    it('trims whitespace from keyfile content', async () => {
      const keyfilePath = path.join(tempDir, 'whitespace-exa.key');
      await fs.writeFile(keyfilePath, '  sk-trimmed  \n', 'utf-8');

      const storage = new ToolKeyStorage({
        toolsDir: tempDir,
        keyringLoader: async () => null,
      });

      await storage.setKeyfilePath('exa', keyfilePath);
      const result = await storage.resolveKey('exa');
      expect(result).toBe('sk-trimmed');
    });

    /**
     * @plan PLAN-20260206-TOOLKEY.P04
     * @requirement REQ-003.6
     */
    it('returns null when keyfile missing', async () => {
      const storage = new ToolKeyStorage({
        toolsDir: tempDir,
        keyringLoader: async () => null,
      });

      await storage.setKeyfilePath('exa', '/nonexistent/path/key.txt');
      const result = await storage.resolveKey('exa');
      expect(result).toBeNull();
    });

    /**
     * @plan PLAN-20260206-TOOLKEY.P04
     * @requirement REQ-003.6
     */
    it('returns null when keyfile empty', async () => {
      const keyfilePath = path.join(tempDir, 'empty-exa.key');
      await fs.writeFile(keyfilePath, '   \n  \n', 'utf-8');

      const storage = new ToolKeyStorage({
        toolsDir: tempDir,
        keyringLoader: async () => null,
      });

      await storage.setKeyfilePath('exa', keyfilePath);
      const result = await storage.resolveKey('exa');
      expect(result).toBeNull();
    });

    /**
     * @plan PLAN-20260206-TOOLKEY.P04
     * @requirement REQ-001.3
     */
    it('returns null when no key configured anywhere', async () => {
      const storage = new ToolKeyStorage({
        toolsDir: tempDir,
        keyringLoader: async () => null,
      });

      const result = await storage.resolveKey('exa');
      expect(result).toBeNull();
    });

    /**
     * @plan PLAN-20260206-TOOLKEY.P04
     * @requirement REQ-001.3
     */
    it('prefers stored key over keyfile when both configured', async () => {
      const mockKeyring = createMockKeyring();
      const keyfilePath = path.join(tempDir, 'override-exa.key');
      await fs.writeFile(keyfilePath, 'sk-from-file\n', 'utf-8');

      const storage = new ToolKeyStorage({
        toolsDir: tempDir,
        keyringLoader: async () => mockKeyring,
      });

      await storage.saveKey('exa', 'sk-from-keychain');
      await storage.setKeyfilePath('exa', keyfilePath);

      const result = await storage.resolveKey('exa');
      expect(result).toBe('sk-from-keychain');
    });
  });

  // ─── hasKey Tests ────────────────────────────────────────────────────────

  describe('hasKey', () => {
    /**
     * @plan PLAN-20260206-TOOLKEY.P04
     * @requirement REQ-001.1
     */
    it('returns true when key stored', async () => {
      const mockKeyring = createMockKeyring();
      const storage = new ToolKeyStorage({
        toolsDir: tempDir,
        keyringLoader: async () => mockKeyring,
      });

      await storage.saveKey('exa', 'sk-exists');
      const result = await storage.hasKey('exa');
      expect(result).toBe(true);
    });

    /**
     * @plan PLAN-20260206-TOOLKEY.P04
     * @requirement REQ-001.1
     */
    it('returns false when no key', async () => {
      const mockKeyring = createMockKeyring();
      const storage = new ToolKeyStorage({
        toolsDir: tempDir,
        keyringLoader: async () => mockKeyring,
      });

      const result = await storage.hasKey('exa');
      expect(result).toBe(false);
    });
  });

  // ─── Invalid Tool Name Validation Tests ─────────────────────────────────

  describe('invalid tool name validation', () => {
    it('rejects path-traversal tool name in saveKey', async () => {
      const storage = new ToolKeyStorage({
        toolsDir: tempDir,
        keyringLoader: async () => null,
      });

      await expect(storage.saveKey('../etc/passwd', 'sk-bad')).rejects.toThrow(
        /Invalid tool key name/,
      );
    });

    it('rejects unregistered tool name in getKey', async () => {
      const storage = new ToolKeyStorage({
        toolsDir: tempDir,
        keyringLoader: async () => null,
      });

      await expect(storage.getKey('not-a-tool')).rejects.toThrow(
        /Invalid tool key name/,
      );
    });

    it('rejects invalid tool name in setKeyfilePath', async () => {
      const storage = new ToolKeyStorage({
        toolsDir: tempDir,
        keyringLoader: async () => null,
      });

      await expect(
        storage.setKeyfilePath('../traversal', '/some/path'),
      ).rejects.toThrow(/Invalid tool key name/);
    });

    it('rejects invalid tool name in getKeyfilePath', async () => {
      const storage = new ToolKeyStorage({
        toolsDir: tempDir,
        keyringLoader: async () => null,
      });

      await expect(storage.getKeyfilePath('../../etc/shadow')).rejects.toThrow(
        /Invalid tool key name/,
      );
    });

    it('rejects invalid tool name in resolveKey', async () => {
      const storage = new ToolKeyStorage({
        toolsDir: tempDir,
        keyringLoader: async () => null,
      });

      await expect(storage.resolveKey('unknown')).rejects.toThrow(
        /Invalid tool key name/,
      );
    });
  });
});
