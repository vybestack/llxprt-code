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
    Config: vi.fn().mockImplementation((params) => {
      let provider = params.provider;
      let model = params.model;
      const ephemerals: Record<string, unknown> = {};
      const settingsServiceInstance = new actual.SettingsService();

      return {
        getProvider: vi.fn(() => provider),
        setProvider: vi.fn((next: string) => {
          provider = next;
        }),
        getProviderManager: vi.fn(),
        setProviderManager: vi.fn(),
        initialize: vi.fn(),
        getModel: vi.fn(() => model),
        setModel: vi.fn((next: string) => {
          model = next;
        }),
        setEphemeralSetting: vi.fn((key: string, value: unknown) => {
          if (value === undefined) {
            delete ephemerals[key];
          } else {
            ephemerals[key] = value;
          }
        }),
        getEphemeralSetting: vi.fn((key: string) => ephemerals[key]),
        getEphemeralSettings: vi.fn(() => ({ ...ephemerals })),
        getSettingsService: vi.fn(() => settingsServiceInstance),
        getConversationLoggingEnabled: vi.fn(() => false),
        getDebugMode: vi.fn(() => false),
        getToolRegistry: vi.fn(() => ({})),
        getSandboxMountDir: vi.fn(() => ''),
        getMemoryImportFormat: vi.fn(() => 'tree'),
        getFolderTrust: vi.fn(() => true),
        getIdeMode: vi.fn(() => false),
        getFileDiscoveryService: vi.fn(() => ({ initialize: vi.fn() })),
        refreshAuth: vi.fn(async () => {}),
      };
    }),
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

const parseBootstrapArgsMock = vi.hoisted(() =>
  vi.fn(() => ({
    bootstrapArgs: {
      profileName: undefined,
      providerOverride: undefined,
    },
    runtimeMetadata: {},
  })),
);

vi.mock('./profileBootstrap.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    parseBootstrapArgs: parseBootstrapArgsMock,
  };
});

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

const setProviderApiKeyMock = vi.fn(async (_apiKey?: string) => ({
  success: true,
  message: '',
  providerName: 'openai',
  isPaidMode: false,
  authType: undefined,
}));

vi.mock('../providers/providerConfigUtils.js', () => ({
  setProviderApiKey: setProviderApiKeyMock,
  setProviderBaseUrl: vi.fn(async (baseUrl?: string | null) => ({
    success: true,
    message: '',
    providerName: 'openai',
    changed: true,
    baseUrl: baseUrl ?? undefined,
  })),
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
    setProviderApiKeyMock.mockClear();
    parseBootstrapArgsMock.mockReset();

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

    it('applies profile ephemerals when using --profile-load (issue #458 regression guard)', async () => {
      const profile = {
        version: 1,
        provider: 'openai',
        model: 'hf:zai-org/GLM-4.6',
        modelParams: {
          temperature: 1,
        },
        ephemeralSettings: {
          'context-limit': 200000,
          'base-url': 'https://api.synthetic.new/openai/v1',
          'auth-key': 'syn_profile_key',
          'auth-keyfile': '/Users/example/.synthetic_key',
        },
      };

      const mockInstance = {
        loadProfile: vi.fn().mockResolvedValue(profile),
        profileExists: vi.fn().mockResolvedValue(true),
      };

      MockedProfileManager.mockImplementation(() => mockInstance);

      parseBootstrapArgsMock.mockReturnValueOnce({
        bootstrapArgs: {
          profileName: 'synthetic',
          providerOverride: undefined,
        },
        runtimeMetadata: {},
      });

      const cliArgs = {
        profileLoad: 'synthetic',
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

      const configInstance = await loadCliConfig(
        settings,
        extensions,
        sessionId,
        cliArgs,
      );

      expect(mockInstance.loadProfile).toHaveBeenCalledWith('synthetic');
      expect(configInstance.getEphemeralSetting('context-limit')).toBe(200000);
      expect(configInstance.getEphemeralSetting('base-url')).toBe(
        'https://api.synthetic.new/openai/v1',
      );
      expect(configInstance.getEphemeralSetting('auth-key')).toBe(
        'syn_profile_key',
      );
      expect(configInstance.getEphemeralSetting('auth-keyfile')).toBe(
        '/Users/example/.synthetic_key',
      );
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
