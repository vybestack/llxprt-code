/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  createProviderRuntimeContext,
  setActiveProviderRuntimeContext,
  clearActiveProviderRuntimeContext,
} from '@vybestack/llxprt-code-core';
import { loadCliConfig } from './config.js';
import { parseArguments } from './cliArgParser.js';
import type { Settings } from './settings.js';
import { ExtensionStorage } from './extension.js';
import * as ServerConfig from '@vybestack/llxprt-code-core';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import {} from './trustedFolders.js';
import { ExtensionEnablementManager } from './extensions/extensionEnablement.js';

vi.mock('./trustedFolders.js', async () => {
  const actual = await vi.importActual<typeof import('./trustedFolders.js')>(
    './trustedFolders.js',
  );
  return {
    ...actual,
    isWorkspaceTrusted: vi.fn().mockReturnValue(true), // Default to trusted
  };
});

vi.mock('./sandboxConfig.js', () => ({
  loadSandboxConfig: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('fs', async (importOriginal) => {
  const actualFs = await importOriginal<typeof import('fs')>();
  const pathMod = await import('node:path');
  const mockHome = pathMod.resolve(pathMod.sep, 'mock', 'home', 'user');
  const MOCK_CWD1 = process.cwd();
  const MOCK_CWD2 = pathMod.resolve(pathMod.sep, 'home', 'user', 'project');

  const mockPaths = new Set([
    MOCK_CWD1,
    MOCK_CWD2,
    pathMod.resolve(pathMod.sep, 'cli', 'path1'),
    pathMod.resolve(pathMod.sep, 'settings', 'path1'),
    pathMod.join(mockHome, 'settings', 'path2'),
    pathMod.join(MOCK_CWD2, 'cli', 'path2'),
    pathMod.join(MOCK_CWD2, 'settings', 'path3'),
  ]);

  return {
    ...actualFs,
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    existsSync: vi.fn((p) => mockPaths.has(p.toString())),
    statSync: vi.fn((p) => {
      if (mockPaths.has(p.toString())) {
        return { isDirectory: () => true } as unknown as import('fs').Stats;
      }
      return actualFs.statSync(p as unknown as string);
    }),
    realpathSync: vi.fn((p) => p),
  };
});

vi.mock('os', async (importOriginal) => {
  const actualOs = await importOriginal<typeof os>();
  return {
    ...actualOs,
    homedir: vi.fn(() => path.resolve(path.sep, 'mock', 'home', 'user')),
  };
});

vi.mock('open', () => ({
  default: vi.fn(),
}));

vi.mock('read-package-up', () => ({
  readPackageUp: vi.fn(() =>
    Promise.resolve({ packageJson: { version: 'test-version' } }),
  ),
}));

const runtimeSettingsState = vi.hoisted(() => ({
  context: null as {
    settingsService: SettingsService;
    config: ServerConfig.Config | null;
    runtimeId: string;
    metadata?: Record<string, unknown>;
  } | null,
  providerManager: null as ServerConfig.RuntimeProviderManager | null,
  oauthManager: null as unknown,
}));

vi.mock('@vybestack/llxprt-code-providers/runtime/runtimeSettings.js', () => {
  const getProviderManager = () =>
    runtimeSettingsState.providerManager ??
    ({
      listProviders: vi.fn(() => []),
      getActiveProviderName: vi.fn(() => null),
      setActiveProvider: vi.fn(),
      getActiveProvider: vi.fn(() => null),
      getAvailableModels: vi.fn(async () => []),
    } as unknown as ServerConfig.RuntimeProviderManager);

  return {
    registerAgentRuntimeFactories: vi.fn(),
    resetAgentRuntimeFactories: vi.fn(),
    applyProfileSnapshot: vi.fn(
      async (profile: {
        provider?: string;
        model?: string;
        baseUrl?: string;
      }) => ({
        providerName: profile.provider ?? '',
        modelName: profile.model ?? '',
        baseUrl: profile.baseUrl,
        warnings: [],
      }),
    ),
    getCliRuntimeContext: vi.fn(() => runtimeSettingsState.context),
    setCliRuntimeContext: vi.fn(
      (
        settingsService: SettingsService,
        config?: ServerConfig.Config,
        options: {
          metadata?: Record<string, unknown>;
          runtimeId?: string;
        } = {},
      ) => {
        runtimeSettingsState.context = {
          settingsService,
          config: config ?? null,
          runtimeId: options.runtimeId ?? 'mock-runtime',
          metadata: options.metadata ?? {},
        };
      },
    ),
    switchActiveProvider: vi.fn(async () => ({
      changed: true,
      previousProvider: null,
      nextProvider: 'mock-provider',
      infoMessages: [],
    })),
    registerCliProviderInfrastructure: vi.fn(
      (manager: ServerConfig.RuntimeProviderManager, oauthManager: unknown) => {
        runtimeSettingsState.providerManager = manager;
        runtimeSettingsState.oauthManager = oauthManager ?? null;
      },
    ),
    applyCliArgumentOverrides: vi.fn(async () => {}),
    getCliRuntimeConfig: vi.fn(
      () => runtimeSettingsState.context?.config ?? null,
    ),
    getCliRuntimeServices: vi.fn(() => ({
      config: runtimeSettingsState.context?.config ?? null,
      settingsService:
        runtimeSettingsState.context?.settingsService ?? new SettingsService(),
      providerManager: getProviderManager(),
    })),
    getCliProviderManager: vi.fn(() => runtimeSettingsState.providerManager),
    getCliOAuthManager: vi.fn(() => runtimeSettingsState.oauthManager ?? null),
    getActiveProviderStatus: vi.fn(() => ({
      name:
        runtimeSettingsState.providerManager?.getActiveProviderName() ??
        runtimeSettingsState.context?.config?.getProvider() ??
        null,
    })),
    listProviders: vi.fn(() => getProviderManager().listProviders()),
    getActiveProviderName: vi.fn(() =>
      getProviderManager().getActiveProviderName(),
    ),
    setActiveModel: vi.fn(async () => ({
      changed: false,
      previousModel: null,
      nextModel: null,
      infoMessages: [],
    })),
    listAvailableModels: vi.fn(async () =>
      getProviderManager().getAvailableModels(),
    ),
    getActiveModelName: vi.fn(() => null),
    getActiveModelParams: vi.fn(() => ({})),
    getEphemeralSettings: vi.fn(() => ({})),
    getEphemeralSetting: vi.fn(() => undefined),
    setEphemeralSetting: vi.fn(),
    setActiveModelParam: vi.fn(),
    clearActiveModelParam: vi.fn(),
    saveProfileSnapshot: vi.fn(async () => undefined),
    saveLoadBalancerProfile: vi.fn(async () => undefined),
    loadProfileByName: vi.fn(async () => undefined),
    deleteProfileByName: vi.fn(async () => undefined),
    listSavedProfiles: vi.fn(() => []),
    getProfileByName: vi.fn(() => undefined),
    setDefaultProfileName: vi.fn(),
    updateActiveProviderBaseUrl: vi.fn(async () => undefined),
    updateActiveProviderApiKey: vi.fn(async () => undefined),
    getRuntimeDiagnosticsSnapshot: vi.fn(() => ({})),
    getActiveToolFormatState: vi.fn(() => ({})),
    setActiveToolFormatOverride: vi.fn(),
    getActiveProviderMetrics: vi.fn(() => undefined),
    getSessionTokenUsage: vi.fn(() => undefined),
    getLoadBalancerStats: vi.fn(() => undefined),
    getLoadBalancerLastSelected: vi.fn(() => undefined),
    getAllLoadBalancerStats: vi.fn(() => ({})),
  };
});

vi.mock('@vybestack/llxprt-code-core', async () => {
  const actualServer = await vi.importActual<typeof ServerConfig>(
    '@vybestack/llxprt-code-core',
  );
  return {
    ...actualServer,
    IdeClient: {
      getInstance: vi.fn().mockResolvedValue({
        getConnectionStatus: vi.fn(),
        initialize: vi.fn(),
        shutdown: vi.fn(),
      }),
    },
    loadEnvironment: vi.fn(),
    loadServerHierarchicalMemory: vi.fn(
      (cwd, dirs, debug, fileService, extensionPaths, _maxDirs) =>
        Promise.resolve({
          // Intentional truthy fallback for empty string
          memoryContent:
            Array.isArray(extensionPaths) && extensionPaths.length > 0
              ? extensionPaths.join(',')
              : '',
          fileCount: extensionPaths?.length ?? 0,
          filePaths: [],
        }),
    ),
    DEFAULT_MEMORY_FILE_FILTERING_OPTIONS: {
      respectGitIgnore: false,
      respectGeminiIgnore: true,
    },
    DEFAULT_FILE_FILTERING_OPTIONS: {
      respectGitIgnore: true,
      respectGeminiIgnore: true,
    },
    // Mock isRipgrepAvailable to return true by default (ripgrep is bundled)
    isRipgrepAvailable: vi.fn().mockResolvedValue(true),
  };
});

function resetRuntimeSettingsState(): void {
  runtimeSettingsState.context = null;
  runtimeSettingsState.providerManager = null;
  runtimeSettingsState.oauthManager = null;
}

describe('loadCliConfig interactive', () => {
  const originalArgv = process.argv;
  const originalIsTTY = process.stdin.isTTY;

  beforeEach(() => {
    resetRuntimeSettingsState();
    vi.resetAllMocks();
    vi.mocked(os.homedir).mockReturnValue('/mock/home/user');
    vi.stubEnv('GEMINI_API_KEY', 'test-api-key');
    process.stdin.isTTY = true;
    setActiveProviderRuntimeContext(createProviderRuntimeContext());
  });

  afterEach(() => {
    process.argv = originalArgv;
    process.stdin.isTTY = originalIsTTY;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    clearActiveProviderRuntimeContext();
  });

  it('should be interactive if isTTY and no prompt', async () => {
    process.stdin.isTTY = true;
    process.argv = ['node', 'script.js'];
    const argv = await parseArguments({} as Settings);
    const config = await loadCliConfig(
      {},
      [],
      new ExtensionEnablementManager(
        ExtensionStorage.getUserExtensionsDir(),
        argv.extensions,
      ),
      'test-session',
      argv,
    );
    expect(config.isInteractive()).toBe(true);
  });

  it('should be interactive if prompt-interactive is set', async () => {
    process.stdin.isTTY = false;
    process.argv = ['node', 'script.js', '--prompt-interactive', 'test'];
    const argv = await parseArguments({} as Settings);
    const config = await loadCliConfig(
      {},
      [],
      new ExtensionEnablementManager(
        ExtensionStorage.getUserExtensionsDir(),
        argv.extensions,
      ),
      'test-session',
      argv,
    );
    expect(config.isInteractive()).toBe(true);
  });

  it('should not be interactive if not isTTY and no prompt', async () => {
    process.stdin.isTTY = false;
    process.argv = ['node', 'script.js'];
    const argv = await parseArguments({} as Settings);
    const config = await loadCliConfig(
      {},
      [],
      new ExtensionEnablementManager(
        ExtensionStorage.getUserExtensionsDir(),
        argv.extensions,
      ),
      'test-session',
      argv,
    );
    expect(config.isInteractive()).toBe(false);
  });

  it('should not be interactive if prompt is set', async () => {
    process.stdin.isTTY = true;
    process.argv = ['node', 'script.js', '--prompt', 'test'];
    const argv = await parseArguments({} as Settings);
    const config = await loadCliConfig(
      {},
      [],
      new ExtensionEnablementManager(
        ExtensionStorage.getUserExtensionsDir(),
        argv.extensions,
      ),
      'test-session',
      argv,
    );
    expect(config.isInteractive()).toBe(false);
  });

  it('should not be interactive if positional prompt words are provided with other flags', async () => {
    process.stdin.isTTY = true;
    process.argv = ['node', 'script.js', '--model', 'gemini-2.5-pro', 'Hello'];
    const argv = await parseArguments({} as Settings);
    const config = await loadCliConfig(
      {},
      [],
      new ExtensionEnablementManager(
        ExtensionStorage.getUserExtensionsDir(),
        argv.extensions,
      ),
      'test-session',
      argv,
    );
    expect(config.isInteractive()).toBe(false);
  });

  it('should not be interactive if positional prompt words are provided with multiple flags', async () => {
    process.stdin.isTTY = true;
    process.argv = [
      'node',
      'script.js',
      '--model',
      'gemini-2.5-pro',
      '--yolo',
      'Hello world',
    ];
    const argv = await parseArguments({} as Settings);
    const config = await loadCliConfig(
      {},
      [],
      new ExtensionEnablementManager(
        ExtensionStorage.getUserExtensionsDir(),
        argv.extensions,
      ),
      'test-session',
      argv,
    );
    expect(config.isInteractive()).toBe(false);
  });

  it('should not be interactive if positional prompt words are provided with extensions flag', async () => {
    process.stdin.isTTY = true;
    process.argv = ['node', 'script.js', '-e', 'none', 'hello'];
    const argv = await parseArguments({} as Settings);
    const config = await loadCliConfig(
      {},
      [],
      new ExtensionEnablementManager(
        ExtensionStorage.getUserExtensionsDir(),
        argv.extensions,
      ),
      'test-session',
      argv,
    );
    expect(config.isInteractive()).toBe(false);
    expect(argv.query).toBe('hello');
    expect(argv.extensions).toStrictEqual(['none']);
  });

  it('should handle multiple positional words correctly', async () => {
    process.stdin.isTTY = true;
    process.argv = ['node', 'script.js', 'hello world how are you'];
    const argv = await parseArguments({} as Settings);
    const config = await loadCliConfig(
      {},
      [],
      new ExtensionEnablementManager(
        ExtensionStorage.getUserExtensionsDir(),
        argv.extensions,
      ),
      'test-session',
      argv,
    );
    expect(config.isInteractive()).toBe(false);
    expect(argv.query).toBe('hello world how are you');
    expect(argv.prompt).toBe('hello world how are you');
  });

  it('should handle multiple positional words with flags', async () => {
    process.stdin.isTTY = true;
    process.argv = [
      'node',
      'script.js',
      '--model',
      'gemini-2.5-pro',
      'write',
      'a',
      'function',
      'to',
      'sort',
      'array',
    ];
    const argv = await parseArguments({} as Settings);
    const config = await loadCliConfig(
      {},
      [],
      new ExtensionEnablementManager(
        ExtensionStorage.getUserExtensionsDir(),
        argv.extensions,
      ),
      'test-session',
      argv,
    );
    expect(config.isInteractive()).toBe(false);
    expect(argv.query).toBe('write a function to sort array');
    expect(argv.model).toBe('gemini-2.5-pro');
  });

  it('should handle empty positional arguments', async () => {
    process.stdin.isTTY = true;
    process.argv = ['node', 'script.js', ''];
    const argv = await parseArguments({} as Settings);
    const config = await loadCliConfig(
      {},
      [],
      new ExtensionEnablementManager(
        ExtensionStorage.getUserExtensionsDir(),
        argv.extensions,
      ),
      'test-session',
      argv,
    );
    expect(config.isInteractive()).toBe(true);
    expect(argv.query).toBeUndefined();
  });

  it('should handle extensions flag with positional arguments correctly', async () => {
    process.stdin.isTTY = true;
    process.argv = [
      'node',
      'script.js',
      '-e',
      'none',
      'hello',
      'world',
      'how',
      'are',
      'you',
    ];
    const argv = await parseArguments({} as Settings);
    const config = await loadCliConfig(
      {},
      [],
      new ExtensionEnablementManager(
        ExtensionStorage.getUserExtensionsDir(),
        argv.extensions,
      ),
      'test-session',
      argv,
    );
    expect(config.isInteractive()).toBe(false);
    expect(argv.query).toBe('hello world how are you');
    expect(argv.extensions).toStrictEqual(['none']);
  });

  it('should be interactive if no positional prompt words are provided with flags', async () => {
    process.stdin.isTTY = true;
    process.argv = ['node', 'script.js', '--model', 'gemini-2.5-pro'];
    const argv = await parseArguments({} as Settings);
    const config = await loadCliConfig(
      {},
      [],
      new ExtensionEnablementManager(
        ExtensionStorage.getUserExtensionsDir(),
        argv.extensions,
      ),
      'test-session',
      argv,
    );
    expect(config.isInteractive()).toBe(true);
  });
});

describe('loadCliConfig fileFiltering', () => {
  const originalArgv = process.argv;

  beforeEach(() => {
    resetRuntimeSettingsState();
    vi.resetAllMocks();
    vi.mocked(os.homedir).mockReturnValue('/mock/home/user');
    vi.stubEnv('GEMINI_API_KEY', 'test-api-key');
    process.argv = ['node', 'script.js']; // Reset argv for each test
    setActiveProviderRuntimeContext(createProviderRuntimeContext());
  });

  afterEach(() => {
    process.argv = originalArgv;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    clearActiveProviderRuntimeContext();
  });

  const testCases: Array<{
    property: keyof NonNullable<Settings['fileFiltering']>;
    getter: (config: ServerConfig.Config) => boolean;
    value: boolean;
  }> = [
    {
      property: 'enableFuzzySearch',
      getter: (c) => !c.getFileFilteringDisableFuzzySearch(),
      value: true,
    },
    {
      property: 'enableFuzzySearch',
      getter: (c) => !c.getFileFilteringDisableFuzzySearch(),
      value: false,
    },
    {
      property: 'respectGitIgnore',
      getter: (c) => c.getFileFilteringRespectGitIgnore(),
      value: true,
    },
    {
      property: 'respectGitIgnore',
      getter: (c) => c.getFileFilteringRespectGitIgnore(),
      value: false,
    },
    {
      property: 'respectLlxprtIgnore',
      getter: (c) => c.getFileFilteringRespectLlxprtIgnore(),
      value: true,
    },
    {
      property: 'respectLlxprtIgnore',
      getter: (c) => c.getFileFilteringRespectLlxprtIgnore(),
      value: false,
    },
    {
      property: 'enableRecursiveFileSearch',
      getter: (c) => c.getEnableRecursiveFileSearch(),
      value: true,
    },
    {
      property: 'enableRecursiveFileSearch',
      getter: (c) => c.getEnableRecursiveFileSearch(),
      value: false,
    },
  ];

  it.each(testCases)(
    'should pass $property from settings to config when $value',
    async ({ property, getter, value }) => {
      const settings: Settings = {
        fileFiltering: { [property]: value },
      };
      const argv = await parseArguments(settings);
      const config = await loadCliConfig(
        settings,
        [],
        new ExtensionEnablementManager(
          ExtensionStorage.getUserExtensionsDir(),
          argv.extensions,
        ),
        'test-session',
        argv,
      );
      expect(getter(config)).toBe(value);
    },
  );
});

describe('parseArguments with positional prompt', () => {
  const originalArgv = process.argv;

  afterEach(() => {
    resetRuntimeSettingsState();
    process.argv = originalArgv;
  });

  it('should throw an error when both a positional prompt and the --prompt flag are used', async () => {
    process.argv = [
      'node',
      'script.js',
      'positional',
      'prompt',
      '--prompt',
      'test prompt',
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
        'Cannot use both a positional prompt and the --prompt (-p) flag together',
      ),
    );

    mockExit.mockRestore();
    mockConsoleError.mockRestore();
  });

  it('should correctly parse a positional prompt', async () => {
    process.argv = ['node', 'script.js', 'positional', 'prompt'];
    const argv = await parseArguments({} as Settings);
    expect(argv.promptWords).toStrictEqual(['positional', 'prompt']);
  });

  it('should correctly parse positional query argument', async () => {
    process.argv = ['node', 'script.js', 'test', 'query'];
    const argv = await parseArguments({} as Settings);
    expect(argv.query).toBe('test query');
  });

  it('should correctly parse a prompt from the --prompt flag', async () => {
    process.argv = ['node', 'script.js', '--prompt', 'test prompt'];
    const argv = await parseArguments({} as Settings);
    expect(argv.prompt).toBe('test prompt');
  });
});
