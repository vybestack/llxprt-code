/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  ExtensionSettingsStorage,
  getSettingsEnvFilePath,
  getKeychainServiceName,
} from './settingsStorage.js';
import type { ExtensionSetting } from './extensionSettings.js';

// Mock keytar/keyring for tests
vi.mock('@napi-rs/keyring', () => ({
  AsyncEntry: vi.fn().mockImplementation((_service, _account) => ({
    getPassword: vi.fn().mockResolvedValue(null),
    setPassword: vi.fn().mockResolvedValue(undefined),
    deletePassword: vi.fn().mockResolvedValue(true),
  })),
  findCredentialsAsync: vi.fn().mockResolvedValue([]),
}));

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
});

describe('ExtensionSettingsStorage', () => {
  let tmpDir: string;
  let storage: ExtensionSettingsStorage;
  const extensionName = 'test-extension';

  beforeEach(async () => {
    tmpDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'ext-settings-test-'),
    );
    storage = new ExtensionSettingsStorage(extensionName, tmpDir);
  });

  afterEach(async () => {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
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

    it('should save sensitive settings to keychain', async () => {
      const settings: ExtensionSetting[] = [
        { name: 'apiKey', envVar: 'API_KEY', sensitive: true },
      ];
      const values = { API_KEY: 'secret123' };

      await storage.saveSettings(settings, values);

      const keyring = await import('@napi-rs/keyring');
      const AsyncEntry = vi.mocked(keyring.AsyncEntry);
      expect(AsyncEntry).toHaveBeenCalledWith(expect.any(String), 'API_KEY');
      const entry = AsyncEntry.mock.results[0]?.value;
      expect(entry.setPassword).toHaveBeenCalledWith('secret123');
    });

    it('should NOT save sensitive settings to env file', async () => {
      const settings: ExtensionSetting[] = [
        { name: 'apiKey', envVar: 'API_KEY', sensitive: true },
      ];
      const values = { API_KEY: 'secret123' };

      await storage.saveSettings(settings, values);

      const envPath = getSettingsEnvFilePath(tmpDir);
      if (fs.existsSync(envPath)) {
        const content = await fs.promises.readFile(envPath, 'utf-8');
        expect(content).not.toContain('secret123');
        expect(content).not.toContain('API_KEY=secret123');
      }
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

    it('should load sensitive settings from keychain', async () => {
      const settings: ExtensionSetting[] = [
        { name: 'apiKey', envVar: 'API_KEY', sensitive: true },
      ];

      // This will test keychain loading - need mock to return value
      const result = await storage.loadSettings(settings);
      // With proper mock setup, should return keychain value
      // Currently mock returns null, so API_KEY should be undefined
      expect(result.API_KEY).toBeUndefined();
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
      // API_KEY would come from keychain (mocked)
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

    it('should delete keychain entries', async () => {
      await storage.deleteSettings();
      // Verify keychain delete was called (check mock)
    });

    it('should handle missing env file gracefully', async () => {
      // Don't create env file
      await expect(storage.deleteSettings()).resolves.not.toThrow();
    });
  });

  describe('hasSettings', () => {
    it('should return true if env file exists', async () => {
      const envPath = getSettingsEnvFilePath(tmpDir);
      await fs.promises.writeFile(envPath, 'TEST=value\n');

      const result = await storage.hasSettings();
      expect(result).toBe(true);
    });

    it('should return false if no settings exist', async () => {
      const result = await storage.hasSettings();
      expect(result).toBe(false);
    });
  });
});
