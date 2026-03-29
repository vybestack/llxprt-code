/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Task 1.2 – Provider/model precedence parity tests
 *
 * Locks the 4-level provider precedence chain:
 *   CLI --provider > profile provider > LLXPRT_DEFAULT_PROVIDER env > 'gemini'
 *
 * Locks the 6-level model precedence chain:
 *   CLI --model > profile model > settings.model > env vars > alias default > Gemini default
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  DEFAULT_GEMINI_MODEL,
  createProviderRuntimeContext,
  setActiveProviderRuntimeContext,
  clearActiveProviderRuntimeContext,
} from '@vybestack/llxprt-code-core';
import * as ServerConfig from '@vybestack/llxprt-code-core';
import { loadCliConfig } from '../config.js';
import { parseArguments } from '../cliArgParser.js';
import type { Settings } from '../settings.js';
import { ExtensionStorage } from '../extension.js';
import { ExtensionEnablementManager } from '../extensions/extensionEnablement.js';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../trustedFolders.js', async () => {
  const actual = await vi.importActual<typeof import('../trustedFolders.js')>(
    '../trustedFolders.js',
  );
  return {
    ...actual,
    isWorkspaceTrusted: vi.fn().mockReturnValue(true),
  };
});

vi.mock('../sandboxConfig.js', () => ({
  loadSandboxConfig: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('fs', async (importOriginal) => {
  const actualFs = await importOriginal<typeof import('fs')>();
  const pathMod = await import('node:path');
  const MOCK_CWD = pathMod.resolve(pathMod.sep, 'home', 'user', 'project');
  const mockPaths = new Set([MOCK_CWD, process.cwd()]);
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

vi.mock('open', () => ({ default: vi.fn() }));
vi.mock('read-package-up', () => ({
  readPackageUp: vi.fn(() =>
    Promise.resolve({ packageJson: { version: 'test-version' } }),
  ),
}));

vi.mock('../profileBootstrap.js', async () => {
  const actual = await vi.importActual<typeof import('../profileBootstrap.js')>(
    '../profileBootstrap.js',
  );
  const { SettingsService: RealSettingsService } = await vi.importActual<
    typeof import('@vybestack/llxprt-code-core')
  >('@vybestack/llxprt-code-core');
  return {
    ...actual,
    prepareRuntimeForProfile: vi.fn(async () => ({
      runtime: {
        settingsService: new RealSettingsService(),
        config: null,
        runtimeId: 'mock-runtime',
        metadata: {},
      },
      runtimeMessageBus: undefined,
      providerManager: {
        listProviders: vi.fn(() => []),
        getActiveProviderName: vi.fn(() => null),
        setActiveProvider: vi.fn(),
        getActiveProvider: vi.fn(() => null),
        getAvailableModels: vi.fn(async () => []),
      },
      oauthManager: undefined,
    })),
  };
});

const runtimeSettingsState = vi.hoisted(() => ({
  context: null as {
    settingsService: ServerConfig.SettingsService;
    config: ServerConfig.Config | null;
    runtimeId: string;
    metadata?: Record<string, unknown>;
  } | null,
  providerManager: null as ServerConfig.ProviderManager | null,
  oauthManager: null as unknown,
}));

vi.mock('../runtime/runtimeSettings.js', () => {
  const getProviderManager = () =>
    runtimeSettingsState.providerManager ??
    ({
      listProviders: vi.fn(() => []),
      getActiveProviderName: vi.fn(() => null),
      setActiveProvider: vi.fn(),
      getActiveProvider: vi.fn(() => null),
      getAvailableModels: vi.fn(async () => []),
    } as unknown as ServerConfig.ProviderManager);

  return {
    applyProfileSnapshot: vi.fn(
      async (profile: { provider?: string; model?: string }) => ({
        providerName: profile.provider ?? '',
        modelName: profile.model ?? '',
        warnings: [],
      }),
    ),
    getCliRuntimeContext: vi.fn(() => runtimeSettingsState.context),
    setCliRuntimeContext: vi.fn(
      (
        settingsService: ServerConfig.SettingsService,
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
      nextProvider: 'gemini',
      infoMessages: [],
    })),
    registerCliProviderInfrastructure: vi.fn(
      (manager: ServerConfig.ProviderManager, oauthManager: unknown) => {
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
        runtimeSettingsState.context?.settingsService ??
        new ServerConfig.SettingsService(),
      providerManager: getProviderManager(),
    })),
    getCliProviderManager: vi.fn(() => runtimeSettingsState.providerManager),
    getCliOAuthManager: vi.fn(() => null),
    getActiveProviderStatus: vi.fn(() => ({ name: null })),
    listProviders: vi.fn(() => []),
    getActiveProviderName: vi.fn(() => null),
    setActiveModel: vi.fn(async () => ({
      changed: false,
      previousModel: null,
      nextModel: null,
      infoMessages: [],
    })),
    listAvailableModels: vi.fn(async () => []),
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
  const actual = await vi.importActual<typeof ServerConfig>(
    '@vybestack/llxprt-code-core',
  );
  return {
    ...actual,
    IdeClient: {
      getInstance: vi.fn().mockResolvedValue({
        getConnectionStatus: vi.fn(),
        initialize: vi.fn(),
        shutdown: vi.fn(),
      }),
    },
    loadEnvironment: vi.fn(),
    loadServerHierarchicalMemory: vi.fn().mockResolvedValue({
      memoryContent: '',
      fileCount: 0,
      filePaths: [],
    }),
    DEFAULT_MEMORY_FILE_FILTERING_OPTIONS: {
      respectGitIgnore: false,
      respectGeminiIgnore: true,
    },
    DEFAULT_FILE_FILTERING_OPTIONS: {
      respectGitIgnore: true,
      respectGeminiIgnore: true,
    },
    isRipgrepAvailable: vi.fn().mockResolvedValue(true),
  };
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeExtMgr() {
  return new ExtensionEnablementManager(
    ExtensionStorage.getUserExtensionsDir(),
  );
}

async function runConfig(settings: Settings, argv?: string[]) {
  if (argv != null) {
    process.argv = ['node', 'script.js', ...argv];
  }
  const parsedArgv = await parseArguments(settings);
  const runtimeSettingsService = new ServerConfig.SettingsService();
  return loadCliConfig(
    settings,
    [],
    makeExtMgr(),
    'test-session',
    parsedArgv,
    undefined,
    { settingsService: runtimeSettingsService },
  );
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('providerModelPrecedenceParity: 4-level provider chain', () => {
  const originalArgv = process.argv;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(os.homedir).mockReturnValue(
      path.resolve(path.sep, 'mock', 'home', 'user'),
    );
    vi.stubEnv('GEMINI_API_KEY', 'test-api-key');
    // Scrub env vars that may leak from CI environment
    delete process.env.LLXPRT_PROFILE;
    delete process.env.LLXPRT_DEFAULT_PROVIDER;
    delete process.env.LLXPRT_DEFAULT_MODEL;
    delete process.env.GEMINI_MODEL;
    // Provide a fallback model so non-gemini providers don't fail with model.missing
    vi.stubEnv('LLXPRT_DEFAULT_MODEL', 'mock-default-model');
    process.argv = ['node', 'script.js'];
    setActiveProviderRuntimeContext(createProviderRuntimeContext());
    runtimeSettingsState.context = null;
    runtimeSettingsState.providerManager = null;
    runtimeSettingsState.oauthManager = null;
  });

  afterEach(() => {
    process.argv = originalArgv;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    clearActiveProviderRuntimeContext();
  });

  it('level 4 fallback: no CLI/profile/env → defaults to gemini', async () => {
    const config = await runConfig({});
    expect(config.getProvider()).toBe('gemini');
  });

  it('level 3: LLXPRT_DEFAULT_PROVIDER env overrides gemini default', async () => {
    vi.stubEnv('LLXPRT_DEFAULT_PROVIDER', 'anthropic');
    const config = await runConfig({});
    expect(config.getProvider()).toBe('anthropic');
  });

  it('level 1: CLI --provider overrides LLXPRT_DEFAULT_PROVIDER env', async () => {
    vi.stubEnv('LLXPRT_DEFAULT_PROVIDER', 'anthropic');
    const config = await runConfig({}, ['--provider', 'openai']);
    expect(config.getProvider()).toBe('openai');
  });

  it('level 1: CLI --provider beats env and gemini default', async () => {
    const config = await runConfig({}, ['--provider', 'openai']);
    expect(config.getProvider()).toBe('openai');
  });
});

describe('providerModelPrecedenceParity: 6-level model chain', () => {
  const originalArgv = process.argv;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(os.homedir).mockReturnValue(
      path.resolve(path.sep, 'mock', 'home', 'user'),
    );
    process.argv = ['node', 'script.js'];
    setActiveProviderRuntimeContext(createProviderRuntimeContext());
    runtimeSettingsState.context = null;
    runtimeSettingsState.providerManager = null;
    runtimeSettingsState.oauthManager = null;
    vi.unstubAllEnvs();
    vi.stubEnv('GEMINI_API_KEY', 'test-api-key');
    // Scrub env vars that may leak from CI environment
    delete process.env.LLXPRT_PROFILE;
    delete process.env.LLXPRT_DEFAULT_PROVIDER;
    delete process.env.LLXPRT_DEFAULT_MODEL;
    delete process.env.GEMINI_MODEL;
  });

  afterEach(() => {
    process.argv = originalArgv;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    clearActiveProviderRuntimeContext();
  });

  it('level 6 fallback: no override → DEFAULT_GEMINI_MODEL for gemini provider', async () => {
    const config = await runConfig({});
    expect(config.getModel()).toBe(DEFAULT_GEMINI_MODEL);
  });

  it('level 5: GEMINI_MODEL env provides model when no other override', async () => {
    vi.stubEnv('GEMINI_MODEL', 'gemini-1.5-flash');
    const config = await runConfig({});
    expect(config.getModel()).toBe('gemini-1.5-flash');
  });

  it('level 5: LLXPRT_DEFAULT_MODEL env provides model when no other override', async () => {
    vi.stubEnv('LLXPRT_DEFAULT_MODEL', 'gemini-env-model');
    const config = await runConfig({});
    expect(config.getModel()).toBe('gemini-env-model');
  });

  it('level 5: LLXPRT_DEFAULT_MODEL beats GEMINI_MODEL', async () => {
    vi.stubEnv('LLXPRT_DEFAULT_MODEL', 'preferred-model');
    vi.stubEnv('GEMINI_MODEL', 'fallback-model');
    const config = await runConfig({});
    expect(config.getModel()).toBe('preferred-model');
  });

  it('level 4: settings.model beats env vars', async () => {
    vi.stubEnv('GEMINI_MODEL', 'env-model');
    const config = await runConfig({ model: 'settings-model' });
    expect(config.getModel()).toBe('settings-model');
  });

  it('level 1: CLI --model beats settings.model and env', async () => {
    vi.stubEnv('GEMINI_MODEL', 'env-model');
    const config = await runConfig({ model: 'settings-model' }, [
      '--model',
      'cli-model',
    ]);
    expect(config.getModel()).toBe('cli-model');
  });

  it('level 1: CLI --model beats LLXPRT_DEFAULT_MODEL env', async () => {
    vi.stubEnv('LLXPRT_DEFAULT_MODEL', 'env-model');
    const config = await runConfig({}, ['--model', 'cli-model']);
    expect(config.getModel()).toBe('cli-model');
  });
});
