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
 * Task 1.1 – Approval mode parity tests
 *
 * Locks the current behavior of the approval mode resolution logic in
 * loadCliConfig. All combinations of:
 *   - --approval-mode (yolo | auto_edit | default)
 *   - --yolo flag
 *   - disableYoloMode / secureModeEnabled settings
 *   - trustedFolder true / false
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
  ApprovalMode,
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
import { isWorkspaceTrusted } from '../trustedFolders.js';

// ─── Mocks matching config.test.ts patterns exactly ───────────────────────────

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
  return {
    ...actual,
    isWorkspaceTrusted: vi.fn().mockReturnValue(true),
  };
});

void vi.mock('../sandboxConfig.js', () => ({
  loadSandboxConfig: vi.fn().mockResolvedValue(undefined),
}));

const pathMod = await import('node:path');
const actualFs = { ...(await import('fs')) };
void vi.mock('fs', () => {
  const MOCK_CWD = pathMod.resolve(pathMod.sep, 'home', 'user', 'project');
  const mockPaths = new Set([
    MOCK_CWD,
    process.cwd(),
    pathMod.resolve(pathMod.sep, 'cli', 'path1'),
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
        getProviderByName: vi.fn(() => undefined),
      },
      oauthManager: undefined,
    })),
  };
});

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

void vi.mock('@vybestack/llxprt-code-providers/runtime.js', () => {
  const getProviderManager = () =>
    runtimeSettingsState.providerManager ??
    ({
      listProviders: vi.fn(() => []),
      getActiveProviderName: vi.fn(() => null),
      setActiveProvider: vi.fn(),
      getActiveProvider: vi.fn(() => undefined),
      getAvailableModels: vi.fn(async () => []),
      getProviderByName: vi.fn(() => undefined),
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
      async (profile: { provider?: string; model?: string }) => ({
        providerName: profile.provider ?? '',
        modelName: profile.model ?? '',
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
      (manager: ProviderManager, oauthManager: unknown) => {
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
    getCliOAuthManager: vi.fn(() => {
      if (runtimeSettingsState.oauthManager == null) {
        throw new Error('OAuthManager missing from runtime registration');
      }
      return runtimeSettingsState.oauthManager;
    }),
    getActiveProviderStatus: vi.fn(() => ({ name: null })),
    listProviders: vi.fn(() => getProviderManager().listProviders()),
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
    assembleCliProviderRuntime: vi.fn(
      (input: {
        settingsService: unknown;
        config: unknown;
        runtimeId: string;
        metadata?: Record<string, unknown>;
      }) => ({
        runtime: {
          settingsService: input.settingsService,
          config: input.config,
          runtimeId: input.runtimeId,
          metadata: input.metadata,
        },
        runtimeMessageBus: { kind: 'session-bus' },
        providerManager: getProviderManager(),
        oauthManager: { id: 'oauth-manager' },
      }),
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

function makeExtMgr(extensions?: string[]) {
  return new ExtensionEnablementManager(
    ExtensionStorage.getUserExtensionsDir(),
    extensions,
  );
}

async function getApprovalMode(
  settings: Settings,
  argvOverride?: Partial<Parameters<typeof loadCliConfig>[4]>,
): Promise<ApprovalMode> {
  const argv = await parseArguments(settings);
  Object.assign(argv, argvOverride ?? {});
  const runtimeSettingsService = new SettingsService();
  const config = await loadCliConfig(
    settings,
    [],
    makeExtMgr(argv.extensions),
    'test-session',
    argv,
    undefined,
    { settingsService: runtimeSettingsService },
  );
  return config.getApprovalMode();
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('approvalModeParity: approval mode resolution', () => {
  const originalArgv = process.argv;

  beforeEach(() => {
    vi.resetAllMocks();
    (os.homedir as Mock<typeof os.homedir>).mockReturnValue(
      path.resolve(path.sep, 'mock', 'home', 'user'),
    );
    setEnv('GEMINI_API_KEY', 'test-api-key');
    // Scrub env vars that may leak from CI environment
    delete process.env.LLXPRT_PROFILE;
    delete process.env.LLXPRT_DEFAULT_PROVIDER;
    delete process.env.LLXPRT_DEFAULT_MODEL;
    delete process.env.GEMINI_MODEL;
    process.argv = ['node', 'script.js'];
    (isWorkspaceTrusted as Mock<typeof isWorkspaceTrusted>).mockReturnValue(
      true,
    );
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

  // ── --approval-mode flag values (trusted folder) ────────────────────────────

  it('--approval-mode=yolo resolves to YOLO when folder trusted', async () => {
    process.argv = ['node', 'script.js', '--approval-mode', 'yolo'];
    expect(await getApprovalMode({})).toBe(ApprovalMode.YOLO);
  });

  it('--approval-mode=auto_edit resolves to AUTO_EDIT when folder trusted', async () => {
    process.argv = ['node', 'script.js', '--approval-mode', 'auto_edit'];
    expect(await getApprovalMode({})).toBe(ApprovalMode.AUTO_EDIT);
  });

  it('--approval-mode=default resolves to DEFAULT', async () => {
    process.argv = ['node', 'script.js', '--approval-mode', 'default'];
    expect(await getApprovalMode({})).toBe(ApprovalMode.DEFAULT);
  });

  // ── --yolo flag (trusted folder) ────────────────────────────────────────────

  it('--yolo flag resolves to YOLO when folder trusted', async () => {
    process.argv = ['node', 'script.js', '--yolo'];
    expect(await getApprovalMode({})).toBe(ApprovalMode.YOLO);
  });

  it('no flag resolves to DEFAULT', async () => {
    process.argv = ['node', 'script.js'];
    expect(await getApprovalMode({})).toBe(ApprovalMode.DEFAULT);
  });

  // ── --approval-mode takes precedence over legacy --yolo (when argv manually combined) ──

  it('--approval-mode=default wins over argv.yolo=true when set directly on argv', async () => {
    process.argv = ['node', 'script.js', '--approval-mode', 'default'];
    expect(await getApprovalMode({}, { yolo: true })).toBe(
      ApprovalMode.DEFAULT,
    );
  });

  // ── disableYoloMode ─────────────────────────────────────────────────────────

  it('disableYoloMode=true blocks --yolo and throws', async () => {
    process.argv = ['node', 'script.js', '--yolo'];
    await expect(
      getApprovalMode({ security: { disableYoloMode: true } }),
    ).rejects.toThrow(/YOLO mode.*disabled/i);
  });

  it('disableYoloMode=true blocks --approval-mode=yolo and throws', async () => {
    process.argv = ['node', 'script.js', '--approval-mode', 'yolo'];
    await expect(
      getApprovalMode({ security: { disableYoloMode: true } }),
    ).rejects.toThrow(/YOLO mode.*disabled/i);
  });

  it('disableYoloMode=true allows --approval-mode=auto_edit', async () => {
    process.argv = ['node', 'script.js', '--approval-mode', 'auto_edit'];
    expect(await getApprovalMode({ security: { disableYoloMode: true } })).toBe(
      ApprovalMode.AUTO_EDIT,
    );
  });

  it('disableYoloMode=true allows DEFAULT mode', async () => {
    process.argv = ['node', 'script.js'];
    expect(await getApprovalMode({ security: { disableYoloMode: true } })).toBe(
      ApprovalMode.DEFAULT,
    );
  });

  // ── secureModeEnabled ───────────────────────────────────────────────────────

  it('secureModeEnabled=true blocks YOLO and throws', async () => {
    process.argv = ['node', 'script.js', '--yolo'];
    await expect(
      getApprovalMode({ admin: { secureModeEnabled: true } }),
    ).rejects.toThrow(/YOLO mode.*disabled/i);
  });

  it('secureModeEnabled=true allows AUTO_EDIT', async () => {
    process.argv = ['node', 'script.js', '--approval-mode', 'auto_edit'];
    expect(await getApprovalMode({ admin: { secureModeEnabled: true } })).toBe(
      ApprovalMode.AUTO_EDIT,
    );
  });

  // ── untrusted folder overrides ───────────────────────────────────────────────

  describe('when folder is NOT trusted (isWorkspaceTrusted returns false)', () => {
    beforeEach(() => {
      (isWorkspaceTrusted as Mock<typeof isWorkspaceTrusted>).mockReturnValue(
        false,
      );
    });

    it('--approval-mode=yolo overridden to DEFAULT', async () => {
      process.argv = ['node', 'script.js', '--approval-mode', 'yolo'];
      expect(await getApprovalMode({})).toBe(ApprovalMode.DEFAULT);
    });

    it('--approval-mode=auto_edit overridden to DEFAULT', async () => {
      process.argv = ['node', 'script.js', '--approval-mode', 'auto_edit'];
      expect(await getApprovalMode({})).toBe(ApprovalMode.DEFAULT);
    });

    it('--yolo overridden to DEFAULT', async () => {
      process.argv = ['node', 'script.js', '--yolo'];
      expect(await getApprovalMode({})).toBe(ApprovalMode.DEFAULT);
    });

    it('--approval-mode=default stays DEFAULT', async () => {
      process.argv = ['node', 'script.js', '--approval-mode', 'default'];
      expect(await getApprovalMode({})).toBe(ApprovalMode.DEFAULT);
    });

    it('no flags stays DEFAULT', async () => {
      process.argv = ['node', 'script.js'];
      expect(await getApprovalMode({})).toBe(ApprovalMode.DEFAULT);
    });
  });

  // ── folderTrust: false means isWorkspaceTrusted returns true (trust disabled) ─

  describe('when folderTrust feature is disabled (default)', () => {
    beforeEach(() => {
      // folderTrust: false means the feature is off → always trusted
      (isWorkspaceTrusted as Mock<typeof isWorkspaceTrusted>).mockReturnValue(
        true,
      );
    });

    it('--approval-mode=yolo is honoured when folder trust disabled', async () => {
      process.argv = ['node', 'script.js', '--approval-mode', 'yolo'];
      expect(await getApprovalMode({ folderTrust: false })).toBe(
        ApprovalMode.YOLO,
      );
    });
  });
});
