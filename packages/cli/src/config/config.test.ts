/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/// <reference types="vitest/globals" />

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import os from 'os';
import { parseArguments, loadCliConfig } from './config.js';
import { Settings } from './settings.js';

vi.mock('os');

function createMockSettingsService() {
  const providerStore = new Map<string, Record<string, unknown>>();
  const globalStore = new Map<string, unknown>();
  return {
    setProviderSetting(provider: string, key: string, value: unknown) {
      const entry = providerStore.get(provider) ?? {};
      if (value === undefined) {
        delete entry[key];
      } else {
        entry[key] = value;
      }
      providerStore.set(provider, entry);
    },
    getProviderSetting(provider: string, key: string) {
      return providerStore.get(provider)?.[key];
    },
    async updateSettings(
      provider: string,
      updates: Record<string, unknown>,
    ): Promise<void> {
      const entry = providerStore.get(provider) ?? {};
      Object.assign(entry, updates);
      providerStore.set(provider, entry);
    },
    async switchProvider(): Promise<void> {
      // no-op for tests
    },
    set(key: string, value: unknown) {
      if (value === undefined) {
        globalStore.delete(key);
      } else {
        globalStore.set(key, value);
      }
    },
    get(key: string) {
      return globalStore.get(key);
    },
    setCurrentProfileName(name: string | null) {
      if (name === null) {
        globalStore.delete('currentProfile');
      } else {
        globalStore.set('currentProfile', name);
      }
    },
    getCurrentProfileName() {
      const value = globalStore.get('currentProfile');
      return (typeof value === 'string' ? value : null) ?? null;
    },
  };
}

function createRuntimeState() {
  const settingsService = createMockSettingsService();
  return {
    runtime: {
      runtimeId: 'cli.runtime.test',
      metadata: {},
      settingsService,
    },
    providerManager: {
      getActiveProviderName: vi.fn(() => 'openai'),
      getActiveProvider: vi.fn(() => ({
        name: 'openai',
        getDefaultModel: () => 'hf:zai-org/GLM-4.6',
      })),
      setActiveProvider: vi.fn().mockResolvedValue(undefined),
      listProviders: vi.fn(() => ['openai']),
      prepareStatelessProviderInvocation: vi.fn(),
      getAvailableModels: vi
        .fn()
        .mockResolvedValue([
          { id: 'hf:zai-org/GLM-4.6', name: 'hf:zai-org/GLM-4.6' },
        ]),
    },
    oauthManager: {
      isOAuthEnabled: vi.fn(() => false),
      toggleOAuthEnabled: vi.fn(),
      authenticate: vi.fn(),
    },
  };
}

const runtimeStateRef = vi.hoisted(() => ({
  value: createRuntimeState(),
}));

const resetRuntimeState = () => {
  runtimeStateRef.value = createRuntimeState();
};

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
      modelOverride: undefined,
      keyOverride: undefined,
      keyfileOverride: undefined,
      baseurlOverride: undefined,
      setOverrides: null,
    },
    runtimeMetadata: {},
  })),
);

vi.mock('./profileBootstrap.js', async (importOriginal) => {
  const actual = await importOriginal();
  const prepareRuntimeForProfile = vi.fn(async () => runtimeStateRef.value);
  const createBootstrapResult = vi.fn(
    ({
      runtime,
      providerManager,
      oauthManager,
      bootstrapArgs,
      profileApplication,
    }) => ({
      runtime,
      providerManager,
      oauthManager,
      bootstrapArgs,
      profile: profileApplication,
    }),
  );
  return {
    ...actual,
    parseBootstrapArgs: parseBootstrapArgsMock,
    prepareRuntimeForProfile,
    createBootstrapResult,
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

vi.mock('../runtime/runtimeSettings.js', () => {
  const applyProfileSnapshot = vi.fn(
    async (
      profile: {
        provider?: string | null;
        model?: string | null;
        ephemeralSettings?: Record<string, unknown>;
      },
      options: { profileName?: string } = {},
    ) => ({
      profileName: options.profileName,
      providerName: profile.provider ?? 'openai',
      modelName: profile.model ?? 'hf:zai-org/GLM-4.6',
      infoMessages: [],
      warnings: [],
      providerChanged: true,
      authType: undefined,
      baseUrl:
        (profile.ephemeralSettings?.['base-url'] as string | undefined) ??
        undefined,
      didFallback: false,
      requestedProvider: profile.provider ?? null,
    }),
  );

  const getCliRuntimeContext = vi.fn(() => runtimeStateRef.value.runtime);
  const setCliRuntimeContext = vi.fn((_service, config) => {
    runtimeStateRef.value.runtime.config = config;
  });
  const switchActiveProvider = vi.fn(async (providerName: string) => ({
    changed: true,
    previousProvider: null,
    nextProvider: providerName,
    infoMessages: [],
    authType: undefined,
  }));
  const applyCliArgumentOverrides = vi.fn(async () => {});
  const registerCliProviderInfrastructure = vi.fn();
  const getCliRuntimeServices = vi.fn(() => ({
    runtime: runtimeStateRef.value.runtime,
    providerManager: runtimeStateRef.value.providerManager,
    config: runtimeStateRef.value.runtime.config,
    settingsService: runtimeStateRef.value.runtime.settingsService,
  }));

  return {
    applyProfileSnapshot,
    getCliRuntimeContext,
    setCliRuntimeContext,
    switchActiveProvider,
    applyCliArgumentOverrides,
    registerCliProviderInfrastructure,
    getCliRuntimeServices,
    getCliProviderManager: vi.fn(() => runtimeStateRef.value.providerManager),
    getCliRuntimeConfig: vi.fn(() => runtimeStateRef.value.runtime.config),
    getActiveProviderStatus: vi.fn(() => ({
      name: 'openai',
      isReady: true,
    })),
    listProviders: vi.fn(() => ['openai']),
  };
});

describe('parseArguments', () => {
  it('should throw an error when both --prompt and --prompt-interactive are used together', async () => {
    process.argv = [
      'node',
      'script.js',
      '--prompt',
      'test prompt',
      '--prompt-interactive',
      'interactive prompt',
    ];

    const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });

    const mockConsoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    await expect(parseArguments({} as Settings)).rejects.toThrow(
      'process.exit called',
    );

    expect(mockConsoleError).toHaveBeenCalledWith(
      expect.stringContaining(
        'Cannot use both --prompt (-p) and --prompt-interactive (-i) together',
      ),
    );

    mockExit.mockRestore();
    mockConsoleError.mockRestore();
  });

  it('should throw an error when using short flags -p and -i together', async () => {
    process.argv = [
      'node',
      'script.js',
      '-p',
      'test prompt',
      '-i',
      'interactive prompt',
    ];

    const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });

    const mockConsoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    await expect(parseArguments({} as Settings)).rejects.toThrow(
      'process.exit called',
    );

    expect(mockConsoleError).toHaveBeenCalledWith(
      expect.stringContaining(
        'Cannot use both --prompt (-p) and --prompt-interactive (-i) together',
      ),
    );

    mockExit.mockRestore();
    mockConsoleError.mockRestore();
  });

  it('should allow --prompt without --prompt-interactive', async () => {
    process.argv = ['node', 'script.js', '--prompt', 'test prompt'];
    const argv = await parseArguments({} as Settings);
    expect(argv.prompt).toBe('test prompt');
    expect(argv.promptInteractive).toBeUndefined();
  });

  it('should allow --prompt-interactive without --prompt', async () => {
    process.argv = [
      'node',
      'script.js',
      '--prompt-interactive',
      'interactive prompt',
    ];
    const argv = await parseArguments({} as Settings);
    expect(argv.promptInteractive).toBe('interactive prompt');
    expect(argv.prompt).toBeUndefined();
  });

  it('should allow -i flag as alias for --prompt-interactive', async () => {
    process.argv = ['node', 'script.js', '-i', 'interactive prompt'];
    const argv = await parseArguments({} as Settings);
    expect(argv.promptInteractive).toBe('interactive prompt');
    expect(argv.prompt).toBeUndefined();
  });

  it('should throw an error when both --yolo and --approval-mode are used together', async () => {
    process.argv = [
      'node',
      'script.js',
      '--yolo',
      '--approval-mode',
      'default',
    ];

    const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });

    const mockConsoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    await expect(parseArguments({} as Settings)).rejects.toThrow(
      'process.exit called',
    );

    expect(mockConsoleError).toHaveBeenCalledWith(
      expect.stringContaining(
        'Cannot use both --yolo (-y) and --approval-mode together. Use --approval-mode=yolo instead.',
      ),
    );

    mockExit.mockRestore();
    mockConsoleError.mockRestore();
  });

  it('should throw an error when using short flags -y and --approval-mode together', async () => {
    process.argv = ['node', 'script.js', '-y', '--approval-mode', 'yolo'];

    const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });

    const mockConsoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    await expect(parseArguments({} as Settings)).rejects.toThrow(
      'process.exit called',
    );

    expect(mockConsoleError).toHaveBeenCalledWith(
      expect.stringContaining(
        'Cannot use both --yolo (-y) and --approval-mode together. Use --approval-mode=yolo instead.',
      ),
    );

    mockExit.mockRestore();
    mockConsoleError.mockRestore();
  });

  it('should allow --approval-mode without --yolo', async () => {
    process.argv = ['node', 'script.js', '--approval-mode', 'auto_edit'];
    const argv = await parseArguments({} as Settings);
    expect(argv.approvalMode).toBe('auto_edit');
    expect(argv.yolo).toBe(false);
  });

  it('should allow --yolo without --approval-mode', async () => {
    process.argv = ['node', 'script.js', '--yolo'];
    const argv = await parseArguments({} as Settings);
    expect(argv.yolo).toBe(true);
    expect(argv.approvalMode).toBeUndefined();
  });

  it('should reject invalid --approval-mode values', async () => {
    process.argv = ['node', 'script.js', '--approval-mode', 'invalid'];

    const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });

    const mockConsoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    await expect(parseArguments({} as Settings)).rejects.toThrow(
      'process.exit called',
    );

    expect(mockConsoleError).toHaveBeenCalledWith(
      expect.stringContaining('Invalid values:'),
    );

    mockExit.mockRestore();
    mockConsoleError.mockRestore();
  });

  it('should support comma-separated values for --allowed-tools', async () => {
    process.argv = [
      'node',
      'script.js',
      '--allowed-tools',
      'read_file,ShellTool(git status)',
    ];
    const argv = await parseArguments({} as Settings);
    expect(argv.allowedTools).toEqual(['read_file', 'ShellTool(git status)']);
  });
});

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
    resetRuntimeState();
    parseBootstrapArgsMock.mockReset();
    parseBootstrapArgsMock.mockReturnValue({
      bootstrapArgs: {
        profileName: undefined,
        providerOverride: undefined,
        modelOverride: undefined,
        keyOverride: undefined,
        keyfileOverride: undefined,
        baseurlOverride: undefined,
        setOverrides: null,
      },
      runtimeMetadata: {},
    });

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
    it('prefers CLI model overrides even when a profile provides a model', async () => {
      const profile = {
        version: 1,
        provider: 'openai',
        model: 'hf:zai-org/GLM-4.6',
        modelParams: {},
        ephemeralSettings: {},
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
        model: 'hf:MiniMaxAI/MiniMax-M2',
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

      expect(configInstance.getModel()).toBe('hf:MiniMaxAI/MiniMax-M2');
    });

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

describe('screenReader configuration', () => {
  const originalArgv = process.argv;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(os.homedir).mockReturnValue('/mock/home/user');
    vi.stubEnv('GEMINI_API_KEY', 'test-api-key');
  });

  afterEach(() => {
    process.argv = originalArgv;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('should use screenReader value from settings if CLI flag is not present (settings true)', async () => {
    process.argv = ['node', 'script.js'];
    const argv = await parseArguments({} as Settings);
    const settings: Settings = {
      ui: { accessibility: { screenReader: true } },
    };
    const config = await loadCliConfig(settings, [], 'test-session', argv);
    expect(config.getScreenReader()).toBe(true);
  });

  it('should use screenReader value from settings if CLI flag is not present (settings false)', async () => {
    process.argv = ['node', 'script.js'];
    const argv = await parseArguments({} as Settings);
    const settings: Settings = {
      ui: { accessibility: { screenReader: false } },
    };
    const config = await loadCliConfig(settings, [], 'test-session', argv);
    expect(config.getScreenReader()).toBe(false);
  });

  it('should prioritize --screen-reader CLI flag (true) over settings (false)', async () => {
    process.argv = ['node', 'script.js', '--screen-reader'];
    const argv = await parseArguments({} as Settings);
    const settings: Settings = {
      ui: { accessibility: { screenReader: false } },
    };
    const config = await loadCliConfig(settings, [], 'test-session', argv);
    expect(config.getScreenReader()).toBe(true);
  });

  it('should be false by default when no flag or setting is present', async () => {
    process.argv = ['node', 'script.js'];
    const argv = await parseArguments({} as Settings);
    const settings: Settings = {};
    const config = await loadCliConfig(settings, [], 'test-session', argv);
    expect(config.getScreenReader()).toBe(false);
  });
});
