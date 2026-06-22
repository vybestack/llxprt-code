/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  ShellTool,
  createProviderRuntimeContext,
  setActiveProviderRuntimeContext,
  clearActiveProviderRuntimeContext,
  isRipgrepAvailable,
} from '@vybestack/llxprt-code-core';
import { loadCliConfig } from './config.js';
import { parseArguments } from './cliArgParser.js';
import type { Settings } from './settings.js';
import { ExtensionStorage } from './extension.js';
import * as ServerConfig from '@vybestack/llxprt-code-core';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { isWorkspaceTrusted } from './trustedFolders.js';
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

describe('loadCliConfig chatCompression', () => {
  const originalArgv = process.argv;

  beforeEach(() => {
    resetRuntimeSettingsState();
    vi.resetAllMocks();
    vi.mocked(os.homedir).mockReturnValue('/mock/home/user');
    vi.stubEnv('GEMINI_API_KEY', 'test-api-key');
    setActiveProviderRuntimeContext(createProviderRuntimeContext());
  });

  afterEach(() => {
    process.argv = originalArgv;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    clearActiveProviderRuntimeContext();
  });

  it('should pass chatCompression settings to the core config', async () => {
    process.argv = ['node', 'script.js'];
    const argv = await parseArguments({} as Settings);
    const settings: Settings = {
      chatCompression: {
        contextPercentageThreshold: 0.5,
      },
    };
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
    expect(config.getChatCompression()).toStrictEqual({
      contextPercentageThreshold: 0.5,
    });
  });

  it('should have undefined chatCompression if not in settings', async () => {
    process.argv = ['node', 'script.js'];
    const argv = await parseArguments({} as Settings);
    const settings: Settings = {};
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
    expect(config.getChatCompression()).toBeUndefined();
  });
});

describe('loadCliConfig useRipgrep', () => {
  const originalArgv = process.argv;

  beforeEach(() => {
    resetRuntimeSettingsState();
    vi.resetAllMocks();
    vi.mocked(os.homedir).mockReturnValue('/mock/home/user');
    vi.stubEnv('GEMINI_API_KEY', 'test-api-key');
    setActiveProviderRuntimeContext(createProviderRuntimeContext());
    // Default: ripgrep is available
    vi.mocked(isRipgrepAvailable).mockResolvedValue(true);
  });

  afterEach(() => {
    process.argv = originalArgv;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    clearActiveProviderRuntimeContext();
  });

  it('should auto-enable ripgrep when available and not set in settings', async () => {
    process.argv = ['node', 'script.js'];
    const argv = await parseArguments({} as Settings);
    const settings: Settings = {};
    vi.mocked(isRipgrepAvailable).mockResolvedValue(true);
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
    expect(config.getUseRipgrep()).toBe(true);
  });

  it('should be false when ripgrep not available and not set in settings', async () => {
    process.argv = ['node', 'script.js'];
    const argv = await parseArguments({} as Settings);
    const settings: Settings = {};
    vi.mocked(isRipgrepAvailable).mockResolvedValue(false);
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
    expect(config.getUseRipgrep()).toBe(false);
  });

  it('should be false when useRipgrep is set to false in settings, even if ripgrep available', async () => {
    process.argv = ['node', 'script.js'];
    const argv = await parseArguments({} as Settings);
    const settings: Settings = { useRipgrep: false };
    vi.mocked(isRipgrepAvailable).mockResolvedValue(true);
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
    expect(config.getUseRipgrep()).toBe(false);
  });

  it('should be true when useRipgrep is explicitly set to true in settings', async () => {
    process.argv = ['node', 'script.js'];
    const argv = await parseArguments({} as Settings);
    const settings: Settings = { useRipgrep: true };
    vi.mocked(isRipgrepAvailable).mockResolvedValue(false);
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
    expect(config.getUseRipgrep()).toBe(true);
  });
});

describe('screenReader configuration', () => {
  const originalArgv = process.argv;

  beforeEach(() => {
    resetRuntimeSettingsState();
    vi.resetAllMocks();
    vi.mocked(os.homedir).mockReturnValue('/mock/home/user');
    vi.stubEnv('GEMINI_API_KEY', 'test-api-key');
    setActiveProviderRuntimeContext(createProviderRuntimeContext());
  });

  afterEach(() => {
    process.argv = originalArgv;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    clearActiveProviderRuntimeContext();
  });

  it('should use screenReader value from settings if CLI flag is not present (settings true)', async () => {
    process.argv = ['node', 'script.js'];
    const argv = await parseArguments({} as Settings);
    const settings: Settings = {
      accessibility: { screenReader: true },
    };
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
    expect(config.getScreenReader()).toBe(true);
  });

  it('should use screenReader value from settings if CLI flag is not present (settings false)', async () => {
    process.argv = ['node', 'script.js'];
    const argv = await parseArguments({} as Settings);
    const settings: Settings = {
      accessibility: { screenReader: false },
    };
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
    expect(config.getScreenReader()).toBe(false);
  });

  it('should prioritize --screen-reader CLI flag (true) over settings (false)', async () => {
    process.argv = ['node', 'script.js', '--screen-reader'];
    const argv = await parseArguments({} as Settings);
    const settings: Settings = {
      accessibility: { screenReader: false },
    };
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
    expect(config.getScreenReader()).toBe(true);
  });

  it('should be false by default when no flag or setting is present', async () => {
    process.argv = ['node', 'script.js'];
    const argv = await parseArguments({} as Settings);
    const settings: Settings = {};
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
    expect(config.getScreenReader()).toBe(false);
  });
});

describe('loadCliConfig tool exclusions', () => {
  const originalArgv = process.argv;
  const originalIsTTY = process.stdin.isTTY;

  beforeEach(() => {
    resetRuntimeSettingsState();
    vi.resetAllMocks();
    vi.mocked(os.homedir).mockReturnValue('/mock/home/user');
    vi.stubEnv('GEMINI_API_KEY', 'test-api-key');
    process.stdin.isTTY = true;
    vi.mocked(isWorkspaceTrusted).mockReturnValue(true);
    setActiveProviderRuntimeContext(createProviderRuntimeContext());
  });

  afterEach(() => {
    process.argv = originalArgv;
    process.stdin.isTTY = originalIsTTY;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    clearActiveProviderRuntimeContext();
  });

  it('should not exclude interactive tools in interactive mode without YOLO', async () => {
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
    expect(config.getExcludeTools()).not.toContain('run_shell_command');
    expect(config.getExcludeTools()).not.toContain('replace');
    expect(config.getExcludeTools()).not.toContain('write_file');
  });

  it('should not exclude interactive tools in interactive mode with YOLO', async () => {
    process.stdin.isTTY = true;
    process.argv = ['node', 'script.js', '--yolo'];
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
    expect(config.getExcludeTools()).not.toContain('run_shell_command');
    expect(config.getExcludeTools()).not.toContain('replace');
    expect(config.getExcludeTools()).not.toContain('write_file');
  });

  it('should exclude interactive tools in non-interactive mode without YOLO', async () => {
    process.stdin.isTTY = false;
    process.argv = ['node', 'script.js', '-p', 'test'];
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
    expect(config.getExcludeTools()).toContain('run_shell_command');
    expect(config.getExcludeTools()).toContain('replace');
    expect(config.getExcludeTools()).toContain('write_file');
  });

  it('should not exclude interactive tools in non-interactive mode with YOLO', async () => {
    process.stdin.isTTY = false;
    process.argv = ['node', 'script.js', '-p', 'test', '--yolo'];
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
    expect(config.getExcludeTools()).not.toContain('run_shell_command');
    expect(config.getExcludeTools()).not.toContain('replace');
    expect(config.getExcludeTools()).not.toContain('write_file');
  });

  it('should not exclude shell tool in non-interactive mode when --allowed-tools="ShellTool" is set', async () => {
    process.stdin.isTTY = false;
    process.argv = [
      'node',
      'script.js',
      '-p',
      'test',
      '--allowed-tools',
      'ShellTool',
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
    expect(config.getExcludeTools()).not.toContain(ShellTool.Name);
  });

  it('should not exclude shell tool in non-interactive mode when --allowed-tools="run_shell_command" is set', async () => {
    process.stdin.isTTY = false;
    process.argv = [
      'node',
      'script.js',
      '-p',
      'test',
      '--allowed-tools',
      'run_shell_command',
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
    expect(config.getExcludeTools()).not.toContain(ShellTool.Name);
  });

  it('should not exclude shell tool in non-interactive mode when --allowed-tools="ShellTool(wc)" is set', async () => {
    process.stdin.isTTY = false;
    process.argv = [
      'node',
      'script.js',
      '-p',
      'test',
      '--allowed-tools',
      'ShellTool(wc)',
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
    expect(config.getExcludeTools()).not.toContain(ShellTool.Name);
  });
});
