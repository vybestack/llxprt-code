/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
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
import { loadCliConfig, parseArguments } from '../config.js';
import type { Settings } from '../settings.js';
import { ExtensionStorage } from '../extension.js';
import { ExtensionEnablementManager } from '../extensions/extensionEnablement.js';
import { isWorkspaceTrusted } from '../trustedFolders.js';

// ─── Mocks matching config.test.ts patterns exactly ───────────────────────────

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
      nextProvider: 'mock-provider',
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
    getCliOAuthManager: vi.fn(() => runtimeSettingsState.oauthManager ?? null),
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
  const config = await loadCliConfig(
    settings,
    [],
    makeExtMgr(argv.extensions),
    'test-session',
    argv,
  );
  return config.getApprovalMode();
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('approvalModeParity: approval mode resolution', () => {
  const originalArgv = process.argv;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(os.homedir).mockReturnValue(
      path.resolve(path.sep, 'mock', 'home', 'user'),
    );
    vi.stubEnv('GEMINI_API_KEY', 'test-api-key');
    process.argv = ['node', 'script.js'];
    vi.mocked(isWorkspaceTrusted).mockReturnValue(true);
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
      vi.mocked(isWorkspaceTrusted).mockReturnValue(false);
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
      vi.mocked(isWorkspaceTrusted).mockReturnValue(true);
    });

    it('--approval-mode=yolo is honoured when folder trust disabled', async () => {
      process.argv = ['node', 'script.js', '--approval-mode', 'yolo'];
      expect(await getApprovalMode({ folderTrust: false })).toBe(
        ApprovalMode.YOLO,
      );
    });
  });
});
