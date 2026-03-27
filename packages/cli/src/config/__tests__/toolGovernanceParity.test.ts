/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Task 1.4 – Tool governance parity tests
 *
 * Locks the tool allowed/excluded set logic for:
 *   - Interactive vs non-interactive mode
 *   - DEFAULT / AUTO_EDIT / YOLO approval modes
 *   - Profile-allowed vs explicit-allowed tool interactions
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  ApprovalMode,
  ShellTool,
  EditTool,
  WriteFileTool,
  createProviderRuntimeContext,
  setActiveProviderRuntimeContext,
  clearActiveProviderRuntimeContext,
} from '@vybestack/llxprt-code-core';
import * as ServerConfig from '@vybestack/llxprt-code-core';
import { loadCliConfig } from '../config.js';
import { parseArguments } from '../cliArgParser.js';
import { READ_ONLY_TOOL_NAMES } from '../toolGovernance.js';
import type { Settings } from '../settings.js';
import { ExtensionStorage } from '../extension.js';
import { ExtensionEnablementManager } from '../extensions/extensionEnablement.js';
import { isWorkspaceTrusted } from '../trustedFolders.js';

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

const runtimeSettingsState = vi.hoisted(() => ({
  context: null as {
    settingsService: ServerConfig.SettingsService;
    config: ServerConfig.Config | null;
    runtimeId: string;
    metadata?: Record<string, unknown>;
  } | null,
  providerManager: null as ServerConfig.ProviderManager | null,
  oauthManager: null as unknown,
  ephemeral: {} as Record<string, unknown>,
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
    applyProfileSnapshot: vi.fn(async () => ({
      providerName: '',
      modelName: '',
      warnings: [],
    })),
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
    getEphemeralSettings: vi.fn(() => runtimeSettingsState.ephemeral),
    getEphemeralSetting: vi.fn(
      (key: string) => runtimeSettingsState.ephemeral[key] ?? undefined,
    ),
    setEphemeralSetting: vi.fn((key: string, value: unknown) => {
      runtimeSettingsState.ephemeral[key] = value;
    }),
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

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('toolGovernanceParity: interactive mode', () => {
  const originalArgv = process.argv;
  const originalIsTTY = process.stdin.isTTY;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(os.homedir).mockReturnValue(
      path.resolve(path.sep, 'mock', 'home', 'user'),
    );
    vi.stubEnv('GEMINI_API_KEY', 'test-api-key');
    vi.mocked(isWorkspaceTrusted).mockReturnValue(true);
    process.stdin.isTTY = true;
    setActiveProviderRuntimeContext(createProviderRuntimeContext());
    runtimeSettingsState.context = null;
    runtimeSettingsState.providerManager = null;
    runtimeSettingsState.oauthManager = null;
    runtimeSettingsState.ephemeral = {};
  });

  afterEach(() => {
    process.argv = originalArgv;
    process.stdin.isTTY = originalIsTTY;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    clearActiveProviderRuntimeContext();
  });

  it('interactive mode: no tools excluded by default (DEFAULT approval)', async () => {
    process.stdin.isTTY = true;
    const config = await runConfig({});
    expect(config.getExcludeTools()).not.toContain(ShellTool.Name);
    expect(config.getExcludeTools()).not.toContain(EditTool.Name);
    expect(config.getExcludeTools()).not.toContain(WriteFileTool.Name);
  });

  it('interactive YOLO mode: no tools excluded', async () => {
    process.stdin.isTTY = true;
    const config = await runConfig({}, ['--yolo']);
    expect(config.getExcludeTools()).not.toContain(ShellTool.Name);
    expect(config.getExcludeTools()).not.toContain(EditTool.Name);
    expect(config.getExcludeTools()).not.toContain(WriteFileTool.Name);
  });

  it('interactive AUTO_EDIT mode: no tools excluded', async () => {
    process.stdin.isTTY = true;
    const config = await runConfig({}, ['--approval-mode', 'auto_edit']);
    expect(config.getExcludeTools()).not.toContain(ShellTool.Name);
    expect(config.getExcludeTools()).not.toContain(EditTool.Name);
    expect(config.getExcludeTools()).not.toContain(WriteFileTool.Name);
  });
});

describe('toolGovernanceParity: non-interactive mode', () => {
  const originalArgv = process.argv;
  const originalIsTTY = process.stdin.isTTY;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(os.homedir).mockReturnValue(
      path.resolve(path.sep, 'mock', 'home', 'user'),
    );
    vi.stubEnv('GEMINI_API_KEY', 'test-api-key');
    vi.mocked(isWorkspaceTrusted).mockReturnValue(true);
    process.stdin.isTTY = false;
    setActiveProviderRuntimeContext(createProviderRuntimeContext());
    runtimeSettingsState.context = null;
    runtimeSettingsState.providerManager = null;
    runtimeSettingsState.oauthManager = null;
    runtimeSettingsState.ephemeral = {};
  });

  afterEach(() => {
    process.argv = originalArgv;
    process.stdin.isTTY = originalIsTTY;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    clearActiveProviderRuntimeContext();
  });

  it('non-interactive DEFAULT mode: excludes ShellTool, EditTool, WriteFileTool', async () => {
    process.stdin.isTTY = false;
    const config = await runConfig({}, ['-p', 'test']);
    expect(config.getExcludeTools()).toContain(ShellTool.Name);
    expect(config.getExcludeTools()).toContain(EditTool.Name);
    expect(config.getExcludeTools()).toContain(WriteFileTool.Name);
  });

  it('non-interactive AUTO_EDIT mode: excludes only ShellTool', async () => {
    process.stdin.isTTY = false;
    const config = await runConfig({}, [
      '-p',
      'test',
      '--approval-mode',
      'auto_edit',
    ]);
    expect(config.getExcludeTools()).toContain(ShellTool.Name);
    // EditTool and WriteFileTool should NOT be excluded in auto_edit
    expect(config.getExcludeTools()).not.toContain(EditTool.Name);
    expect(config.getExcludeTools()).not.toContain(WriteFileTool.Name);
  });

  it('non-interactive YOLO mode: no extra tools excluded', async () => {
    process.stdin.isTTY = false;
    const config = await runConfig({}, ['-p', 'test', '--yolo']);
    expect(config.getExcludeTools()).not.toContain(ShellTool.Name);
    expect(config.getExcludeTools()).not.toContain(EditTool.Name);
    expect(config.getExcludeTools()).not.toContain(WriteFileTool.Name);
  });

  it('non-interactive with --allowed-tools=ShellTool: ShellTool NOT excluded', async () => {
    process.stdin.isTTY = false;
    const config = await runConfig({}, [
      '-p',
      'test',
      '--allowed-tools',
      'ShellTool',
    ]);
    expect(config.getExcludeTools()).not.toContain(ShellTool.Name);
  });

  it('non-interactive with --allowed-tools=run_shell_command: ShellTool NOT excluded', async () => {
    process.stdin.isTTY = false;
    const config = await runConfig({}, [
      '-p',
      'test',
      '--allowed-tools',
      'run_shell_command',
    ]);
    expect(config.getExcludeTools()).not.toContain(ShellTool.Name);
  });

  it('non-interactive with --allowed-tools=run_shell_commander: ShellTool remains excluded', async () => {
    process.stdin.isTTY = false;
    const config = await runConfig({}, [
      '-p',
      'test',
      '--allowed-tools',
      'run_shell_commander',
    ]);
    expect(config.getExcludeTools()).toContain(ShellTool.Name);
  });

  it('non-interactive with --allowed-tools= ShellTool(ls) : ShellTool NOT excluded', async () => {
    process.stdin.isTTY = false;
    const config = await runConfig({}, [
      '-p',
      'test',
      '--allowed-tools',
      ' ShellTool(ls) ',
    ]);
    expect(config.getExcludeTools()).not.toContain(ShellTool.Name);
  });
});

describe('toolGovernanceParity: tool policy - non-interactive allowed sets', () => {
  const originalArgv = process.argv;
  const originalIsTTY = process.stdin.isTTY;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(os.homedir).mockReturnValue(
      path.resolve(path.sep, 'mock', 'home', 'user'),
    );
    vi.stubEnv('GEMINI_API_KEY', 'test-api-key');
    vi.mocked(isWorkspaceTrusted).mockReturnValue(true);
    process.stdin.isTTY = false;
    setActiveProviderRuntimeContext(createProviderRuntimeContext());
    runtimeSettingsState.context = null;
    runtimeSettingsState.providerManager = null;
    runtimeSettingsState.oauthManager = null;
    runtimeSettingsState.ephemeral = {};
  });

  afterEach(() => {
    process.argv = originalArgv;
    process.stdin.isTTY = originalIsTTY;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    clearActiveProviderRuntimeContext();
  });

  it('non-interactive DEFAULT: allowed tools include all READ_ONLY_TOOL_NAMES', async () => {
    process.stdin.isTTY = false;
    const config = await runConfig({}, ['-p', 'test']);
    const allowed = config.getEphemeralSetting('tools.allowed') as
      | string[]
      | undefined;
    expect(allowed).toBeDefined();
    const normalizedAllowed = allowed!.map((t) => t.trim().toLowerCase());
    for (const readOnlyTool of READ_ONLY_TOOL_NAMES) {
      expect(normalizedAllowed).toContain(readOnlyTool.trim().toLowerCase());
    }
  });

  it('non-interactive AUTO_EDIT: allowed tools include replace (edit tool)', async () => {
    process.stdin.isTTY = false;
    const config = await runConfig({}, [
      '-p',
      'test',
      '--approval-mode',
      'auto_edit',
    ]);
    const allowed = config.getEphemeralSetting('tools.allowed') as
      | string[]
      | undefined;
    expect(allowed).toBeDefined();
    const normalizedAllowed = allowed!.map((t) => t.trim().toLowerCase());
    expect(normalizedAllowed).toContain('replace');
  });

  it('non-interactive DEFAULT with explicit --allowed-tools: union with read-only set', async () => {
    process.stdin.isTTY = false;
    const config = await runConfig({}, [
      '-p',
      'test',
      '--allowed-tools',
      'read_file',
    ]);
    const allowed = config.getEphemeralSetting('tools.allowed') as
      | string[]
      | undefined;
    expect(allowed).toBeDefined();
    const normalizedAllowed = allowed!.map((t) => t.trim().toLowerCase());
    expect(normalizedAllowed).toContain('read_file');
  });

  it('non-interactive YOLO with explicit --allowed-tools: only explicit set', async () => {
    process.stdin.isTTY = false;
    const config = await runConfig({}, [
      '-p',
      'test',
      '--yolo',
      '--allowed-tools',
      'read_file',
    ]);
    const allowed = config.getEphemeralSetting('tools.allowed') as
      | string[]
      | undefined;
    expect(allowed).toBeDefined();
    const normalizedAllowed = allowed!.map((t) => t.trim().toLowerCase());
    expect(normalizedAllowed).toContain('read_file');
  });

  it('non-interactive YOLO with no explicit allowed tools: tools.allowed is undefined (all allowed)', async () => {
    process.stdin.isTTY = false;
    const config = await runConfig({}, ['-p', 'test', '--yolo']);
    const allowed = config.getEphemeralSetting('tools.allowed');
    // YOLO with no explicit allowed tools → unrestricted (undefined)
    expect(allowed).toBeUndefined();
  });

  it('READ_ONLY_TOOL_NAMES contains expected read-only tools', () => {
    expect(READ_ONLY_TOOL_NAMES).toContain('read_file');
    expect(READ_ONLY_TOOL_NAMES).toContain('glob');
    expect(READ_ONLY_TOOL_NAMES).toContain('search_file_content');
    expect(READ_ONLY_TOOL_NAMES).toContain('list_directory');
    expect(READ_ONLY_TOOL_NAMES).toContain('ls');
  });

  it('READ_ONLY_TOOL_NAMES does NOT contain write tools', () => {
    const names = READ_ONLY_TOOL_NAMES.map((n) => n.toLowerCase());
    expect(names).not.toContain('run_shell_command');
    expect(names).not.toContain('replace');
    expect(names).not.toContain('write_file');
  });

  it('non-interactive DEFAULT: approval mode is DEFAULT', async () => {
    process.stdin.isTTY = false;
    const config = await runConfig({}, ['-p', 'test']);
    expect(config.getApprovalMode()).toBe(ApprovalMode.DEFAULT);
  });

  it('non-interactive YOLO: approval mode is YOLO', async () => {
    process.stdin.isTTY = false;
    const config = await runConfig({}, ['-p', 'test', '--yolo']);
    expect(config.getApprovalMode()).toBe(ApprovalMode.YOLO);
  });
});
