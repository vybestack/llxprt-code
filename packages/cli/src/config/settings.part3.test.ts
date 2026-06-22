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
    it('should correctly resolve and merge env variables from different scopes', () => {
      process.env['SYSTEM_VAR'] = 'system_value';
      process.env['USER_VAR'] = 'user_value';
      process.env['WORKSPACE_VAR'] = 'workspace_value';
      process.env['SHARED_VAR'] = 'final_value';

      const systemSettingsContent = {
        configValue: '$SHARED_VAR',
        systemOnly: '$SYSTEM_VAR',
      };
      const userSettingsContent = {
        configValue: '$SHARED_VAR',
        userOnly: '$USER_VAR',
        theme: 'dark',
      };
      const workspaceSettingsContent = {
        configValue: '$SHARED_VAR',
        workspaceOnly: '$WORKSPACE_VAR',
        theme: 'light',
      };

      (mockFsExistsSync as Mock).mockReturnValue(true);

      (fs.readFileSync as Mock).mockImplementation(
        (p: fs.PathOrFileDescriptor) => {
          if (p === getSystemSettingsPath()) {
            return JSON.stringify(systemSettingsContent);
          }
          if (p === USER_SETTINGS_PATH) {
            return JSON.stringify(userSettingsContent);
          }
          if (p === MOCK_WORKSPACE_SETTINGS_PATH) {
            return JSON.stringify(workspaceSettingsContent);
          }
          return '{}';
        },
      );

      const settings = loadSettings(MOCK_WORKSPACE_DIR);
      const arbitrary = dynamicSettings(settings);

      // Check resolved values in individual scopes
      expect(arbitrary.system.settings.configValue).toBe('final_value');
      expect(arbitrary.system.settings.systemOnly).toBe('system_value');
      expect(arbitrary.user.settings.configValue).toBe('final_value');
      expect(arbitrary.user.settings.userOnly).toBe('user_value');
      expect(arbitrary.workspace.settings.configValue).toBe('final_value');
      expect(arbitrary.workspace.settings.workspaceOnly).toBe(
        'workspace_value',
      );

      // Check merged values (workspace > user > system for themes)
      expect(arbitrary.merged.theme).toBe('light');
      expect(arbitrary.merged.configValue).toBe('final_value');
      expect(arbitrary.merged.systemOnly).toBe('system_value');
      expect(arbitrary.merged.userOnly).toBe('user_value');
      expect(arbitrary.merged.workspaceOnly).toBe('workspace_value');

      // Clean up
      delete process.env['SYSTEM_VAR'];
      delete process.env['USER_VAR'];
      delete process.env['WORKSPACE_VAR'];
      delete process.env['SHARED_VAR'];
    });

    it('should correctly merge dnsResolutionOrder with workspace taking precedence', () => {
      (mockFsExistsSync as Mock).mockReturnValue(true);
      const userSettingsContent = {
        dnsResolutionOrder: 'ipv4first',
      };
      const workspaceSettingsContent = {
        dnsResolutionOrder: 'verbatim',
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
      expect(settings.merged.dnsResolutionOrder).toBe('verbatim');
    });

    it('should use user dnsResolutionOrder if workspace is not defined', () => {
      (mockFsExistsSync as Mock).mockImplementation(
        (p: fs.PathLike) => p === USER_SETTINGS_PATH,
      );
      const userSettingsContent = {
        dnsResolutionOrder: 'verbatim',
      };
      (fs.readFileSync as Mock).mockImplementation(
        (p: fs.PathOrFileDescriptor) => {
          if (p === USER_SETTINGS_PATH)
            return JSON.stringify(userSettingsContent);
          return '{}';
        },
      );

      const settings = loadSettings(MOCK_WORKSPACE_DIR);
      expect(settings.merged.dnsResolutionOrder).toBe('verbatim');
    });

    it('should leave unresolved environment variables as is', () => {
      const userSettingsContent = { apiKey: '$UNDEFINED_VAR' };
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
      expect(arbitrary.user.settings.apiKey).toBe('$UNDEFINED_VAR');
      expect(arbitrary.merged.apiKey).toBe('$UNDEFINED_VAR');
    });

    it('should resolve multiple environment variables in a single string', () => {
      process.env.VAR_A = 'valueA';
      process.env.VAR_B = 'valueB';
      const userSettingsContent = { path: '/path/$VAR_A/${VAR_B}/end' };
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
      expect(arbitrary.user.settings.path).toBe('/path/valueA/valueB/end');
      delete process.env.VAR_A;
      delete process.env.VAR_B;
    });

    it('should resolve environment variables in arrays', () => {
      process.env.ITEM_1 = 'item1_env';
      process.env.ITEM_2 = 'item2_env';
      const userSettingsContent = { list: ['$ITEM_1', '${ITEM_2}', 'literal'] };
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
      expect(arbitrary.user.settings.list).toStrictEqual([
        'item1_env',
        'item2_env',
        'literal',
      ]);
      delete process.env.ITEM_1;
      delete process.env.ITEM_2;
    });

    it('should correctly pass through null, boolean, and number types, and handle undefined properties', () => {
      process.env.MY_ENV_STRING = 'env_string_value';
      process.env.MY_ENV_STRING_NESTED = 'env_string_nested_value';

      const userSettingsContent = {
        nullVal: null,
        trueVal: true,
        falseVal: false,
        numberVal: 123.45,
        stringVal: '$MY_ENV_STRING',
        nestedObj: {
          nestedNull: null,
          nestedBool: true,
          nestedNum: 0,
          nestedString: 'literal',
          anotherEnv: '${MY_ENV_STRING_NESTED}',
        },
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

      expect(arbitrary.user.settings.nullVal).toBeNull();
      expect(arbitrary.user.settings.trueVal).toBe(true);
      expect(arbitrary.user.settings.falseVal).toBe(false);
      expect(arbitrary.user.settings.numberVal).toBe(123.45);
      expect(arbitrary.user.settings.stringVal).toBe('env_string_value');
      expect(arbitrary.user.settings.undefinedVal).toBeUndefined();

      expect(
        (arbitrary.user.settings.nestedObj as Record<string, unknown>)
          .nestedNull,
      ).toBeNull();
      expect(
        (arbitrary.user.settings.nestedObj as Record<string, unknown>)
          .nestedBool,
      ).toBe(true);
      expect(
        (arbitrary.user.settings.nestedObj as Record<string, unknown>)
          .nestedNum,
      ).toBe(0);
      expect(
        (arbitrary.user.settings.nestedObj as Record<string, unknown>)
          .nestedString,
      ).toBe('literal');
      expect(
        (arbitrary.user.settings.nestedObj as Record<string, unknown>)
          .anotherEnv,
      ).toBe('env_string_nested_value');

      delete process.env.MY_ENV_STRING;
      delete process.env.MY_ENV_STRING_NESTED;
    });

    it('should resolve multiple concatenated environment variables in a single string value', () => {
      process.env.TEST_HOST = 'myhost';
      process.env.TEST_PORT = '9090';
      const userSettingsContent = {
        serverAddress: '${TEST_HOST}:${TEST_PORT}/api',
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
      expect(arbitrary.user.settings.serverAddress).toBe('myhost:9090/api');

      delete process.env.TEST_HOST;
      delete process.env.TEST_PORT;
    });

    describe('when LLXPRT_CODE_SYSTEM_SETTINGS_PATH is set', () => {
      const MOCK_ENV_SYSTEM_SETTINGS_PATH = '/mock/env/system/settings.json';

      beforeEach(() => {
        process.env.LLXPRT_CODE_SYSTEM_SETTINGS_PATH =
          MOCK_ENV_SYSTEM_SETTINGS_PATH;
      });

      afterEach(() => {
        delete process.env.LLXPRT_CODE_SYSTEM_SETTINGS_PATH;
      });

      it('should load system settings from the path specified in the environment variable', () => {
        (mockFsExistsSync as Mock).mockImplementation(
          (p: fs.PathLike) => p === MOCK_ENV_SYSTEM_SETTINGS_PATH,
        );
        const systemSettingsContent = {};
        (fs.readFileSync as Mock).mockImplementation(
          (p: fs.PathOrFileDescriptor) => {
            if (p === MOCK_ENV_SYSTEM_SETTINGS_PATH)
              return JSON.stringify(systemSettingsContent);
            return '{}';
          },
        );

        const settings = loadSettings(MOCK_WORKSPACE_DIR);

        expect(fs.readFileSync).toHaveBeenCalledWith(
          MOCK_ENV_SYSTEM_SETTINGS_PATH,
          'utf-8',
        );
        expect(settings.system.path).toBe(MOCK_ENV_SYSTEM_SETTINGS_PATH);
        // Migration adds enableAutoUpdate/enableAutoUpdateNotification — use toMatchObject
        expect(settings.system.settings).toMatchObject(systemSettingsContent);
        expect(settings.merged).toMatchObject({
          accessibility: {},
          chatCompression: {},
          checkpointing: {},
          coreToolSettings: {},
          emojifilter: 'auto',
          enablePromptCompletion: false,
          enableTextToolCallParsing: false,
          excludedProjectEnvVars: ['DEBUG', 'DEBUG_MODE'],
          extensionManagement: true,
          extensions: {
            disabled: [],
            workspacesWithMigrationNudge: [],
          },
          fileFiltering: {},
          folderTrust: false,
          folderTrustFeature: false,
          hasSeenIdeIntegrationNudge: false,
          hideCWD: false,
          hideModelInfo: false,
          hideSandboxStatus: false,
          ide: {},
          includeDirectories: [],
          loadMemoryFromIncludeDirectories: false,
          mcp: {},
          mcpServers: {},
          oauthEnabledProviders: {},
          openaiResponsesEnabled: false,
          output: {},
          providerApiKeys: {},
          providerBaseUrls: {},
          providerKeyfiles: {},
          providerToolFormatOverrides: {},
          security: {},
          shellReplacement: 'allowlist',
          shouldUseNodePtyShell: false,
          allowPtyThemeOverride: false,
          ptyScrollbackLimit: 600000,

          showStatusInTitle: false,
          textToolCallModels: [],
          tools: {},
          ui: {
            customThemes: {},
            theme: undefined,
          },
          ...systemSettingsContent,
        });
      });
    });

    it('migrates legacy tools.usePty to shouldUseNodePtyShell', () => {
      const expectedUserSettingsPath = USER_SETTINGS_PATH;
      (mockFsExistsSync as Mock).mockImplementation(
        (p: fs.PathLike) => p === expectedUserSettingsPath,
      );
      const userSettingsContent = {
        tools: {
          usePty: true,
        },
      };
      (fs.readFileSync as Mock).mockImplementation(
        (p: fs.PathOrFileDescriptor) => {
          if (p === expectedUserSettingsPath) {
            return JSON.stringify(userSettingsContent);
          }
          return '{}';
        },
      );

      const settings = loadSettings(MOCK_WORKSPACE_DIR);

      expect(settings.user.settings.shouldUseNodePtyShell).toBe(true);
      expect(settings.merged.shouldUseNodePtyShell).toBe(true);
    });

    it('migrates legacy tools.shell.enableInteractiveShell to shouldUseNodePtyShell', () => {
      const expectedUserSettingsPath = USER_SETTINGS_PATH;
      (mockFsExistsSync as Mock).mockImplementation(
        (p: fs.PathLike) => p === expectedUserSettingsPath,
      );
      const userSettingsContent = {
        tools: {
          shell: {
            enableInteractiveShell: true,
          },
        },
      };
      (fs.readFileSync as Mock).mockImplementation(
        (p: fs.PathOrFileDescriptor) => {
          if (p === expectedUserSettingsPath) {
            return JSON.stringify(userSettingsContent);
          }
          return '{}';
        },
      );

      const settings = loadSettings(MOCK_WORKSPACE_DIR);

      expect(settings.user.settings.shouldUseNodePtyShell).toBe(true);
      expect(settings.merged.shouldUseNodePtyShell).toBe(true);
    });

    it('retains explicit shouldUseNodePtyShell when legacy values are present', () => {
      const expectedUserSettingsPath = USER_SETTINGS_PATH;
      (mockFsExistsSync as Mock).mockImplementation(
        (p: fs.PathLike) => p === expectedUserSettingsPath,
      );
      const userSettingsContent = {
        shouldUseNodePtyShell: false,
        tools: {
          usePty: true,
          shell: {
            enableInteractiveShell: true,
          },
        },
      };
      (fs.readFileSync as Mock).mockImplementation(
        (p: fs.PathOrFileDescriptor) => {
          if (p === expectedUserSettingsPath) {
            return JSON.stringify(userSettingsContent);
          }
          return '{}';
        },
      );

      const settings = loadSettings(MOCK_WORKSPACE_DIR);

      expect(settings.user.settings.shouldUseNodePtyShell).toBe(false);
      expect(settings.merged.shouldUseNodePtyShell).toBe(false);
    });

    it('should migrate disableUpdateNag to enableAutoUpdateNotification in system and systemDefaults settings', () => {
      const systemSettingsContent = {
        disableUpdateNag: true,
      };
      const systemDefaultsContent = {
        disableUpdateNag: false,
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      (fs.readFileSync as Mock).mockImplementation(
        (p: fs.PathOrFileDescriptor) => {
          if (p === getSystemSettingsPath()) {
            return JSON.stringify(systemSettingsContent);
          }
          if (p === getSystemDefaultsPath()) {
            return JSON.stringify(systemDefaultsContent);
          }
          return '{}';
        },
      );

      const settings = loadSettings(MOCK_WORKSPACE_DIR);

      // Verify system settings were migrated
      expect(settings.system.settings).toHaveProperty(
        'enableAutoUpdateNotification',
      );
      expect(
        (settings.system.settings as Record<string, unknown>)[
          'enableAutoUpdateNotification'
        ],
      ).toBe(false);

      // Verify systemDefaults settings were migrated
      expect(settings.systemDefaults.settings).toHaveProperty(
        'enableAutoUpdateNotification',
      );
      expect(
        (settings.systemDefaults.settings as Record<string, unknown>)[
          'enableAutoUpdateNotification'
        ],
      ).toBe(true);

      // Merged reflects system scope (system overrides defaults)
      expect(settings.merged.enableAutoUpdateNotification).toBe(false);
    });

    it('should migrate disableAutoUpdate to enableAutoUpdate in user settings', () => {
      const userSettingsContent = {
        disableAutoUpdate: true,
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      (fs.readFileSync as Mock).mockImplementation(
        (p: fs.PathOrFileDescriptor) => {
          if (p === USER_SETTINGS_PATH) {
            return JSON.stringify(userSettingsContent);
          }
          return '{}';
        },
      );

      const settings = loadSettings(MOCK_WORKSPACE_DIR);

      // Verify migrated value (inverted: disableAutoUpdate=true → enableAutoUpdate=false)
      expect(
        (settings.user.settings as Record<string, unknown>)['enableAutoUpdate'],
      ).toBe(false);
      expect(settings.merged.enableAutoUpdate).toBe(false);
    });

    it('should migrate accessibility.disableLoadingPhrases to accessibility.enableLoadingPhrases', () => {
      const userSettingsContent = {
        accessibility: {
          disableLoadingPhrases: true,
        },
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      (fs.readFileSync as Mock).mockImplementation(
        (p: fs.PathOrFileDescriptor) => {
          if (p === USER_SETTINGS_PATH) {
            return JSON.stringify(userSettingsContent);
          }
          return '{}';
        },
      );

      const settings = loadSettings(MOCK_WORKSPACE_DIR);

      // Verify migrated value (inverted: disableLoadingPhrases=true → enableLoadingPhrases=false)
      expect(
        (settings.user.settings.ui?.accessibility as Record<string, unknown>)[
          'enableLoadingPhrases'
        ],
      ).toBe(false);
      expect(settings.merged.accessibility?.enableLoadingPhrases).toBe(false);
    });

    it('should migrate ui.disableLoadingPhrases to ui.accessibility.enableLoadingPhrases', () => {
      const userSettingsContent = {
        ui: {
          disableLoadingPhrases: true,
        },
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      (fs.readFileSync as Mock).mockImplementation(
        (p: fs.PathOrFileDescriptor) => {
          if (p === USER_SETTINGS_PATH) {
            return JSON.stringify(userSettingsContent);
          }
          return '{}';
        },
      );

      const settings = loadSettings(MOCK_WORKSPACE_DIR);

      // Verify migrated value (inverted: disableLoadingPhrases=true → enableLoadingPhrases=false)
      expect(
        (settings.user.settings.ui?.accessibility as Record<string, unknown>)[
          'enableLoadingPhrases'
        ],
      ).toBe(false);
      expect(settings.merged.accessibility?.enableLoadingPhrases).toBe(false);
    });
  });
});
