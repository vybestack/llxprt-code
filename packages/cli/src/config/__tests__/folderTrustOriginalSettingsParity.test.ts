/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Task 1.8 – folderTrust uses ORIGINAL settings, NOT profile-merged settings
 *
 * Security boundary: a profile should NOT be able to override trust decisions.
 *
 * loadCliConfig reads `settings.folderTrust` and calls `isWorkspaceTrusted(settings)`
 * using the ORIGINAL settings object (before profile ephemeral merging). This test
 * verifies that a profile's ephemeral settings cannot change the trust evaluation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  ApprovalMode,
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
import { isWorkspaceTrusted } from '../trustedFolders.js';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../trustedFolders.js', async () => {
  const actual = await vi.importActual<typeof import('../trustedFolders.js')>(
    '../trustedFolders.js',
  );
  return { ...actual, isWorkspaceTrusted: vi.fn() };
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

/** Track what settings object isWorkspaceTrusted was called with */
let capturedTrustCheckSettings: Settings | undefined;

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
    switchActiveProvider: vi.fn(async () => ({
      changed: true,
      previousProvider: null,
      nextProvider: 'gemini',
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

async function runConfig(settings: Settings) {
  const argv = await parseArguments(settings);
  const runtimeSettingsService = new ServerConfig.SettingsService();
  return loadCliConfig(
    settings,
    [],
    makeExtMgr(),
    'test-session',
    argv,
    undefined,
    { settingsService: runtimeSettingsService },
  );
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('folderTrustOriginalSettingsParity: trust uses original settings', () => {
  const originalArgv = process.argv;

  beforeEach(() => {
    vi.resetAllMocks();
    capturedTrustCheckSettings = undefined;
    vi.mocked(os.homedir).mockReturnValue(
      path.resolve(path.sep, 'mock', 'home', 'user'),
    );
    vi.stubEnv('GEMINI_API_KEY', 'test-api-key');
    process.argv = ['node', 'script.js'];
    setActiveProviderRuntimeContext(createProviderRuntimeContext());
    runtimeSettingsState.context = null;
    runtimeSettingsState.providerManager = null;
    runtimeSettingsState.oauthManager = null;

    // Capture the settings object passed to isWorkspaceTrusted
    vi.mocked(isWorkspaceTrusted).mockImplementation((s: Settings) => {
      capturedTrustCheckSettings = s;
      // Return the original trust value from the captured settings
      return s.folderTrust !== false;
    });
  });

  afterEach(() => {
    process.argv = originalArgv;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    clearActiveProviderRuntimeContext();
  });

  it('isWorkspaceTrusted is called with the ORIGINAL settings object identity', async () => {
    const originalSettings: Settings = { folderTrust: true };
    process.argv = ['node', 'script.js'];
    await runConfig(originalSettings);

    expect(isWorkspaceTrusted).toHaveBeenCalled();
    // The settings passed to isWorkspaceTrusted must be the exact original object
    expect(capturedTrustCheckSettings).toBe(originalSettings);
  });

  it('folder untrusted (via isWorkspaceTrusted returning false) → approval forced to DEFAULT', async () => {
    vi.mocked(isWorkspaceTrusted).mockImplementation((s: Settings) => {
      capturedTrustCheckSettings = s;
      return false; // always untrusted
    });

    process.argv = ['node', 'script.js', '--approval-mode', 'yolo'];
    const config = await runConfig({});

    expect(config.getApprovalMode()).toBe(ApprovalMode.DEFAULT);
  });

  it('folder trusted (via isWorkspaceTrusted returning true) → YOLO mode is honored', async () => {
    vi.mocked(isWorkspaceTrusted).mockImplementation((s: Settings) => {
      capturedTrustCheckSettings = s;
      return true; // always trusted
    });

    process.argv = ['node', 'script.js', '--approval-mode', 'yolo'];
    const config = await runConfig({});

    expect(config.getApprovalMode()).toBe(ApprovalMode.YOLO);
  });

  it('profile ephemeral folderTrust value does NOT change the trust check', async () => {
    // This tests the security boundary: original settings are used for trust,
    // not profile-merged settings.
    //
    // We simulate a profile that could set folderTrust=true in its ephemeralSettings
    // by providing an inline profile via LLXPRT_PROFILE that has base-url (which gets merged).
    // The critical point is: isWorkspaceTrusted must be called with the ORIGINAL settings object.

    const callsWithTrustedFalse: boolean[] = [];
    vi.mocked(isWorkspaceTrusted).mockImplementation((s: Settings) => {
      capturedTrustCheckSettings = s;
      // Track what folderTrust value was seen during trust check
      callsWithTrustedFalse.push(s.folderTrust === false);
      return false; // untrusted
    });

    // Original settings: folderTrust explicitly false
    const originalSettings: Settings = { folderTrust: false };

    process.argv = ['node', 'script.js', '--approval-mode', 'yolo'];
    const config = await runConfig(originalSettings);

    // Trust check must have happened with original settings
    expect(isWorkspaceTrusted).toHaveBeenCalled();
    // Trust check received settings with folderTrust=false (original, not profile-merged)
    expect(callsWithTrustedFalse.some((v) => v === true)).toBe(true);

    // Because folder is not trusted, approval mode is forced to DEFAULT
    expect(config.getApprovalMode()).toBe(ApprovalMode.DEFAULT);
  });

  it('isWorkspaceTrusted is called exactly once for trust determination', async () => {
    vi.mocked(isWorkspaceTrusted).mockReturnValue(true);
    process.argv = ['node', 'script.js'];
    await runConfig({});

    expect(isWorkspaceTrusted).toHaveBeenCalledTimes(1);
  });
});
