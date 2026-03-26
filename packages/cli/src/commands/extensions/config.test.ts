/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

import { configCommand } from './config.js';
import yargs from 'yargs';
import type * as settingsIntegrationModule from '../../config/extensions/settingsIntegration.js';
import type * as utilsModule from './utils.js';
import type * as extensionModule from '../../config/extension.js';
import type * as settingsModule from './settings.js';
import type { GeminiCLIExtension } from '@vybestack/llxprt-code-core';
import type { ExtensionSetting } from '../../config/extensions/extensionSettings.js';

const mockUpdateSetting: Mock<typeof settingsIntegrationModule.updateSetting> =
  vi.hoisted(() => vi.fn());
const mockGetScopedEnvContents: Mock<
  typeof settingsIntegrationModule.getScopedEnvContents
> = vi.hoisted(() => vi.fn());
const mockLoadExtensionSettingsFromManifest: Mock<
  typeof settingsIntegrationModule.loadExtensionSettingsFromManifest
> = vi.hoisted(() => vi.fn());
const mockGetExtensionAndConfig: Mock<
  typeof utilsModule.getExtensionAndConfig
> = vi.hoisted(() => vi.fn());
const mockLoadUserExtensions: Mock<typeof extensionModule.loadUserExtensions> =
  vi.hoisted(() => vi.fn());
const mockLoadExtensionConfig: Mock<
  typeof extensionModule.loadExtensionConfig
> = vi.hoisted(() => vi.fn());
const mockPromptForSetting: Mock<typeof settingsModule.promptForSetting> =
  vi.hoisted(() => vi.fn());
const mockConfirmOverwrite: Mock = vi.hoisted(() => vi.fn());
const mockLoadSettings: Mock = vi.hoisted(() => vi.fn());

// Mock readline module to control confirmOverwrite
vi.mock('node:readline', () => ({
  createInterface: vi.fn(() => ({
    question: vi.fn((prompt: string, callback: (answer: string) => void) => {
      // Call the mocked confirmOverwrite function and resolve based on its return value
      const shouldOverwrite = mockConfirmOverwrite(
        prompt.includes('API Key')
          ? 'API Key'
          : prompt.includes('Database URL')
            ? 'Database URL'
            : 'unknown',
      );
      callback(shouldOverwrite ? 'y' : 'n');
    }),
    close: vi.fn(),
  })),
}));

vi.mock('../../config/extensions/settingsIntegration.js', async () => {
  const actual = await vi.importActual<typeof settingsIntegrationModule>(
    '../../config/extensions/settingsIntegration.js',
  );
  return {
    updateSetting: mockUpdateSetting,
    getScopedEnvContents: mockGetScopedEnvContents,
    loadExtensionSettingsFromManifest: mockLoadExtensionSettingsFromManifest,
    ExtensionSettingScope: actual.ExtensionSettingScope,
  };
});

vi.mock('./utils.js', () => ({
  getExtensionAndConfig: mockGetExtensionAndConfig,
}));

vi.mock('../../config/extension.js', async () => {
  const actual = await vi.importActual<typeof extensionModule>(
    '../../config/extension.js',
  );
  return {
    ...actual,
    loadUserExtensions: mockLoadUserExtensions,
    loadExtensionConfig: mockLoadExtensionConfig,
  };
});

vi.mock('./settings.js', () => ({
  promptForSetting: mockPromptForSetting,
}));

vi.mock('../utils.js', () => ({
  exitCli: vi.fn(),
}));

vi.mock('./utils.js', () => ({
  getExtensionAndConfig: mockGetExtensionAndConfig,
}));

vi.mock('../../config/extension.js', async () => {
  const actual = await vi.importActual<typeof extensionModule>(
    '../../config/extension.js',
  );
  return {
    ...actual,
    loadUserExtensions: mockLoadUserExtensions,
    loadExtensionConfig: mockLoadExtensionConfig,
  };
});

vi.mock('./settings.js', () => ({
  promptForSetting: mockPromptForSetting,
}));

vi.mock('../utils.js', () => ({
  exitCli: vi.fn(),
}));

vi.mock('../../config/settings.js', () => ({
  loadSettings: mockLoadSettings,
}));

// Mock confirmOverwrite in the config module
vi.mock('./config.js', async () => {
  const actual = await vi.importActual('./config.js');
  return {
    ...actual,
    confirmOverwrite: mockConfirmOverwrite,
  };
});

describe('extensions config command', () => {
  beforeEach(() => {
    vi.resetAllMocks();

    // Default mock setup
    mockGetExtensionAndConfig.mockResolvedValue({
      extension: {
        name: 'test-ext',
        path: '/path/to/extension',
      } as GeminiCLIExtension,
      extensionConfig: {
        name: 'test-ext',
        version: '1.0.0',
      },
    });

    mockUpdateSetting.mockResolvedValue(true);
    mockGetScopedEnvContents.mockResolvedValue({});
    mockLoadExtensionSettingsFromManifest.mockReturnValue([]);
    mockPromptForSetting.mockResolvedValue('test-value');
    mockConfirmOverwrite.mockResolvedValue(true);
    mockLoadUserExtensions.mockReturnValue([]);
    mockLoadExtensionConfig.mockResolvedValue({
      name: 'test-ext',
      version: '1.0.0',
    });
    // Default: extensionConfig enabled so existing tests pass
    mockLoadSettings.mockReturnValue({
      merged: {
        experimental: {
          extensionConfig: true,
        },
      },
    });
  });

  describe('specific setting mode', () => {
    it('should call updateSetting for specific setting', async () => {
      const parser = yargs([]).command(configCommand).fail(false);
      await parser.parseAsync('config test-ext TEST_VAR');

      expect(mockGetExtensionAndConfig).toHaveBeenCalledWith('test-ext');
      expect(mockUpdateSetting).toHaveBeenCalledWith(
        'test-ext',
        '/path/to/extension',
        'TEST_VAR',
        expect.any(Function),
        'user',
      );
    });

    it('should use workspace scope when specified', async () => {
      const parser = yargs([]).command(configCommand).fail(false);
      await parser.parseAsync('config test-ext TEST_VAR --scope workspace');

      expect(mockUpdateSetting).toHaveBeenCalledWith(
        'test-ext',
        '/path/to/extension',
        'TEST_VAR',
        expect.any(Function),
        'workspace',
      );
    });

    it('should not call updateSetting when extension is missing', async () => {
      mockGetExtensionAndConfig.mockResolvedValue({
        extension: null,
        extensionConfig: null,
      });

      const parser = yargs([]).command(configCommand).fail(false);
      await parser.parseAsync('config nonexistent TEST_VAR');

      expect(mockUpdateSetting).not.toHaveBeenCalled();
    });

    it('should not call updateSetting when extension config is missing', async () => {
      mockGetExtensionAndConfig.mockResolvedValue({
        extension: {
          name: 'test-ext',
          path: '/path/to/extension',
        } as GeminiCLIExtension,
        extensionConfig: null,
      });

      const parser = yargs([]).command(configCommand).fail(false);
      await parser.parseAsync('config test-ext TEST_VAR');

      expect(mockUpdateSetting).not.toHaveBeenCalled();
    });
  });

  describe('all settings mode', () => {
    it('should configure all settings for an extension', async () => {
      const mockSettings: ExtensionSetting[] = [
        {
          name: 'API Key',
          envVar: 'API_KEY',
          description: 'Your API key',
          sensitive: true,
        },
        {
          name: 'Database URL',
          envVar: 'DATABASE_URL',
          description: 'Database connection string',
          sensitive: false,
        },
      ];

      mockLoadExtensionSettingsFromManifest.mockReturnValue(mockSettings);
      mockGetScopedEnvContents.mockResolvedValue({});

      const parser = yargs([]).command(configCommand).fail(false);
      await parser.parseAsync('config test-ext');

      expect(mockLoadExtensionSettingsFromManifest).toHaveBeenCalledWith(
        '/path/to/extension',
      );
      expect(mockUpdateSetting).toHaveBeenCalledTimes(2);
      expect(mockUpdateSetting).toHaveBeenCalledWith(
        'test-ext',
        '/path/to/extension',
        'API_KEY',
        expect.any(Function),
        'user',
      );
      expect(mockUpdateSetting).toHaveBeenCalledWith(
        'test-ext',
        '/path/to/extension',
        'DATABASE_URL',
        expect.any(Function),
        'user',
      );
    });

    it('should handle extension with no settings', async () => {
      mockLoadExtensionSettingsFromManifest.mockReturnValue([]);

      const parser = yargs([]).command(configCommand).fail(false);
      await parser.parseAsync('config test-ext');

      expect(mockLoadExtensionSettingsFromManifest).toHaveBeenCalledWith(
        '/path/to/extension',
      );
      expect(mockUpdateSetting).not.toHaveBeenCalled();
    });

    it('should prompt for overwrite when setting already exists', async () => {
      const mockSettings: ExtensionSetting[] = [
        {
          name: 'API Key',
          envVar: 'API_KEY',
          sensitive: true,
        },
      ];

      mockLoadExtensionSettingsFromManifest.mockReturnValue(mockSettings);
      mockGetScopedEnvContents.mockResolvedValue({
        API_KEY: 'existing-value',
      });
      mockConfirmOverwrite.mockResolvedValue(true);

      const parser = yargs([]).command(configCommand).fail(false);
      await parser.parseAsync('config test-ext');

      expect(mockConfirmOverwrite).toHaveBeenCalledWith('API Key');
      expect(mockUpdateSetting).toHaveBeenCalledTimes(1);
    });

    it('should skip setting when user declines overwrite', async () => {
      const mockSettings: ExtensionSetting[] = [
        {
          name: 'API Key',
          envVar: 'API_KEY',
          sensitive: true,
        },
        {
          name: 'Database URL',
          envVar: 'DATABASE_URL',
          sensitive: false,
        },
      ];

      mockLoadExtensionSettingsFromManifest.mockReturnValue(mockSettings);
      mockGetScopedEnvContents.mockResolvedValue({
        API_KEY: 'existing-value',
        DATABASE_URL: 'existing-db',
      });
      // Decline both overwrites
      mockConfirmOverwrite.mockReturnValue(false);

      const parser = yargs([]).command(configCommand).fail(false);
      await parser.parseAsync('config test-ext');

      expect(mockConfirmOverwrite).toHaveBeenCalledWith('API Key');
      expect(mockConfirmOverwrite).toHaveBeenCalledWith('Database URL');
      // Should not call updateSetting for either setting
      expect(mockUpdateSetting).not.toHaveBeenCalled();
    });

    it('should show advisory when workspace value exists for user scope', async () => {
      const mockSettings: ExtensionSetting[] = [
        {
          name: 'API Key',
          envVar: 'API_KEY',
          sensitive: true,
        },
      ];

      mockLoadExtensionSettingsFromManifest.mockReturnValue(mockSettings);
      // First call for user scope (empty), second call for workspace scope (has value)
      mockGetScopedEnvContents
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ API_KEY: 'workspace-value' });

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const parser = yargs([]).command(configCommand).fail(false);
      await parser.parseAsync('config test-ext --scope user');

      expect(mockGetScopedEnvContents).toHaveBeenCalledTimes(2);
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('workspace value'),
      );

      consoleSpy.mockRestore();
    });
  });

  describe('all extensions mode', () => {
    it('should configure all installed extensions', async () => {
      const mockExtensions: GeminiCLIExtension[] = [
        { name: 'ext1', path: '/path/to/ext1' } as GeminiCLIExtension,
        { name: 'ext2', path: '/path/to/ext2' } as GeminiCLIExtension,
      ];

      mockLoadUserExtensions.mockReturnValue(mockExtensions);
      mockLoadExtensionConfig
        .mockResolvedValueOnce({ name: 'ext1', version: '1.0.0' })
        .mockResolvedValueOnce({ name: 'ext2', version: '1.0.0' });
      mockLoadExtensionSettingsFromManifest.mockReturnValue([]);

      const parser = yargs([]).command(configCommand).fail(false);
      await parser.parseAsync('config');

      expect(mockLoadUserExtensions).toHaveBeenCalled();
      expect(mockLoadExtensionConfig).toHaveBeenCalledTimes(2);
      expect(mockLoadExtensionConfig).toHaveBeenCalledWith({
        extensionDir: '/path/to/ext1',
        workspaceDir: expect.any(String),
      });
      expect(mockLoadExtensionConfig).toHaveBeenCalledWith({
        extensionDir: '/path/to/ext2',
        workspaceDir: expect.any(String),
      });
    });

    it('should handle no installed extensions', async () => {
      mockLoadUserExtensions.mockReturnValue([]);

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const parser = yargs([]).command(configCommand).fail(false);
      await parser.parseAsync('config');

      expect(mockLoadUserExtensions).toHaveBeenCalled();
      expect(mockLoadExtensionConfig).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith('No extensions installed.');

      consoleSpy.mockRestore();
    });

    it('should continue on error and configure remaining extensions', async () => {
      const mockExtensions: GeminiCLIExtension[] = [
        { name: 'ext1', path: '/path/to/ext1' } as GeminiCLIExtension,
        { name: 'ext2', path: '/path/to/ext2' } as GeminiCLIExtension,
        { name: 'ext3', path: '/path/to/ext3' } as GeminiCLIExtension,
      ];

      mockLoadUserExtensions.mockReturnValue(mockExtensions);
      mockLoadExtensionConfig
        .mockResolvedValueOnce({ name: 'ext1', version: '1.0.0' })
        .mockResolvedValueOnce(null) // ext2 fails to load
        .mockResolvedValueOnce({ name: 'ext3', version: '1.0.0' });
      mockLoadExtensionSettingsFromManifest.mockReturnValue([]);

      const consoleErrorSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      const parser = yargs([]).command(configCommand).fail(false);
      await parser.parseAsync('config');

      expect(mockLoadExtensionConfig).toHaveBeenCalledTimes(3);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('ext2'),
      );

      consoleErrorSpy.mockRestore();
    });

    it('should exit with non-zero code when any extension fails', async () => {
      const mockExtensions: GeminiCLIExtension[] = [
        { name: 'ext1', path: '/path/to/ext1' } as GeminiCLIExtension,
        { name: 'ext2', path: '/path/to/ext2' } as GeminiCLIExtension,
      ];

      mockLoadUserExtensions.mockReturnValue(mockExtensions);
      mockLoadExtensionConfig
        .mockResolvedValueOnce({ name: 'ext1', version: '1.0.0' })
        .mockResolvedValueOnce(null); // ext2 fails
      mockLoadExtensionSettingsFromManifest.mockReturnValue([]);

      const consoleErrorSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});
      const originalExitCode = process.exitCode;

      const parser = yargs([]).command(configCommand).fail(false);
      await parser.parseAsync('config');

      expect(process.exitCode).toBe(1);

      // Cleanup
      process.exitCode = originalExitCode;
      consoleErrorSpy.mockRestore();
    });
  });

  describe('extensionConfig gate', () => {
    it('should show error and exit when experimental.extensionConfig is false', async () => {
      mockLoadSettings.mockReturnValue({
        merged: {
          experimental: {
            extensionConfig: false,
          },
        },
      });

      const consoleErrorSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      const parser = yargs([]).command(configCommand).fail(false);
      await parser.parseAsync('config test-ext TEST_VAR');

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'Extension configuration is currently disabled',
        ),
      );
      expect(mockGetExtensionAndConfig).not.toHaveBeenCalled();
      expect(mockUpdateSetting).not.toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });

    it('should show error and exit when experimental.extensionConfig is not set', async () => {
      mockLoadSettings.mockReturnValue({
        merged: {},
      });

      const consoleErrorSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      const parser = yargs([]).command(configCommand).fail(false);
      await parser.parseAsync('config test-ext');

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'Extension configuration is currently disabled',
        ),
      );
      expect(mockGetExtensionAndConfig).not.toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });

    it('should proceed when experimental.extensionConfig is true', async () => {
      mockLoadSettings.mockReturnValue({
        merged: {
          experimental: {
            extensionConfig: true,
          },
        },
      });

      const parser = yargs([]).command(configCommand).fail(false);
      await parser.parseAsync('config test-ext TEST_VAR');

      expect(mockGetExtensionAndConfig).toHaveBeenCalledWith('test-ext');
      expect(mockUpdateSetting).toHaveBeenCalled();
    });
  });
});
