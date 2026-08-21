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
 * Task 1.3 – MCP filtering parity tests
 *
 * Locks the behavior of MCP server filtering via:
 *   - settings.allowMCPServers
 *   - settings.excludeMCPServers
 *   - argv.allowedMcpServerNames (overrides settings-level filtering)
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

const reloadSettingsState = {} as { current?: Settings };

const actual = { ...(await import('../settings.js')) };
void vi.mock('../settings.js', () => ({
  ...actual,
  loadSettings: vi.fn((cwd: string) =>
    reloadSettingsState.current === undefined
      ? actual.loadSettings(cwd)
      : { merged: reloadSettingsState.current },
  ),
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
    applyProfileSnapshot: vi.fn(async () => ({
      providerName: '',
      modelName: '',
      warnings: [],
    })),
    getCliRuntimeContext: vi.fn(() => runtimeSettingsState.context),
    setCliRuntimeContext: vi.fn(
      (
        svc: SettingsService,
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
      (mgr: ProviderManager, oauth: unknown) => {
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

function makeExtMgr() {
  return new ExtensionEnablementManager(
    ExtensionStorage.getUserExtensionsDir(),
  );
}

type McpServerMap = Record<
  string,
  { command?: string; args?: string[]; httpUrl?: string }
>;

function settingsWithMcpServers(servers: McpServerMap): Settings {
  return { mcpServers: servers } as unknown as Settings;
}

async function loadMcpConfig(
  settings: Settings,
  cliArgs: string[] = [],
): Promise<ServerConfig.Config> {
  process.argv = ['node', 'script.js', ...cliArgs];
  const argv = await parseArguments(settings);
  const runtimeSettingsService = new SettingsService();
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

async function getMcpServers(
  settings: Settings,
  cliArgs: string[] = [],
): Promise<string[]> {
  const config = await loadMcpConfig(settings, cliArgs);
  return Object.keys(config.getMcpServers() ?? {});
}

async function getBlockedMcpServers(
  settings: Settings,
  cliArgs: string[] = [],
): Promise<Array<{ name: string; extensionName: string }>> {
  process.argv = ['node', 'script.js', ...cliArgs];
  const argv = await parseArguments(settings);
  const runtimeSettingsService = new SettingsService();
  const config = await loadCliConfig(
    settings,
    [],
    makeExtMgr(),
    'test-session',
    argv,
    undefined,
    { settingsService: runtimeSettingsService },
  );
  return config.getBlockedMcpServers() ?? [];
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('mcpFilteringParity: MCP server filtering', () => {
  const originalArgv = process.argv;

  beforeEach(() => {
    vi.resetAllMocks();
    (os.homedir as Mock<typeof os.homedir>).mockReturnValue(
      path.resolve(path.sep, 'mock', 'home', 'user'),
    );
    setEnv('GEMINI_API_KEY', 'test-api-key');
    process.argv = ['node', 'script.js'];
    setActiveProviderRuntimeContext(createProviderRuntimeContext());
    runtimeSettingsState.context = null;
    runtimeSettingsState.providerManager = null;
    runtimeSettingsState.oauthManager = null;
    reloadSettingsState.current = undefined;
  });

  afterEach(() => {
    process.argv = originalArgv;
    restoreEnv();
    vi.restoreAllMocks();
    clearActiveProviderRuntimeContext();
  });

  it('all servers visible when no filtering configured', async () => {
    const settings = settingsWithMcpServers({
      serverA: { command: 'cmd-a' },
      serverB: { command: 'cmd-b' },
    });
    const servers = await getMcpServers(settings);
    expect(servers).toContain('serverA');
    expect(servers).toContain('serverB');
  });

  // ── allowMCPServers (settings-level) ────────────────────────────────────────

  it('settings.allowMCPServers keeps only allowed servers', async () => {
    const settings: Settings = {
      ...settingsWithMcpServers({
        serverA: { command: 'cmd-a' },
        serverB: { command: 'cmd-b' },
        serverC: { command: 'cmd-c' },
      }),
      allowMCPServers: ['serverA'],
    };
    const servers = await getMcpServers(settings);
    expect(servers).toContain('serverA');
    expect(servers).not.toContain('serverB');
    expect(servers).not.toContain('serverC');
  });

  it('settings.allowMCPServers with empty array blocks all servers', async () => {
    const settings: Settings = {
      ...settingsWithMcpServers({
        serverA: { command: 'cmd-a' },
      }),
      allowMCPServers: [],
    };
    const servers = await getMcpServers(settings);
    expect(servers).not.toContain('serverA');
  });

  // ── excludeMCPServers (settings-level) ──────────────────────────────────────

  it('settings.excludeMCPServers removes listed servers', async () => {
    const settings: Settings = {
      ...settingsWithMcpServers({
        serverA: { command: 'cmd-a' },
        serverB: { command: 'cmd-b' },
      }),
      excludeMCPServers: ['serverB'],
    };
    const servers = await getMcpServers(settings);
    expect(servers).toContain('serverA');
    expect(servers).not.toContain('serverB');
  });

  it('settings.excludeMCPServers with empty list excludes nothing', async () => {
    const settings: Settings = {
      ...settingsWithMcpServers({
        serverA: { command: 'cmd-a' },
      }),
      excludeMCPServers: [],
    };
    const servers = await getMcpServers(settings);
    expect(servers).toContain('serverA');
  });

  // ── argv.allowedMcpServerNames overrides settings filtering ─────────────────

  it('argv --allowed-mcp-server-names overrides settings.allowMCPServers', async () => {
    const settings: Settings = {
      ...settingsWithMcpServers({
        serverA: { command: 'cmd-a' },
        serverB: { command: 'cmd-b' },
        serverC: { command: 'cmd-c' },
      }),
      // settings would only allow serverA
      allowMCPServers: ['serverA'],
    };
    // CLI overrides to allow serverB instead
    const servers = await getMcpServers(settings, [
      '--allowed-mcp-server-names',
      'serverB',
    ]);
    expect(servers).not.toContain('serverA');
    expect(servers).toContain('serverB');
    expect(servers).not.toContain('serverC');
  });

  it('argv --allowed-mcp-server-names bypasses settings.excludeMCPServers', async () => {
    const settings: Settings = {
      ...settingsWithMcpServers({
        serverA: { command: 'cmd-a' },
        serverB: { command: 'cmd-b' },
      }),
      excludeMCPServers: ['serverA'],
    };
    // CLI explicitly allows serverA despite being excluded in settings
    const servers = await getMcpServers(settings, [
      '--allowed-mcp-server-names',
      'serverA',
    ]);
    expect(servers).toContain('serverA');
  });

  it('argv --allowed-mcp-server-names comma-separated list filters correctly', async () => {
    const settings = settingsWithMcpServers({
      serverA: { command: 'cmd-a' },
      serverB: { command: 'cmd-b' },
      serverC: { command: 'cmd-c' },
    });
    const servers = await getMcpServers(settings, [
      '--allowed-mcp-server-names',
      'serverA,serverC',
    ]);
    expect(servers).toContain('serverA');
    expect(servers).not.toContain('serverB');
    expect(servers).toContain('serverC');
  });

  // ── mcp.enabled=false blocks all servers ────────────────────────────────────

  it('admin.mcp.enabled=false results in empty MCP servers', async () => {
    const settings: Settings = {
      ...settingsWithMcpServers({ serverA: { command: 'cmd-a' } }),
      admin: { mcp: { enabled: false } },
    };
    const servers = await getMcpServers(settings);
    expect(servers).toHaveLength(0);
  });

  // ── blockedMcpServers threaded through config build path (F7) ───────────────

  it('blockedMcpServers is populated when settings.allowMCPServers filters out servers', async () => {
    const settings: Settings = {
      ...settingsWithMcpServers({
        serverA: { command: 'cmd-a' },
        serverB: { command: 'cmd-b' },
      }),
      allowMCPServers: ['serverA'],
    };
    const blocked = await getBlockedMcpServers(settings);
    const blockedNames = blocked.map((s) => s.name);
    expect(blockedNames).toContain('serverB');
    expect(blockedNames).not.toContain('serverA');
  });

  it('blockedMcpServers is populated when argv --allowed-mcp-server-names filters out servers', async () => {
    const settings = settingsWithMcpServers({
      serverA: { command: 'cmd-a' },
      serverB: { command: 'cmd-b' },
      serverC: { command: 'cmd-c' },
    });
    const blocked = await getBlockedMcpServers(settings, [
      '--allowed-mcp-server-names',
      'serverB',
    ]);
    const blockedNames = blocked.map((s) => s.name);
    expect(blockedNames).toContain('serverA');
    expect(blockedNames).toContain('serverC');
    expect(blockedNames).not.toContain('serverB');
  });

  it('blockedMcpServers is empty when no filtering is applied', async () => {
    const settings = settingsWithMcpServers({
      serverA: { command: 'cmd-a' },
      serverB: { command: 'cmd-b' },
    });
    const blocked = await getBlockedMcpServers(settings);
    expect(blocked).toHaveLength(0);
  });

  it('reloads persisted MCP servers and reapplies settings filtering', async () => {
    const config = await loadMcpConfig(
      settingsWithMcpServers({ stale: { command: 'stale' } }),
    );
    reloadSettingsState.current = {
      ...settingsWithMcpServers({
        allowed: { command: 'allowed' },
        blocked: { command: 'blocked' },
      }),
      allowMCPServers: ['allowed'],
    };

    await config.reloadMcpServers();

    expect(Object.keys(config.getMcpServers() ?? {})).toStrictEqual([
      'allowed',
    ]);
    expect(config.getBlockedMcpServers()).toStrictEqual([
      { name: 'blocked', extensionName: '' },
    ]);
  });

  it('retains the startup CLI allow-list when persisted settings reload', async () => {
    const config = await loadMcpConfig(
      settingsWithMcpServers({ allowed: { command: 'initial' } }),
      ['--allowed-mcp-server-names', 'allowed'],
    );
    reloadSettingsState.current = settingsWithMcpServers({
      allowed: { command: 'updated' },
      rejected: { command: 'rejected' },
    });

    await config.reloadMcpServers();

    expect(config.getMcpServers()).toStrictEqual({
      allowed: { command: 'updated' },
    });
  });

  it('keeps MCP reload disabled when administrative policy disabled it at startup', async () => {
    const config = await loadMcpConfig({
      ...settingsWithMcpServers({ initial: { command: 'initial' } }),
      admin: { mcp: { enabled: false } },
    });
    reloadSettingsState.current = settingsWithMcpServers({
      added: { command: 'added' },
    });

    await config.reloadMcpServers();

    expect(config.getMcpServers()).toStrictEqual({});
    expect(config.getBlockedMcpServers()).toStrictEqual([]);
  });

  it('blockedMcpServers includes servers filtered by settings.excludeMCPServers', async () => {
    const settings: Settings = {
      ...settingsWithMcpServers({
        serverA: { command: 'cmd-a' },
        serverB: { command: 'cmd-b' },
      }),
      excludeMCPServers: ['serverB'],
    };
    const blocked = await getBlockedMcpServers(settings);
    const blockedNames = blocked.map((s) => s.name);
    expect(blockedNames).toContain('serverB');
    expect(blockedNames).not.toContain('serverA');
  });
});
