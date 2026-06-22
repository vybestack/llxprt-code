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
  ApprovalMode,
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

describe('defaultDisabledTools', () => {
  const originalIsTTY = process.stdin.isTTY;

  beforeEach(() => {
    resetRuntimeSettingsState();
    process.stdin.isTTY = true;
    setActiveProviderRuntimeContext(createProviderRuntimeContext());
  });

  afterEach(() => {
    process.stdin.isTTY = originalIsTTY;
    clearActiveProviderRuntimeContext();
  });

  it('should seed tools.disabled with defaultDisabledTools', async () => {
    const settings: Settings = {
      defaultDisabledTools: ['google_web_fetch'],
    };
    process.argv = ['node', 'script.js'];
    const argv = await parseArguments({} as Settings);
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
    const disabled = config.getEphemeralSetting('tools.disabled');
    expect(disabled).toStrictEqual(
      expect.arrayContaining(['google_web_fetch']),
    );
  });

  it('should seed tools.disabled with both default-disabled tools', async () => {
    const settings: Settings = {
      defaultDisabledTools: ['google_web_fetch', 'google_web_search'],
    };
    process.argv = ['node', 'script.js'];
    const argv = await parseArguments({} as Settings);
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
    const disabled = config.getEphemeralSetting('tools.disabled');
    expect(disabled).toStrictEqual(
      expect.arrayContaining(['google_web_fetch', 'google_web_search']),
    );
  });

  it('should merge defaultDisabledTools with existing tools.disabled', async () => {
    const settings: Settings = {
      defaultDisabledTools: ['google_web_fetch'],
    };
    process.argv = [
      'node',
      'script.js',
      '--set',
      'tools.disabled=["read_file"]',
    ];
    const argv = await parseArguments({} as Settings);
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
    const currentDisabled =
      (config.getEphemeralSetting('tools.disabled') as string[] | undefined) ??
      [];
    expect(currentDisabled).toStrictEqual(
      expect.arrayContaining(['read_file', 'google_web_fetch']),
    );
  });

  it('should not duplicate tools already in tools.disabled', async () => {
    const settings: Settings = {
      defaultDisabledTools: ['google_web_fetch'],
    };
    process.argv = [
      'node',
      'script.js',
      '--set',
      'tools.disabled=["google_web_fetch"]',
    ];
    const argv = await parseArguments({} as Settings);
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
    const disabled = config.getEphemeralSetting('tools.disabled') as string[];
    const googleWebFetchCount = disabled.filter(
      (t) => t === 'google_web_fetch',
    ).length;
    expect(googleWebFetchCount).toBe(1);
  });

  it('should not seed tools.disabled when defaultDisabledTools is empty', async () => {
    const settings: Settings = {
      defaultDisabledTools: [],
    };
    process.argv = ['node', 'script.js'];
    const argv = await parseArguments({} as Settings);
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
    const disabled = config.getEphemeralSetting('tools.disabled');
    // Should be either undefined, null, or empty array
    expect(
      disabled === undefined ||
        disabled === null ||
        (Array.isArray(disabled) && disabled.length === 0),
    ).toBe(true);
  });

  it('should not seed tools.disabled when defaultDisabledTools is undefined', async () => {
    const settings: Settings = {
      defaultDisabledTools: undefined,
    };
    process.argv = ['node', 'script.js'];
    const argv = await parseArguments({} as Settings);
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
    const disabled = config.getEphemeralSetting('tools.disabled');
    // Should be either undefined, null, or empty array
    expect(
      disabled === undefined ||
        disabled === null ||
        (Array.isArray(disabled) && disabled.length === 0),
    ).toBe(true);
  });

  it('should not affect excludeTools (tool remains discoverable)', async () => {
    const settings: Settings = {
      defaultDisabledTools: ['google_web_fetch'],
    };
    process.argv = ['node', 'script.js'];
    const argv = await parseArguments({} as Settings);
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
    // google_web_fetch should NOT be in excludeTools
    expect(config.getExcludeTools()).not.toContain('google_web_fetch');
    // But it SHOULD be in tools.disabled
    const disabled = config.getEphemeralSetting('tools.disabled') as string[];
    expect(disabled).toContain('google_web_fetch');
  });

  it('should not re-disable a tool that the user has explicitly allowed', async () => {
    const settings: Settings = {
      defaultDisabledTools: ['google_web_fetch'],
    };
    process.argv = [
      'node',
      'script.js',
      '--set',
      'tools.allowed=["google_web_fetch"]',
    ];
    const argv = await parseArguments({} as Settings);
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
    const disabled = config.getEphemeralSetting('tools.disabled') as
      | string[]
      | undefined;
    // google_web_fetch is in tools.allowed, so it must NOT be added to tools.disabled
    expect(disabled ?? []).not.toContain('google_web_fetch');
  });
});

describe('loadCliConfig disableYoloMode', () => {
  beforeEach(() => {
    resetRuntimeSettingsState();
    vi.resetAllMocks();
    vi.mocked(os.homedir).mockReturnValue('/mock/home/user');
    vi.stubEnv('GEMINI_API_KEY', 'test-api-key');
    vi.mocked(isWorkspaceTrusted).mockReturnValue(true);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('should allow auto_edit mode even if yolo mode is disabled', async () => {
    process.argv = ['node', 'script.js', '--approval-mode=auto_edit'];
    const argv = await parseArguments({} as Settings);
    const settings: Settings = {
      security: { disableYoloMode: true },
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
    expect(config.getApprovalMode()).toBe(ApprovalMode.AUTO_EDIT);
  });

  it('should throw if YOLO mode is attempted when disableYoloMode is true', async () => {
    process.argv = ['node', 'script.js', '--yolo'];
    const argv = await parseArguments({} as Settings);
    const settings: Settings = {
      security: { disableYoloMode: true },
    };
    await expect(
      loadCliConfig(
        settings,
        [],
        new ExtensionEnablementManager(
          ExtensionStorage.getUserExtensionsDir(),
          argv.extensions,
        ),
        'test-session',
        argv,
      ),
    ).rejects.toThrow(
      'Cannot start in YOLO mode since it is disabled by your admin',
    );
  });
});

describe('loadCliConfig secureModeEnabled', () => {
  beforeEach(() => {
    resetRuntimeSettingsState();
    vi.resetAllMocks();
    vi.mocked(os.homedir).mockReturnValue('/mock/home/user');
    vi.stubEnv('GEMINI_API_KEY', 'test-api-key');
    vi.mocked(isWorkspaceTrusted).mockReturnValue(true);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('should throw an error if YOLO mode is attempted when secureModeEnabled is true', async () => {
    process.argv = ['node', 'script.js', '--yolo'];
    const argv = await parseArguments({} as Settings);
    const settings: Settings = {
      admin: { secureModeEnabled: true },
    };
    await expect(
      loadCliConfig(
        settings,
        [],
        new ExtensionEnablementManager(
          ExtensionStorage.getUserExtensionsDir(),
          argv.extensions,
        ),
        'test-session',
        argv,
      ),
    ).rejects.toThrow(
      'Cannot start in YOLO mode since it is disabled by your admin',
    );
  });
});
