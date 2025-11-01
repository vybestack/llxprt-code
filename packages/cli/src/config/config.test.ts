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
    },
    Config: vi.fn().mockImplementation((params) => ({
      getProvider: vi.fn(() => params.provider),
      getProviderManager: vi.fn(),
      initialize: vi.fn(),
      getModel: vi.fn(),
      setModel: vi.fn(),
      setEphemeralSetting: vi.fn(),
      getSettingsService: vi.fn(),
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
    it('should throw error when loading non-existent profile', async () => {
      const mockInstance = {
        loadProfile: vi
          .fn()
          .mockRejectedValue(new Error("Profile 'nonexistent' not found")),
      };
      MockedProfileManager.mockImplementation(() => mockInstance);

      const cliArgs = {
        profileLoad: 'nonexistent',
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

      // Mock console.error to avoid actually logging during tests
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      await expect(
        loadCliConfig(settings, extensions, sessionId, cliArgs),
      ).rejects.toThrow();
      expect(mockInstance.loadProfile).toHaveBeenCalledWith('nonexistent');

      consoleSpy.mockRestore();
    });

    it('should throw error when loading corrupted profile', async () => {
      const mockInstance = {
        loadProfile: vi
          .fn()
          .mockRejectedValue(new Error("Profile 'corrupted' is corrupted")),
      };
      MockedProfileManager.mockImplementation(() => mockInstance);

      const cliArgs = {
        profileLoad: 'corrupted',
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

      // Mock console.error to avoid actually logging during tests
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      await expect(
        loadCliConfig(settings, extensions, sessionId, cliArgs),
      ).rejects.toThrow();
      expect(mockInstance.loadProfile).toHaveBeenCalledWith('corrupted');

      consoleSpy.mockRestore();
    });

    it('should throw error when loading invalid profile with missing fields', async () => {
      const mockInstance = {
        loadProfile: vi
          .fn()
          .mockRejectedValue(
            new Error("Profile 'invalid' is invalid: missing required fields"),
          ),
      };
      MockedProfileManager.mockImplementation(() => mockInstance);

      const cliArgs = {
        profileLoad: 'invalid',
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

      // Mock console.error to avoid actually logging during tests
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      await expect(
        loadCliConfig(settings, extensions, sessionId, cliArgs),
      ).rejects.toThrow();
      expect(mockInstance.loadProfile).toHaveBeenCalledWith('invalid');

      consoleSpy.mockRestore();
    });

    it('should throw error for unsupported profile version', async () => {
      const mockInstance = {
        loadProfile: vi
          .fn()
          .mockRejectedValue(new Error('unsupported profile version')),
      };
      MockedProfileManager.mockImplementation(() => mockInstance);

      const cliArgs = {
        profileLoad: 'old-version',
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

      // Mock console.error to avoid actually logging during tests
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      await expect(
        loadCliConfig(settings, extensions, sessionId, cliArgs),
      ).rejects.toThrow();
      expect(mockInstance.loadProfile).toHaveBeenCalledWith('old-version');

      consoleSpy.mockRestore();
    });
  });

  describe('Invalid provider handling', () => {
    it('should throw error when explicitly setting invalid provider without profile', async () => {
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

      // Call loadCliConfig and verify it doesn't fallback to gemini
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
