/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Task 1.6 – Profile + CLI override precedence parity tests
 *
 * Locks:
 *   - --provider with --key/--keyfile/--baseurl creates synthetic profile
 *   - Profile ephemeral settings are skipped when --provider is explicit
 *   - CLI model override is re-applied after provider switch (observable via config.getModel())
 *   - Profile source chain: --profile-load CLI > LLXPRT_PROFILE env > settings.defaultProfile
 *     (only when --provider is NOT explicit)
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

// Track applyProfileSnapshot calls — path must match config.ts's import source
// config.ts: import { applyProfileSnapshot } from '../runtime/profileSnapshot.js'
// from src/config/__tests__/, '../../runtime/profileSnapshot.js' → src/runtime/profileSnapshot.js
const profileSnapshotCalls = vi.hoisted(
  () => [] as Array<{ provider?: string; profileName?: string }>,
);

vi.mock('../../runtime/profileSnapshot.js', () => ({
  applyProfileSnapshot: vi.fn(
    async (
      profile: { provider?: string; model?: string; baseUrl?: string },
      opts?: { profileName?: string },
    ) => {
      profileSnapshotCalls.push({
        provider: profile.provider,
        profileName: opts?.profileName,
      });
      return {
        providerName: profile.provider ?? '',
        modelName: profile.model ?? '',
        baseUrl: profile.baseUrl,
        warnings: [],
      };
    },
  ),
}));

// Track switchActiveProvider calls
// config.ts: import { switchActiveProvider } from '../runtime/providerSwitch.js'
const switchProviderCalls = vi.hoisted(() => [] as string[]);

vi.mock('../../runtime/providerSwitch.js', () => ({
  switchActiveProvider: vi.fn(async (providerName: string) => {
    switchProviderCalls.push(providerName);
    return {
      changed: true,
      previousProvider: null,
      nextProvider: providerName,
      infoMessages: [],
    };
  }),
}));

// config.ts: import { setCliRuntimeContext } from '../runtime/runtimeLifecycle.js'
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

vi.mock('../../runtime/runtimeLifecycle.js', () => ({
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
}));

// config.ts: import { getCliRuntimeContext } from '../runtime/runtimeAccessors.js'
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
        runtimeSettingsState.providerManager = mgr;
        runtimeSettingsState.oauthManager = oauth ?? null;
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

async function runConfig(settings: Settings, argv: string[] = []) {
  process.argv = ['node', 'script.js', ...argv];
  const parsedArgv = await parseArguments(settings);
  return loadCliConfig(settings, [], makeExtMgr(), 'test-session', parsedArgv);
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('profileOverridePrecedenceParity: synthetic profile for CLI auth', () => {
  const originalArgv = process.argv;

  beforeEach(() => {
    vi.clearAllMocks();
    profileSnapshotCalls.length = 0;
    switchProviderCalls.length = 0;
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

  it('--provider with --key creates synthetic profile (applyProfileSnapshot called)', async () => {
    await runConfig({}, ['--provider', 'openai', '--key', 'sk-test-key']);
    const syntheticCall = profileSnapshotCalls.find(
      (c) => c.profileName === 'cli-args',
    );
    expect(syntheticCall).toBeDefined();
    expect(syntheticCall?.provider).toBe('openai');
  });

  it('--provider with --baseurl creates synthetic profile', async () => {
    await runConfig({}, [
      '--provider',
      'openai',
      '--baseurl',
      'https://custom.api.com',
    ]);
    const syntheticCall = profileSnapshotCalls.find(
      (c) => c.profileName === 'cli-args',
    );
    expect(syntheticCall).toBeDefined();
  });

  it('--provider alone (no key/keyfile/baseurl) does NOT create synthetic profile', async () => {
    await runConfig({}, ['--provider', 'openai']);
    const syntheticCall = profileSnapshotCalls.find(
      (c) => c.profileName === 'cli-args',
    );
    expect(syntheticCall).toBeUndefined();
  });
});

describe('profileOverridePrecedenceParity: --provider skips profile ephemeral settings', () => {
  const originalArgv = process.argv;

  beforeEach(() => {
    vi.clearAllMocks();
    profileSnapshotCalls.length = 0;
    switchProviderCalls.length = 0;
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

  it('with --provider, profile from LLXPRT_PROFILE env is skipped (no crash)', async () => {
    vi.stubEnv('LLXPRT_PROFILE', 'nonexistent-profile');
    const config = await runConfig({}, ['--provider', 'gemini']);
    expect(config).toBeDefined();
    expect(config.getProvider()).toBe('gemini');
  });

  it('without --provider, settings.defaultProfile is attempted (non-crash on not-found)', async () => {
    const settings: Settings = { defaultProfile: 'nonexistent-default' };
    const config = await runConfig(settings);
    expect(config).toBeDefined();
  });

  it('with --provider, settings.defaultProfile is NOT applied as file-based profile', async () => {
    const settings: Settings = { defaultProfile: 'some-profile' };
    await runConfig(settings, ['--provider', 'gemini']);
    const fileBasedCall = profileSnapshotCalls.find(
      (c) => c.profileName === 'some-profile',
    );
    expect(fileBasedCall).toBeUndefined();
  });
});

describe('profileOverridePrecedenceParity: CLI model override after provider switch', () => {
  const originalArgv = process.argv;

  beforeEach(() => {
    vi.clearAllMocks();
    profileSnapshotCalls.length = 0;
    switchProviderCalls.length = 0;
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

  it('--model override is reflected in final config model', async () => {
    const config = await runConfig({}, ['--model', 'my-custom-model']);
    expect(config.getModel()).toBe('my-custom-model');
  });

  it('--model combined with --provider: model set on final config', async () => {
    const config = await runConfig({}, [
      '--provider',
      'openai',
      '--model',
      'gpt-4',
    ]);
    expect(config.getModel()).toBe('gpt-4');
  });

  it('switchActiveProvider is called with the specified --provider', async () => {
    await runConfig({}, ['--provider', 'openai']);
    expect(switchProviderCalls).toContain('openai');
  });

  it('switchActiveProvider is called with gemini when no --provider is given', async () => {
    await runConfig({});
    expect(switchProviderCalls).toContain('gemini');
  });
});
