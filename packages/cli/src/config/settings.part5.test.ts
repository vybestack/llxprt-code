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
  SettingScope,
  SETTINGS_DIRECTORY_NAME,
} from './settings.js';

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

  describe('LoadedSettings class', () => {
    it('setValue should update the correct scope and recompute merged settings', () => {
      (mockFsExistsSync as Mock).mockReturnValue(false);
      const loadedSettings = loadSettings(MOCK_WORKSPACE_DIR);

      vi.mocked(fs.writeFileSync).mockImplementation(() => {});
      // mkdirSync is mocked in beforeEach to return undefined, which is fine for void usage

      loadedSettings.setValue(SettingScope.User, 'ui.theme', 'matrix');
      expect(loadedSettings.user.settings.ui?.theme).toBe('matrix');
      expect(loadedSettings.merged.ui.theme).toBe('matrix');
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        USER_SETTINGS_PATH,
        JSON.stringify({ ui: { theme: 'matrix' } }, null, 2),
        'utf-8',
      );

      loadedSettings.setValue(
        SettingScope.Workspace,
        'ui.contextFileName',
        'MY_AGENTS.md',
      );
      expect(loadedSettings.workspace.settings.ui?.contextFileName).toBe(
        'MY_AGENTS.md',
      );
      expect(loadedSettings.merged.ui.contextFileName).toBe('MY_AGENTS.md');
      expect(loadedSettings.merged.ui.theme).toBe('matrix'); // User setting should still be there
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        MOCK_WORKSPACE_SETTINGS_PATH,
        JSON.stringify({ ui: { contextFileName: 'MY_AGENTS.md' } }, null, 2),
        'utf-8',
      );

      // System theme should not override user/workspace themes
      loadedSettings.setValue(SettingScope.System, 'ui.theme', 'ocean');

      expect(loadedSettings.system.settings.ui?.theme).toBe('ocean');
      expect(loadedSettings.merged.ui.theme).toBe('matrix');

      // SystemDefaults theme is overridden by user, workspace, and system themes
      loadedSettings.setValue(
        SettingScope.SystemDefaults,
        'ui.theme',
        'default',
      );
      expect(loadedSettings.systemDefaults.settings.ui?.theme).toBe('default');
      expect(loadedSettings.merged.ui.theme).toBe('matrix');
    });

    it('setValue should write V2-compatible settings to namespaced paths', () => {
      (mockFsExistsSync as Mock).mockReturnValue(false);
      const loadedSettings = loadSettings(MOCK_WORKSPACE_DIR);

      vi.mocked(fs.writeFileSync).mockImplementation(() => {});

      loadedSettings.setValue(
        SettingScope.User,
        'accessibility.screenReader',
        true,
      );
      expect(loadedSettings.user.settings.accessibility).toBeUndefined();
      expect(loadedSettings.user.settings.ui?.accessibility).toStrictEqual({
        screenReader: true,
      });
      expect(loadedSettings.merged.accessibility!.screenReader).toBe(true);
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        USER_SETTINGS_PATH,
        JSON.stringify(
          { ui: { accessibility: { screenReader: true } } },
          null,
          2,
        ),
        'utf-8',
      );
    });

    it('setValue should write additional V2-compatible settings to namespaced paths', () => {
      (mockFsExistsSync as Mock).mockReturnValue(false);
      const loadedSettings = loadSettings(MOCK_WORKSPACE_DIR);

      vi.mocked(fs.writeFileSync).mockImplementation(() => {});

      loadedSettings.setValue(SettingScope.User, 'checkpointing.enabled', true);
      expect(loadedSettings.user.settings.checkpointing).toBeUndefined();
      expect(loadedSettings.user.settings.ui?.checkpointing).toStrictEqual({
        enabled: true,
      });
      expect(loadedSettings.merged.checkpointing!.enabled).toBe(true);

      loadedSettings.setValue(
        SettingScope.User,
        'fileFiltering.enableFuzzySearch',
        false,
      );
      expect(loadedSettings.user.settings.fileFiltering).toBeUndefined();
      expect(loadedSettings.user.settings.ui?.fileFiltering).toStrictEqual({
        enableFuzzySearch: false,
      });
      expect(loadedSettings.merged.fileFiltering!.enableFuzzySearch).toBe(
        false,
      );
    });

    it('setValue should write chatCompression threshold updates to V2 model path', () => {
      (mockFsExistsSync as Mock).mockReturnValue(false);
      const loadedSettings = loadSettings(MOCK_WORKSPACE_DIR);

      vi.mocked(fs.writeFileSync).mockImplementation(() => {});

      loadedSettings.setValue(
        SettingScope.User,
        'chatCompression.contextPercentageThreshold',
        0.7,
      );
      expect(loadedSettings.user.settings.chatCompression).toBeUndefined();
      expect(
        (
          loadedSettings.user.settings.model as {
            compressionThreshold?: number;
          }
        ).compressionThreshold,
      ).toBe(0.7);
      expect(loadedSettings.merged.chatCompression).toStrictEqual({
        contextPercentageThreshold: 0.7,
      });
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        USER_SETTINGS_PATH,
        JSON.stringify({ model: { compressionThreshold: 0.7 } }, null, 2),
        'utf-8',
      );
    });

    it('setValue should remove duplicate legacy leaves when writing V2 paths', () => {
      (mockFsExistsSync as Mock).mockReturnValue(true);
      (fs.readFileSync as Mock).mockImplementation(
        (p: fs.PathOrFileDescriptor) => {
          if (p === USER_SETTINGS_PATH) {
            return JSON.stringify({
              accessibility: {
                screenReader: false,
                enableLoadingPhrases: true,
              },
              checkpointing: { enabled: false },
              fileFiltering: { enableFuzzySearch: true },
              chatCompression: {
                contextPercentageThreshold: 0.5,
                strategy: 'high-density',
                profile: 'balanced',
              },
            });
          }
          return '{}';
        },
      );
      const loadedSettings = loadSettings(MOCK_WORKSPACE_DIR);

      vi.mocked(fs.writeFileSync).mockImplementation(() => {});

      loadedSettings.setValue(
        SettingScope.User,
        'accessibility.screenReader',
        true,
      );
      loadedSettings.setValue(SettingScope.User, 'checkpointing.enabled', true);
      loadedSettings.setValue(
        SettingScope.User,
        'fileFiltering.enableFuzzySearch',
        false,
      );
      loadedSettings.setValue(
        SettingScope.User,
        'chatCompression.contextPercentageThreshold',
        0.8,
      );

      expect(loadedSettings.user.settings.accessibility).toStrictEqual({
        enableLoadingPhrases: true,
      });
      expect(loadedSettings.user.settings.checkpointing).toBeUndefined();
      expect(loadedSettings.user.settings.fileFiltering).toBeUndefined();
      expect(loadedSettings.user.settings.chatCompression).toStrictEqual({
        strategy: 'high-density',
        profile: 'balanced',
      });
      expect(loadedSettings.user.settings.ui?.accessibility).toStrictEqual({
        screenReader: true,
      });
      expect(loadedSettings.user.settings.ui?.checkpointing).toStrictEqual({
        enabled: true,
      });
      expect(loadedSettings.user.settings.ui?.fileFiltering).toStrictEqual({
        enableFuzzySearch: false,
      });
      expect(loadedSettings.user.settings.model).toStrictEqual({
        compressionThreshold: 0.8,
      });
    });

    it('setValue should preserve an existing V2 model object when setting the legacy model name', () => {
      (mockFsExistsSync as Mock).mockImplementation(
        (p: fs.PathLike) => p === USER_SETTINGS_PATH,
      );
      const userSettingsContent = {
        model: { compressionThreshold: 0.7 },
      };

      (fs.readFileSync as Mock).mockImplementation(
        (p: fs.PathOrFileDescriptor) => {
          if (p === USER_SETTINGS_PATH)
            return JSON.stringify(userSettingsContent);
          return '{}';
        },
      );
      const loadedSettings = loadSettings(MOCK_WORKSPACE_DIR);

      vi.mocked(fs.writeFileSync).mockImplementation(() => {});

      loadedSettings.setValue(SettingScope.User, 'model', 'updated-model');

      expect(loadedSettings.user.settings.model).toStrictEqual({
        name: 'updated-model',
        compressionThreshold: 0.7,
      });
      expect(loadedSettings.merged.model).toBe('updated-model');
      expect(loadedSettings.merged.chatCompression).toStrictEqual({
        contextPercentageThreshold: 0.7,
      });
    });

    it('setValue should replace an existing V2 model object when setting a model object', () => {
      (mockFsExistsSync as Mock).mockImplementation(
        (p: fs.PathLike) => p === USER_SETTINGS_PATH,
      );
      const userSettingsContent = {
        model: { name: 'existing-model', compressionThreshold: 0.7 },
      };

      (fs.readFileSync as Mock).mockImplementation(
        (p: fs.PathOrFileDescriptor) => {
          if (p === USER_SETTINGS_PATH)
            return JSON.stringify(userSettingsContent);
          return '{}';
        },
      );
      const loadedSettings = loadSettings(MOCK_WORKSPACE_DIR);

      vi.mocked(fs.writeFileSync).mockImplementation(() => {});

      loadedSettings.setValue(SettingScope.User, 'model', {
        name: 'replacement-model',
        compressionThreshold: 0.5,
      });

      expect(loadedSettings.user.settings.model).toStrictEqual({
        name: 'replacement-model',
        compressionThreshold: 0.5,
      });
      expect(loadedSettings.merged.model).toBe('replacement-model');
      expect(loadedSettings.merged.chatCompression).toStrictEqual({
        contextPercentageThreshold: 0.5,
      });
    });

    it('setValue should support direct V2 model.compressionThreshold writes and preserve name', () => {
      (mockFsExistsSync as Mock).mockImplementation(
        (p: fs.PathLike) => p === USER_SETTINGS_PATH,
      );
      const userSettingsContent = {
        model: { name: 'existing-model' },
      };

      (fs.readFileSync as Mock).mockImplementation(
        (p: fs.PathOrFileDescriptor) => {
          if (p === USER_SETTINGS_PATH)
            return JSON.stringify(userSettingsContent);
          return '{}';
        },
      );
      const loadedSettings = loadSettings(MOCK_WORKSPACE_DIR);

      vi.mocked(fs.writeFileSync).mockImplementation(() => {});

      loadedSettings.setValue(
        SettingScope.User,
        'model.compressionThreshold',
        0.8,
      );

      expect(loadedSettings.user.settings.model).toStrictEqual({
        name: 'existing-model',
        compressionThreshold: 0.8,
      });
      expect(loadedSettings.merged.model).toBe('existing-model');
      expect(loadedSettings.merged.chatCompression).toStrictEqual({
        contextPercentageThreshold: 0.8,
      });
    });

    it('setValue should support direct V2 model.name writes and preserve compressionThreshold', () => {
      (mockFsExistsSync as Mock).mockImplementation(
        (p: fs.PathLike) => p === USER_SETTINGS_PATH,
      );
      const userSettingsContent = {
        model: { compressionThreshold: 0.7 },
      };

      (fs.readFileSync as Mock).mockImplementation(
        (p: fs.PathOrFileDescriptor) => {
          if (p === USER_SETTINGS_PATH)
            return JSON.stringify(userSettingsContent);
          return '{}';
        },
      );
      const loadedSettings = loadSettings(MOCK_WORKSPACE_DIR);

      vi.mocked(fs.writeFileSync).mockImplementation(() => {});

      loadedSettings.setValue(SettingScope.User, 'model.name', 'updated-model');

      expect(loadedSettings.user.settings.model).toStrictEqual({
        name: 'updated-model',
        compressionThreshold: 0.7,
      });
      expect(loadedSettings.merged.model).toBe('updated-model');
      expect(loadedSettings.merged.chatCompression).toStrictEqual({
        contextPercentageThreshold: 0.7,
      });
    });
  });

  describe('excludedProjectEnvVars integration', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('should exclude DEBUG and DEBUG_MODE from project .env files by default', () => {
      const workspaceSettingsContent = {
        excludedProjectEnvVars: ['DEBUG', 'DEBUG_MODE'],
      };
      const projectEnvPath = pathActual.join(MOCK_WORKSPACE_DIR, '.env');

      vi.spyOn(process, 'cwd').mockReturnValue(MOCK_WORKSPACE_DIR);
      delete process.env.DEBUG;
      delete process.env.DEBUG_MODE;
      delete process.env.GEMINI_API_KEY;

      (mockFsExistsSync as Mock).mockImplementation(
        (p: fs.PathLike) =>
          p === MOCK_WORKSPACE_SETTINGS_PATH || p === projectEnvPath,
      );

      (fs.readFileSync as Mock).mockImplementation(
        (p: fs.PathOrFileDescriptor) => {
          if (p === projectEnvPath) {
            return 'DEBUG=true\nDEBUG_MODE=1\nGEMINI_API_KEY=test-key';
          }
          if (p === MOCK_WORKSPACE_SETTINGS_PATH) {
            return JSON.stringify(workspaceSettingsContent);
          }
          return '{}';
        },
      );

      const settings = loadSettings(MOCK_WORKSPACE_DIR);

      expect(settings.merged.excludedProjectEnvVars).toStrictEqual([
        'DEBUG',
        'DEBUG_MODE',
      ]);
      expect(process.env.GEMINI_API_KEY).toBe('test-key');
      expect(process.env.DEBUG).toBeUndefined();
      expect(process.env.DEBUG_MODE).toBeUndefined();
    });

    it('should respect custom excludedProjectEnvVars from user settings', () => {
      const userSettingsContent = {
        excludedProjectEnvVars: ['NODE_ENV', 'DEBUG'],
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

      const settings = loadSettings(MOCK_WORKSPACE_DIR);
      expect(settings.user.settings.excludedProjectEnvVars).toStrictEqual([
        'NODE_ENV',
        'DEBUG',
      ]);
      expect(settings.merged.excludedProjectEnvVars).toStrictEqual([
        'NODE_ENV',
        'DEBUG',
      ]);
    });

    it('should merge excludedProjectEnvVars with workspace taking precedence', () => {
      const userSettingsContent = {
        excludedProjectEnvVars: ['DEBUG', 'NODE_ENV', 'USER_VAR'],
      };
      const workspaceSettingsContent = {
        excludedProjectEnvVars: ['WORKSPACE_DEBUG', 'WORKSPACE_VAR'],
      };

      (mockFsExistsSync as Mock).mockReturnValue(true);

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

      expect(settings.user.settings.excludedProjectEnvVars).toStrictEqual([
        'DEBUG',
        'NODE_ENV',
        'USER_VAR',
      ]);
      expect(settings.workspace.settings.excludedProjectEnvVars).toStrictEqual([
        'WORKSPACE_DEBUG',
        'WORKSPACE_VAR',
      ]);
      expect(settings.merged.excludedProjectEnvVars).toStrictEqual([
        'WORKSPACE_DEBUG',
        'WORKSPACE_VAR',
      ]);
    });
  });

  describe('with workspace trust', () => {
    it('should merge workspace settings when workspace is trusted', () => {
      (mockFsExistsSync as Mock).mockReturnValue(true);
      const userSettingsContent = { enableAutoUpdate: true };
      const workspaceSettingsContent = {
        enableAutoUpdate: false,
        contextFileName: 'WORKSPACE.md',
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
      const arbitrary = dynamicSettings(settings);

      expect(settings.merged.enableAutoUpdate).toBe(false);
      expect(arbitrary.merged.contextFileName).toBe('WORKSPACE.md');
    });

    it('should NOT merge workspace settings when workspace is not trusted', () => {
      vi.mocked(isWorkspaceTrusted).mockReturnValue(false);
      vi.mocked(isFolderTrustEnabled).mockReturnValue(true); // Enable the feature for this test
      (mockFsExistsSync as Mock).mockReturnValue(true);
      const userSettingsContent = {
        enableAutoUpdate: true,
        contextFileName: 'USER.md',
        folderTrustFeature: true, // Enable the feature
        folderTrust: true, // Enable the setting
      };
      const workspaceSettingsContent = {
        enableAutoUpdate: false,
        contextFileName: 'WORKSPACE.md',
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
      const arbitrary = dynamicSettings(settings);

      expect(settings.merged.enableAutoUpdate).toBe(true); // User setting
      expect(arbitrary.merged.contextFileName).toBe('USER.md'); // User setting
    });
  });
});
