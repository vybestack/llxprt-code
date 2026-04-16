/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  getEnvContents,
  updateSetting,
  loadExtensionSettingsFromManifest,
  ExtensionSettingScope,
} from './settingsIntegration.js';
import type { ExtensionSetting } from './extensionSettings.js';
import { getWorkspaceIdentity } from '../../utils/gitUtils.js';
import { DebugLogger } from '@vybestack/llxprt-code-core';

vi.mock('../../utils/gitUtils.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../utils/gitUtils.js')>();
  return {
    ...actual,
    getWorkspaceIdentity: vi.fn(actual.getWorkspaceIdentity),
  };
});

describe('settingsIntegration', () => {
  let tempDir: string;

  beforeEach(async () => {
    vi.mocked(getWorkspaceIdentity).mockRestore();
    tempDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'llxprt-settings-test-'),
    );
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (tempDir && fs.existsSync(tempDir)) {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    }
  });

  describe('loadExtensionSettingsFromManifest', () => {
    it('should load settings from llxprt-extension.json', async () => {
      const manifestPath = path.join(tempDir, 'llxprt-extension.json');
      const manifest = {
        name: 'test-extension',
        version: '1.0.0',
        settings: [
          {
            name: 'API Key',
            envVar: 'API_KEY',
            sensitive: true,
          },
          {
            name: 'API URL',
            description: 'The API endpoint URL',
            envVar: 'API_URL',
            sensitive: false,
          },
        ],
      };

      await fs.promises.writeFile(
        manifestPath,
        JSON.stringify(manifest),
        'utf-8',
      );

      const settings = loadExtensionSettingsFromManifest(tempDir);

      expect(settings).toHaveLength(2);
      expect(settings[0]).toStrictEqual({
        name: 'API Key',
        envVar: 'API_KEY',
        sensitive: true,
      });
      expect(settings[1]).toStrictEqual({
        name: 'API URL',
        description: 'The API endpoint URL',
        envVar: 'API_URL',
        sensitive: false,
      });
    });

    it('should return empty array if no settings in manifest', async () => {
      const manifestPath = path.join(tempDir, 'llxprt-extension.json');
      const manifest = {
        name: 'test-extension',
        version: '1.0.0',
      };

      await fs.promises.writeFile(
        manifestPath,
        JSON.stringify(manifest),
        'utf-8',
      );

      const settings = loadExtensionSettingsFromManifest(tempDir);

      expect(settings).toStrictEqual([]);
    });

    it('should return empty array if manifest not found', () => {
      const settings = loadExtensionSettingsFromManifest(tempDir);
      expect(settings).toStrictEqual([]);
    });
  });

  describe('getEnvContents', () => {
    it('should return settings with display values', async () => {
      // Create manifest
      const manifestPath = path.join(tempDir, 'llxprt-extension.json');
      const manifest = {
        name: 'test-ext',
        version: '1.0.0',
        settings: [
          {
            name: 'Public Setting',
            envVar: 'PUBLIC_VAR',
            sensitive: false,
          },
          {
            name: 'Secret Setting',
            envVar: 'SECRET_VAR',
            sensitive: true,
          },
          {
            name: 'Unset Setting',
            envVar: 'UNSET_VAR',
            sensitive: false,
          },
        ] as ExtensionSetting[],
      };

      await fs.promises.writeFile(
        manifestPath,
        JSON.stringify(manifest),
        'utf-8',
      );

      // Create .env file with non-sensitive value
      const envPath = path.join(tempDir, '.env');
      await fs.promises.writeFile(
        envPath,
        'PUBLIC_VAR=public-value\n',
        'utf-8',
      );

      const contents = await getEnvContents('test-ext', tempDir);

      expect(contents).toHaveLength(3);
      expect(contents[0]).toStrictEqual({
        name: 'Public Setting',
        value: 'public-value',
      });
      expect(contents[1]).toStrictEqual({
        name: 'Secret Setting',
        value: '[not set]',
      });
      expect(contents[2]).toStrictEqual({
        name: 'Unset Setting',
        value: '[not set]',
      });
    });

    it('should return empty array if no settings', async () => {
      const manifestPath = path.join(tempDir, 'llxprt-extension.json');
      const manifest = {
        name: 'test-ext',
        version: '1.0.0',
      };

      await fs.promises.writeFile(
        manifestPath,
        JSON.stringify(manifest),
        'utf-8',
      );

      const contents = await getEnvContents('test-ext', tempDir);
      expect(contents).toStrictEqual([]);
    });
  });

  describe('updateSetting', () => {
    it('should find setting by name and update it', async () => {
      const manifestPath = path.join(tempDir, 'llxprt-extension.json');
      const manifest = {
        name: 'test-ext',
        version: '1.0.0',
        settings: [
          {
            name: 'API Key',
            envVar: 'API_KEY',
            sensitive: false,
          },
        ] as ExtensionSetting[],
      };

      await fs.promises.writeFile(
        manifestPath,
        JSON.stringify(manifest),
        'utf-8',
      );

      const mockPrompt = vi.fn().mockResolvedValue('new-value');

      const result = await updateSetting(
        'test-ext',
        tempDir,
        'API Key',
        mockPrompt,
      );

      expect(result).toBe(true);
      expect(mockPrompt).toHaveBeenCalledWith('API Key: ', false);

      // Verify the value was written to .env
      const envPath = path.join(tempDir, '.env');
      const envContent = await fs.promises.readFile(envPath, 'utf-8');
      expect(envContent).toContain('API_KEY=new-value');
    });

    it('should find setting by envVar and update it', async () => {
      const manifestPath = path.join(tempDir, 'llxprt-extension.json');
      const manifest = {
        name: 'test-ext',
        version: '1.0.0',
        settings: [
          {
            name: 'API Key',
            envVar: 'API_KEY',
            sensitive: false,
          },
        ] as ExtensionSetting[],
      };

      await fs.promises.writeFile(
        manifestPath,
        JSON.stringify(manifest),
        'utf-8',
      );

      const mockPrompt = vi.fn().mockResolvedValue('new-value');

      const result = await updateSetting(
        'test-ext',
        tempDir,
        'API_KEY',
        mockPrompt,
      );

      expect(result).toBe(true);
    });

    it('should return false if setting not found', async () => {
      const manifestPath = path.join(tempDir, 'llxprt-extension.json');
      const manifest = {
        name: 'test-ext',
        version: '1.0.0',
        settings: [
          {
            name: 'API Key',
            envVar: 'API_KEY',
            sensitive: false,
          },
        ] as ExtensionSetting[],
      };

      await fs.promises.writeFile(
        manifestPath,
        JSON.stringify(manifest),
        'utf-8',
      );

      const mockPrompt = vi.fn().mockResolvedValue('new-value');

      const debugErrorSpy = vi
        .spyOn(DebugLogger.prototype, 'error')
        .mockImplementation(() => {});

      const result = await updateSetting(
        'test-ext',
        tempDir,
        'NonExistent',
        mockPrompt,
      );

      expect(result).toBe(false);
      expect(mockPrompt).not.toHaveBeenCalled();
      expect(debugErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Setting "NonExistent" not found'),
      );

      debugErrorSpy.mockRestore();
    });

    it('should return false if user cancels (empty value)', async () => {
      const manifestPath = path.join(tempDir, 'llxprt-extension.json');
      const manifest = {
        name: 'test-ext',
        version: '1.0.0',
        settings: [
          {
            name: 'API Key',
            envVar: 'API_KEY',
            sensitive: false,
          },
        ] as ExtensionSetting[],
      };

      await fs.promises.writeFile(
        manifestPath,
        JSON.stringify(manifest),
        'utf-8',
      );

      const mockPrompt = vi.fn().mockResolvedValue('');

      const result = await updateSetting(
        'test-ext',
        tempDir,
        'API Key',
        mockPrompt,
      );

      expect(result).toBe(false);
    });

    it('should handle values with spaces by quoting them', async () => {
      const manifestPath = path.join(tempDir, 'llxprt-extension.json');
      const manifest = {
        name: 'test-ext',
        version: '1.0.0',
        settings: [
          {
            name: 'Display Name',
            envVar: 'DISPLAY_NAME',
            sensitive: false,
          },
        ] as ExtensionSetting[],
      };

      await fs.promises.writeFile(
        manifestPath,
        JSON.stringify(manifest),
        'utf-8',
      );

      const mockPrompt = vi.fn().mockResolvedValue('My Cool Extension');

      await updateSetting('test-ext', tempDir, 'Display Name', mockPrompt);

      const envPath = path.join(tempDir, '.env');
      const envContent = await fs.promises.readFile(envPath, 'utf-8');
      expect(envContent).toContain('DISPLAY_NAME="My Cool Extension"');
    });
  });

  describe('scoped settings', () => {
    it('should support user-scoped settings', async () => {
      const manifestPath = path.join(tempDir, 'llxprt-extension.json');
      const manifest = {
        name: 'test-extension',
        version: '1.0.0',
        settings: [
          {
            name: 'User Setting',
            envVar: 'USER_SETTING',
            sensitive: false,
          },
        ],
      };

      await fs.promises.writeFile(
        manifestPath,
        JSON.stringify(manifest),
        'utf-8',
      );

      const mockPrompt = vi.fn().mockResolvedValue('user-value');
      await updateSetting(
        'test-extension',
        tempDir,
        'User Setting',
        mockPrompt,
        ExtensionSettingScope.USER,
      );

      const userEnvPath = path.join(tempDir, '.env');
      expect(fs.existsSync(userEnvPath)).toBe(true);
      const envContent = await fs.promises.readFile(userEnvPath, 'utf-8');
      expect(envContent).toContain('USER_SETTING=user-value');
    });

    it('should support workspace-scoped settings', async () => {
      // Mock workspace identity to a temp dir so the test doesn't write to the real project
      const workspaceRoot = await fs.promises.mkdtemp(
        path.join(os.tmpdir(), 'llxprt-ws-test-'),
      );
      vi.mocked(getWorkspaceIdentity).mockReturnValue(workspaceRoot);

      const manifestPath = path.join(tempDir, 'llxprt-extension.json');
      const manifest = {
        name: 'test-extension',
        version: '1.0.0',
        settings: [
          {
            name: 'Workspace Setting',
            envVar: 'WORKSPACE_SETTING',
            sensitive: false,
          },
        ],
      };

      await fs.promises.writeFile(
        manifestPath,
        JSON.stringify(manifest),
        'utf-8',
      );

      const mockPrompt = vi.fn().mockResolvedValue('workspace-value');
      await updateSetting(
        'test-extension',
        tempDir,
        'Workspace Setting',
        mockPrompt,
        ExtensionSettingScope.WORKSPACE,
      );

      const workspaceEnvPath = path.join(
        workspaceRoot,
        '.llxprt',
        'extensions',
        'test-extension',
        '.env',
      );
      expect(fs.existsSync(workspaceEnvPath)).toBe(true);
      const envContent = await fs.promises.readFile(workspaceEnvPath, 'utf-8');
      expect(envContent).toContain('WORKSPACE_SETTING=workspace-value');

      // Clean up
      await fs.promises.rm(workspaceRoot, { recursive: true, force: true });
    });

    it('should merge user and workspace scopes with workspace override', async () => {
      // Mock workspace identity to a temp dir
      const workspaceRoot = await fs.promises.mkdtemp(
        path.join(os.tmpdir(), 'llxprt-ws-merge-test-'),
      );
      vi.mocked(getWorkspaceIdentity).mockReturnValue(workspaceRoot);

      const manifestPath = path.join(tempDir, 'llxprt-extension.json');
      const manifest = {
        name: 'test-extension',
        version: '1.0.0',
        settings: [
          {
            name: 'Shared Setting',
            envVar: 'SHARED_SETTING',
            sensitive: false,
          },
        ],
      };

      await fs.promises.writeFile(
        manifestPath,
        JSON.stringify(manifest),
        'utf-8',
      );

      // Set user-level setting
      const mockPromptUser = vi.fn().mockResolvedValue('user-value');
      await updateSetting(
        'test-extension',
        tempDir,
        'Shared Setting',
        mockPromptUser,
        ExtensionSettingScope.USER,
      );

      // Set workspace-level setting (should override)
      const mockPromptWorkspace = vi.fn().mockResolvedValue('workspace-value');
      await updateSetting(
        'test-extension',
        tempDir,
        'Shared Setting',
        mockPromptWorkspace,
        ExtensionSettingScope.WORKSPACE,
      );

      // Get merged contents
      const contents = await getEnvContents('test-extension', tempDir);

      const sharedSetting = contents.find((s) => s.name === 'Shared Setting');
      expect(sharedSetting?.value).toBe('workspace-value');

      // Clean up
      await fs.promises.rm(workspaceRoot, { recursive: true, force: true });
    });

    it('should list settings for specific scope', async () => {
      const manifestPath = path.join(tempDir, 'llxprt-extension.json');
      const manifest = {
        name: 'test-extension',
        version: '1.0.0',
        settings: [
          {
            name: 'Setting',
            envVar: 'SETTING',
            sensitive: false,
          },
        ],
      };

      await fs.promises.writeFile(
        manifestPath,
        JSON.stringify(manifest),
        'utf-8',
      );

      // Set user-level setting
      const mockPromptUser = vi.fn().mockResolvedValue('user-value');
      await updateSetting(
        'test-extension',
        tempDir,
        'Setting',
        mockPromptUser,
        ExtensionSettingScope.USER,
      );

      // Get user scope contents
      const userContents = await getEnvContents(
        'test-extension',
        tempDir,
        ExtensionSettingScope.USER,
      );

      expect(userContents).toHaveLength(1);
      expect(userContents[0].value).toBe('user-value');
    });
  });

  describe('workspace identity stability', () => {
    it('should resolve workspace settings path from repo root, not cwd', async () => {
      const manifestPath = path.join(tempDir, 'llxprt-extension.json');
      const manifest = {
        name: 'test-extension',
        version: '1.0.0',
        settings: [
          {
            name: 'Workspace Setting',
            envVar: 'WORKSPACE_SETTING',
            sensitive: false,
          },
        ],
      };

      await fs.promises.writeFile(
        manifestPath,
        JSON.stringify(manifest),
        'utf-8',
      );

      // Use a separate temp dir as the mock repo root (must be writable)
      const mockRepoRoot = await fs.promises.mkdtemp(
        path.join(os.tmpdir(), 'llxprt-mock-repo-'),
      );

      // Mock getWorkspaceIdentity to return the mock repo root
      vi.mocked(getWorkspaceIdentity).mockReturnValue(mockRepoRoot);

      const mockPrompt = vi.fn().mockResolvedValue('workspace-value');
      await updateSetting(
        'test-extension',
        tempDir,
        'Workspace Setting',
        mockPrompt,
        ExtensionSettingScope.WORKSPACE,
      );

      // The workspace .env should be in the repo root, not process.cwd()
      const expectedPath = path.join(
        mockRepoRoot,
        '.llxprt',
        'extensions',
        'test-extension',
        '.env',
      );

      // Verify the settings file was written to the mock repo root
      expect(fs.existsSync(expectedPath)).toBe(true);

      // Cleanup
      await fs.promises.rm(mockRepoRoot, { recursive: true, force: true });
    });

    it('should use same keychain service from any subdirectory', async () => {
      const manifestPath = path.join(tempDir, 'llxprt-extension.json');
      const manifest = {
        name: 'test-extension',
        version: '1.0.0',
        settings: [
          {
            name: 'Secret',
            envVar: 'SECRET',
            sensitive: true,
          },
        ],
      };

      await fs.promises.writeFile(
        manifestPath,
        JSON.stringify(manifest),
        'utf-8',
      );

      const mockRepoRoot = '/Users/test/repo';
      vi.doMock('./../../utils/gitUtils.js', () => ({
        getWorkspaceIdentity: vi.fn(() => mockRepoRoot),
      }));

      // Import getKeychainServiceName to test
      const { getKeychainServiceName } = await import('./settingsStorage.js');

      // Current implementation will produce different service names from different cwds
      // Expected: same service name regardless of subdirectory
      const serviceName1 = getKeychainServiceName(
        'test-extension',
        path.join(mockRepoRoot, '.llxprt', 'extensions', 'test-extension'),
      );

      // Simulate from subdirectory
      const serviceName2 = getKeychainServiceName(
        'test-extension',
        path.join(
          mockRepoRoot,
          'packages',
          'cli',
          '.llxprt',
          'extensions',
          'test-extension',
        ),
      );

      // This will fail because current implementation hashes process.cwd() directly
      expect(serviceName1).toBe(serviceName2);
    });
  });

  describe('resolveExtensionSettingsWithSource', () => {
    it('should return user source when only user scope has value', async () => {
      // Create manifest
      const manifestPath = path.join(tempDir, 'llxprt-extension.json');
      const manifest = {
        name: 'test-ext',
        version: '1.0.0',
        settings: [
          {
            name: 'API Key',
            envVar: 'API_KEY',
            sensitive: false,
          },
        ] as ExtensionSetting[],
      };

      await fs.promises.writeFile(
        manifestPath,
        JSON.stringify(manifest),
        'utf-8',
      );

      // Create user .env file
      const envPath = path.join(tempDir, '.env');
      await fs.promises.writeFile(envPath, 'API_KEY=user-value\n', 'utf-8');

      const { resolveExtensionSettingsWithSource } = await import(
        '../extension.js'
      );

      const resolved = await resolveExtensionSettingsWithSource(
        'test-ext',
        tempDir,
        manifest.settings,
      );

      expect(resolved).toHaveLength(1);
      expect(resolved[0]).toStrictEqual({
        name: 'API Key',
        envVar: 'API_KEY',
        value: 'user-value',
        description: undefined,
        sensitive: false,
        source: 'user',
      });
    });

    it('should return workspace source when workspace overrides user', async () => {
      vi.mocked(getWorkspaceIdentity).mockReturnValue(tempDir);

      // Create manifest
      const manifestPath = path.join(tempDir, 'llxprt-extension.json');
      const manifest = {
        name: 'test-ext',
        version: '1.0.0',
        settings: [
          {
            name: 'API Key',
            envVar: 'API_KEY',
            sensitive: false,
          },
        ] as ExtensionSetting[],
      };

      await fs.promises.writeFile(
        manifestPath,
        JSON.stringify(manifest),
        'utf-8',
      );

      // Create user .env file
      const userEnvPath = path.join(tempDir, '.env');
      await fs.promises.writeFile(userEnvPath, 'API_KEY=user-value\n', 'utf-8');

      // Create workspace .env file
      const workspaceDir = path.join(
        tempDir,
        '.llxprt',
        'extensions',
        'test-ext',
      );
      await fs.promises.mkdir(workspaceDir, { recursive: true });
      const workspaceEnvPath = path.join(workspaceDir, '.env');
      await fs.promises.writeFile(
        workspaceEnvPath,
        'API_KEY=workspace-value\n',
        'utf-8',
      );

      const { resolveExtensionSettingsWithSource } = await import(
        '../extension.js'
      );

      const resolved = await resolveExtensionSettingsWithSource(
        'test-ext',
        tempDir,
        manifest.settings,
      );

      expect(resolved).toHaveLength(1);
      expect(resolved[0]).toStrictEqual({
        name: 'API Key',
        envVar: 'API_KEY',
        value: 'workspace-value',
        description: undefined,
        sensitive: false,
        source: 'workspace',
      });
    });

    it('should return default source when no value is set', async () => {
      // Create manifest
      const manifestPath = path.join(tempDir, 'llxprt-extension.json');
      const manifest = {
        name: 'test-ext',
        version: '1.0.0',
        settings: [
          {
            name: 'API Key',
            envVar: 'API_KEY',
            sensitive: false,
          },
        ] as ExtensionSetting[],
      };

      await fs.promises.writeFile(
        manifestPath,
        JSON.stringify(manifest),
        'utf-8',
      );

      const { resolveExtensionSettingsWithSource } = await import(
        '../extension.js'
      );

      const resolved = await resolveExtensionSettingsWithSource(
        'test-ext',
        tempDir,
        manifest.settings,
      );

      expect(resolved).toHaveLength(1);
      expect(resolved[0]).toStrictEqual({
        name: 'API Key',
        envVar: 'API_KEY',
        value: '[not set]',
        description: undefined,
        sensitive: false,
        source: 'default',
      });
    });

    it('should mask sensitive values and report default source when not set', async () => {
      // Create manifest
      const manifestPath = path.join(tempDir, 'llxprt-extension.json');
      const manifest = {
        name: 'test-ext',
        version: '1.0.0',
        settings: [
          {
            name: 'Secret',
            envVar: 'SECRET',
            sensitive: true,
          },
        ] as ExtensionSetting[],
      };

      await fs.promises.writeFile(
        manifestPath,
        JSON.stringify(manifest),
        'utf-8',
      );

      const { resolveExtensionSettingsWithSource } = await import(
        '../extension.js'
      );

      const resolved = await resolveExtensionSettingsWithSource(
        'test-ext',
        tempDir,
        manifest.settings,
      );

      expect(resolved).toHaveLength(1);
      expect(resolved[0]).toStrictEqual({
        name: 'Secret',
        envVar: 'SECRET',
        value: '[not set]',
        description: undefined,
        sensitive: true,
        source: 'default',
      });
    });

    it('should return empty array when no settings', async () => {
      const { resolveExtensionSettingsWithSource } = await import(
        '../extension.js'
      );

      const resolved = await resolveExtensionSettingsWithSource(
        'test-ext',
        tempDir,
        [],
      );

      expect(resolved).toStrictEqual([]);
    });
  });
});
