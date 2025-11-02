/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/// <reference types="vitest/globals" />

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the '@vybestack/llxprt-code-core' module
vi.mock('@vybestack/llxprt-code-core', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    ProfileManager: vi.fn().mockImplementation(() => ({
      loadProfile: vi.fn(),
      profileExists: vi.fn(),
    })),
    Storage: {
      getGlobalSettingsPath: vi.fn(
        () => '/mock/home/user/.llxprt/settings.json',
      ),
      getGlobalLlxprtDir: vi.fn(() => '/mock/home/user/.llxprt'),
    },
    Config: vi.fn().mockImplementation((params) => ({
      getProvider: vi.fn(() => params.provider),
      getProviderManager: vi.fn(),
      setProviderManager: vi.fn(),
      initialize: vi.fn(),
      getModel: vi.fn(),
      setModel: vi.fn(),
      setEphemeralSetting: vi.fn(),
      getEphemeralSetting: vi.fn(() => undefined),
      getSettingsService: vi.fn(),
      getConversationLoggingEnabled: vi.fn(() => false),
      getDebugMode: vi.fn(() => false),
      getToolRegistry: vi.fn(() => ({})),
      getSandboxMountDir: vi.fn(() => ''),
      getMemoryImportFormat: vi.fn(() => 'tree'),
      getFolderTrust: vi.fn(() => true),
      getIdeMode: vi.fn(() => false),
      getFileDiscoveryService: vi.fn(() => ({ initialize: vi.fn() })),
    })),
  };
});

// Mock fs and os
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    realpathSync: vi.fn((path: string) => path),
    existsSync: vi.fn(() => false),
  };
});

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof osActual>();
  return {
    ...actual,
    homedir: vi.fn(() => '/mock/home/user'),
  };
});

// Mock settings module
vi.mock('./settings.js', () => ({
  USER_SETTINGS_PATH: '/mock/home/user/.llxprt/settings.json',
  USER_SETTINGS_DIR: '/mock/home/user/.llxprt',
}));

// Mock other dependencies
vi.mock('../utils/version.js', () => ({
  getCliVersion: vi.fn(() => Promise.resolve('1.0.0')),
}));

vi.mock('../utils/resolvePath.js', () => ({
  resolvePath: vi.fn((path: string) => path),
}));

vi.mock('./trustedFolders.js', () => ({
  isWorkspaceTrusted: vi.fn(() => true),
}));

vi.mock('./cliEphemeralSettings.js', () => ({
  applyCliSetArguments: vi.fn((_config, _setArgs) => ({ modelParams: {} })),
}));

vi.mock('../utils/events.js', () => ({
  appEvents: {
    on: vi.fn(),
    emit: vi.fn(),
  },
}));

vi.mock('dotenv', () => ({
  config: vi.fn(),
}));

vi.mock('yargs/yargs', () => ({
  default: vi.fn(() => ({
    scriptName: vi.fn(() => ({
      usage: vi.fn(() => ({
        option: vi.fn(() => ({
          option: vi.fn(() => ({
            command: vi.fn(() => ({
              version: vi.fn(() => ({
                alias: vi.fn(() => ({
                  help: vi.fn(() => ({
                    strict: vi.fn(() => ({
                      check: vi.fn(() => ({
                        wrap: vi.fn(() => ({
                          parseAsync: vi.fn(() =>
                            Promise.resolve({
                              provider: undefined,
                              profileLoad: null,
                              model: undefined,
                              debug: false,
                              prompt: undefined,
                              promptInteractive: undefined,
                              allFiles: false,
                              showMemoryUsage: false,
                              yolo: false,
                              approvalMode: undefined,
                              telemetry: false,
                              checkpointing: false,
                              telemetryTarget: undefined,
                              telemetryOtlpEndpoint: undefined,
                              telemetryLogPrompts: undefined,
                              telemetryOutfile: undefined,
                              allowedMcpServerNames: undefined,
                              experimentalAcp: false,
                              extensions: undefined,
                              listExtensions: false,
                              key: undefined,
                              keyfile: undefined,
                              baseurl: undefined,
                              proxy: undefined,
                              includeDirectories: undefined,
                              loadMemoryFromIncludeDirectories: undefined,
                              ideMode: undefined,
                              screenReader: false,
                              useSmartEdit: false,
                              sessionSummary: undefined,
                              set: undefined,
                              promptWords: undefined,
                            }),
                          ),
                        })),
                      })),
                    })),
                  })),
                })),
              })),
            })),
          })),
        })),
      })),
    })),
  })),
}));

// Hide binary modules from Vitest's parser
vi.mock('node-gyp-build', () => ({}));

import { ProfileManager } from '@vybestack/llxprt-code-core';
import { loadCliConfig } from './config.js';
import { Settings } from './settings.js';
import { Extension } from './extension.js';

const MockedProfileManager = vi.mocked(ProfileManager);

describe('loadCliConfig - Invalid Profile/Provider Handling', () => {
  let settings: Settings;
  let extensions: Extension[];
  const sessionId = 'test-session-123';

  beforeEach(() => {
    vi.clearAllMocks();

    settings = {
      memoryImportFormat: 'tree',
      ideMode: false,
      folderTrust: true,
      defaultProfile: undefined,
      telemetry: { enabled: false },
      checkpointing: { enabled: false },
      fileFiltering: {},
      usageStatisticsEnabled: true,
      showMemoryUsage: false,
      memoryDiscoveryMaxDirs: 100,
      includeDirectories: [],
      coreTools: [],
      excludeTools: [],
      allowedTools: [],
      mcpServers: {},
      bugCommand: { urlTemplate: '' },
      summarizeToolOutput: {},
      chatCompression: {},
      shellReplacement: false,
      useRipgrep: false,
      shouldUseNodePtyShell: false,
      enablePromptCompletion: false,
      useSmartEdit: false,
      maxSessionTurns: -1,
      accessibility: { screenReader: false },
    };

    extensions = [];
  });

  describe('Invalid profile handling', () => {
    it('should handle error when loading non-existent profile', async () => {
      const mockInstance = {
        loadProfile: vi
          .fn()
          .mockRejectedValue(new Error("Profile 'nonexistent' not found")),
      };
      MockedProfileManager.mockImplementation(() => mockInstance);

      // Set profile via environment variable since bootstrap reads from process.env
      process.env.LLXPRT_PROFILE = 'nonexistent';

      const cliArgs = {
        profileLoad: undefined,
        provider: undefined,
        model: undefined,
        sandbox: undefined,
        sandboxImage: undefined,
        debug: false,
        prompt: undefined,
        promptInteractive: undefined,
        allFiles: false,
        showMemoryUsage: false,
        yolo: false,
        approvalMode: undefined,
        telemetry: false,
        checkpointing: false,
        telemetryTarget: undefined,
        telemetryOtlpEndpoint: undefined,
        telemetryLogPrompts: undefined,
        telemetryOutfile: undefined,
        allowedMcpServerNames: undefined,
        experimentalAcp: false,
        extensions: undefined,
        listExtensions: false,
        key: undefined,
        keyfile: undefined,
        baseurl: undefined,
        proxy: undefined,
        includeDirectories: undefined,
        loadMemoryFromIncludeDirectories: undefined,
        ideMode: undefined,
        screenReader: false,
        useSmartEdit: false,
        sessionSummary: undefined,
        set: undefined,
        promptWords: undefined,
      };

      // Mock console.error to verify error was logged
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      // Profile loading errors should be caught and handled gracefully
      const config = await loadCliConfig(
        settings,
        extensions,
        sessionId,
        cliArgs,
      );

      // Verify the profile loading was attempted
      expect(mockInstance.loadProfile).toHaveBeenCalledWith('nonexistent');
      // Verify the error was logged
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Failed to load profile 'nonexistent'"),
      );
      // Verify a config was still returned (graceful degradation)
      expect(config).toBeDefined();

      consoleSpy.mockRestore();
      delete process.env.LLXPRT_PROFILE;
    });

    it('should handle error when loading corrupted profile', async () => {
      const mockInstance = {
        loadProfile: vi
          .fn()
          .mockRejectedValue(new Error("Profile 'corrupted' is corrupted")),
      };
      MockedProfileManager.mockImplementation(() => mockInstance);

      // Set profile via environment variable since bootstrap reads from process.env
      process.env.LLXPRT_PROFILE = 'corrupted';

      const cliArgs = {
        profileLoad: undefined,
        provider: undefined,
        model: undefined,
        sandbox: undefined,
        sandboxImage: undefined,
        debug: false,
        prompt: undefined,
        promptInteractive: undefined,
        allFiles: false,
        showMemoryUsage: false,
        yolo: false,
        approvalMode: undefined,
        telemetry: false,
        checkpointing: false,
        telemetryTarget: undefined,
        telemetryOtlpEndpoint: undefined,
        telemetryLogPrompts: undefined,
        telemetryOutfile: undefined,
        allowedMcpServerNames: undefined,
        experimentalAcp: false,
        extensions: undefined,
        listExtensions: false,
        key: undefined,
        keyfile: undefined,
        baseurl: undefined,
        proxy: undefined,
        includeDirectories: undefined,
        loadMemoryFromIncludeDirectories: undefined,
        ideMode: undefined,
        screenReader: false,
        useSmartEdit: false,
        sessionSummary: undefined,
        set: undefined,
        promptWords: undefined,
      };

      // Mock console.error to verify error was logged
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      // Profile loading errors should be caught and handled gracefully
      const config = await loadCliConfig(
        settings,
        extensions,
        sessionId,
        cliArgs,
      );

      // Verify the profile loading was attempted
      expect(mockInstance.loadProfile).toHaveBeenCalledWith('corrupted');
      // Verify the error was logged
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Failed to load profile 'corrupted'"),
      );
      // Verify a config was still returned (graceful degradation)
      expect(config).toBeDefined();

      consoleSpy.mockRestore();
      delete process.env.LLXPRT_PROFILE;
    });

    it('should handle error when loading invalid profile with missing fields', async () => {
      const mockInstance = {
        loadProfile: vi
          .fn()
          .mockRejectedValue(
            new Error("Profile 'invalid' is invalid: missing required fields"),
          ),
      };
      MockedProfileManager.mockImplementation(() => mockInstance);

      // Set profile via environment variable since bootstrap reads from process.env
      process.env.LLXPRT_PROFILE = 'invalid';

      const cliArgs = {
        profileLoad: undefined,
        provider: undefined,
        model: undefined,
        sandbox: undefined,
        sandboxImage: undefined,
        debug: false,
        prompt: undefined,
        promptInteractive: undefined,
        allFiles: false,
        showMemoryUsage: false,
        yolo: false,
        approvalMode: undefined,
        telemetry: false,
        checkpointing: false,
        telemetryTarget: undefined,
        telemetryOtlpEndpoint: undefined,
        telemetryLogPrompts: undefined,
        telemetryOutfile: undefined,
        allowedMcpServerNames: undefined,
        experimentalAcp: false,
        extensions: undefined,
        listExtensions: false,
        key: undefined,
        keyfile: undefined,
        baseurl: undefined,
        proxy: undefined,
        includeDirectories: undefined,
        loadMemoryFromIncludeDirectories: undefined,
        ideMode: undefined,
        screenReader: false,
        useSmartEdit: false,
        sessionSummary: undefined,
        set: undefined,
        promptWords: undefined,
      };

      // Mock console.error to verify error was logged
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      // Profile loading errors should be caught and handled gracefully
      const config = await loadCliConfig(
        settings,
        extensions,
        sessionId,
        cliArgs,
      );

      // Verify the profile loading was attempted
      expect(mockInstance.loadProfile).toHaveBeenCalledWith('invalid');
      // Verify the error was logged
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Failed to load profile 'invalid'"),
      );
      // Verify a config was still returned (graceful degradation)
      expect(config).toBeDefined();

      consoleSpy.mockRestore();
      delete process.env.LLXPRT_PROFILE;
    });

    it('should handle error for unsupported profile version', async () => {
      const mockInstance = {
        loadProfile: vi
          .fn()
          .mockRejectedValue(new Error('unsupported profile version')),
      };
      MockedProfileManager.mockImplementation(() => mockInstance);

      // Set profile via environment variable since bootstrap reads from process.env
      process.env.LLXPRT_PROFILE = 'old-version';

      const cliArgs = {
        profileLoad: undefined,
        provider: undefined,
        model: undefined,
        sandbox: undefined,
        sandboxImage: undefined,
        debug: false,
        prompt: undefined,
        promptInteractive: undefined,
        allFiles: false,
        showMemoryUsage: false,
        yolo: false,
        approvalMode: undefined,
        telemetry: false,
        checkpointing: false,
        telemetryTarget: undefined,
        telemetryOtlpEndpoint: undefined,
        telemetryLogPrompts: undefined,
        telemetryOutfile: undefined,
        allowedMcpServerNames: undefined,
        experimentalAcp: false,
        extensions: undefined,
        listExtensions: false,
        key: undefined,
        keyfile: undefined,
        baseurl: undefined,
        proxy: undefined,
        includeDirectories: undefined,
        loadMemoryFromIncludeDirectories: undefined,
        ideMode: undefined,
        screenReader: false,
        useSmartEdit: false,
        sessionSummary: undefined,
        set: undefined,
        promptWords: undefined,
      };

      // Mock console.error to verify error was logged
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      // Profile loading errors should be caught and handled gracefully
      const config = await loadCliConfig(
        settings,
        extensions,
        sessionId,
        cliArgs,
      );

      // Verify the profile loading was attempted
      expect(mockInstance.loadProfile).toHaveBeenCalledWith('old-version');
      // Verify the error was logged
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Failed to load profile 'old-version'"),
      );
      // Verify a config was still returned (graceful degradation)
      expect(config).toBeDefined();

      consoleSpy.mockRestore();
      delete process.env.LLXPRT_PROFILE;
    });
  });

  describe('Invalid provider handling', () => {
    it('should accept explicitly set provider without profile', async () => {
      const cliArgs = {
        profileLoad: undefined,
        provider: 'nonexistent-provider',
        model: undefined,
        sandbox: undefined,
        sandboxImage: undefined,
        debug: false,
        prompt: undefined,
        promptInteractive: undefined,
        allFiles: false,
        showMemoryUsage: false,
        yolo: false,
        approvalMode: undefined,
        telemetry: false,
        checkpointing: false,
        telemetryTarget: undefined,
        telemetryOtlpEndpoint: undefined,
        telemetryLogPrompts: undefined,
        telemetryOutfile: undefined,
        allowedMcpServerNames: undefined,
        experimentalAcp: false,
        extensions: undefined,
        listExtensions: false,
        key: undefined,
        keyfile: undefined,
        baseurl: undefined,
        proxy: undefined,
        includeDirectories: undefined,
        loadMemoryFromIncludeDirectories: undefined,
        ideMode: undefined,
        screenReader: false,
        useSmartEdit: false,
        sessionSummary: undefined,
        set: undefined,
        promptWords: undefined,
      };

      // Call loadCliConfig and verify it accepts the provider even if it doesn't exist
      // This allows for custom/unknown providers to be used
      const config = await loadCliConfig(
        settings,
        extensions,
        sessionId,
        cliArgs,
      );
      expect(config.getProvider()).toBe('nonexistent-provider');
    });
  });
});
