/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/// <reference types="vitest/globals" />

// Mock 'os' first.
import * as osActual from 'os';
import path, * as pathActual from 'node:path'; // Import for type info for the mock factory
vi.mock('os', async (importOriginal) => {
  const actualOs = await importOriginal<typeof osActual>();
  return {
    ...actualOs,
    homedir: vi.fn(() => '/mock/home/user'),
    platform: vi.fn(() => 'linux'),
  };
});

// Mock './settings.js' to ensure it uses the mocked 'os.homedir()' for its internal constants.
vi.mock('./settings.js', async (importActual) => {
  const originalModule = await importActual<typeof import('./settings.js')>();
  return {
    __esModule: true, // Ensure correct module shape
    ...originalModule, // Re-export all original members
    // We are relying on originalModule's USER_SETTINGS_PATH being constructed with mocked os.homedir()
  };
});

// Mock trustedFolders
vi.mock('./trustedFolders.js', () => ({
  isWorkspaceTrusted: vi.fn(),
  isFolderTrustEnabled: vi.fn(),
}));

// NOW import everything else, including the (now effectively re-exported) settings.js
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mocked,
  type Mock,
} from 'vitest';
import * as fs from 'fs'; // fs will be mocked separately
import stripJsonComments from 'strip-json-comments'; // Will be mocked separately
import { isWorkspaceTrusted, isFolderTrustEnabled } from './trustedFolders.js';

// These imports will get the versions from the vi.mock('./settings.js', ...) factory.
import {
  type SettingsFile,
  loadSettings,
  saveSettings,
  USER_SETTINGS_PATH,
  SettingScope,
  getSystemDefaultsPath,
  loadEnvironment,
  SETTINGS_DIRECTORY_NAME,
  getSystemSettingsPath,
} from './settings.js';

import { LLXPRT_DIR } from '@vybestack/llxprt-code-storage';
import { FatalConfigError } from '@vybestack/llxprt-code-core';

type DynamicSettings = Record<string, unknown>;
type DynamicLoadedSettings = {
  system: { settings: DynamicSettings };
  user: { settings: DynamicSettings };
  workspace: { settings: DynamicSettings };
  merged: DynamicSettings;
};
const dynamicSettings = (settings: unknown): DynamicLoadedSettings =>
  settings as DynamicLoadedSettings;

const MOCK_WORKSPACE_DIR = '/mock/workspace';
// Use the (mocked) SETTINGS_DIRECTORY_NAME for consistency
const MOCK_WORKSPACE_SETTINGS_PATH = pathActual.join(
  MOCK_WORKSPACE_DIR,
  SETTINGS_DIRECTORY_NAME,
  'settings.json',
);

vi.mock('fs', async (importOriginal) => {
  // Get all the functions from the real 'fs' module
  const actualFs = await importOriginal<typeof fs>();

  return {
    ...actualFs, // Keep all the real functions
    // Now, just override the ones we need for the test
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    realpathSync: (p: string) => p,
  };
});

const mockCoreEvents = vi.hoisted(() => ({
  emitFeedback: vi.fn(),
  emitSettingsChanged: vi.fn(),
}));

vi.mock('@vybestack/llxprt-code-core', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@vybestack/llxprt-code-core')>();
  return {
    ...actual,
    coreEvents: mockCoreEvents,
  };
});

vi.mock('strip-json-comments', () => ({
  default: vi.fn((content) => content),
}));

describe('Settings Loading and Merging', () => {
  let mockFsExistsSync: Mocked<typeof fs.existsSync>;
  let mockStripJsonComments: Mocked<typeof stripJsonComments>;
  let mockFsMkdirSync: Mocked<typeof fs.mkdirSync>;

  beforeEach(() => {
    vi.resetAllMocks();

    // Set environment variables to override system paths
    process.env.LLXPRT_CODE_SYSTEM_SETTINGS_PATH = '/mock/system/settings.json';
    process.env.LLXPRT_CODE_SYSTEM_DEFAULTS_PATH =
      '/mock/system/system-defaults.json';

    mockFsExistsSync = vi.mocked(fs.existsSync);
    mockFsMkdirSync = vi.mocked(fs.mkdirSync);
    mockStripJsonComments = vi.mocked(stripJsonComments);

    vi.mocked(osActual.homedir).mockReturnValue('/mock/home/user');
    (mockStripJsonComments as unknown as Mock).mockImplementation(
      (jsonString: string) => jsonString,
    );
    (mockFsExistsSync as Mock).mockReturnValue(false);
    (fs.readFileSync as Mock).mockImplementation(
      (p: fs.PathOrFileDescriptor) => {
        // Handle system paths specifically
        if (
          p === '/mock/system/settings.json' ||
          p === '/mock/system/system-defaults.json'
        ) {
          return '{}'; // Return valid empty JSON for system paths
        }
        // Always return valid empty JSON for any path to prevent JSON parsing errors
        // Individual tests can override this mock for specific paths they need
        return '{}';
      },
    );
    (mockFsMkdirSync as Mock).mockImplementation(
      (dir: string, _options?: unknown) => {
        // Mock implementation that validates directory creation
        if (!dir || typeof dir !== 'string') {
          throw new Error('Invalid directory path');
        }
        return dir; // Return the created directory path for verification
      },
    );
    vi.mocked(isWorkspaceTrusted).mockReturnValue(true);
    vi.mocked(isFolderTrustEnabled).mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // Clean up environment variables
    delete process.env.LLXPRT_CODE_SYSTEM_SETTINGS_PATH;
    delete process.env.LLXPRT_CODE_SYSTEM_DEFAULTS_PATH;
  });

  describe('Settings validation and error handling improvements', () => {
    it('should validate directory creation during setValue operations', () => {
      (mockFsExistsSync as Mock).mockReturnValue(false);
      const loadedSettings = loadSettings(MOCK_WORKSPACE_DIR);

      vi.mocked(fs.writeFileSync).mockImplementation(() => {});

      // Test that mkdirSync is called with proper parameters
      loadedSettings.setValue(SettingScope.User, 'theme', 'dark');

      expect(mockFsMkdirSync).toHaveBeenCalled();
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        USER_SETTINGS_PATH,
        JSON.stringify({ theme: 'dark' }, null, 2),
        'utf-8',
      );
    });

    it('should handle file system errors gracefully during directory creation', () => {
      (mockFsExistsSync as Mock).mockReturnValue(false);
      const loadedSettings = loadSettings(MOCK_WORKSPACE_DIR);

      // Mock mkdirSync to throw an error
      (mockFsMkdirSync as Mock).mockImplementation(() => {
        throw new Error('Permission denied');
      });

      vi.mocked(fs.writeFileSync).mockImplementation(() => {});

      // Should not throw but may handle error internally
      expect(() => {
        loadedSettings.setValue(SettingScope.User, 'theme', 'dark');
      }).not.toThrow();
    });

    it('should properly validate JSON structure in settings files', () => {
      (mockFsExistsSync as Mock).mockReturnValue(true);
      const complexSettingsContent = {
        theme: 'dark',
        mcpServers: {
          'test-server': {
            command: 'node',
            args: ['server.js'],
            env: {
              NODE_ENV: 'production',
              PORT: '3000',
            },
          },
        },
        customThemes: {
          'my-theme': {
            colors: {
              primary: '#007acc',
              secondary: '#6c757d',
            },
          },
        },
      };

      (fs.readFileSync as Mock).mockImplementation(
        (p: fs.PathOrFileDescriptor) => {
          if (p === USER_SETTINGS_PATH)
            return JSON.stringify(complexSettingsContent);
          return '{}';
        },
      );

      const settings = loadSettings(MOCK_WORKSPACE_DIR);
      const arbitrary = dynamicSettings(settings);

      expect(settings.user.settings).toStrictEqual(complexSettingsContent);
      expect(settings.merged.mcpServers).toHaveProperty('test-server');
      expect(arbitrary.merged.customThemes).toHaveProperty('my-theme');
      expect(settings.merged.mcpServers!['test-server'].env).toStrictEqual({
        NODE_ENV: 'production',
        PORT: '3000',
      });
    });

    it('should handle malformed JSON with detailed error information', () => {
      (mockFsExistsSync as Mock).mockReturnValue(true);
      const malformedJson = '{ "theme": "dark", "mcpServers": { "test": } }'; // Missing value

      (fs.readFileSync as Mock).mockImplementation(
        (p: fs.PathOrFileDescriptor) => {
          if (p === USER_SETTINGS_PATH) {
            return malformedJson;
          }
          return '{}';
        },
      );

      // Mock JSON.parse to throw a detailed error only for the malformed JSON
      const parseError = new SyntaxError(
        'Unexpected token } in JSON at position 42',
      );
      let _parseCallCount = 0;
      const originalParse = JSON.parse;
      vi.spyOn(JSON, 'parse').mockImplementation((text: string) => {
        _parseCallCount++;
        // Only throw on the specific malformed JSON content
        if (text === malformedJson) {
          throw parseError;
        }
        // Use original parse for other JSON calls
        return originalParse(text);
      });

      expect(() => loadSettings(MOCK_WORKSPACE_DIR)).toThrow(FatalConfigError);

      // Test the error message content
      let caughtError: FatalConfigError | null = null;
      try {
        loadSettings(MOCK_WORKSPACE_DIR);
      } catch (error) {
        caughtError = error as FatalConfigError;
      }

      expect(caughtError).toBeInstanceOf(FatalConfigError);
      expect(caughtError?.message).toContain(USER_SETTINGS_PATH);
      expect(caughtError?.message).toContain(parseError.message);

      vi.restoreAllMocks();
    });

    it('should validate environment variable resolution with complex scenarios', () => {
      process.env['MULTI_VALUE'] = 'part1:part2:part3';
      process.env['JSON_CONFIG'] = '{"key": "value", "number": 42}';
      process.env['EMPTY_VAR'] = '';

      const userSettingsContent = {
        complexPath: '${HOME}/configs/${MULTI_VALUE}/app.json',
        configData: '${JSON_CONFIG}',
        fallbackValue: '${EMPTY_VAR:-default_value}',
        multipleVars: 'user:${USER}@host:${HOST}:${PORT:-8080}',
      };

      // Set some additional env vars for testing
      process.env['HOME'] = '/home/testuser';
      process.env['USER'] = 'testuser';
      process.env['HOST'] = 'testhost';

      (mockFsExistsSync as Mock).mockImplementation(
        (p: fs.PathLike) => p === USER_SETTINGS_PATH,
      );
      (fs.readFileSync as Mock).mockImplementation(
        (p: fs.PathOrFileDescriptor) => {
          if (p === USER_SETTINGS_PATH)
            return JSON.stringify(userSettingsContent);
          return '{}';
        },
      );

      const arbitrary = dynamicSettings(loadSettings(MOCK_WORKSPACE_DIR));

      expect(arbitrary.user.settings.complexPath).toBe(
        '/home/testuser/configs/part1:part2:part3/app.json',
      );
      expect(arbitrary.user.settings.configData).toBe(
        '{"key": "value", "number": 42}',
      );
      expect(arbitrary.user.settings.fallbackValue).toBe(
        '${EMPTY_VAR:-default_value}',
      ); // Should not resolve bash-style fallbacks
      expect(arbitrary.user.settings.multipleVars).toBe(
        'user:testuser@host:testhost:${PORT:-8080}',
      );

      // Cleanup
      delete process.env['MULTI_VALUE'];
      delete process.env['JSON_CONFIG'];
      delete process.env['EMPTY_VAR'];
      delete process.env['HOME'];
      delete process.env['USER'];
      delete process.env['HOST'];
    });

    it('should properly merge arrays without overwriting in includeDirectories', () => {
      (mockFsExistsSync as Mock).mockReturnValue(true);
      const systemDefaultsContent = {
        includeDirectories: [
          '/system/defaults/common',
          '/system/defaults/shared',
        ],
      };
      const systemSettingsContent = {
        includeDirectories: ['/system/admin'],
      };
      const userSettingsContent = {
        includeDirectories: ['/home/user/projects', '/home/user/scripts'],
      };
      const workspaceSettingsContent = {
        includeDirectories: ['/workspace/src', '/workspace/tests'],
      };

      (fs.readFileSync as Mock).mockImplementation(
        (p: fs.PathOrFileDescriptor) => {
          if (p === getSystemDefaultsPath())
            return JSON.stringify(systemDefaultsContent);
          if (p === getSystemSettingsPath())
            return JSON.stringify(systemSettingsContent);
          if (p === USER_SETTINGS_PATH)
            return JSON.stringify(userSettingsContent);
          if (p === MOCK_WORKSPACE_SETTINGS_PATH)
            return JSON.stringify(workspaceSettingsContent);
          return '{}';
        },
      );

      const settings = loadSettings(MOCK_WORKSPACE_DIR);

      // Verify the merge order and uniqueness
      const expectedDirectories = [
        '/system/defaults/common',
        '/system/defaults/shared',
        '/home/user/projects',
        '/home/user/scripts',
        '/workspace/src',
        '/workspace/tests',
        '/system/admin',
      ];

      expect(settings.merged.includeDirectories).toStrictEqual(
        expectedDirectories,
      );
      expect(settings.merged.includeDirectories).toHaveLength(
        expectedDirectories.length,
      );
    });

    it('should validate setValue operations with complex nested objects', () => {
      (mockFsExistsSync as Mock).mockReturnValue(false);
      const loadedSettings = loadSettings(MOCK_WORKSPACE_DIR);

      vi.mocked(fs.writeFileSync).mockImplementation(() => {});

      // Test setting complex nested configuration
      const complexMcpServer = {
        command: 'node',
        args: ['--experimental-modules', 'server.mjs'],
        env: {
          NODE_ENV: 'development',
          DEBUG: '*',
        },
        cwd: '/project/mcp-server',
        timeout: 30000,
      };

      loadedSettings.setValue(SettingScope.User, 'mcpServers', {
        'complex-server': complexMcpServer,
      });

      expect(loadedSettings.user.settings.mcpServers).toStrictEqual({
        'complex-server': complexMcpServer,
      });
      expect(loadedSettings.merged.mcpServers).toStrictEqual({
        'complex-server': complexMcpServer,
      });

      // Verify the JSON was written correctly
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        USER_SETTINGS_PATH,
        JSON.stringify(
          { mcpServers: { 'complex-server': complexMcpServer } },
          null,
          2,
        ),
        'utf-8',
      );
    });

    it('should handle concurrent setValue operations correctly', () => {
      (mockFsExistsSync as Mock).mockReturnValue(false);
      const loadedSettings = loadSettings(MOCK_WORKSPACE_DIR);

      let writeCallCount = 0;
      vi.mocked(fs.writeFileSync).mockImplementation(() => {
        writeCallCount++;
      });

      // Simulate multiple rapid setValue calls
      loadedSettings.setValue(SettingScope.User, 'theme', 'dark');
      loadedSettings.setValue(SettingScope.User, 'sandbox', true);
      loadedSettings.setValue(
        SettingScope.User,
        'contextFileName',
        'CONTEXT.md',
      );

      expect(loadedSettings.user.settings).toStrictEqual({
        theme: 'dark',
        sandbox: true,
        contextFileName: 'CONTEXT.md',
      });
      expect(dynamicSettings(loadedSettings).merged.theme).toBe('dark');
      expect(loadedSettings.merged.sandbox).toBe(true);
      expect(dynamicSettings(loadedSettings).merged.contextFileName).toBe(
        'CONTEXT.md',
      );

      // Should have written 3 times (once per setValue call)
      expect(writeCallCount).toBe(3);
    });
  });

  describe('loadEnvironment', () => {
    function setup({
      isFolderTrustEnabled: folderTrustEnabledValue = true,
      isWorkspaceTrustedValue = true,
    }) {
      delete process.env['TESTTEST']; // reset
      const geminiEnvPath = path.resolve(path.join(LLXPRT_DIR, '.env'));

      vi.mocked(isWorkspaceTrusted).mockReturnValue(isWorkspaceTrustedValue);
      vi.mocked(isFolderTrustEnabled).mockReturnValue(folderTrustEnabledValue);
      (mockFsExistsSync as Mock).mockImplementation((p: fs.PathLike) =>
        [USER_SETTINGS_PATH, geminiEnvPath].includes(p.toString()),
      );
      const userSettingsContent = {
        theme: 'dark',
        folderTrustFeature: true, // Enable the feature for these tests
        folderTrust: folderTrustEnabledValue,
        contextFileName: 'USER_CONTEXT.md',
      };
      (fs.readFileSync as Mock).mockImplementation(
        (p: fs.PathOrFileDescriptor) => {
          if (p === USER_SETTINGS_PATH)
            return JSON.stringify(userSettingsContent);
          if (p === geminiEnvPath) return 'TESTTEST=1234';
          return '{}';
        },
      );
    }

    it('sets environment variables from .env files', () => {
      setup({ isFolderTrustEnabled: false, isWorkspaceTrustedValue: true });
      loadEnvironment(loadSettings(MOCK_WORKSPACE_DIR).merged);

      expect(process.env['TESTTEST']).toStrictEqual('1234');
    });

    it('does not load env files from untrusted spaces', () => {
      setup({ isFolderTrustEnabled: true, isWorkspaceTrustedValue: false });
      loadEnvironment(loadSettings(MOCK_WORKSPACE_DIR).merged);

      expect(process.env['TESTTEST']).not.toStrictEqual('1234');
    });
  });

  describe('saveSettings', () => {
    it('should save settings to file', () => {
      const mockFsExistsSync = vi.mocked(fs.existsSync);
      const mockFsWriteFileSync = vi.mocked(fs.writeFileSync);
      mockFsExistsSync.mockReturnValue(true);
      mockFsWriteFileSync.mockImplementation(() => {});

      const settingsFile = {
        path: '/mock/settings.json',
        settings: { ui: { theme: 'dark' } },
        originalSettings: { ui: { theme: 'dark' } },
      } as unknown as SettingsFile;

      saveSettings(settingsFile);

      expect(mockFsWriteFileSync).toHaveBeenCalled();
    });

    it('should create directory if it does not exist', () => {
      const mockFsExistsSync = vi.mocked(fs.existsSync);
      const mockFsMkdirSync = vi.mocked(fs.mkdirSync);
      const mockFsWriteFileSync = vi.mocked(fs.writeFileSync);
      mockFsExistsSync.mockReturnValue(false);
      mockFsWriteFileSync.mockImplementation(() => {});

      const settingsFile = {
        path: '/mock/new/dir/settings.json',
        settings: {},
        originalSettings: {},
      } as unknown as SettingsFile;

      saveSettings(settingsFile);

      expect(mockFsExistsSync).toHaveBeenCalledWith('/mock/new/dir');
      expect(mockFsMkdirSync).toHaveBeenCalledWith('/mock/new/dir', {
        recursive: true,
      });
    });

    it('should emit error feedback if saving fails', () => {
      const mockFsExistsSync = vi.mocked(fs.existsSync);
      const error = new Error('Write failed');
      mockFsExistsSync.mockImplementation(() => {
        throw error;
      });

      const settingsFile = {
        path: '/mock/settings.json',
        settings: {},
        originalSettings: {},
      } as unknown as SettingsFile;

      saveSettings(settingsFile);

      expect(mockCoreEvents.emitFeedback).toHaveBeenCalledWith(
        'error',
        'There was an error saving your latest settings changes.',
        error,
      );
    });
  });
});
