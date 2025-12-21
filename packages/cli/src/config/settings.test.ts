/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/// <reference types="vitest/globals" />

// Mock 'os' first.
import * as osActual from 'os'; // Import for type info for the mock factory
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
import path, * as pathActual from 'node:path'; // Restored for MOCK_WORKSPACE_SETTINGS_PATH
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
import { disableExtension } from './extension.js';

// These imports will get the versions from the vi.mock('./settings.js', ...) factory.
import {
  loadSettings,
  USER_SETTINGS_PATH, // This IS the mocked path.
  getSystemSettingsPath,
  getSystemDefaultsPath,
  SETTINGS_DIRECTORY_NAME, // This is from the original module, but used by the mock.
  SettingScope,
  type Settings,
  loadEnvironment,
} from './settings';
import { FatalConfigError, LLXPRT_DIR } from '@vybestack/llxprt-code-core';

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
      expect(settings.system.settings).toEqual({});
      expect(settings.user.settings).toEqual({});
      expect(settings.workspace.settings).toEqual({});
      // Schema defaults are now recursively extracted for nested objects
      // Test key nested defaults that demonstrate the fix is working
      expect(settings.merged.accessibility).toEqual({
        disableLoadingPhrases: false,
        screenReader: false,
      });
      expect(settings.merged.checkpointing).toEqual({ enabled: false });
      expect(settings.merged.fileFiltering).toEqual({
        respectGitIgnore: true,
        respectLlxprtIgnore: true,
        enableRecursiveFileSearch: true,
        disableFuzzySearch: false,
      });
      expect(settings.merged.security).toEqual({
        folderTrust: { enabled: false },
        auth: {},
      });
      expect(settings.merged.tools).toMatchObject({
        autoAccept: false,
        useRipgrep: false,
        enableToolOutputTruncation: true,
      });
      expect(settings.merged.mcp).toEqual({});
      expect(settings.merged.output).toEqual({ format: 'text' });
      expect(settings.merged.selectedAuthType).toBe('provider');
      expect(settings.errors.length).toBe(0);
    });

    it('should load system settings if only system file exists', () => {
      (mockFsExistsSync as Mock).mockImplementation(
        (p: fs.PathLike) => p === getSystemSettingsPath(),
      );
      const systemSettingsContent = {
        theme: 'system-default',
        sandbox: false,
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
      expect(settings.system.settings).toEqual(systemSettingsContent);
      expect(settings.user.settings).toEqual({});
      expect(settings.workspace.settings).toEqual({});
      expect(settings.merged).toMatchObject({
        accessibility: {},
        chatCompression: {},
        checkpointing: {},
        coreToolSettings: {},
        debugKeystrokeLogging: false,
        disableAutoUpdate: false,
        disableUpdateNag: false,
        emojifilter: 'auto',
        enablePromptCompletion: false,
        enableTextToolCallParsing: false,
        excludedProjectEnvVars: ['DEBUG', 'DEBUG_MODE'],
        extensionManagement: false,
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
        selectedAuthType: 'provider',
        shellReplacement: false,
        shouldUseNodePtyShell: false,
        showLineNumbers: false,
        showStatusInTitle: false,
        textToolCallModels: [],
        toolCallProcessingMode: 'legacy',
        tools: {},
        ui: {
          customThemes: {},
          theme: undefined,
        },
        useRipgrep: false,
        ...systemSettingsContent,
      });
    });

    it('should load user settings if only user file exists', () => {
      const expectedUserSettingsPath = USER_SETTINGS_PATH; // Use the path actually resolved by the (mocked) module

      (mockFsExistsSync as Mock).mockImplementation(
        (p: fs.PathLike) => p === expectedUserSettingsPath,
      );
      const userSettingsContent = {
        theme: 'dark',
        contextFileName: 'USER_CONTEXT.md',
      };
      (fs.readFileSync as Mock).mockImplementation(
        (p: fs.PathOrFileDescriptor) => {
          if (p === expectedUserSettingsPath)
            return JSON.stringify(userSettingsContent);
          return '{}';
        },
      );

      const settings = loadSettings(MOCK_WORKSPACE_DIR);

      expect(fs.readFileSync).toHaveBeenCalledWith(
        expectedUserSettingsPath,
        'utf-8',
      );
      expect(settings.user.settings).toEqual(userSettingsContent);
      expect(settings.workspace.settings).toEqual({});
      expect(settings.merged).toMatchObject({
        accessibility: {},
        chatCompression: {},
        checkpointing: {},
        contextFileName: 'USER_CONTEXT.md',
        coreToolSettings: {},
        debugKeystrokeLogging: false,
        disableAutoUpdate: false,
        disableUpdateNag: false,
        emojifilter: 'auto',
        enablePromptCompletion: false,
        enableTextToolCallParsing: false,
        excludedProjectEnvVars: ['DEBUG', 'DEBUG_MODE'],
        extensionManagement: false,
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
        selectedAuthType: 'provider',
        shellReplacement: false,
        shouldUseNodePtyShell: false,
        showLineNumbers: false,
        showStatusInTitle: false,
        textToolCallModels: [],
        theme: 'dark',
        toolCallProcessingMode: 'legacy',
        tools: {},
        ui: {
          customThemes: {},
          theme: undefined,
        },
        useRipgrep: false,
      });
      expect(settings.errors.length).toBe(0);
    });

    it('should load workspace settings if only workspace file exists', () => {
      (mockFsExistsSync as Mock).mockImplementation(
        (p: fs.PathLike) => p === MOCK_WORKSPACE_SETTINGS_PATH,
      );
      const workspaceSettingsContent = {
        sandbox: true,
        contextFileName: 'WORKSPACE_CONTEXT.md',
      };
      (fs.readFileSync as Mock).mockImplementation(
        (p: fs.PathOrFileDescriptor) => {
          if (p === MOCK_WORKSPACE_SETTINGS_PATH)
            return JSON.stringify(workspaceSettingsContent);
          return '{}';
        },
      );

      const settings = loadSettings(MOCK_WORKSPACE_DIR);

      expect(fs.readFileSync).toHaveBeenCalledWith(
        MOCK_WORKSPACE_SETTINGS_PATH,
        'utf-8',
      );
      expect(settings.user.settings).toEqual({});
      expect(settings.workspace.settings).toEqual(workspaceSettingsContent);
      expect(settings.merged).toMatchObject({
        accessibility: {},
        chatCompression: {},
        checkpointing: {},
        contextFileName: 'WORKSPACE_CONTEXT.md',
        coreToolSettings: {},
        debugKeystrokeLogging: false,
        disableAutoUpdate: false,
        disableUpdateNag: false,
        emojifilter: 'auto',
        enablePromptCompletion: false,
        enableTextToolCallParsing: false,
        excludedProjectEnvVars: ['DEBUG', 'DEBUG_MODE'],
        extensionManagement: false,
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
        sandbox: true,
        security: {},
        selectedAuthType: 'provider',
        shellReplacement: false,
        shouldUseNodePtyShell: false,
        showLineNumbers: false,
        showStatusInTitle: false,
        textToolCallModels: [],
        toolCallProcessingMode: 'legacy',
        tools: {},
        ui: {
          customThemes: {},
          theme: undefined,
        },
        useRipgrep: false,
      });
      expect(settings.errors.length).toBe(0);
    });

    it('should merge user and workspace settings, with workspace taking precedence', () => {
      (mockFsExistsSync as Mock).mockReturnValue(true);
      const userSettingsContent = {
        theme: 'dark',
        sandbox: false,
        contextFileName: 'USER_CONTEXT.md',
      };
      const workspaceSettingsContent = {
        sandbox: true,
        coreTools: ['tool1'],
        contextFileName: 'WORKSPACE_CONTEXT.md',
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

      expect(settings.user.settings).toEqual(userSettingsContent);
      expect(settings.workspace.settings).toEqual(workspaceSettingsContent);
      expect(settings.merged).toMatchObject({
        accessibility: {},
        chatCompression: {},
        checkpointing: {},
        contextFileName: 'WORKSPACE_CONTEXT.md',
        coreTools: ['tool1'],
        coreToolSettings: {},
        debugKeystrokeLogging: false,
        disableAutoUpdate: false,
        disableUpdateNag: false,
        emojifilter: 'auto',
        enablePromptCompletion: false,
        enableTextToolCallParsing: false,
        excludedProjectEnvVars: ['DEBUG', 'DEBUG_MODE'],
        extensionManagement: false,
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
        sandbox: true,
        security: {},
        selectedAuthType: 'provider',
        shellReplacement: false,
        shouldUseNodePtyShell: false,
        showLineNumbers: false,
        showStatusInTitle: false,
        textToolCallModels: [],
        theme: 'dark',
        toolCallProcessingMode: 'legacy',
        tools: {},
        ui: {
          customThemes: {},
          theme: undefined,
        },
        useRipgrep: false,
      });
      expect(settings.errors.length).toBe(0);
    });

    it('should merge system, user, and workspace settings with workspace overriding user and user overriding system for theme', () => {
      (mockFsExistsSync as Mock).mockReturnValue(true);
      const systemSettingsContent = {
        theme: 'system-theme',
        sandbox: false,
        allowMCPServers: ['server1', 'server2'],
        telemetry: { enabled: false },
      };
      const userSettingsContent = {
        theme: 'dark',
        sandbox: true,
        contextFileName: 'USER_CONTEXT.md',
      };
      const workspaceSettingsContent = {
        sandbox: false,
        coreTools: ['tool1'],
        contextFileName: 'WORKSPACE_CONTEXT.md',
        allowMCPServers: ['server1', 'server2', 'server3'],
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

      expect(settings.system.settings).toEqual(systemSettingsContent);
      expect(settings.user.settings).toEqual(userSettingsContent);
      expect(settings.workspace.settings).toEqual(workspaceSettingsContent);
      expect(settings.merged).toMatchObject({
        accessibility: {},
        allowMCPServers: ['server1', 'server2'],
        chatCompression: {},
        checkpointing: {},
        contextFileName: 'WORKSPACE_CONTEXT.md',
        coreTools: ['tool1'],
        coreToolSettings: {},
        debugKeystrokeLogging: false,
        disableAutoUpdate: false,
        disableUpdateNag: false,
        emojifilter: 'auto',
        enablePromptCompletion: false,
        enableTextToolCallParsing: false,
        excludedProjectEnvVars: ['DEBUG', 'DEBUG_MODE'],
        extensionManagement: false,
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
        sandbox: false,
        security: {},
        selectedAuthType: 'provider',
        shellReplacement: false,
        shouldUseNodePtyShell: false,
        showLineNumbers: false,
        showStatusInTitle: false,
        telemetry: { enabled: false },
        textToolCallModels: [],
        theme: 'system-theme',
        toolCallProcessingMode: 'legacy',
        tools: {},
        ui: {
          customThemes: {},
          theme: undefined,
        },
        useRipgrep: false,
      });
      expect(settings.errors.length).toBe(0);
    });

    it('should merge all settings files with the correct precedence, letting user/workspace themes override system', () => {
      (mockFsExistsSync as Mock).mockReturnValue(true);
      const systemDefaultsContent = {
        theme: 'default-theme',
        sandbox: true,
        telemetry: true,
        includeDirectories: ['/system/defaults/dir'],
      };
      const userSettingsContent = {
        theme: 'user-theme',
        contextFileName: 'USER_CONTEXT.md',
        includeDirectories: ['/user/dir1', '/user/dir2'],
      };
      const workspaceSettingsContent = {
        sandbox: false,
        contextFileName: 'WORKSPACE_CONTEXT.md',
        includeDirectories: ['/workspace/dir'],
      };
      const systemSettingsContent = {
        theme: 'system-theme',
        telemetry: false,
        includeDirectories: ['/system/dir'],
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

      expect(settings.systemDefaults.settings).toEqual(systemDefaultsContent);
      expect(settings.system.settings).toEqual(systemSettingsContent);
      expect(settings.user.settings).toEqual(userSettingsContent);
      expect(settings.workspace.settings).toEqual(workspaceSettingsContent);
      expect(settings.merged).toMatchObject({
        accessibility: {},
        chatCompression: {},
        checkpointing: {},
        contextFileName: 'WORKSPACE_CONTEXT.md',
        coreToolSettings: {},
        debugKeystrokeLogging: false,
        disableAutoUpdate: false,
        disableUpdateNag: false,
        emojifilter: 'auto',
        enablePromptCompletion: false,
        enableTextToolCallParsing: false,
        excludedProjectEnvVars: ['DEBUG', 'DEBUG_MODE'],
        extensionManagement: false,
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
        includeDirectories: [
          '/system/defaults/dir',
          '/user/dir1',
          '/user/dir2',
          '/workspace/dir',
          '/system/dir',
        ],
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
        sandbox: false,
        security: {},
        selectedAuthType: 'provider',
        shellReplacement: false,
        shouldUseNodePtyShell: false,
        showLineNumbers: false,
        showStatusInTitle: false,
        telemetry: false,
        textToolCallModels: [],
        theme: 'system-theme',
        toolCallProcessingMode: 'legacy',
        tools: {},
        ui: {
          customThemes: {},
          theme: undefined,
        },
        useRipgrep: false,
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
      expect(settings.merged.excludedProjectEnvVars).toEqual([
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
      expect(settings.merged.excludedProjectEnvVars).toEqual([
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

      expect(settings.user.settings.excludedProjectEnvVars).toEqual([
        'DEBUG',
        'NODE_ENV',
        'USER_VAR',
      ]);
      expect(settings.workspace.settings.excludedProjectEnvVars).toEqual([
        'WORKSPACE_DEBUG',
        'WORKSPACE_VAR',
      ]);
      expect(settings.merged.excludedProjectEnvVars).toEqual([
        'WORKSPACE_DEBUG',
        'WORKSPACE_VAR',
      ]);
    });

    it('should default contextFileName to undefined if not in any settings file', () => {
      (mockFsExistsSync as Mock).mockReturnValue(true);
      const userSettingsContent = { theme: 'dark' };
      const workspaceSettingsContent = { sandbox: true };
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

    it('should load telemetry setting from user settings', () => {
      (mockFsExistsSync as Mock).mockImplementation(
        (p: fs.PathLike) => p === USER_SETTINGS_PATH,
      );
      const userSettingsContent = { telemetry: true };
      (fs.readFileSync as Mock).mockImplementation(
        (p: fs.PathOrFileDescriptor) => {
          if (p === USER_SETTINGS_PATH)
            return JSON.stringify(userSettingsContent);
          return '{}';
        },
      );
      const settings = loadSettings(MOCK_WORKSPACE_DIR);
      expect(settings.merged.telemetry).toBe(true);
    });

    it('should load telemetry setting from workspace settings', () => {
      (mockFsExistsSync as Mock).mockImplementation(
        (p: fs.PathLike) => p === MOCK_WORKSPACE_SETTINGS_PATH,
      );
      const workspaceSettingsContent = { telemetry: false };
      (fs.readFileSync as Mock).mockImplementation(
        (p: fs.PathOrFileDescriptor) => {
          if (p === MOCK_WORKSPACE_SETTINGS_PATH)
            return JSON.stringify(workspaceSettingsContent);
          return '{}';
        },
      );
      const settings = loadSettings(MOCK_WORKSPACE_DIR);
      expect(settings.merged.telemetry).toBe(false);
    });

    it('should prioritize workspace telemetry setting over user setting', () => {
      (mockFsExistsSync as Mock).mockReturnValue(true);
      const userSettingsContent = { telemetry: true };
      const workspaceSettingsContent = { telemetry: false };
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
      expect(settings.merged.telemetry).toBe(false);
    });

    it('should have telemetry as undefined if not in any settings file', () => {
      (mockFsExistsSync as Mock).mockReturnValue(false); // No settings files exist
      (fs.readFileSync as Mock).mockReturnValue('{}');
      const settings = loadSettings(MOCK_WORKSPACE_DIR);
      expect(settings.merged.telemetry).toBeUndefined();
      expect(settings.merged.ui?.customThemes).toEqual({});
      expect(settings.merged.mcpServers).toEqual({});
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

      expect(settings.user.settings).toEqual(userSettingsContent);
      expect(settings.workspace.settings).toEqual(workspaceSettingsContent);
      expect(settings.merged.mcpServers).toEqual({
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
      expect(settings.merged.mcpServers).toEqual({
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
      expect(settings.merged.mcpServers).toEqual({
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
      expect(settings.merged.mcpServers).toEqual({});
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

      expect(settings.user.settings.chatCompression).toEqual({
        contextPercentageThreshold: 0.5,
      });
      expect(settings.workspace.settings.chatCompression).toEqual({
        contextPercentageThreshold: 0.8,
      });
      expect(settings.merged.chatCompression).toEqual({
        contextPercentageThreshold: 0.8,
      });
    });

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
      expect(settings.merged.chatCompression).toEqual({
        contextPercentageThreshold: 0.5,
      });
    });

    it('should have chatCompression as an empty object if not in any settings file', () => {
      (mockFsExistsSync as Mock).mockReturnValue(false); // No settings files exist
      (fs.readFileSync as Mock).mockReturnValue('{}');
      const settings = loadSettings(MOCK_WORKSPACE_DIR);
      expect(settings.merged.chatCompression).toEqual({});
    });

    // Test removed - chatCompression validation was removed in upstream commit e6e60861
    it.skip('should ignore chatCompression if contextPercentageThreshold is invalid', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      (mockFsExistsSync as Mock).mockImplementation(
        (p: fs.PathLike) => p === USER_SETTINGS_PATH,
      );
      const userSettingsContent = {
        chatCompression: { contextPercentageThreshold: 1.5 },
      };
      (fs.readFileSync as Mock).mockImplementation(
        (p: fs.PathOrFileDescriptor) => {
          if (p === USER_SETTINGS_PATH)
            return JSON.stringify(userSettingsContent);
          return '{}';
        },
      );

      const settings = loadSettings(MOCK_WORKSPACE_DIR);
      expect(settings.merged.chatCompression).toBeUndefined();
      expect(warnSpy).toHaveBeenCalledWith(
        'Invalid value for chatCompression.contextPercentageThreshold: "1.5". Please use a value between 0 and 1. Using default compression settings.',
      );
      warnSpy.mockRestore();
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

      expect(settings.merged.chatCompression).toEqual({
        contextPercentageThreshold: 0.5,
      });
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

      expect(settings.merged.includeDirectories).toEqual([
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

      const settings = loadSettings(MOCK_WORKSPACE_DIR);
      // @ts-expect-error: dynamic property for test
      expect(settings.user.settings.apiKey).toBe('user_api_key_from_env');
      // @ts-expect-error: dynamic property for test
      expect(settings.user.settings.someUrl).toBe(
        'https://test.com/user_api_key_from_env',
      );
      // @ts-expect-error: dynamic property for test
      expect(settings.merged.apiKey).toBe('user_api_key_from_env');
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
      expect(settings.workspace.settings.endpoint).toBe(
        'workspace_endpoint_from_env/api',
      );
      expect(settings.workspace.settings.nested.value).toBe(
        'workspace_endpoint_from_env',
      );
      // @ts-expect-error: dynamic property for test
      expect(settings.merged.endpoint).toBe('workspace_endpoint_from_env/api');
      delete process.env.WORKSPACE_ENDPOINT;
    });

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

      // Check resolved values in individual scopes
      // @ts-expect-error: dynamic property for test
      expect(settings.system.settings.configValue).toBe('final_value');
      // @ts-expect-error: dynamic property for test
      expect(settings.system.settings.systemOnly).toBe('system_value');
      // @ts-expect-error: dynamic property for test
      expect(settings.user.settings.configValue).toBe('final_value');
      // @ts-expect-error: dynamic property for test
      expect(settings.user.settings.userOnly).toBe('user_value');
      // @ts-expect-error: dynamic property for test
      expect(settings.workspace.settings.configValue).toBe('final_value');
      // @ts-expect-error: dynamic property for test
      expect(settings.workspace.settings.workspaceOnly).toBe('workspace_value');

      // Check merged values (workspace > user > system for themes)
      expect(settings.merged.theme).toBe('light');
      // @ts-expect-error: dynamic property for test
      expect(settings.merged.configValue).toBe('final_value');
      // @ts-expect-error: dynamic property for test
      expect(settings.merged.systemOnly).toBe('system_value');
      // @ts-expect-error: dynamic property for test
      expect(settings.merged.userOnly).toBe('user_value');
      // @ts-expect-error: dynamic property for test
      expect(settings.merged.workspaceOnly).toBe('workspace_value');

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

      const settings = loadSettings(MOCK_WORKSPACE_DIR);
      expect(settings.user.settings.apiKey).toBe('$UNDEFINED_VAR');
      expect(settings.merged.apiKey).toBe('$UNDEFINED_VAR');
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
      const settings = loadSettings(MOCK_WORKSPACE_DIR);
      expect(settings.user.settings.path).toBe('/path/valueA/valueB/end');
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
      const settings = loadSettings(MOCK_WORKSPACE_DIR);
      expect(settings.user.settings.list).toEqual([
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

      const settings = loadSettings(MOCK_WORKSPACE_DIR);

      expect(settings.user.settings.nullVal).toBeNull();
      expect(settings.user.settings.trueVal).toBe(true);
      expect(settings.user.settings.falseVal).toBe(false);
      expect(settings.user.settings.numberVal).toBe(123.45);
      expect(settings.user.settings.stringVal).toBe('env_string_value');
      expect(settings.user.settings.undefinedVal).toBeUndefined();

      expect(settings.user.settings.nestedObj.nestedNull).toBeNull();
      expect(settings.user.settings.nestedObj.nestedBool).toBe(true);
      expect(settings.user.settings.nestedObj.nestedNum).toBe(0);
      expect(settings.user.settings.nestedObj.nestedString).toBe('literal');
      expect(settings.user.settings.nestedObj.anotherEnv).toBe(
        'env_string_nested_value',
      );

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

      const settings = loadSettings(MOCK_WORKSPACE_DIR);
      expect(settings.user.settings.serverAddress).toBe('myhost:9090/api');

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
        const systemSettingsContent = {
          theme: 'env-var-theme',
          sandbox: true,
        };
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
        expect(settings.system.settings).toEqual(systemSettingsContent);
        expect(settings.merged).toMatchObject({
          accessibility: {},
          chatCompression: {},
          checkpointing: {},
          coreToolSettings: {},
          debugKeystrokeLogging: false,
          disableAutoUpdate: false,
          disableUpdateNag: false,
          emojifilter: 'auto',
          enablePromptCompletion: false,
          enableTextToolCallParsing: false,
          excludedProjectEnvVars: ['DEBUG', 'DEBUG_MODE'],
          extensionManagement: false,
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
          selectedAuthType: 'provider',
          shellReplacement: false,
          shouldUseNodePtyShell: false,
          showLineNumbers: false,
          showStatusInTitle: false,
          textToolCallModels: [],
          toolCallProcessingMode: 'legacy',
          tools: {},
          ui: {
            customThemes: {},
            theme: undefined,
          },
          useRipgrep: false,
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
  });

  describe('LoadedSettings class', () => {
    it('setValue should update the correct scope and recompute merged settings', () => {
      (mockFsExistsSync as Mock).mockReturnValue(false);
      const loadedSettings = loadSettings(MOCK_WORKSPACE_DIR);

      vi.mocked(fs.writeFileSync).mockImplementation(() => {});
      // mkdirSync is mocked in beforeEach to return undefined, which is fine for void usage

      loadedSettings.setValue(SettingScope.User, 'ui.theme', 'matrix');
      expect(loadedSettings.user.settings.ui?.theme).toBe('matrix');
      expect(loadedSettings.merged.ui?.theme).toBe('matrix');
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
      expect(loadedSettings.merged.ui?.contextFileName).toBe('MY_AGENTS.md');
      expect(loadedSettings.merged.ui?.theme).toBe('matrix'); // User setting should still be there
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        MOCK_WORKSPACE_SETTINGS_PATH,
        JSON.stringify({ ui: { contextFileName: 'MY_AGENTS.md' } }, null, 2),
        'utf-8',
      );

      // System theme should not override user/workspace themes
      loadedSettings.setValue(SettingScope.System, 'ui.theme', 'ocean');

      expect(loadedSettings.system.settings.ui?.theme).toBe('ocean');
      expect(loadedSettings.merged.ui?.theme).toBe('matrix');

      // SystemDefaults theme is overridden by user, workspace, and system themes
      loadedSettings.setValue(
        SettingScope.SystemDefaults,
        'ui.theme',
        'default',
      );
      expect(loadedSettings.systemDefaults.settings.ui?.theme).toBe('default');
      expect(loadedSettings.merged.ui?.theme).toBe('matrix');
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
      // Create a workspace settings file with excludedProjectEnvVars
      const workspaceSettingsContent = {
        excludedProjectEnvVars: ['DEBUG', 'DEBUG_MODE'],
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

      // Mock findEnvFile to return a project .env file
      const originalFindEnvFile = (
        loadSettings as unknown as { findEnvFile: () => string }
      ).findEnvFile;
      (loadSettings as unknown as { findEnvFile: () => string }).findEnvFile =
        () => '/mock/project/.env';

      // Mock fs.readFileSync for .env file content
      const originalReadFileSync = fs.readFileSync;
      (fs.readFileSync as Mock).mockImplementation(
        (p: fs.PathOrFileDescriptor) => {
          if (p === '/mock/project/.env') {
            return 'DEBUG=true\nDEBUG_MODE=1\nGEMINI_API_KEY=test-key';
          }
          if (p === MOCK_WORKSPACE_SETTINGS_PATH) {
            return JSON.stringify(workspaceSettingsContent);
          }
          return '{}';
        },
      );

      try {
        // This will call loadEnvironment internally with the merged settings
        const settings = loadSettings(MOCK_WORKSPACE_DIR);

        // Verify the settings were loaded correctly
        expect(settings.merged.excludedProjectEnvVars).toEqual([
          'DEBUG',
          'DEBUG_MODE',
        ]);

        // Note: We can't directly test process.env changes here because the mocking
        // prevents the actual file system operations, but we can verify the settings
        // are correctly merged and passed to loadEnvironment
      } finally {
        (loadSettings as unknown as { findEnvFile: () => string }).findEnvFile =
          originalFindEnvFile;
        (fs.readFileSync as Mock).mockImplementation(originalReadFileSync);
      }
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
      expect(settings.user.settings.excludedProjectEnvVars).toEqual([
        'NODE_ENV',
        'DEBUG',
      ]);
      expect(settings.merged.excludedProjectEnvVars).toEqual([
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

      expect(settings.user.settings.excludedProjectEnvVars).toEqual([
        'DEBUG',
        'NODE_ENV',
        'USER_VAR',
      ]);
      expect(settings.workspace.settings.excludedProjectEnvVars).toEqual([
        'WORKSPACE_DEBUG',
        'WORKSPACE_VAR',
      ]);
      expect(settings.merged.excludedProjectEnvVars).toEqual([
        'WORKSPACE_DEBUG',
        'WORKSPACE_VAR',
      ]);
    });
  });

  describe('with workspace trust', () => {
    it('should merge workspace settings when workspace is trusted', () => {
      (mockFsExistsSync as Mock).mockReturnValue(true);
      const userSettingsContent = { theme: 'dark', sandbox: false };
      const workspaceSettingsContent = {
        sandbox: true,
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

      expect(settings.merged.sandbox).toBe(true);
      expect(settings.merged.contextFileName).toBe('WORKSPACE.md');
      expect(settings.merged.theme).toBe('dark');
    });

    it('should NOT merge workspace settings when workspace is not trusted', () => {
      vi.mocked(isWorkspaceTrusted).mockReturnValue(false);
      vi.mocked(isFolderTrustEnabled).mockReturnValue(true); // Enable the feature for this test
      (mockFsExistsSync as Mock).mockReturnValue(true);
      const userSettingsContent = {
        theme: 'dark',
        sandbox: false,
        contextFileName: 'USER.md',
        folderTrustFeature: true, // Enable the feature
        folderTrust: true, // Enable the setting
      };
      const workspaceSettingsContent = {
        sandbox: true,
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

      expect(settings.merged.sandbox).toBe(false); // User setting
      expect(settings.merged.contextFileName).toBe('USER.md'); // User setting
      expect(settings.merged.theme).toBe('dark'); // User setting
    });
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

      expect(settings.user.settings).toEqual(complexSettingsContent);
      expect(settings.merged.mcpServers).toHaveProperty('test-server');
      expect(settings.merged.customThemes).toHaveProperty('my-theme');
      expect(settings.merged.mcpServers['test-server'].env).toEqual({
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

      const settings = loadSettings(MOCK_WORKSPACE_DIR);

      expect(settings.user.settings.complexPath).toBe(
        '/home/testuser/configs/part1:part2:part3/app.json',
      );
      expect(settings.user.settings.configData).toBe(
        '{"key": "value", "number": 42}',
      );
      expect(settings.user.settings.fallbackValue).toBe(
        '${EMPTY_VAR:-default_value}',
      ); // Should not resolve bash-style fallbacks
      expect(settings.user.settings.multipleVars).toBe(
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

      expect(settings.merged.includeDirectories).toEqual(expectedDirectories);
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

      expect(loadedSettings.user.settings.mcpServers).toEqual({
        'complex-server': complexMcpServer,
      });
      expect(loadedSettings.merged.mcpServers).toEqual({
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

      expect(loadedSettings.user.settings).toEqual({
        theme: 'dark',
        sandbox: true,
        contextFileName: 'CONTEXT.md',
      });
      expect(loadedSettings.merged.theme).toBe('dark');
      expect(loadedSettings.merged.sandbox).toBe(true);
      expect(loadedSettings.merged.contextFileName).toBe('CONTEXT.md');

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
      const userSettingsContent: Settings = {
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

      expect(process.env['TESTTEST']).toEqual('1234');
    });

    it('does not load env files from untrusted spaces', () => {
      setup({ isFolderTrustEnabled: true, isWorkspaceTrustedValue: false });
      loadEnvironment(loadSettings(MOCK_WORKSPACE_DIR).merged);

      expect(process.env['TESTTEST']).not.toEqual('1234');
    });
  });

  // TODO: needsMigration and migrateDeprecatedSettings functions not yet implemented
  const needsMigration = (_settings: unknown) => {
    throw new Error('needsMigration is not implemented');
  };

  const migrateDeprecatedSettings = (
    _loadedSettings: ReturnType<typeof loadSettings>,
    _workspaceDir: string,
  ) => {
    throw new Error('migrateDeprecatedSettings is not implemented');
  };

  describe.skip('needsMigration', () => {
    it('should return false for an empty object', () => {
      expect(needsMigration({})).toBe(false);
    });

    it('should return false for settings that are already in V2 format', () => {
      const v2Settings: Partial<Settings> = {
        ui: {
          theme: 'dark',
        },
        tools: {
          sandbox: true,
        },
      };
      expect(needsMigration(v2Settings)).toBe(false);
    });

    it('should return true for settings with a V1 key that needs to be moved', () => {
      const v1Settings = {
        theme: 'dark', // v1 key
      };
      expect(needsMigration(v1Settings)).toBe(true);
    });

    it('should return true for settings with a mix of V1 and V2 keys', () => {
      const mixedSettings = {
        theme: 'dark', // v1 key
        tools: {
          sandbox: true, // v2 key
        },
      };
      expect(needsMigration(mixedSettings)).toBe(true);
    });

    it('should return false for settings with only V1 keys that are the same in V2', () => {
      const v1Settings = {
        mcpServers: {},
        telemetry: {},
        extensions: [],
      };
      expect(needsMigration(v1Settings)).toBe(false);
    });

    it('should return true for settings with a mix of V1 keys that are the same in V2 and V1 keys that need moving', () => {
      const v1Settings = {
        mcpServers: {}, // same in v2
        theme: 'dark', // needs moving
      };
      expect(needsMigration(v1Settings)).toBe(true);
    });

    it('should return false for settings with unrecognized keys', () => {
      const settings = {
        someUnrecognizedKey: 'value',
      };
      expect(needsMigration(settings)).toBe(false);
    });

    it('should return false for settings with v2 keys and unrecognized keys', () => {
      const settings = {
        ui: { theme: 'dark' },
        someUnrecognizedKey: 'value',
      };
      expect(needsMigration(settings)).toBe(false);
    });
  });

  describe.skip('migrateDeprecatedSettings', () => {
    let mockFsExistsSync: Mocked<typeof fs.existsSync>;
    let mockFsReadFileSync: Mocked<typeof fs.readFileSync>;
    let mockDisableExtension: Mocked<typeof disableExtension>;

    beforeEach(() => {
      vi.resetAllMocks();

      mockFsExistsSync = vi.mocked(fs.existsSync);
      mockFsReadFileSync = vi.mocked(fs.readFileSync);
      mockDisableExtension = vi.mocked(disableExtension);

      (mockFsExistsSync as Mock).mockReturnValue(true);
      vi.mocked(isWorkspaceTrusted).mockReturnValue(true);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should migrate disabled extensions from user and workspace settings', () => {
      const userSettingsContent = {
        extensions: {
          disabled: ['user-ext-1', 'shared-ext'],
        },
      };
      const workspaceSettingsContent = {
        extensions: {
          disabled: ['workspace-ext-1', 'shared-ext'],
        },
      };

      (mockFsReadFileSync as Mock).mockImplementation(
        (p: fs.PathOrFileDescriptor) => {
          if (p === USER_SETTINGS_PATH)
            return JSON.stringify(userSettingsContent);
          if (p === MOCK_WORKSPACE_SETTINGS_PATH)
            return JSON.stringify(workspaceSettingsContent);
          return '{}';
        },
      );

      const loadedSettings = loadSettings(MOCK_WORKSPACE_DIR);
      const setValueSpy = vi.spyOn(loadedSettings, 'setValue');

      migrateDeprecatedSettings(loadedSettings, MOCK_WORKSPACE_DIR);

      // Check user settings migration
      expect(mockDisableExtension).toHaveBeenCalledWith(
        'user-ext-1',
        SettingScope.User,
        MOCK_WORKSPACE_DIR,
      );
      expect(mockDisableExtension).toHaveBeenCalledWith(
        'shared-ext',
        SettingScope.User,
        MOCK_WORKSPACE_DIR,
      );

      // Check workspace settings migration
      expect(mockDisableExtension).toHaveBeenCalledWith(
        'workspace-ext-1',
        SettingScope.Workspace,
        MOCK_WORKSPACE_DIR,
      );
      expect(mockDisableExtension).toHaveBeenCalledWith(
        'shared-ext',
        SettingScope.Workspace,
        MOCK_WORKSPACE_DIR,
      );

      // Check that setValue was called to remove the deprecated setting
      expect(setValueSpy).toHaveBeenCalledWith(
        SettingScope.User,
        'extensions',
        {
          disabled: undefined,
        },
      );
      expect(setValueSpy).toHaveBeenCalledWith(
        SettingScope.Workspace,
        'extensions',
        {
          disabled: undefined,
        },
      );
    });

    it('should not do anything if there are no deprecated settings', () => {
      const userSettingsContent = {
        extensions: {
          enabled: ['user-ext-1'],
        },
      };
      const workspaceSettingsContent = {
        someOtherSetting: 'value',
      };

      (mockFsReadFileSync as Mock).mockImplementation(
        (p: fs.PathOrFileDescriptor) => {
          if (p === USER_SETTINGS_PATH)
            return JSON.stringify(userSettingsContent);
          if (p === MOCK_WORKSPACE_SETTINGS_PATH)
            return JSON.stringify(workspaceSettingsContent);
          return '{}';
        },
      );

      const loadedSettings = loadSettings(MOCK_WORKSPACE_DIR);
      const setValueSpy = vi.spyOn(loadedSettings, 'setValue');

      migrateDeprecatedSettings(loadedSettings, MOCK_WORKSPACE_DIR);

      expect(mockDisableExtension).not.toHaveBeenCalled();
      expect(setValueSpy).not.toHaveBeenCalled();
    });
  });
});
