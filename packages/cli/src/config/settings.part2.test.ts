/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/// <reference types="vitest/globals" />

// Mock 'os' first.
import * as osActual from 'os';
import * as pathActual from 'node:path'; // Import for type info for the mock factory
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
  loadSettings,
  USER_SETTINGS_PATH,
  getSystemDefaultsPath,
  SETTINGS_DIRECTORY_NAME,
  getSystemSettingsPath,
} from './settings.js';
import { getV2NamespacedSettingPath } from './settingsMerge.js';

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

  describe('loadSettings', () => {
    it('should handle chatCompression when only in user settings', () => {
      (mockFsExistsSync as Mock).mockImplementation(
        (p: fs.PathLike) => p === USER_SETTINGS_PATH,
      );
      const userSettingsContent = {
        chatCompression: { contextPercentageThreshold: 0.5 },
      };
      (fs.readFileSync as Mock).mockImplementation(
        (p: fs.PathOrFileDescriptor) => {
          if (p === USER_SETTINGS_PATH)
            return JSON.stringify(userSettingsContent);
          return '{}';
        },
      );

      const settings = loadSettings(MOCK_WORKSPACE_DIR);
      expect(settings.merged.chatCompression).toStrictEqual({
        contextPercentageThreshold: 0.5,
      });
    });

    it('should have chatCompression as an empty object if not in any settings file', () => {
      (mockFsExistsSync as Mock).mockReturnValue(false); // No settings files exist
      (fs.readFileSync as Mock).mockReturnValue('{}');
      const settings = loadSettings(MOCK_WORKSPACE_DIR);
      expect(settings.merged.chatCompression).toStrictEqual({});
    });

    it('should deep merge chatCompression settings', () => {
      (mockFsExistsSync as Mock).mockReturnValue(true);
      const userSettingsContent = {
        chatCompression: { contextPercentageThreshold: 0.5 },
      };
      const workspaceSettingsContent = {
        chatCompression: {},
      };

      (fs.readFileSync as Mock).mockImplementation(
        (p: fs.PathOrFileDescriptor) => {
          if (p === USER_SETTINGS_PATH)
            return JSON.stringify(userSettingsContent);
          if (p === MOCK_WORKSPACE_SETTINGS_PATH)
            return JSON.stringify(workspaceSettingsContent);
          return '{}';
        },
      );

      const settings = loadSettings(MOCK_WORKSPACE_DIR);

      expect(settings.merged.chatCompression).toStrictEqual({
        contextPercentageThreshold: 0.5,
      });
    });

    it('should map V2 model.compressionThreshold to chatCompression without changing model string selection', () => {
      (mockFsExistsSync as Mock).mockReturnValue(true);
      const userSettingsContent = {
        model: {
          name: 'user-model',
          compressionThreshold: 0.5,
        },
      };
      const workspaceSettingsContent = {
        model: 'workspace-model',
      };

      (fs.readFileSync as Mock).mockImplementation(
        (p: fs.PathOrFileDescriptor) => {
          if (p === USER_SETTINGS_PATH)
            return JSON.stringify(userSettingsContent);
          if (p === MOCK_WORKSPACE_SETTINGS_PATH)
            return JSON.stringify(workspaceSettingsContent);
          return '{}';
        },
      );

      const settings = loadSettings(MOCK_WORKSPACE_DIR);

      expect(settings.merged.model).toBe('workspace-model');
      expect(settings.merged.chatCompression).toStrictEqual({
        contextPercentageThreshold: 0.5,
      });
      expect(settings.merged.modelConfig).toStrictEqual({
        name: 'workspace-model',
        compressionThreshold: 0.5,
      });
    });

    it('should let higher-precedence model.compressionThreshold override legacy chatCompression', () => {
      (mockFsExistsSync as Mock).mockReturnValue(true);
      const userSettingsContent = {
        chatCompression: { contextPercentageThreshold: 0.5 },
      };
      const workspaceSettingsContent = {
        model: {
          name: 'workspace-model',
          compressionThreshold: 0.8,
        },
      };

      (fs.readFileSync as Mock).mockImplementation(
        (p: fs.PathOrFileDescriptor) => {
          if (p === USER_SETTINGS_PATH)
            return JSON.stringify(userSettingsContent);
          if (p === MOCK_WORKSPACE_SETTINGS_PATH)
            return JSON.stringify(workspaceSettingsContent);
          return '{}';
        },
      );

      const settings = loadSettings(MOCK_WORKSPACE_DIR);

      expect(settings.merged.model).toBe('workspace-model');
      expect(settings.merged.chatCompression).toStrictEqual({
        contextPercentageThreshold: 0.8,
      });
    });

    it('should preserve legacy chatCompression when lower-precedence model.compressionThreshold exists', () => {
      (mockFsExistsSync as Mock).mockReturnValue(true);
      const userSettingsContent = {
        model: { compressionThreshold: 0.5 },
      };
      const workspaceSettingsContent = {
        chatCompression: { contextPercentageThreshold: 0.8 },
      };

      (fs.readFileSync as Mock).mockImplementation(
        (p: fs.PathOrFileDescriptor) => {
          if (p === USER_SETTINGS_PATH)
            return JSON.stringify(userSettingsContent);
          if (p === MOCK_WORKSPACE_SETTINGS_PATH)
            return JSON.stringify(workspaceSettingsContent);
          return '{}';
        },
      );

      const settings = loadSettings(MOCK_WORKSPACE_DIR);

      expect(settings.merged.chatCompression).toStrictEqual({
        contextPercentageThreshold: 0.8,
      });
    });

    it('should preserve legacy chatCompression strategy and profile fields', () => {
      (mockFsExistsSync as Mock).mockImplementation(
        (p: fs.PathLike) => p === USER_SETTINGS_PATH,
      );
      const userSettingsContent = {
        chatCompression: {
          contextPercentageThreshold: 0.5,
          strategy: 'high-density',
          profile: 'balanced',
        },
      };

      (fs.readFileSync as Mock).mockImplementation(
        (p: fs.PathOrFileDescriptor) => {
          if (p === USER_SETTINGS_PATH)
            return JSON.stringify(userSettingsContent);
          return '{}';
        },
      );

      const settings = loadSettings(MOCK_WORKSPACE_DIR);

      expect(settings.user.settings.chatCompression).toStrictEqual({
        contextPercentageThreshold: 0.5,
        strategy: 'high-density',
        profile: 'balanced',
      });
      expect(settings.merged.chatCompression).toStrictEqual({
        contextPercentageThreshold: 0.5,
        strategy: 'high-density',
        profile: 'balanced',
      });
    });

    it('should keep workspace and user model precedence over system model settings', () => {
      (mockFsExistsSync as Mock).mockReturnValue(true);
      const systemSettingsContent = {
        model: 'system-model',
      };
      const systemDefaultsContent = {
        model: 'system-default-model',
      };
      const userSettingsContent = {
        model: 'user-model',
      };
      const workspaceSettingsContent = {
        model: { name: 'workspace-model' },
      };

      (fs.readFileSync as Mock).mockImplementation(
        (p: fs.PathOrFileDescriptor) => {
          if (p === '/mock/system/settings.json')
            return JSON.stringify(systemSettingsContent);
          if (p === '/mock/system/system-defaults.json')
            return JSON.stringify(systemDefaultsContent);
          if (p === USER_SETTINGS_PATH)
            return JSON.stringify(userSettingsContent);
          if (p === MOCK_WORKSPACE_SETTINGS_PATH)
            return JSON.stringify(workspaceSettingsContent);
          return '{}';
        },
      );

      const settings = loadSettings(MOCK_WORKSPACE_DIR);

      expect(settings.merged.model).toBe('workspace-model');
    });

    it('should keep user model precedence over system model settings when workspace model is absent', () => {
      (mockFsExistsSync as Mock).mockReturnValue(true);
      const systemSettingsContent = {
        model: { name: 'system-model' },
      };
      const systemDefaultsContent = {
        model: { name: 'system-default-model' },
      };
      const userSettingsContent = {
        model: 'user-model',
      };
      const workspaceSettingsContent = {};

      (fs.readFileSync as Mock).mockImplementation(
        (p: fs.PathOrFileDescriptor) => {
          if (p === '/mock/system/settings.json')
            return JSON.stringify(systemSettingsContent);
          if (p === '/mock/system/system-defaults.json')
            return JSON.stringify(systemDefaultsContent);
          if (p === USER_SETTINGS_PATH)
            return JSON.stringify(userSettingsContent);
          if (p === MOCK_WORKSPACE_SETTINGS_PATH)
            return JSON.stringify(workspaceSettingsContent);
          return '{}';
        },
      );

      const settings = loadSettings(MOCK_WORKSPACE_DIR);

      expect(settings.merged.model).toBe('user-model');
    });

    it('should use system model precedence over systemDefaults when user and workspace are absent', () => {
      (mockFsExistsSync as Mock).mockReturnValue(true);
      const systemSettingsContent = {
        model: 'system-model',
      };
      const systemDefaultsContent = {
        model: { name: 'system-default-model' },
      };
      const userSettingsContent = {};
      const workspaceSettingsContent = {};

      (fs.readFileSync as Mock).mockImplementation(
        (p: fs.PathOrFileDescriptor) => {
          if (p === '/mock/system/settings.json')
            return JSON.stringify(systemSettingsContent);
          if (p === '/mock/system/system-defaults.json')
            return JSON.stringify(systemDefaultsContent);
          if (p === USER_SETTINGS_PATH)
            return JSON.stringify(userSettingsContent);
          if (p === MOCK_WORKSPACE_SETTINGS_PATH)
            return JSON.stringify(workspaceSettingsContent);
          return '{}';
        },
      );

      const settings = loadSettings(MOCK_WORKSPACE_DIR);

      expect(settings.merged.model).toBe('system-model');
    });

    it('should use systemDefaults model when no higher precedence model exists', () => {
      (mockFsExistsSync as Mock).mockReturnValue(true);
      const systemSettingsContent = {};
      const systemDefaultsContent = {
        model: 'system-default-model',
      };
      const userSettingsContent = {};
      const workspaceSettingsContent = {};

      (fs.readFileSync as Mock).mockImplementation(
        (p: fs.PathOrFileDescriptor) => {
          if (p === '/mock/system/settings.json')
            return JSON.stringify(systemSettingsContent);
          if (p === '/mock/system/system-defaults.json')
            return JSON.stringify(systemDefaultsContent);
          if (p === USER_SETTINGS_PATH)
            return JSON.stringify(userSettingsContent);
          if (p === MOCK_WORKSPACE_SETTINGS_PATH)
            return JSON.stringify(workspaceSettingsContent);
          return '{}';
        },
      );

      const settings = loadSettings(MOCK_WORKSPACE_DIR);

      expect(settings.merged.model).toBe('system-default-model');
    });

    it('should read V2 namespaced UI settings into their top-level compatibility sections', () => {
      (mockFsExistsSync as Mock).mockImplementation(
        (p: fs.PathLike) => p === USER_SETTINGS_PATH,
      );
      const userSettingsContent = {
        ui: {
          accessibility: { screenReader: true },
          checkpointing: { enabled: true },
          fileFiltering: { enableFuzzySearch: false },
        },
      };

      (fs.readFileSync as Mock).mockImplementation(
        (p: fs.PathOrFileDescriptor) => {
          if (p === USER_SETTINGS_PATH)
            return JSON.stringify(userSettingsContent);
          return '{}';
        },
      );

      const settings = loadSettings(MOCK_WORKSPACE_DIR);

      expect(settings.merged.accessibility).toMatchObject({
        enableLoadingPhrases: true,
        screenReader: true,
      });
      expect(settings.merged.checkpointing).toStrictEqual({ enabled: true });
      expect(settings.merged.fileFiltering).toMatchObject({
        enableFuzzySearch: false,
        respectGitIgnore: true,
      });
    });

    it('should prefer V2 namespaced values over legacy top-level values in the same settings layer', () => {
      (mockFsExistsSync as Mock).mockImplementation(
        (p: fs.PathLike) => p === USER_SETTINGS_PATH,
      );
      const userSettingsContent = {
        accessibility: { screenReader: false },
        checkpointing: { enabled: false },
        fileFiltering: { enableFuzzySearch: true },
        ui: {
          accessibility: { screenReader: true },
          checkpointing: { enabled: true },
          fileFiltering: { enableFuzzySearch: false },
        },
      };

      (fs.readFileSync as Mock).mockImplementation(
        (p: fs.PathOrFileDescriptor) => {
          if (p === USER_SETTINGS_PATH)
            return JSON.stringify(userSettingsContent);
          return '{}';
        },
      );

      const settings = loadSettings(MOCK_WORKSPACE_DIR);

      expect(settings.merged.accessibility!.screenReader).toBe(true);
      expect(settings.merged.checkpointing!.enabled).toBe(true);
      expect(settings.merged.fileFiltering!.enableFuzzySearch).toBe(false);
    });

    it('should keep layer precedence when merging legacy top-level and V2 namespaced settings', () => {
      (mockFsExistsSync as Mock).mockImplementation(
        (p: fs.PathLike) =>
          p === USER_SETTINGS_PATH || p === MOCK_WORKSPACE_SETTINGS_PATH,
      );
      const userSettingsContent = {
        ui: {
          accessibility: { screenReader: true },
          checkpointing: { enabled: true },
          fileFiltering: { enableFuzzySearch: false },
        },
      };
      const workspaceSettingsContent = {
        accessibility: { screenReader: false },
        checkpointing: { enabled: false },
        fileFiltering: { enableFuzzySearch: true },
      };

      (fs.readFileSync as Mock).mockImplementation(
        (p: fs.PathOrFileDescriptor) => {
          if (p === USER_SETTINGS_PATH)
            return JSON.stringify(userSettingsContent);
          if (p === MOCK_WORKSPACE_SETTINGS_PATH)
            return JSON.stringify(workspaceSettingsContent);
          return '{}';
        },
      );

      const settings = loadSettings(MOCK_WORKSPACE_DIR);

      expect(settings.merged.accessibility!.screenReader).toBe(false);
      expect(settings.merged.checkpointing!.enabled).toBe(false);
      expect(settings.merged.fileFiltering!.enableFuzzySearch).toBe(true);
    });

    it('should map legacy V2-compatible setting paths to namespaced write paths', () => {
      expect(getV2NamespacedSettingPath('accessibility.screenReader')).toBe(
        'ui.accessibility.screenReader',
      );
      expect(getV2NamespacedSettingPath('checkpointing.enabled')).toBe(
        'ui.checkpointing.enabled',
      );
      expect(
        getV2NamespacedSettingPath('fileFiltering.enableFuzzySearch'),
      ).toBe('ui.fileFiltering.enableFuzzySearch');
      expect(getV2NamespacedSettingPath('ui.theme')).toBe('ui.theme');
      expect(getV2NamespacedSettingPath('chatCompression.enabled')).toBe(
        'chatCompression.enabled',
      );
      expect(
        getV2NamespacedSettingPath(
          'chatCompression.contextPercentageThreshold',
        ),
      ).toBe('model.compressionThreshold');
    });

    it('should merge includeDirectories from all scopes', () => {
      (mockFsExistsSync as Mock).mockReturnValue(true);
      const systemSettingsContent = {
        includeDirectories: ['/system/dir'],
      };
      const systemDefaultsContent = {
        includeDirectories: ['/system/defaults/dir'],
      };
      const userSettingsContent = {
        includeDirectories: ['/user/dir1', '/user/dir2'],
      };
      const workspaceSettingsContent = {
        includeDirectories: ['/workspace/dir'],
      };

      (fs.readFileSync as Mock).mockImplementation(
        (p: fs.PathOrFileDescriptor) => {
          if (p === getSystemSettingsPath())
            return JSON.stringify(systemSettingsContent);
          if (p === getSystemDefaultsPath())
            return JSON.stringify(systemDefaultsContent);
          if (p === USER_SETTINGS_PATH)
            return JSON.stringify(userSettingsContent);
          if (p === MOCK_WORKSPACE_SETTINGS_PATH)
            return JSON.stringify(workspaceSettingsContent);
          return '{}';
        },
      );

      const settings = loadSettings(MOCK_WORKSPACE_DIR);

      expect(settings.merged.includeDirectories).toStrictEqual([
        '/system/defaults/dir',
        '/user/dir1',
        '/user/dir2',
        '/workspace/dir',
        '/system/dir',
      ]);
    });

    it('should handle JSON parsing errors gracefully', () => {
      (mockFsExistsSync as Mock).mockReturnValue(true); // Both files "exist"
      const invalidJsonContent = 'invalid json';
      const userReadError = new SyntaxError(
        "Expected ',' or '}' after property value in JSON at position 10",
      );
      const workspaceReadError = new SyntaxError(
        'Unexpected token i in JSON at position 0',
      );

      (fs.readFileSync as Mock).mockImplementation(
        (p: fs.PathOrFileDescriptor) => {
          if (p === USER_SETTINGS_PATH) {
            // Simulate JSON.parse throwing for user settings
            vi.spyOn(JSON, 'parse').mockImplementationOnce(() => {
              throw userReadError;
            });
            return invalidJsonContent; // Content that would cause JSON.parse to throw
          }
          if (p === MOCK_WORKSPACE_SETTINGS_PATH) {
            // Simulate JSON.parse throwing for workspace settings
            vi.spyOn(JSON, 'parse').mockImplementationOnce(() => {
              throw workspaceReadError;
            });
            return invalidJsonContent;
          }
          return '{}'; // Default for other reads
        },
      );

      // Errors now throw FatalConfigError instead of being collected
      expect(() => loadSettings(MOCK_WORKSPACE_DIR)).toThrow(FatalConfigError);

      // Restore JSON.parse mock if it was spied on specifically for this test
      vi.restoreAllMocks(); // Or more targeted restore if needed
    });

    it('should resolve environment variables in user settings', () => {
      process.env.TEST_API_KEY = 'user_api_key_from_env';
      const userSettingsContent = {
        apiKey: '$TEST_API_KEY',
        someUrl: 'https://test.com/${TEST_API_KEY}',
      };
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
      expect(arbitrary.user.settings.apiKey).toBe('user_api_key_from_env');
      expect(arbitrary.user.settings.someUrl).toBe(
        'https://test.com/user_api_key_from_env',
      );
      expect(arbitrary.merged.apiKey).toBe('user_api_key_from_env');
      delete process.env.TEST_API_KEY;
    });

    it('should resolve environment variables in workspace settings', () => {
      process.env.WORKSPACE_ENDPOINT = 'workspace_endpoint_from_env';
      const workspaceSettingsContent = {
        endpoint: '${WORKSPACE_ENDPOINT}/api',
        nested: { value: '$WORKSPACE_ENDPOINT' },
      };
      (mockFsExistsSync as Mock).mockImplementation(
        (p: fs.PathLike) => p === MOCK_WORKSPACE_SETTINGS_PATH,
      );
      (fs.readFileSync as Mock).mockImplementation(
        (p: fs.PathOrFileDescriptor) => {
          if (p === MOCK_WORKSPACE_SETTINGS_PATH)
            return JSON.stringify(workspaceSettingsContent);
          return '{}';
        },
      );

      const settings = loadSettings(MOCK_WORKSPACE_DIR);
      const arbitrary = dynamicSettings(settings);
      expect(arbitrary.workspace.settings.endpoint).toBe(
        'workspace_endpoint_from_env/api',
      );
      expect(
        (arbitrary.workspace.settings.nested as { value: unknown }).value,
      ).toBe('workspace_endpoint_from_env');
      expect(arbitrary.merged.endpoint).toBe('workspace_endpoint_from_env/api');
      delete process.env.WORKSPACE_ENDPOINT;
    });
  });
});
