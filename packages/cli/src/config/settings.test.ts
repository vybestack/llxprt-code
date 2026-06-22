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
  SETTINGS_DIRECTORY_NAME,
  getSystemSettingsPath,
} from './settings';

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
    it('should load empty settings if no files exist', () => {
      const settings = loadSettings(MOCK_WORKSPACE_DIR);
      expect(settings.system.settings).toStrictEqual({});
      expect(settings.user.settings).toStrictEqual({});
      expect(settings.workspace.settings).toStrictEqual({});
      // Schema defaults are now recursively extracted for nested objects
      // Test key nested defaults that demonstrate the fix is working
      expect(settings.merged.accessibility).toStrictEqual({
        enableLoadingPhrases: true,
        screenReader: false,
      });
      expect(settings.merged.checkpointing).toStrictEqual({ enabled: false });
      expect(settings.merged.fileFiltering).toStrictEqual({
        respectGitIgnore: true,
        respectLlxprtIgnore: true,
        enableRecursiveFileSearch: true,
        enableFuzzySearch: true,
        maxFileCount: 20000,
        searchTimeout: 5000,
      });
      expect(settings.merged.security).toStrictEqual({
        disableYoloMode: false,
        folderTrust: { enabled: false },
        auth: {},
        blockGitExtensions: false,
        enablePermanentToolApproval: false,
        environmentVariableRedaction: {
          enabled: false,
          allowed: [],
          blocked: [],
        },
      });
      expect(settings.merged.tools).toMatchObject({
        autoAccept: false,
        enableToolOutputTruncation: true,
      });
      expect(settings.merged.mcp).toStrictEqual({});
      expect(settings.merged.output).toStrictEqual({ format: 'text' });
      expect(settings.merged.selectedAuthType).toBeUndefined();
      expect(settings.errors.length).toBe(0);
    });

    it('should load system settings if only system file exists', () => {
      (mockFsExistsSync as Mock).mockImplementation(
        (p: fs.PathLike) => p === getSystemSettingsPath(),
      );
      const systemSettingsContent = {
        enableAutoUpdate: true,
        enableAutoUpdateNotification: false,
      };
      (fs.readFileSync as Mock).mockImplementation(
        (p: fs.PathOrFileDescriptor) => {
          if (p === getSystemSettingsPath())
            return JSON.stringify(systemSettingsContent);
          return '{}';
        },
      );

      const settings = loadSettings(MOCK_WORKSPACE_DIR);

      expect(fs.readFileSync).toHaveBeenCalledWith(
        getSystemSettingsPath(),
        'utf-8',
      );
      // Migration adds enableAutoUpdate/enableAutoUpdateNotification — use toMatchObject
      expect(settings.system.settings).toMatchObject(systemSettingsContent);
      expect(settings.user.settings).toStrictEqual({});
      expect(settings.workspace.settings).toStrictEqual({});
      expect(settings.merged).toMatchObject({
        accessibility: {},
        chatCompression: {},
        checkpointing: {},
        coreToolSettings: {},
        enableAutoUpdate: true,
        enableAutoUpdateNotification: false,
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

    it('should use folderTrust from workspace settings when trusted', () => {
      (mockFsExistsSync as Mock).mockReturnValue(true);
      const userSettingsContent = {
        folderTrust: true,
      };
      const workspaceSettingsContent = {
        folderTrust: false, // Workspace value should override when trusted
      };
      const systemSettingsContent = {
        // No folderTrust here
      };

      (fs.readFileSync as Mock).mockImplementation(
        (p: fs.PathOrFileDescriptor) => {
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
      expect(settings.merged.folderTrust).toBe(false); // Workspace setting should be used
    });

    it('should use system folderTrust over user setting', () => {
      (mockFsExistsSync as Mock).mockReturnValue(true);
      const userSettingsContent = {
        folderTrust: false,
      };
      const workspaceSettingsContent = {
        folderTrust: true, // This should be ignored
      };
      const systemSettingsContent = {
        folderTrust: true,
      };

      (fs.readFileSync as Mock).mockImplementation(
        (p: fs.PathOrFileDescriptor) => {
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
      expect(settings.merged.folderTrust).toBe(true); // System setting should be used
    });

    it('should not allow user or workspace to override system disableYoloMode', () => {
      (mockFsExistsSync as Mock).mockReturnValue(true);
      const userSettingsContent = {
        security: {
          disableYoloMode: false,
        },
      };
      const workspaceSettingsContent = {
        security: {
          disableYoloMode: false, // This should be ignored
        },
      };
      const systemSettingsContent = {
        security: {
          disableYoloMode: true,
        },
      };

      (fs.readFileSync as Mock).mockImplementation(
        (p: fs.PathOrFileDescriptor) => {
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
      expect(settings.merged.security.disableYoloMode).toBe(true); // System setting should be used
    });

    it('should handle contextFileName correctly when only in user settings', () => {
      (mockFsExistsSync as Mock).mockImplementation(
        (p: fs.PathLike) => p === USER_SETTINGS_PATH,
      );
      const userSettingsContent = { contextFileName: 'CUSTOM.md' };
      (fs.readFileSync as Mock).mockImplementation(
        (p: fs.PathOrFileDescriptor) => {
          if (p === USER_SETTINGS_PATH)
            return JSON.stringify(userSettingsContent);
          return '{}';
        },
      );

      const settings = loadSettings(MOCK_WORKSPACE_DIR);
      expect(settings.merged.contextFileName).toBe('CUSTOM.md');
    });

    it('should handle contextFileName correctly when only in workspace settings', () => {
      (mockFsExistsSync as Mock).mockImplementation(
        (p: fs.PathLike) => p === MOCK_WORKSPACE_SETTINGS_PATH,
      );
      const workspaceSettingsContent = {
        contextFileName: 'PROJECT_SPECIFIC.md',
      };
      (fs.readFileSync as Mock).mockImplementation(
        (p: fs.PathOrFileDescriptor) => {
          if (p === MOCK_WORKSPACE_SETTINGS_PATH)
            return JSON.stringify(workspaceSettingsContent);
          return '{}';
        },
      );

      const settings = loadSettings(MOCK_WORKSPACE_DIR);
      expect(settings.merged.contextFileName).toBe('PROJECT_SPECIFIC.md');
    });

    it('should handle excludedProjectEnvVars correctly when only in user settings', () => {
      (mockFsExistsSync as Mock).mockImplementation(
        (p: fs.PathLike) => p === USER_SETTINGS_PATH,
      );
      const userSettingsContent = {
        excludedProjectEnvVars: ['DEBUG', 'NODE_ENV', 'CUSTOM_VAR'],
      };
      (fs.readFileSync as Mock).mockImplementation(
        (p: fs.PathOrFileDescriptor) => {
          if (p === USER_SETTINGS_PATH)
            return JSON.stringify(userSettingsContent);
          return '{}';
        },
      );

      const settings = loadSettings(MOCK_WORKSPACE_DIR);
      expect(settings.merged.excludedProjectEnvVars).toStrictEqual([
        'DEBUG',
        'NODE_ENV',
        'CUSTOM_VAR',
      ]);
    });

    it('should handle excludedProjectEnvVars correctly when only in workspace settings', () => {
      (mockFsExistsSync as Mock).mockImplementation(
        (p: fs.PathLike) => p === MOCK_WORKSPACE_SETTINGS_PATH,
      );
      const workspaceSettingsContent = {
        excludedProjectEnvVars: ['WORKSPACE_DEBUG', 'WORKSPACE_VAR'],
      };
      (fs.readFileSync as Mock).mockImplementation(
        (p: fs.PathOrFileDescriptor) => {
          if (p === MOCK_WORKSPACE_SETTINGS_PATH)
            return JSON.stringify(workspaceSettingsContent);
          return '{}';
        },
      );

      const settings = loadSettings(MOCK_WORKSPACE_DIR);
      expect(settings.merged.excludedProjectEnvVars).toStrictEqual([
        'WORKSPACE_DEBUG',
        'WORKSPACE_VAR',
      ]);
    });

    it('should merge excludedProjectEnvVars with workspace taking precedence over user', () => {
      (mockFsExistsSync as Mock).mockReturnValue(true);
      const userSettingsContent = {
        excludedProjectEnvVars: ['DEBUG', 'NODE_ENV', 'USER_VAR'],
      };
      const workspaceSettingsContent = {
        excludedProjectEnvVars: ['WORKSPACE_DEBUG', 'WORKSPACE_VAR'],
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

    it('should default contextFileName to undefined if not in any settings file', () => {
      (mockFsExistsSync as Mock).mockReturnValue(true);
      const userSettingsContent = { enableAutoUpdate: true };
      const workspaceSettingsContent = { enableAutoUpdateNotification: false };
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
      expect(settings.merged.contextFileName).toBeUndefined();
    });

    it('should load enableAutoUpdate setting from user settings', () => {
      (mockFsExistsSync as Mock).mockImplementation(
        (p: fs.PathLike) => p === USER_SETTINGS_PATH,
      );
      const userSettingsContent = { enableAutoUpdate: false };
      (fs.readFileSync as Mock).mockImplementation(
        (p: fs.PathOrFileDescriptor) => {
          if (p === USER_SETTINGS_PATH)
            return JSON.stringify(userSettingsContent);
          return '{}';
        },
      );
      const settings = loadSettings(MOCK_WORKSPACE_DIR);
      expect(settings.merged.enableAutoUpdate).toBe(false);
    });

    it('should load enableAutoUpdate setting from workspace settings', () => {
      (mockFsExistsSync as Mock).mockImplementation(
        (p: fs.PathLike) => p === MOCK_WORKSPACE_SETTINGS_PATH,
      );
      const workspaceSettingsContent = { enableAutoUpdate: true };
      (fs.readFileSync as Mock).mockImplementation(
        (p: fs.PathOrFileDescriptor) => {
          if (p === MOCK_WORKSPACE_SETTINGS_PATH)
            return JSON.stringify(workspaceSettingsContent);
          return '{}';
        },
      );
      const settings = loadSettings(MOCK_WORKSPACE_DIR);
      expect(settings.merged.enableAutoUpdate).toBe(true);
    });

    it('should prioritize workspace enableAutoUpdate setting over user setting', () => {
      (mockFsExistsSync as Mock).mockReturnValue(true);
      const userSettingsContent = { enableAutoUpdate: false };
      const workspaceSettingsContent = { enableAutoUpdate: true };
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
      expect(settings.merged.enableAutoUpdate).toBe(true);
    });

    it('should have telemetry as empty object if not in any settings file', () => {
      (mockFsExistsSync as Mock).mockReturnValue(false); // No settings files exist
      (fs.readFileSync as Mock).mockReturnValue('{}');
      const settings = loadSettings(MOCK_WORKSPACE_DIR);
      expect(settings.merged.telemetry).toStrictEqual({});
      expect(settings.merged.ui.customThemes).toStrictEqual({});
      expect(settings.merged.mcpServers).toStrictEqual({});
    });

    it('should merge MCP servers correctly, with workspace taking precedence', () => {
      (mockFsExistsSync as Mock).mockReturnValue(true);
      const userSettingsContent = {
        mcpServers: {
          'user-server': {
            command: 'user-command',
            args: ['--user-arg'],
            description: 'User MCP server',
          },
          'shared-server': {
            command: 'user-shared-command',
            description: 'User shared server config',
          },
        },
      };
      const workspaceSettingsContent = {
        mcpServers: {
          'workspace-server': {
            command: 'workspace-command',
            args: ['--workspace-arg'],
            description: 'Workspace MCP server',
          },
          'shared-server': {
            command: 'workspace-shared-command',
            description: 'Workspace shared server config',
          },
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

      expect(settings.user.settings).toStrictEqual(userSettingsContent);
      expect(settings.workspace.settings).toStrictEqual(
        workspaceSettingsContent,
      );
      expect(settings.merged.mcpServers).toStrictEqual({
        'user-server': {
          command: 'user-command',
          args: ['--user-arg'],
          description: 'User MCP server',
        },
        'workspace-server': {
          command: 'workspace-command',
          args: ['--workspace-arg'],
          description: 'Workspace MCP server',
        },
        'shared-server': {
          command: 'workspace-shared-command',
          description: 'Workspace shared server config',
        },
      });
    });

    it('should handle MCP servers when only in user settings', () => {
      (mockFsExistsSync as Mock).mockImplementation(
        (p: fs.PathLike) => p === USER_SETTINGS_PATH,
      );
      const userSettingsContent = {
        mcpServers: {
          'user-only-server': {
            command: 'user-only-command',
            description: 'User only server',
          },
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
      expect(settings.merged.mcpServers).toStrictEqual({
        'user-only-server': {
          command: 'user-only-command',
          description: 'User only server',
        },
      });
    });

    it('should handle MCP servers when only in workspace settings', () => {
      (mockFsExistsSync as Mock).mockImplementation(
        (p: fs.PathLike) => p === MOCK_WORKSPACE_SETTINGS_PATH,
      );
      const workspaceSettingsContent = {
        mcpServers: {
          'workspace-only-server': {
            command: 'workspace-only-command',
            description: 'Workspace only server',
          },
        },
      };
      (fs.readFileSync as Mock).mockImplementation(
        (p: fs.PathOrFileDescriptor) => {
          if (p === MOCK_WORKSPACE_SETTINGS_PATH)
            return JSON.stringify(workspaceSettingsContent);
          return '{}';
        },
      );

      const settings = loadSettings(MOCK_WORKSPACE_DIR);
      expect(settings.merged.mcpServers).toStrictEqual({
        'workspace-only-server': {
          command: 'workspace-only-command',
          description: 'Workspace only server',
        },
      });
    });

    it('should have mcpServers as empty object if not in any settings file', () => {
      (mockFsExistsSync as Mock).mockReturnValue(false); // No settings files exist
      (fs.readFileSync as Mock).mockReturnValue('{}');
      const settings = loadSettings(MOCK_WORKSPACE_DIR);
      expect(settings.merged.mcpServers).toStrictEqual({});
    });

    it('should merge chatCompression settings, with workspace taking precedence', () => {
      (mockFsExistsSync as Mock).mockReturnValue(true);
      const userSettingsContent = {
        chatCompression: { contextPercentageThreshold: 0.5 },
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

      expect(settings.user.settings.chatCompression).toStrictEqual({
        contextPercentageThreshold: 0.5,
      });
      expect(settings.workspace.settings.chatCompression).toStrictEqual({
        contextPercentageThreshold: 0.8,
      });
      expect(settings.merged.chatCompression).toStrictEqual({
        contextPercentageThreshold: 0.8,
      });
    });
  });
});
