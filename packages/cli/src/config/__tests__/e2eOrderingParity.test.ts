/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Task 1.7 – End-to-end provider/profile/override ordering parity test
 *
 * Guards the critical ordering of steps 10-14 in loadCliConfig:
 *   10. setCliRuntimeContext — MUST complete before step 11
 *   11. registerCliProviderInfrastructure (conditional, via runtimeSettings dynamic import)
 *   12. applyProfileToRuntime (applyProfileSnapshot)
 *   13. switchActiveProvider
 *   14. reapplyCliOverrides (CLI model override must survive provider switch)
 *
 * Asserts:
 *   - setCliRuntimeContext completes before switchActiveProvider
 *   - switchActiveProvider is called with the correct provider
 *   - CLI --model override is set on the config even after provider switch
 *   - Full provider and model precedence chain is honored end-to-end
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import {
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
  return { ...actual, isWorkspaceTrusted: vi.fn().mockReturnValue(true) };
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
      if (mockPaths.has(p.toString()))
        return { isDirectory: () => true } as unknown as import('fs').Stats;
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

/**
 * Shared call log — populated by mock implementations below.
 * Used to assert temporal ordering between critical lifecycle steps.
 */
const callLog = vi.hoisted(() => ({ entries: [] as string[] }));

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

// Mock applyProfileSnapshot (static import in config.ts from profileSnapshot.js)
vi.mock('../../runtime/profileSnapshot.js', () => ({
  applyProfileSnapshot: vi.fn(
    async (profile: { provider?: string; model?: string }) => {
      callLog.entries.push('applyProfileSnapshot');
      return {
        providerName: profile.provider ?? '',
        modelName: profile.model ?? '',
        warnings: [],
      };
    },
  ),
}));

// Mock switchActiveProvider (static import in config.ts from providerSwitch.js)
vi.mock('../../runtime/providerSwitch.js', () => ({
  switchActiveProvider: vi.fn(async (providerName: string) => {
    callLog.entries.push(`switchActiveProvider:${providerName}`);
    return {
      changed: true,
      previousProvider: null,
      nextProvider: providerName,
      infoMessages: [],
    };
  }),
}));

// Mock setCliRuntimeContext (static import in config.ts from runtimeLifecycle.js)
vi.mock('../../runtime/runtimeLifecycle.js', () => ({
  setCliRuntimeContext: vi.fn(
    (
      svc: ServerConfig.SettingsService,
      cfg?: ServerConfig.Config,
      opts: { metadata?: Record<string, unknown>; runtimeId?: string } = {},
    ) => {
      callLog.entries.push('setCliRuntimeContext');
      runtimeSettingsState.context = {
        settingsService: svc,
        config: cfg ?? null,
        runtimeId: opts.runtimeId ?? 'mock-runtime',
        metadata: opts.metadata ?? {},
      };
    },
  ),
}));

// Mock runtimeAccessors (static import in config.ts)
vi.mock('../../runtime/runtimeAccessors.js', () => ({
  getCliRuntimeContext: vi.fn(() => runtimeSettingsState.context),
  getCliRuntimeConfig: vi.fn(
    () => runtimeSettingsState.context?.config ?? null,
  ),
  getCliRuntimeServices: vi.fn(() => ({
    config: runtimeSettingsState.context?.config ?? null,
    settingsService:
      runtimeSettingsState.context?.settingsService ??
      new ServerConfig.SettingsService(),
    providerManager:
      runtimeSettingsState.providerManager ??
      ({
        listProviders: vi.fn(() => []),
        getActiveProviderName: vi.fn(() => null),
        setActiveProvider: vi.fn(),
        getActiveProvider: vi.fn(() => null),
        getAvailableModels: vi.fn(async () => []),
      } as unknown as ServerConfig.ProviderManager),
  })),
  getCliProviderManager: vi.fn(() => runtimeSettingsState.providerManager),
  getCliOAuthManager: vi.fn(() => null),
  getActiveProviderStatus: vi.fn(() => ({ name: null })),
  listProviders: vi.fn(() => []),
  getActiveProviderName: vi.fn(() => null),
  getActiveModelName: vi.fn(() => null),
  getEphemeralSettings: vi.fn(() => ({})),
  getEphemeralSetting: vi.fn(() => undefined),
}));

vi.mock('../../runtime/runtimeSettings.js', () => {
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
        svc: ServerConfig.SettingsService,
        cfg?: ServerConfig.Config,
        opts: { metadata?: Record<string, unknown>; runtimeId?: string } = {},
      ) => {
        runtimeSettingsState.context = {
          settingsService: svc,
          config: cfg ?? null,
          runtimeId: opts.runtimeId ?? 'mock-runtime',
          metadata: opts.metadata ?? {},
        };
      },
    ),
    switchActiveProvider: vi.fn(async (providerName: string) => ({
      changed: true,
      previousProvider: null,
      nextProvider: providerName,
      infoMessages: [],
    })),
    registerCliProviderInfrastructure: vi.fn(
      (mgr: ServerConfig.ProviderManager, oauth: unknown) => {
        callLog.entries.push('registerCliProviderInfrastructure');
        runtimeSettingsState.providerManager = mgr;
        runtimeSettingsState.oauthManager = oauth ?? null;
      },
    ),
    applyCliArgumentOverrides: vi.fn(async () => {
      callLog.entries.push('applyCliArgumentOverrides');
    }),
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

async function runConfig(settings: Settings, argv: string[] = []) {
  process.argv = ['node', 'script.js', ...argv];
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

// ─── Suite: step ordering ─────────────────────────────────────────────────────

describe('e2eOrderingParity: step ordering constraints', () => {
  const originalArgv = process.argv;

  beforeEach(() => {
    vi.clearAllMocks();
    callLog.entries.length = 0;
    vi.mocked(os.homedir).mockReturnValue(
      path.resolve(path.sep, 'mock', 'home', 'user'),
    );
    vi.stubEnv('GEMINI_API_KEY', 'test-api-key');
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

  it('setCliRuntimeContext happens before switchActiveProvider', async () => {
    await runConfig({});
    const entries = callLog.entries;
    const setIdx = entries.indexOf('setCliRuntimeContext');
    const switchIdx = entries.findIndex((c) =>
      c.startsWith('switchActiveProvider:'),
    );
    expect(setIdx).toBeGreaterThanOrEqual(0);
    expect(switchIdx).toBeGreaterThanOrEqual(0);
    expect(setIdx).toBeLessThan(switchIdx);
  });

  it('switchActiveProvider is called exactly once', async () => {
    await runConfig({});
    const switchCalls = callLog.entries.filter((c) =>
      c.startsWith('switchActiveProvider:'),
    );
    expect(switchCalls).toHaveLength(1);
  });

  it('with --provider+--key: applyProfileSnapshot is called (synthetic profile flow)', async () => {
    await runConfig({}, ['--provider', 'openai', '--key', 'sk-test']);
    // Synthetic profile flow calls applyProfileSnapshot followed by switchActiveProvider
    const applyIdx = callLog.entries.indexOf('applyProfileSnapshot');
    const switchIdx = callLog.entries.findIndex((c) =>
      c.startsWith('switchActiveProvider:'),
    );
    // Both must happen
    expect(applyIdx).toBeGreaterThanOrEqual(0);
    expect(switchIdx).toBeGreaterThanOrEqual(0);
    // applyProfileSnapshot must happen before switchActiveProvider
    expect(applyIdx).toBeLessThan(switchIdx);
  });
});

// ─── Suite: full precedence chain ────────────────────────────────────────────

describe('e2eOrderingParity: full precedence chain end-to-end', () => {
  const originalArgv = process.argv;

  beforeEach(() => {
    vi.clearAllMocks();
    callLog.entries.length = 0;
    vi.mocked(os.homedir).mockReturnValue(
      path.resolve(path.sep, 'mock', 'home', 'user'),
    );
    vi.stubEnv('GEMINI_API_KEY', 'test-api-key');
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

  it('CLI --provider wins over LLXPRT_DEFAULT_PROVIDER env', async () => {
    vi.stubEnv('LLXPRT_DEFAULT_PROVIDER', 'anthropic');
    const config = await runConfig({}, ['--provider', 'openai']);
    expect(config.getProvider()).toBe('openai');
    expect(
      callLog.entries.some((c) => c === 'switchActiveProvider:openai'),
    ).toBe(true);
  });

  it('LLXPRT_DEFAULT_PROVIDER env wins over gemini default', async () => {
    vi.stubEnv('LLXPRT_DEFAULT_PROVIDER', 'anthropic');
    const config = await runConfig({});
    expect(config.getProvider()).toBe('anthropic');
    expect(
      callLog.entries.some((c) => c === 'switchActiveProvider:anthropic'),
    ).toBe(true);
  });

  it('CLI --model is set on config and survives the provider switch', async () => {
    const config = await runConfig({}, ['--model', 'cli-override-model']);
    expect(config.getModel()).toBe('cli-override-model');
    expect(
      callLog.entries.some((c) => c.startsWith('switchActiveProvider:')),
    ).toBe(true);
  });

  it('settings.model is used when no CLI --model and no env', async () => {
    const config = await runConfig({ model: 'settings-model' });
    expect(config.getModel()).toBe('settings-model');
  });

  it('CLI --model beats settings.model', async () => {
    const config = await runConfig({ model: 'settings-model' }, [
      '--model',
      'cli-model',
    ]);
    expect(config.getModel()).toBe('cli-model');
  });

  it('full stack: --provider + --model produces expected provider and model', async () => {
    const config = await runConfig({}, [
      '--provider',
      'openai',
      '--model',
      'gpt-4-turbo',
    ]);
    expect(config.getProvider()).toBe('openai');
    expect(config.getModel()).toBe('gpt-4-turbo');
  });
});
