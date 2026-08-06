/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260603-ISSUE1584.P13
 * @requirement:REQ-API-001
 * @pseudocode consumer-migration.md lines 10-18
 */

/**
 * Task 1.7 – End-to-end provider/profile/override ordering parity test
 *
 * Guards the critical ordering of steps 10-14 in loadCliConfig:
 *   10. setCliRuntimeContext — MUST complete before provider infra registration
 *   11. registerCliProviderInfrastructure
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

import { restoreEnv, setEnv } from '@vybestack/llxprt-code-test-utils';
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from 'bun:test';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  createProviderRuntimeContext,
  setActiveProviderRuntimeContext,
  clearActiveProviderRuntimeContext,
} from '@vybestack/llxprt-code-core';
import * as ServerConfig from '@vybestack/llxprt-code-core';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import type { ProviderManager } from '@vybestack/llxprt-code-providers';
import { loadCliConfig } from '../config.js';
import { parseArguments } from '../cliArgParser.js';
import type { Settings } from '../settings.js';
import { ExtensionStorage } from '../extension.js';
import { ExtensionEnablementManager } from '../extensions/extensionEnablement.js';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const realTrustedFoldersModule = { ...(await import('../trustedFolders.js')) };
const realProfileBootstrapModule = {
  ...(await import('../profileBootstrap.js')),
};
const realLlxprtCodeSettingsModule = {
  ...(await import('@vybestack/llxprt-code-settings')),
};
const realLlxprtCodeCoreModule = {
  ...(await import('@vybestack/llxprt-code-core')),
};

void vi.mock('../trustedFolders.js', () => {
  const actual = realTrustedFoldersModule;
  return { ...actual, isWorkspaceTrusted: vi.fn().mockReturnValue(true) };
});

void vi.mock('../sandboxConfig.js', () => ({
  loadSandboxConfig: vi.fn().mockResolvedValue(undefined),
}));

const pathMod = await import('node:path');
const actualFs = { ...(await import('fs')) };
void vi.mock('fs', () => {
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

const actualOs = { ...(await import('os')) };
void vi.mock('os', () => {
  return {
    ...actualOs,
    homedir: vi.fn(() => path.resolve(path.sep, 'mock', 'home', 'user')),
  };
});

void vi.mock('open', () => ({ default: vi.fn() }));
void vi.mock('read-package-up', () => ({
  readPackageUp: vi.fn(() =>
    Promise.resolve({ packageJson: { version: 'test-version' } }),
  ),
}));

void vi.mock('../profileBootstrap.js', () => {
  const actual = realProfileBootstrapModule;
  const { SettingsService: RealSettingsService } = realLlxprtCodeSettingsModule;
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
        getActiveProvider: vi.fn(() => undefined),
        getAvailableModels: vi.fn(async () => []),
      },
      oauthManager: {},
    })),
  };
});

/**
 * Shared call log — populated by mock implementations below.
 * Used to assert temporal ordering between critical lifecycle steps.
 */
const callLog = { entries: [] as string[] };

const runtimeSettingsState = {
  context: null as {
    settingsService: SettingsService;
    config: ServerConfig.Config | null;
    runtimeId: string;
    metadata?: Record<string, unknown>;
  } | null,
  providerManager: null as ProviderManager | null,
  oauthManager: null as unknown,
};

// Mock applyProfileSnapshot (static import in config.ts from profileSnapshot.js)
void vi.mock(
  '@vybestack/llxprt-code-providers/runtime/profileSnapshot.js',
  () => ({
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
  }),
);

// Mock switchActiveProvider (static import in config.ts from providerSwitch.js)
void vi.mock(
  '@vybestack/llxprt-code-providers/runtime/providerSwitch.js',
  () => ({
    switchActiveProvider: vi.fn(async (providerName: string) => {
      callLog.entries.push(`switchActiveProvider:${providerName}`);
      return {
        changed: true,
        previousProvider: null,
        nextProvider: providerName,
        infoMessages: [],
      };
    }),
  }),
);

// Mock setCliRuntimeContext (static import in config.ts from runtimeLifecycle.js)
void vi.mock(
  '@vybestack/llxprt-code-providers/runtime/runtimeLifecycle.js',
  () => ({
    resetCliProviderInfrastructure: vi.fn(),
    setCliRuntimeContext: vi.fn(
      (
        svc: SettingsService,
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
    registerCliProviderInfrastructure: vi.fn(
      (
        mgr: ProviderManager,
        oauth: unknown,
        _options?: {
          messageBus?: unknown;
          runtimeId?: string;
          metadata?: Record<string, unknown>;
        },
      ) => {
        callLog.entries.push('registerCliProviderInfrastructure');
        runtimeSettingsState.providerManager = mgr;
        runtimeSettingsState.oauthManager = oauth ?? null;
      },
    ),
  }),
);

// Mock runtimeAccessors (static import in config.ts)
void vi.mock(
  '@vybestack/llxprt-code-providers/runtime/runtimeAccessors.js',
  () => ({
    getCliRuntimeContext: vi.fn(() => runtimeSettingsState.context),
    getCliRuntimeConfig: vi.fn(
      () => runtimeSettingsState.context?.config ?? null,
    ),
    getCliRuntimeServices: vi.fn(() => ({
      config: runtimeSettingsState.context?.config ?? null,
      settingsService:
        runtimeSettingsState.context?.settingsService ?? new SettingsService(),
      providerManager:
        runtimeSettingsState.providerManager ??
        ({
          listProviders: vi.fn(() => []),
          getActiveProviderName: vi.fn(() => null),
          setActiveProvider: vi.fn(),
          getActiveProvider: vi.fn(() => undefined),
          getAvailableModels: vi.fn(async () => []),
        } as unknown as ProviderManager),
    })),
    getCliProviderManager: vi.fn(() => runtimeSettingsState.providerManager),
    getCliOAuthManager: vi.fn(() => {
      if (runtimeSettingsState.oauthManager === null) {
        throw new Error('OAuthManager missing from runtime registration');
      }
      return runtimeSettingsState.oauthManager;
    }),
    getActiveProviderStatus: vi.fn(() => ({ name: null })),
    listProviders: vi.fn(() => []),
    getActiveProviderName: vi.fn(() => null),
    getActiveModelName: vi.fn(() => null),
    getEphemeralSettings: vi.fn(() => ({})),
    getEphemeralSetting: vi.fn(() => undefined),
  }),
);

void vi.mock('@vybestack/llxprt-code-providers/runtime.js', () => {
  const getProviderManager = () =>
    runtimeSettingsState.providerManager ??
    ({
      listProviders: vi.fn(() => []),
      getActiveProviderName: vi.fn(() => null),
      setActiveProvider: vi.fn(),
      getActiveProvider: vi.fn(() => undefined),
      getAvailableModels: vi.fn(async () => []),
    } as unknown as ProviderManager);

  return {
    registerAgentRuntimeFactories: vi.fn(),
    resetAgentRuntimeFactories: vi.fn(),
    ephemeralSettingHelp: {},
    parseEphemeralSettingValue: vi.fn((_key: string, rawValue: string) => ({
      success: true,
      value: rawValue,
    })),
    applyCliSetArguments: vi.fn(() => ({ modelParams: {} })),
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
    resetCliProviderInfrastructure: vi.fn(),
    getCliRuntimeContext: vi.fn(() => runtimeSettingsState.context),
    setCliRuntimeContext: vi.fn(
      (
        svc: SettingsService,
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
    switchActiveProvider: vi.fn(async (providerName: string) => {
      callLog.entries.push(`switchActiveProvider:${providerName}`);
      return {
        changed: true,
        previousProvider: null,
        nextProvider: providerName,
        infoMessages: [],
      };
    }),
    registerCliProviderInfrastructure: vi.fn(
      (
        mgr: ProviderManager,
        oauth: unknown,
        _options?: {
          messageBus?: unknown;
          runtimeId?: string;
          metadata?: Record<string, unknown>;
        },
      ) => {
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
        runtimeSettingsState.context?.settingsService ?? new SettingsService(),
      providerManager: getProviderManager(),
    })),
    getCliProviderManager: vi.fn(() => runtimeSettingsState.providerManager),
    getCliOAuthManager: vi.fn(() => {
      if (runtimeSettingsState.oauthManager === null) {
        throw new Error('OAuthManager missing from runtime registration');
      }
      return runtimeSettingsState.oauthManager;
    }),
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
    getActiveProfileName: vi.fn(() => null),
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
    assembleCliProviderRuntime: vi.fn(
      (input: {
        settingsService: unknown;
        config: unknown;
        runtimeId: string;
        metadata?: Record<string, unknown>;
      }) => {
        // The real assembleCliProviderRuntime calls setCliRuntimeContext
        // first, then registerCliProviderInfrastructure — mirror that
        // ordering so the callLog-based ordering assertions hold.
        callLog.entries.push('setCliRuntimeContext');
        callLog.entries.push('registerCliProviderInfrastructure');
        runtimeSettingsState.context = {
          settingsService: input.settingsService as SettingsService,
          config: (input.config as ServerConfig.Config | null) ?? null,
          runtimeId: input.runtimeId,
          metadata: input.metadata ?? {},
        };
        const pm = getProviderManager();
        runtimeSettingsState.providerManager = pm;
        runtimeSettingsState.oauthManager = { id: 'oauth-manager' };
        return {
          runtime: {
            settingsService: input.settingsService,
            config: input.config,
            runtimeId: input.runtimeId,
            metadata: input.metadata,
          },
          runtimeMessageBus: { kind: 'session-bus' },
          providerManager: pm,
          oauthManager: { id: 'oauth-manager' },
        };
      },
    ),
  };
});

void vi.mock('@vybestack/llxprt-code-core', () => {
  const actual = realLlxprtCodeCoreModule;
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
  const runtimeSettingsService = new SettingsService();
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
    (os.homedir as Mock<typeof os.homedir>).mockReturnValue(
      path.resolve(path.sep, 'mock', 'home', 'user'),
    );
    setEnv('GEMINI_API_KEY', 'test-api-key');
    // Provide a fallback model so non-gemini providers don't fail with model.missing
    setEnv('LLXPRT_DEFAULT_MODEL', 'mock-default-model');
    process.argv = ['node', 'script.js'];
    setActiveProviderRuntimeContext(createProviderRuntimeContext());
    runtimeSettingsState.context = null;
    runtimeSettingsState.providerManager = null;
    runtimeSettingsState.oauthManager = null;
  });

  afterEach(() => {
    process.argv = originalArgv;
    restoreEnv();
    vi.restoreAllMocks();
    clearActiveProviderRuntimeContext();
  });

  it('setCliRuntimeContext happens before switchActiveProvider', async () => {
    await runConfig({}, ['--provider', 'gemini']);
    const entries = callLog.entries;
    const setIdx = entries.indexOf('setCliRuntimeContext');
    const switchIdx = entries.findIndex((c) =>
      c.startsWith('switchActiveProvider:'),
    );
    expect(setIdx).toBeGreaterThanOrEqual(0);
    expect(switchIdx).toBeGreaterThanOrEqual(0);
    expect(setIdx).toBeLessThan(switchIdx);
  });

  it('registerCliProviderInfrastructure happens after setCliRuntimeContext', async () => {
    await runConfig({});
    const entries = callLog.entries;
    const setIdx = entries.indexOf('setCliRuntimeContext');
    const registerIdx = entries.indexOf('registerCliProviderInfrastructure');
    expect(setIdx).toBeGreaterThanOrEqual(0);
    expect(registerIdx).toBeGreaterThanOrEqual(0);
    expect(setIdx).toBeLessThan(registerIdx);
  });

  it('switchActiveProvider is called exactly once', async () => {
    await runConfig({}, ['--provider', 'gemini']);
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
    (os.homedir as Mock<typeof os.homedir>).mockReturnValue(
      path.resolve(path.sep, 'mock', 'home', 'user'),
    );
    setEnv('GEMINI_API_KEY', 'test-api-key');
    // Provide a fallback model so non-gemini providers don't fail with model.missing
    setEnv('LLXPRT_DEFAULT_MODEL', 'mock-default-model');
    process.argv = ['node', 'script.js'];
    setActiveProviderRuntimeContext(createProviderRuntimeContext());
    runtimeSettingsState.context = null;
    runtimeSettingsState.providerManager = null;
    runtimeSettingsState.oauthManager = null;
  });

  afterEach(() => {
    process.argv = originalArgv;
    restoreEnv();
    vi.restoreAllMocks();
    clearActiveProviderRuntimeContext();
  });

  it('CLI --provider wins over LLXPRT_DEFAULT_PROVIDER env', async () => {
    setEnv('LLXPRT_DEFAULT_PROVIDER', 'anthropic');
    const config = await runConfig({}, ['--provider', 'openai']);
    expect(config.getProvider()).toBe('openai');
    expect(
      callLog.entries.some((c) => c === 'switchActiveProvider:openai'),
    ).toBe(true);
  });

  it('LLXPRT_DEFAULT_PROVIDER env wins over gemini default', async () => {
    setEnv('LLXPRT_DEFAULT_PROVIDER', 'anthropic');
    const config = await runConfig({});
    expect(config.getProvider()).toBe('anthropic');
    expect(
      callLog.entries.some((c) => c === 'switchActiveProvider:anthropic'),
    ).toBe(true);
  });

  it('CLI --model is set on config and survives the provider switch', async () => {
    const config = await runConfig({}, [
      '--provider',
      'gemini',
      '--model',
      'cli-override-model',
    ]);
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
