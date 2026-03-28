/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

import { setCommand, listCommand } from './settings.js';
import yargs from 'yargs';
import type * as settingsIntegrationModule from '../../config/extensions/settingsIntegration.js';
import type * as utilsModule from './utils.js';
import type { GeminiCLIExtension } from '@vybestack/llxprt-code-core';

const mockUpdateSetting: Mock<typeof settingsIntegrationModule.updateSetting> =
  vi.hoisted(() => vi.fn());
const mockGetEnvContents: Mock<
  typeof settingsIntegrationModule.getEnvContents
> = vi.hoisted(() => vi.fn());
const mockGetExtensionAndConfig: Mock<
  typeof utilsModule.getExtensionAndConfig
> = vi.hoisted(() => vi.fn());
const mockLoadSettings: Mock = vi.hoisted(() => vi.fn());

vi.mock('../../config/extensions/settingsIntegration.js', async () => ({
  updateSetting: mockUpdateSetting,
  getEnvContents: mockGetEnvContents,
  ExtensionSettingScope: {
    USER: 'user',
    WORKSPACE: 'workspace',
  },
}));

vi.mock('./utils.js', () => ({
  getExtensionAndConfig: mockGetExtensionAndConfig,
}));

vi.mock('../utils.js', () => ({
  exitCli: vi.fn(),
}));

vi.mock('../../config/settings.js', () => ({
  loadSettings: mockLoadSettings,
}));

describe('extensions settings set command', () => {
  beforeEach(() => {
    vi.resetAllMocks();

    // Default: extensionConfig enabled so existing tests pass
    mockLoadSettings.mockReturnValue({
      merged: {
        experimental: {
          extensionConfig: true,
        },
      },
    });

    // Default mock setup - extension and config exist
    mockGetExtensionAndConfig.mockResolvedValue({
      extension: {
        name: 'myext',
        path: '/path/to/extension',
      } as GeminiCLIExtension,
      extensionConfig: {
        name: 'myext',
        version: '1.0.0',
      },
    });

    mockUpdateSetting.mockResolvedValue(true);
  });

  it('should call updateSetting with correct scope and args', async () => {
    const parser = yargs([]).command(setCommand).fail(false);
    await parser.parseAsync('set myext API_KEY --scope user');

    expect(mockGetExtensionAndConfig).toHaveBeenCalledWith('myext');
    expect(mockUpdateSetting).toHaveBeenCalledWith(
      'myext',
      '/path/to/extension',
      'API_KEY',
      expect.any(Function),
      'user',
    );
  });

  it('should default scope to user when not specified', async () => {
    const parser = yargs([]).command(setCommand).fail(false);
    await parser.parseAsync('set myext DATABASE_URL');

    expect(mockUpdateSetting).toHaveBeenCalledWith(
      'myext',
      '/path/to/extension',
      'DATABASE_URL',
      expect.any(Function),
      'user',
    );
  });

  it('should support workspace scope', async () => {
    const parser = yargs([]).command(setCommand).fail(false);
    await parser.parseAsync('set myext SECRET_KEY --scope workspace');

    expect(mockUpdateSetting).toHaveBeenCalledWith(
      'myext',
      '/path/to/extension',
      'SECRET_KEY',
      expect.any(Function),
      'workspace',
    );
  });

  it('should handle missing extension gracefully', async () => {
    mockGetExtensionAndConfig.mockResolvedValue({
      extension: null,
      extensionConfig: null,
    });

    const parser = yargs([]).command(setCommand).fail(false);
    await parser.parseAsync('set nonexistent API_KEY');

    // Should not call updateSetting if extension is not found
    expect(mockUpdateSetting).not.toHaveBeenCalled();
  });

  it('should handle missing extension config gracefully', async () => {
    mockGetExtensionAndConfig.mockResolvedValue({
      extension: {
        name: 'myext',
        path: '/path/to/extension',
      } as GeminiCLIExtension,
      extensionConfig: null,
    });

    const parser = yargs([]).command(setCommand).fail(false);
    await parser.parseAsync('set myext API_KEY');

    // Should not call updateSetting if extension config is not loaded
    expect(mockUpdateSetting).not.toHaveBeenCalled();
  });
});

describe('extensions settings list command', () => {
  beforeEach(() => {
    vi.resetAllMocks();

    // Default: extensionConfig enabled so existing tests pass
    mockLoadSettings.mockReturnValue({
      merged: {
        experimental: {
          extensionConfig: true,
        },
      },
    });

    // Default mock setup - extension and config exist
    mockGetExtensionAndConfig.mockResolvedValue({
      extension: {
        name: 'myext',
        path: '/path/to/extension',
      } as GeminiCLIExtension,
      extensionConfig: {
        name: 'myext',
        version: '1.0.0',
      },
    });

    mockGetEnvContents.mockResolvedValue([
      { name: 'API_KEY', value: '[not set]' },
      { name: 'DATABASE_URL', value: 'postgres://localhost' },
    ]);
  });

  it('should call getEnvContents for specified extension', async () => {
    const parser = yargs([]).command(listCommand).fail(false);
    await parser.parseAsync('list myext');

    expect(mockGetExtensionAndConfig).toHaveBeenCalledWith('myext');
    expect(mockGetEnvContents).toHaveBeenCalledWith(
      'myext',
      '/path/to/extension',
      undefined,
    );
  });

  it('should pass user scope filter when specified', async () => {
    const parser = yargs([]).command(listCommand).fail(false);
    await parser.parseAsync('list myext --scope user');

    expect(mockGetEnvContents).toHaveBeenCalledWith(
      'myext',
      '/path/to/extension',
      'user',
    );
  });

  it('should pass workspace scope filter when specified', async () => {
    const parser = yargs([]).command(listCommand).fail(false);
    await parser.parseAsync('list myext --scope workspace');

    expect(mockGetEnvContents).toHaveBeenCalledWith(
      'myext',
      '/path/to/extension',
      'workspace',
    );
  });

  it('should handle extension with no settings without crashing', async () => {
    mockGetEnvContents.mockResolvedValue([]);

    const parser = yargs([]).command(listCommand).fail(false);
    await parser.parseAsync('list myext');

    expect(mockGetEnvContents).toHaveBeenCalledWith(
      'myext',
      '/path/to/extension',
      undefined,
    );
  });

  it('should handle missing extension gracefully', async () => {
    mockGetExtensionAndConfig.mockResolvedValue({
      extension: null,
      extensionConfig: null,
    });

    const parser = yargs([]).command(listCommand).fail(false);
    await parser.parseAsync('list nonexistent');

    // Should not call getEnvContents if extension is not found
    expect(mockGetEnvContents).not.toHaveBeenCalled();
  });

  it('should handle missing extension config gracefully', async () => {
    mockGetExtensionAndConfig.mockResolvedValue({
      extension: {
        name: 'myext',
        path: '/path/to/extension',
      } as GeminiCLIExtension,
      extensionConfig: null,
    });

    const parser = yargs([]).command(listCommand).fail(false);
    await parser.parseAsync('list myext');

    // Should not call getEnvContents if extension config is not loaded
    expect(mockGetEnvContents).not.toHaveBeenCalled();
  });
});

describe('extensionConfig gate (settings)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should block set when experimental.extensionConfig is false', async () => {
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

    const parser = yargs([]).command(setCommand).fail(false);
    await parser.parseAsync('set myext API_KEY');

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Extension configuration is currently disabled'),
    );
    expect(mockGetExtensionAndConfig).not.toHaveBeenCalled();
    expect(mockUpdateSetting).not.toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });

  it('should block set when experimental.extensionConfig is not set', async () => {
    mockLoadSettings.mockReturnValue({
      merged: {},
    });

    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    const originalExitCode = process.exitCode;

    const parser = yargs([]).command(setCommand).fail(false);
    await parser.parseAsync('set myext API_KEY');

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Extension configuration is currently disabled'),
    );
    expect(mockGetExtensionAndConfig).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);

    process.exitCode = originalExitCode;
    consoleErrorSpy.mockRestore();
  });

  it('should block list when experimental.extensionConfig is false', async () => {
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

    const parser = yargs([]).command(listCommand).fail(false);
    await parser.parseAsync('list myext');

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Extension configuration is currently disabled'),
    );
    expect(mockGetExtensionAndConfig).not.toHaveBeenCalled();
    expect(mockGetEnvContents).not.toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });

  it('should allow set when experimental.extensionConfig is true', async () => {
    mockLoadSettings.mockReturnValue({
      merged: {
        experimental: {
          extensionConfig: true,
        },
      },
    });

    mockGetExtensionAndConfig.mockResolvedValue({
      extension: {
        name: 'myext',
        path: '/path/to/extension',
      } as GeminiCLIExtension,
      extensionConfig: {
        name: 'myext',
        version: '1.0.0',
      },
    });
    mockUpdateSetting.mockResolvedValue(true);

    const parser = yargs([]).command(setCommand).fail(false);
    await parser.parseAsync('set myext API_KEY');

    expect(mockGetExtensionAndConfig).toHaveBeenCalledWith('myext');
    expect(mockUpdateSetting).toHaveBeenCalled();
  });

  it('should allow list when experimental.extensionConfig is true', async () => {
    mockLoadSettings.mockReturnValue({
      merged: {
        experimental: {
          extensionConfig: true,
        },
      },
    });

    mockGetExtensionAndConfig.mockResolvedValue({
      extension: {
        name: 'myext',
        path: '/path/to/extension',
      } as GeminiCLIExtension,
      extensionConfig: {
        name: 'myext',
        version: '1.0.0',
      },
    });
    mockGetEnvContents.mockResolvedValue([]);

    const parser = yargs([]).command(listCommand).fail(false);
    await parser.parseAsync('list myext');

    expect(mockGetExtensionAndConfig).toHaveBeenCalledWith('myext');
    expect(mockGetEnvContents).toHaveBeenCalled();
  });
});
