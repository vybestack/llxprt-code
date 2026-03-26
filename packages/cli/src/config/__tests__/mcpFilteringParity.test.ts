/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Task 1.3 – MCP filtering parity tests
 *
 * Locks the behavior of MCP server filtering via:
 *   - settings.allowMCPServers
 *   - settings.excludeMCPServers
 *   - argv.allowedMcpServerNames (overrides settings-level filtering)
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
import { loadCliConfig, parseArguments } from '../config.js';
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

type McpServerMap = Record<
  string,
  { command?: string; args?: string[]; httpUrl?: string }
>;

function settingsWithMcpServers(servers: McpServerMap): Settings {
  return { mcpServers: servers } as unknown as Settings;
}

async function getMcpServers(
  settings: Settings,
  cliArgs: string[] = [],
): Promise<string[]> {
  process.argv = ['node', 'script.js', ...cliArgs];
  const argv = await parseArguments(settings);
  const config = await loadCliConfig(
    settings,
    [],
    makeExtMgr(),
    'test-session',
    argv,
  );
  return Object.keys(config.getMcpServers?.() ?? {});
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('mcpFilteringParity: MCP server filtering', () => {
  const originalArgv = process.argv;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(os.homedir).mockReturnValue(
      path.resolve(path.sep, 'mock', 'home', 'user'),
    );
    vi.stubEnv('GEMINI_API_KEY', 'test-api-key');
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
});
