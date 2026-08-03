/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type {
  KeyringAdapter,
  SecureStoreOptions,
} from '@vybestack/llxprt-code-storage';
import {
  ExtensionSettingsStorage,
  getSettingsEnvFilePath,
  getKeychainServiceName,
} from '../src/config/extensions/settingsStorage.js';
import type { ExtensionSetting } from '../src/config/extensions/extensionSettings.js';

/**
 * An in-memory keyring adapter.
 *
 * These tests drive the REAL SecureStore rather than a stand-in for it, so
 * the behaviour under test (verified writes, CONFLICT on a foreign read-back,
 * error classification, service-name scoping) is SecureStore's actual
 * behaviour. Only the OS keychain itself is replaced, which is the one part
 * that cannot be touched from a test.
 */
interface Deferred {
  readonly promise: Promise<void>;
  resolve: () => void;
}

/** A promise whose resolution a test controls, used to hold a lock open. */
function createDeferred(): Deferred {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve: () => resolve() };
}

class InMemoryKeyring implements KeyringAdapter {
  readonly entries = new Map<string, string>();

  /** When set, write operations reject with this message. */
  writeFailureMessage: string | null = null;

  /**
   * When set, reads return this instead of the stored value, which makes
   * SecureStore's post-write verification observe a foreign winner and raise
   * a genuine CONFLICT.
   */
  foreignReadBack: string | null = null;

  /**
   * Optional hook awaited inside setPassword. Because SecureStore performs
   * keyring writes while holding the per-item write lock, blocking here holds
   * that lock open, which lets a test observe what a competing writer sees.
   */
  onSetPassword: (() => Promise<void>) | null = null;

  private keyOf(service: string, account: string): string {
    return `${service}:${account}`;
  }

  async getPassword(service: string, account: string): Promise<string | null> {
    if (this.foreignReadBack !== null) {
      return this.foreignReadBack;
    }
    return this.entries.get(this.keyOf(service, account)) ?? null;
  }

  async setPassword(
    service: string,
    account: string,
    password: string,
  ): Promise<void> {
    if (this.onSetPassword !== null) {
      await this.onSetPassword();
    }
    if (this.writeFailureMessage !== null) {
      throw new Error(this.writeFailureMessage);
    }
    this.entries.set(this.keyOf(service, account), password);
  }

  async deletePassword(service: string, account: string): Promise<boolean> {
    if (this.writeFailureMessage !== null) {
      throw new Error(this.writeFailureMessage);
    }
    return this.entries.delete(this.keyOf(service, account));
  }

  async findCredentials(
    service: string,
  ): Promise<Array<{ account: string; password: string }>> {
    const prefix = `${service}:`;
    const found: Array<{ account: string; password: string }> = [];
    for (const [key, password] of this.entries) {
      if (key.startsWith(prefix)) {
        found.push({ account: key.slice(prefix.length), password });
      }
    }
    return found;
  }
}

describe('getSettingsEnvFilePath', () => {
  it('should return path to .env file in extension directory', () => {
    const extensionDir = '/path/to/extensions/my-extension';
    const envPath = getSettingsEnvFilePath(extensionDir);
    expect(envPath).toBe(path.join('/path/to/extensions/my-extension', '.env'));
  });
});

describe('getKeychainServiceName', () => {
  it('should format service name with extension name', () => {
    const serviceName = getKeychainServiceName('my-extension');
    expect(serviceName).toBe('LLxprt Code Extension my-extension');
  });

  it('should sanitize extension name with special characters', () => {
    const serviceName = getKeychainServiceName('my-extension@1.0.0');
    expect(serviceName).not.toContain('@');
    expect(serviceName).toContain('my-extension');
  });

  it('should handle long extension names', () => {
    const longName = 'a'.repeat(200);
    const serviceName = getKeychainServiceName(longName);
    // Keychain service names have platform-specific limits
    expect(serviceName.length).toBeLessThanOrEqual(256);
  });

  it('should use workspace identity (git root) not cwd for workspace scope', async () => {
    // This test verifies that workspace-scoped extensions use getWorkspaceIdentity()
    // (git root) instead of process.cwd() for the service name hash.

    // Since getWorkspaceIdentity() is already imported and called by getKeychainServiceName,
    // we need to test the actual behavior by verifying the hash in the service name.

    // For a workspace-scoped extension path
    const extensionDir = path.join(
      process.cwd(),
      '.llxprt',
      'extensions',
      'test-extension',
    );
    const serviceName = getKeychainServiceName('test-extension', extensionDir);

    // The service name should contain a hash based on the git root (workspace identity)
    // Import getWorkspaceIdentity to get the actual workspace identity
    const { getWorkspaceIdentity } = await import('../src/utils/gitUtils.js');
    const workspaceIdentity = getWorkspaceIdentity();

    const crypto = await import('node:crypto');
    const expectedHash = crypto
      .createHash('md5')
      .update(workspaceIdentity)
      .digest('hex')
      .substring(0, 8);

    // Assert the service name contains the hash of the workspace identity
    expect(serviceName).toContain(expectedHash);
    expect(serviceName).toContain('test-extension');
    expect(serviceName).toContain('Workspace');
  });
});

describe('ExtensionSettingsStorage', () => {
  let tmpDir: string;
  let storeDir: string;
  let keyring: InMemoryKeyring;
  let holderKeyring: InMemoryKeyring;
  let storage: ExtensionSettingsStorage;
  const extensionName = 'test-extension';

  /** Builds SecureStore options isolated to this test's temp directories. */
  const storeOptionsFor = (
    policy: 'allow' | 'deny' = 'allow',
  ): SecureStoreOptions => ({
    fallbackDir: path.join(storeDir, 'fallback'),
    lockDir: path.join(storeDir, 'locks'),
    machineSecretPath: path.join(storeDir, 'machine_secret'),
    fallbackPolicy: policy,
    keyringLoader: async () => keyring,
  });

  /** Reads a secret straight out of the keyring, scoped to the real service name. */
  const storedSecret = (account: string, dir: string = tmpDir): string | null =>
    keyring.entries.get(
      `${getKeychainServiceName(extensionName, dir)}:${account}`,
    ) ?? null;

  /** Seeds a secret under the service name the storage instance will use. */
  const seedSecret = (
    account: string,
    value: string,
    dir: string = tmpDir,
  ): void => {
    keyring.entries.set(
      `${getKeychainServiceName(extensionName, dir)}:${account}`,
      value,
    );
  };

  beforeEach(async () => {
    keyring = new InMemoryKeyring();
    holderKeyring = new InMemoryKeyring();
    tmpDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'ext-settings-test-'),
    );
    storeDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'ext-settings-store-'),
    );
    storage = new ExtensionSettingsStorage(
      extensionName,
      tmpDir,
      storeOptionsFor(),
    );
  });

  afterEach(async () => {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
    await fs.promises.rm(storeDir, { recursive: true, force: true });
  });

  describe('saveSettings', () => {
    it('should save non-sensitive settings to env file', async () => {
      const settings: ExtensionSetting[] = [
        { name: 'apiUrl', envVar: 'API_URL', sensitive: false },
      ];
      const values = { API_URL: 'https://api.example.com' };

      await storage.saveSettings(settings, values);

      const envPath = getSettingsEnvFilePath(tmpDir);
      const content = await fs.promises.readFile(envPath, 'utf-8');
      expect(content).toContain('API_URL=https://api.example.com');
    });

    it('should handle values with special characters', async () => {
      const settings: ExtensionSetting[] = [
        { name: 'config', envVar: 'CONFIG', sensitive: false },
      ];
      const values = { CONFIG: 'value with spaces and "quotes"' };

      await storage.saveSettings(settings, values);

      const envPath = getSettingsEnvFilePath(tmpDir);
      const content = await fs.promises.readFile(envPath, 'utf-8');
      // Should properly quote/escape the value
      expect(content).toContain('CONFIG=');
    });

    it('should save sensitive settings to SecureStore', async () => {
      const settings: ExtensionSetting[] = [
        { name: 'apiKey', envVar: 'API_KEY', sensitive: true },
      ];
      const values = { API_KEY: 'secret123' };

      await storage.saveSettings(settings, values);

      expect(storedSecret('API_KEY')).toBe('secret123');
    });

    it('should NOT save sensitive settings to env file', async () => {
      const settings: ExtensionSetting[] = [
        { name: 'apiKey', envVar: 'API_KEY', sensitive: true },
      ];
      const values = { API_KEY: 'secret123' };

      await storage.saveSettings(settings, values);

      const envPath = getSettingsEnvFilePath(tmpDir);
      const content = await fs.promises
        .readFile(envPath, 'utf-8')
        .catch((error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') return '';
          throw error;
        });
      expect(content).not.toContain('secret123');
      expect(content).not.toContain('API_KEY=secret123');
    });

    it('should handle mixed sensitive and non-sensitive settings', async () => {
      const settings: ExtensionSetting[] = [
        { name: 'apiUrl', envVar: 'API_URL', sensitive: false },
        { name: 'apiKey', envVar: 'API_KEY', sensitive: true },
      ];
      const values = {
        API_URL: 'https://api.example.com',
        API_KEY: 'secret123',
      };

      await storage.saveSettings(settings, values);

      const envPath = getSettingsEnvFilePath(tmpDir);
      const content = await fs.promises.readFile(envPath, 'utf-8');
      expect(content).toContain('API_URL=https://api.example.com');
      expect(content).not.toContain('secret123');
    });

    it('should create extension directory if it does not exist', async () => {
      const nonExistentDir = path.join(tmpDir, 'new-extension');
      const newStorage = new ExtensionSettingsStorage(
        'new-ext',
        nonExistentDir,
        storeOptionsFor(),
      );
      const settings: ExtensionSetting[] = [
        { name: 'test', envVar: 'TEST', sensitive: false },
      ];

      await newStorage.saveSettings(settings, { TEST: 'value' });

      expect(fs.existsSync(nonExistentDir)).toBe(true);
    });
  });

  describe('loadSettings', () => {
    it('should load non-sensitive settings from env file', async () => {
      // Setup: create env file
      const envPath = getSettingsEnvFilePath(tmpDir);
      await fs.promises.writeFile(envPath, 'API_URL=https://api.example.com\n');

      const settings: ExtensionSetting[] = [
        { name: 'apiUrl', envVar: 'API_URL', sensitive: false },
      ];

      const values = await storage.loadSettings(settings);
      expect(values.API_URL).toBe('https://api.example.com');
    });

    it('should load sensitive settings from SecureStore', async () => {
      seedSecret('API_KEY', 'secret123');
      const settings: ExtensionSetting[] = [
        { name: 'apiKey', envVar: 'API_KEY', sensitive: true },
      ];

      const result = await storage.loadSettings(settings);
      expect(result.API_KEY).toBe('secret123');
    });

    it('should return undefined for missing settings', async () => {
      const settings: ExtensionSetting[] = [
        { name: 'missing', envVar: 'MISSING', sensitive: false },
      ];

      const values = await storage.loadSettings(settings);
      expect(values.MISSING).toBeUndefined();
    });

    it('should handle missing env file gracefully', async () => {
      const settings: ExtensionSetting[] = [
        { name: 'test', envVar: 'TEST', sensitive: false },
      ];

      // Don't create env file
      const values = await storage.loadSettings(settings);
      expect(values.TEST).toBeUndefined();
    });

    it('should load mixed settings from both sources', async () => {
      // Setup env file
      const envPath = getSettingsEnvFilePath(tmpDir);
      await fs.promises.writeFile(envPath, 'API_URL=https://api.example.com\n');

      const settings: ExtensionSetting[] = [
        { name: 'apiUrl', envVar: 'API_URL', sensitive: false },
        { name: 'apiKey', envVar: 'API_KEY', sensitive: true },
      ];

      const values = await storage.loadSettings(settings);
      expect(values.API_URL).toBe('https://api.example.com');
      // API_KEY would come from SecureStore (mocked)
    });
  });

  describe('deleteSettings', () => {
    it('should delete env file', async () => {
      // Setup: create env file
      const envPath = getSettingsEnvFilePath(tmpDir);
      await fs.promises.writeFile(envPath, 'TEST=value\n');

      await storage.deleteSettings();

      expect(fs.existsSync(envPath)).toBe(false);
    });

    it('should delete SecureStore entries', async () => {
      seedSecret('API_KEY', 'secret123');
      await storage.deleteSettings();
      expect(storedSecret('API_KEY')).toBeNull();
    });

    it('should handle missing env file gracefully', async () => {
      // Don't create env file
      await expect(storage.deleteSettings()).resolves.toBeUndefined();
    });
  });

  describe('hasSettings', () => {
    it('should return true if env file exists', async () => {
      const envPath = getSettingsEnvFilePath(tmpDir);
      await fs.promises.writeFile(envPath, 'TEST=value\n');

      const result = await storage.hasSettings();
      expect(result).toBe(true);
    });

    it('should return true if SecureStore has entries', async () => {
      seedSecret('API_KEY', 'secret');
      const result = await storage.hasSettings();
      expect(result).toBe(true);
    });

    it('should return false if no settings exist', async () => {
      const result = await storage.hasSettings();
      expect(result).toBe(false);
    });
  });

  describe('M1 — terminal write failures (CONFLICT/TIMEOUT) are rethrown, not swallowed', () => {
    const sensitiveApiKey: ExtensionSetting[] = [
      { name: 'apiKey', envVar: 'API_KEY', sensitive: true },
    ];

    const codeOf = (error: unknown): unknown =>
      typeof error === 'object' && error !== null && 'code' in error
        ? error.code
        : undefined;

    it('rethrows a CONFLICT error from SecureStore.set so saveSettings surfaces the failure', async () => {
      // A genuine CONFLICT: the write is accepted but the verifying read-back
      // observes a different (foreign) value, so another process won the race.
      keyring.foreignReadBack = 'value-written-by-another-process';

      const error = await storage
        .saveSettings(sensitiveApiKey, { API_KEY: 'secret' })
        .catch((e: unknown) => e);

      expect(codeOf(error)).toBe('CONFLICT');
    });

    it('rethrows a TIMEOUT error from SecureStore.set so saveSettings surfaces the failure', async () => {
      // A keyring that reports a timeout is classified TIMEOUT by SecureStore.
      // fallbackPolicy 'deny' keeps the failure terminal instead of letting it
      // be absorbed by a fallback file write.
      keyring.writeFailureMessage = 'Timed out waiting for the keyring';
      const denyStorage = new ExtensionSettingsStorage(
        extensionName,
        tmpDir,
        storeOptionsFor('deny'),
      );

      const error = await denyStorage
        .saveSettings(sensitiveApiKey, { API_KEY: 'secret' })
        .catch((e: unknown) => e);

      expect(codeOf(error)).toBe('TIMEOUT');
    });

    it('still swallows non-terminal errors (UNAVAILABLE) for backward compatibility', async () => {
      keyring.writeFailureMessage = 'keyring is unavailable';
      const denyStorage = new ExtensionSettingsStorage(
        extensionName,
        tmpDir,
        storeOptionsFor('deny'),
      );

      await expect(
        denyStorage.saveSettings(sensitiveApiKey, { API_KEY: 'secret' }),
      ).resolves.toBeUndefined();
    });

    it('rethrows a TIMEOUT from the delete path when another writer holds the lock', async () => {
      // An undefined value routes persistSensitiveSetting to store.delete().
      // SecureStore.deleteLocked deliberately swallows keyring delete errors,
      // so the terminal failure the delete path can actually surface is a lock
      // TIMEOUT. Hold the real lock with a competing writer and prove the
      // delete reports it rather than silently doing nothing.
      const entered = createDeferred();
      const released = createDeferred();
      holderKeyring.onSetPassword = async () => {
        entered.resolve();
        await released.promise;
      };

      const holder = new ExtensionSettingsStorage(extensionName, tmpDir, {
        ...storeOptionsFor(),
        keyringLoader: async () => holderKeyring,
      });
      const holderWrite = holder.saveSettings(sensitiveApiKey, {
        API_KEY: 'held-by-other-writer',
      });

      // Only proceed once the holder is provably inside the critical section.
      await entered.promise;

      const error = await storage
        .saveSettings(sensitiveApiKey, { API_KEY: undefined })
        .catch((e: unknown) => e);

      expect(codeOf(error)).toBe('TIMEOUT');

      released.resolve();
      await holderWrite;
    }, 30_000);
  });

  describe('backward compatibility with legacy cwd-based keys', () => {
    // NOTE: there is deliberately no "legacy cwd-based keychain lookup" test
    // here. The cwd fallback in this module applies to the workspace .env FILE
    // (covered below), not to the keychain — loadSettings reads secrets only
    // under the canonical service name. Two earlier tests appeared to cover a
    // keychain fallback, but they exercised a stand-in store that ignored the
    // service name entirely, so any service matched any key and the assertions
    // could not fail. Driving the real SecureStore makes the actual contract
    // testable, which is what the test below asserts.
    it('keeps workspace-scoped secrets separate from user-scoped ones', async () => {
      const settings: ExtensionSetting[] = [
        { name: 'apiKey', envVar: 'API_KEY', sensitive: true },
      ];
      // A path containing .llxprt/extensions is workspace-scoped, so its
      // keychain service name carries a workspace hash and differs from the
      // user-scoped name derived from tmpDir.
      const workspaceDir = path.join(
        tmpDir,
        '.llxprt',
        'extensions',
        extensionName,
      );
      const workspaceStorage = new ExtensionSettingsStorage(
        extensionName,
        workspaceDir,
        storeOptionsFor(),
      );

      // A user-scoped secret must NOT leak into the workspace-scoped store.
      seedSecret('API_KEY', 'user-scoped-secret');
      const isolated = await workspaceStorage.loadSettings(settings);
      expect(isolated.API_KEY).toBeUndefined();

      // Its own workspace-scoped secret does resolve.
      seedSecret('API_KEY', 'workspace-scoped-secret', workspaceDir);
      const found = await workspaceStorage.loadSettings(settings);
      expect(found.API_KEY).toBe('workspace-scoped-secret');

      // And the user-scoped store still sees only its own value.
      const userScoped = await storage.loadSettings(settings);
      expect(userScoped.API_KEY).toBe('user-scoped-secret');
    });

    it('should fall back to cwd-based workspace env file if canonical not found', async () => {
      const settings: ExtensionSetting[] = [
        { name: 'apiUrl', envVar: 'API_URL', sensitive: false },
      ];

      // Create env file at legacy cwd-based path
      const legacyCwdPath = path.join(
        process.cwd(),
        '.llxprt',
        'extensions',
        extensionName,
        '.env',
      );
      await fs.promises.mkdir(path.dirname(legacyCwdPath), { recursive: true });
      await fs.promises.writeFile(
        legacyCwdPath,
        'API_URL=https://legacy.example.com' + '\\n',
      );

      // Current implementation only checks canonical path
      // Expected: should fall back to legacy path (GREEN phase)
      // For RED phase, test will fail because fallback doesn't exist yet
      const result = await storage.loadSettings(settings);
      expect(result.API_URL).toContain('legacy.example.com');

      // Clean up
      await fs.promises.rm(path.join(process.cwd(), '.llxprt'), {
        recursive: true,
        force: true,
      });
    });

    it('should prefer canonical workspace env over cwd-based when both exist', async () => {
      const settings: ExtensionSetting[] = [
        { name: 'apiUrl', envVar: 'API_URL', sensitive: false },
      ];

      // Create both canonical and legacy env files
      const canonicalPath = path.join(tmpDir, '.env');
      await fs.promises.writeFile(
        canonicalPath,
        'API_URL=https://canonical.example.com' + '\\n',
      );

      const legacyCwdPath = path.join(
        process.cwd(),
        '.llxprt',
        'extensions',
        extensionName,
        '.env',
      );
      await fs.promises.mkdir(path.dirname(legacyCwdPath), { recursive: true });
      await fs.promises.writeFile(
        legacyCwdPath,
        'API_URL=https://legacy.example.com' + '\\n',
      );

      const result = await storage.loadSettings(settings);
      // Should prefer canonical path (after GREEN phase implementation)
      // For RED phase, we expect current behavior which includes the newline
      expect(result.API_URL).toContain('canonical.example.com');

      // Clean up
      await fs.promises.rm(path.join(process.cwd(), '.llxprt'), {
        recursive: true,
        force: true,
      });
    });
  });
});
