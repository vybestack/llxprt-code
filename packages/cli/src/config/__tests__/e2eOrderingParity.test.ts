/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { RuntimeProviderManager } from '@vybestack/llxprt-code-core';
import type { OAuthManager } from '@vybestack/llxprt-code-providers/auth.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
const retainedActivationOperations: Array<{ dispose(): void | Promise<void> }> =
  [];

const retainedSettingsOwners: SessionSettingsOwner[] = [];

/**
 * @plan:PLAN-20260603-ISSUE1584.P13
 * @requirement:REQ-API-001
 * @pseudocode consumer-migration.md lines 10-18
 */

/**
 * Task 1.7 – End-to-end provider/profile/override ordering parity test
 *
 * Verifies provider/profile/override ordering through loadCliConfig and
 * checks that post-Config runtime assembly binds its manager and bus to Config.
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
import * as ServerConfig from '@vybestack/llxprt-code-core';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import {
  ProviderManager,
  type IProvider,
} from '@vybestack/llxprt-code-providers';
import { loadCliConfig } from '../config.js';
import { parseArguments } from '../cliArgParser.js';
import type { Settings } from '../settings.js';
import { ExtensionStorage } from '../extension.js';
import { ExtensionEnablementManager } from '../extensions/extensionEnablement.js';
import {
  loadPrecedenceProviderContributions,
  registerPrecedenceProviders,
} from './precedenceProviderContributions.js';

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
    existsSync: vi.fn(
      (p) => mockPaths.has(p.toString()) || actualFs.existsSync(p),
    ),
    statSync: vi.fn((p) => {
      if (mockPaths.has(p.toString())) return actualFs.statSync(process.cwd());
      return actualFs.statSync(p.toString());
    }),
    realpathSync: vi.fn((p) => p),
  };
});

const actualOs = { ...(await import('os')) };
void vi.mock('os', () => ({
  ...actualOs,
  homedir: vi.fn(() => path.resolve(path.sep, 'mock', 'home', 'user')),
}));

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
    prepareRuntimeForProfile: vi.fn(async () => {
      const settingsService = new RealSettingsService();
      const providerManager = new ProviderManager({ settingsService });
      const provider: IProvider = {
        name: 'openai',
        getDefaultModel: () => 'mock-default-model',
        getModels: async () => [],
        async *generateChatCompletion() {
          yield { speaker: 'ai', blocks: [{ type: 'text', text: 'ready' }] };
        },
      };
      providerManager.registerProvider(provider);
      runtimeSettingsState.providerManager = providerManager;
      return {
        runtime: {
          settingsService,
          config: null,
          runtimeId: 'mock-runtime',
          metadata: {},
        },
        runtimeMessageBus: undefined,
        providerManager,
        oauthManager: null,
      };
    }),
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

void vi.mock('@vybestack/llxprt-code-providers/runtime.js', () => {
  const getProviderManager = () =>
    runtimeSettingsState.providerManager ??
    ({
      listProviders: vi.fn(() => []),
      getActiveProviderName: vi.fn(() => null),
      setActiveProvider: vi.fn(),
      getActiveProvider: vi.fn(() => undefined),
      getAvailableModels: vi.fn(async () => []),
      getProviderByName: vi.fn(() => ({
        getDefaultModel: () => 'gemini-2.5-pro',
      })),
    } as unknown as ProviderManager);

  return {
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
    switchActiveProvider: vi.fn(async (providerName: string) => {
      callLog.entries.push(`switchActiveProvider:${providerName}`);
      return {
        changed: true,
        previousProvider: null,
        nextProvider: providerName,
        infoMessages: [],
      };
    }),
    applyCliArgumentOverrides: vi.fn(async () => {
      callLog.entries.push('applyCliArgumentOverrides');
    }),
    providerManager: vi.fn(() => runtimeSettingsState.providerManager),
    oauthManager: vi.fn(() => {
      if (runtimeSettingsState.oauthManager === null) {
        throw new Error('OAuthManager missing from runtime registration');
      }
      return runtimeSettingsState.oauthManager;
    }),
    providerStatus: vi.fn(() => ({ name: null })),
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
    updateActiveProviderBaseUrl: vi.fn(async () => ({
      message: 'Base URL updated',
    })),
    updateActiveProviderApiKey: vi.fn(async () => ({ message: 'Key updated' })),
    getRuntimeDiagnosticsSnapshot: vi.fn(() => ({})),
    getActiveToolFormatState: vi.fn(() => ({})),
    setActiveToolFormatOverride: vi.fn(),
    getActiveProviderMetrics: vi.fn(() => undefined),
    getSessionTokenUsage: vi.fn(() => undefined),
    assembleCliProviderRuntime: vi.fn(
      (input: {
        settingsService: unknown;
        config: unknown;
        runtimeId: string;
        metadata?: Record<string, unknown>;
      }) => {
        callLog.entries.push('assembleCliProviderRuntime');
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
          oauthManager: null,
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
      respectLlxprtIgnore: true,
    },
    DEFAULT_FILE_FILTERING_OPTIONS: {
      respectGitIgnore: true,
      respectLlxprtIgnore: true,
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

let publishedManager: RuntimeProviderManager | undefined;
async function runConfig(settings: Settings, argv: string[] = []) {
  process.argv = ['node', 'script.js', ...argv];
  const parsedArgv = await parseArguments(settings);
  const runtimeSettingsService = new SettingsService();
  const settingsOwner = new SessionSettingsOwner(runtimeSettingsService);
  retainedSettingsOwners.push(settingsOwner);
  let oauthManager: OAuthManager | undefined;
  const config = await loadCliConfig(
    settings,
    [],
    makeExtMgr(),
    'test-session',
    parsedArgv,
    undefined,
    {
      settingsService: runtimeSettingsService,
      sessionSettingsOwner: settingsOwner,
      onActivationBootstrapReady: (operation) => {
        operation.takeSettingsOwner(runtimeSettingsService);
        retainedActivationOperations.push(operation);
      },
      onOAuthManagerReady: (owner) => {
        oauthManager = owner;
      },
      onProviderManagerReady: (manager) => {
        registerPrecedenceProviders(manager);
        publishedManager = manager;
      },
      providerContributions: await loadPrecedenceProviderContributions(),
    },
  );
  return { config, settingsOwner, oauthManager };
}

// ─── Suite: step ordering ─────────────────────────────────────────────────────

describe('e2eOrderingParity: step ordering constraints', () => {
  afterEach(async () => {
    const results = await Promise.allSettled(
      retainedActivationOperations
        .splice(0)
        .map(async (operation) => operation.dispose()),
    );
    const errors = results.flatMap((result) =>
      result.status === 'rejected' ? [result.reason] : [],
    );
    if (errors.length > 0)
      throw new AggregateError(errors, 'Activation fixture cleanup');
  });
  afterEach(async () => {
    for (const owner of retainedSettingsOwners.splice(0)) await owner.dispose();
  });

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
    runtimeSettingsState.context = null;
    runtimeSettingsState.providerManager = null;
    runtimeSettingsState.oauthManager = null;
  });

  afterEach(() => {
    process.argv = originalArgv;
    restoreEnv();
    vi.restoreAllMocks();
  });

  it('binds the post-Config manager and message bus before provider selection', async () => {
    const { config, oauthManager } = await runConfig({}, [
      '--provider',
      'gemini',
    ]);
    expect('getProviderManager' in config).toBe(false);
    expect(publishedManager?.getActiveProviderName()).toBe('gemini');
    expect(oauthManager?.runtimeMessageBus).toBeDefined();
    expect(callLog.entries.indexOf('assembleCliProviderRuntime')).toBeLessThan(
      callLog.entries.indexOf('switchActiveProvider:gemini'),
    );
  });

  it('switchActiveProvider is called exactly once', async () => {
    await runConfig({}, ['--provider', 'gemini']);
    const switchCalls = callLog.entries.filter((c) =>
      c.startsWith('switchActiveProvider:'),
    );
    expect(switchCalls).toHaveLength(1);
  });

  it('with --provider+--key: applies the synthetic CLI profile before returning the config', async () => {
    const { config: config, settingsOwner: configSettingsOwner } =
      await runConfig({}, ['--provider', 'openai', '--key', 'sk-test']);
    expect(config.getProvider()).toBe('openai');
    expect(configSettingsOwner.readNamedParameter('auth-key')).toBe('sk-test');
  });
});

// ─── Suite: full precedence chain ────────────────────────────────────────────

describe('e2eOrderingParity: full precedence chain end-to-end', () => {
  afterEach(async () => {
    const results = await Promise.allSettled(
      retainedActivationOperations
        .splice(0)
        .map(async (operation) => operation.dispose()),
    );
    const errors = results.flatMap((result) =>
      result.status === 'rejected' ? [result.reason] : [],
    );
    if (errors.length > 0)
      throw new AggregateError(errors, 'Activation fixture cleanup');
  });
  afterEach(async () => {
    for (const owner of retainedSettingsOwners.splice(0)) await owner.dispose();
  });

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
    runtimeSettingsState.context = null;
    runtimeSettingsState.providerManager = null;
    runtimeSettingsState.oauthManager = null;
  });

  afterEach(() => {
    process.argv = originalArgv;
    restoreEnv();
    vi.restoreAllMocks();
  });

  it('CLI --provider wins over LLXPRT_DEFAULT_PROVIDER env', async () => {
    setEnv('LLXPRT_DEFAULT_PROVIDER', 'anthropic');
    const { config: config } = await runConfig({}, ['--provider', 'openai']);
    expect(config.getProvider()).toBe('openai');
    expect(
      callLog.entries.some((c) => c === 'switchActiveProvider:openai'),
    ).toBe(true);
  });

  it('LLXPRT_DEFAULT_PROVIDER env wins over gemini default', async () => {
    setEnv('LLXPRT_DEFAULT_PROVIDER', 'anthropic');
    const { config: config } = await runConfig({});
    expect(config.getProvider()).toBe('anthropic');
    expect(
      callLog.entries.some((c) => c === 'switchActiveProvider:anthropic'),
    ).toBe(true);
  });

  it('CLI --model is set on config and survives the provider switch', async () => {
    const { config: config } = await runConfig({}, [
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
    const { config: config } = await runConfig({ model: 'settings-model' });
    expect(config.getModel()).toBe('settings-model');
  });

  it('CLI --model beats settings.model', async () => {
    const { config: config } = await runConfig({ model: 'settings-model' }, [
      '--model',
      'cli-model',
    ]);
    expect(config.getModel()).toBe('cli-model');
  });

  it('full stack: --provider + --model produces expected provider and model', async () => {
    const { config: config } = await runConfig({}, [
      '--provider',
      'openai',
      '--model',
      'gpt-4-turbo',
    ]);
    expect(config.getProvider()).toBe('openai');
    expect(config.getModel()).toBe('gpt-4-turbo');
  });
});
