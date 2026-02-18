/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20250212-LSP.P35
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { ConfigParameters } from '../../config/config.js';
import { Config } from '../../config/config.js';
import type { LspConfig } from '../types.js';
import { setLlxprtMdFilename as mockSetLlxprtMdFilename } from '../../tools/memoryTool.js';
import * as lspServiceClientModule from '../lsp-service-client.js';

vi.mock('../../tools/tool-registry', () => {
  const ToolRegistryMock = vi.fn().mockImplementation(() => {
    const tools: Array<{
      serverName?: string;
      serverToolName?: string;
      name?: string;
    }> = [];
    return {
      registerTool: vi.fn(
        (tool: {
          serverName?: string;
          serverToolName?: string;
          name?: string;
        }) => {
          tools.push(tool);
        },
      ),
      discoverAllTools: vi.fn(),
      sortTools: vi.fn(),
      getAllTools: vi.fn(() => [...tools]),
      removeMcpToolsByServer: vi.fn((serverName: string) => {
        for (let i = tools.length - 1; i >= 0; i -= 1) {
          if (tools[i].serverName === serverName) {
            tools.splice(i, 1);
          }
        }
      }),
    };
  });
  return { ToolRegistry: ToolRegistryMock };
});

vi.mock('../../tools/ls');
vi.mock('../../tools/read-file');
vi.mock('../../tools/grep');
vi.mock('../../tools/glob');
vi.mock('../../tools/edit');
vi.mock('../../tools/shell');
vi.mock('../../tools/write-file');
vi.mock('../../tools/google-web-fetch');
vi.mock('../../tools/read-many-files');
vi.mock('../../tools/memoryTool', () => ({
  MemoryTool: vi.fn(),
  setLlxprtMdFilename: vi.fn(),
  getCurrentLlxprtMdFilename: vi.fn(() => 'LLXPRT.md'),
  DEFAULT_CONTEXT_FILENAME: 'LLXPRT.md',
  LLXPRT_CONFIG_DIR: '.llxprt',
}));

vi.mock('../../core/contentGenerator.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../core/contentGenerator.js')>();
  return {
    ...actual,
    createContentGeneratorConfig: vi.fn(),
  };
});

vi.mock('../../core/client.js', () => ({
  GeminiClient: vi.fn().mockImplementation(() => ({
    initialize: vi.fn().mockResolvedValue(undefined),
    isInitialized: vi.fn().mockReturnValue(false),
    getHistory: vi.fn().mockReturnValue([]),
    getHistoryService: vi.fn().mockReturnValue(null),
    dispose: vi.fn(),
  })),
}));

vi.mock('../../telemetry/index.js', () => ({
  initializeTelemetry: vi.fn(),
  DEFAULT_TELEMETRY_TARGET: 'local',
  DEFAULT_OTLP_ENDPOINT: 'http://localhost:4318',
  logCliConfiguration: vi.fn(),
  StartSessionEvent: vi.fn(),
}));

vi.mock('../../ide/ide-client.js', () => ({
  IdeClient: {
    getInstance: vi.fn().mockResolvedValue({
      connect: vi.fn(),
      disconnect: vi.fn(),
    }),
  },
}));

vi.mock('../../services/fileDiscoveryService.js', () => ({
  FileDiscoveryService: vi.fn().mockImplementation(() => ({
    discoverFiles: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock('../../services/gitService.js', () => ({
  GitService: vi.fn().mockImplementation(() => ({
    initialize: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('../../tools/mcp-client-manager.js', () => ({
  McpClientManager: vi.fn().mockImplementation(() => ({
    startConfiguredMcpServers: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('../../utils/extensionLoader.js', () => ({
  SimpleExtensionLoader: vi.fn().mockImplementation(() => ({
    start: vi.fn().mockResolvedValue(undefined),
    getExtensions: vi.fn().mockReturnValue([]),
  })),
}));

vi.mock('../../runtime/providerRuntimeContext.js', () => ({
  setActiveProviderRuntimeContext: vi.fn(),
  peekActiveProviderRuntimeContext: vi.fn().mockReturnValue(null),
  createProviderRuntimeContext: vi.fn().mockReturnValue({}),
  getActiveProviderRuntimeContext: vi.fn().mockReturnValue({
    settingsService: {
      get: vi.fn(),
      set: vi.fn(),
      getAllGlobalSettings: vi.fn().mockReturnValue({}),
      getProviderSettings: vi.fn().mockReturnValue({}),
      getProviderConfig: vi.fn().mockReturnValue({
        includeDirectories: [],
        mcpServers: {},
        contextFileName: undefined,
      }),
      setProviderSetting: vi.fn(),
    },
    config: null,
    runtimeId: 'p35-runtime',
    metadata: {},
  }),
}));

vi.mock('../../settings/settingsServiceInstance.js', () => ({
  getSettingsService: vi.fn().mockReturnValue({
    get: vi.fn(),
    set: vi.fn(),
    getAllGlobalSettings: vi.fn().mockReturnValue({}),
    getProviderSettings: vi.fn().mockReturnValue({}),
    getProviderConfig: vi.fn().mockReturnValue({
      includeDirectories: [],
      mcpServers: {},
      contextFileName: undefined,
    }),
    setProviderSetting: vi.fn(),
    clear: vi.fn(),
  }),
  registerSettingsService: vi.fn(),
}));

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    getServerCapabilities: vi.fn().mockReturnValue({ tools: {} }),
    listTools: vi.fn().mockResolvedValue({
      tools: [
        {
          name: 'lsp_goto_definition',
          description: 'Go to definition',
          inputSchema: {
            type: 'object',
            properties: {
              filePath: { type: 'string' },
              line: { type: 'number' },
              character: { type: 'number' },
            },
            required: ['filePath', 'line', 'character'],
          },
        },
      ],
    }),
    callTool: vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
      isError: false,
    }),
    close: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('../../tools/mcp-tool.js', () => ({
  DiscoveredMCPTool: vi
    .fn()
    .mockImplementation(
      (
        _callableTool: unknown,
        serverName: string,
        serverToolName: string,
        _description: string,
        _inputSchema: unknown,
      ) => ({
        serverName,
        serverToolName,
        name: `${serverName}__${serverToolName}`,
      }),
    ),
}));

describe('LSP system integration (P35)', () => {
  const repoRoot = fileURLToPath(new URL('../../../../../', import.meta.url));
  const targetDir = repoRoot;

  function createBaseConfigParams(
    overrides?: Partial<ConfigParameters>,
  ): ConfigParameters {
    const settingsService = {
      get: vi.fn(),
      set: vi.fn(),
      clear: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
      emit: vi.fn(),
      getAllGlobalSettings: vi.fn().mockReturnValue({}),
      getProviderSettings: vi.fn().mockReturnValue({}),
      getProviderConfig: vi.fn().mockReturnValue({
        includeDirectories: [],
        mcpServers: {},
        contextFileName: undefined,
      }),
      setProviderSetting: vi.fn(),
    };

    return {
      sessionId: 'p35-session-id',
      targetDir,
      debugMode: false,
      cwd: targetDir,
      model: 'gemini-2.0-flash-exp',
      settingsService:
        settingsService as unknown as ConfigParameters['settingsService'],
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns undefined client/config when lsp is false', async () => {
    const config = new Config(createBaseConfigParams({ lsp: false }));
    await config.initialize();

    expect(config.getLspServiceClient()).toBeUndefined();
    expect(config.getLspConfig()).toBeUndefined();
  });

  it('defaults to disabled when lsp key is absent (not configured)', async () => {
    const config = new Config(createBaseConfigParams());
    await config.initialize();

    expect(config.getLspConfig()).toBeUndefined();
    expect(config.getLspServiceClient()).toBeUndefined();
  });

  it('defaults to enabled config when lsp is true', async () => {
    const config = new Config(createBaseConfigParams({ lsp: true }));
    await config.initialize();

    expect(config.getLspConfig()).toEqual({ servers: [] });
    expect(config.getLspServiceClient()).toBeDefined();
  });

  it('uses provided lsp config object', async () => {
    const lsp: LspConfig = {
      servers: [],
      includeSeverities: ['error', 'warning'],
      maxDiagnosticsPerFile: 12,
      navigationTools: true,
    };
    const config = new Config(createBaseConfigParams({ lsp }));
    await config.initialize();

    expect(config.getLspConfig()).toEqual(lsp);
  });

  it('returns same LSP service client instance across calls', async () => {
    const config = new Config(createBaseConfigParams({ lsp: { servers: [] } }));
    await config.initialize();

    const client1 = config.getLspServiceClient();
    const client2 = config.getLspServiceClient();
    expect(client1).toBeDefined();
    expect(client1).toBe(client2);
  });

  it('returns same LSP config reference across calls', async () => {
    const config = new Config(createBaseConfigParams({ lsp: { servers: [] } }));
    await config.initialize();

    const config1 = config.getLspConfig();
    const config2 = config.getLspConfig();
    expect(config1).toBeDefined();
    expect(config1).toBe(config2);
  });

  it('registers no lsp-navigation tools when navigationTools is false', async () => {
    const config = new Config(
      createBaseConfigParams({
        lsp: {
          servers: [],
          navigationTools: false,
        },
      }),
    );
    await config.initialize();

    const tools = config.getToolRegistry().getAllTools();
    const lspNavTools = tools.filter(
      (t: { serverName?: string }) => t.serverName === 'lsp-navigation',
    );
    expect(lspNavTools).toHaveLength(0);
  });

  it('registers lsp-navigation tools when service is alive and navigationTools is true', async () => {
    const config = new Config(
      createBaseConfigParams({
        lsp: {
          servers: [],
          navigationTools: true,
        },
      }),
    );
    await config.initialize();

    const tools = config.getToolRegistry().getAllTools();
    const lspNavTools = tools.filter(
      (t: { serverName?: string }) => t.serverName === 'lsp-navigation',
    );
    expect(lspNavTools.length).toBeGreaterThan(0);
  });

  it('does not register lsp-navigation tools when service is unavailable', async () => {
    const config = new Config(
      createBaseConfigParams({
        lsp: {
          servers: [
            {
              id: 'tsserver',
              command: '/definitely-missing/tsserver',
            },
          ],
          navigationTools: true,
        },
      }),
    );
    await config.initialize();

    const lspClient = config.getLspServiceClient();
    expect(lspClient?.isAlive()).toBe(false);

    const tools = config.getToolRegistry().getAllTools();
    const lspNavTools = tools.filter(
      (t: { serverName?: string }) => t.serverName === 'lsp-navigation',
    );
    expect(lspNavTools).toHaveLength(0);
  });

  it('gracefully degrades when LSP start throws', async () => {
    vi.spyOn(
      lspServiceClientModule.LspServiceClient.prototype,
      'start',
    ).mockRejectedValue(new Error('simulated start failure'));

    const config = new Config(createBaseConfigParams({ lsp: { servers: [] } }));
    await expect(config.initialize()).resolves.toBeUndefined();
    expect(config.getLspServiceClient()).toBeUndefined();
    expect(config.getLspConfig()).toEqual({ servers: [] });
  });

  it('shutdownLspService clears service client and removes lsp-navigation tools', async () => {
    const config = new Config(
      createBaseConfigParams({
        lsp: {
          servers: [],
          navigationTools: true,
        },
      }),
    );
    await config.initialize();

    await config.shutdownLspService();

    expect(config.getLspServiceClient()).toBeUndefined();
    const tools = config.getToolRegistry().getAllTools();
    const lspNavTools = tools.filter(
      (t: { serverName?: string }) => t.serverName === 'lsp-navigation',
    );
    expect(lspNavTools).toHaveLength(0);
  });

  it('edit and write tools keep LSP integration call sites', () => {
    const editPath = fileURLToPath(
      new URL('../../tools/edit.ts', import.meta.url),
    );
    const writePath = fileURLToPath(
      new URL('../../tools/write-file.ts', import.meta.url),
    );
    const helperPath = fileURLToPath(
      new URL('../../tools/lsp-diagnostics-helper.ts', import.meta.url),
    );

    const editSource = readFileSync(editPath, 'utf8');
    const writeSource = readFileSync(writePath, 'utf8');
    const helperSource = readFileSync(helperPath, 'utf8');

    // edit.ts uses the shared helper via import
    expect(editSource).toContain('collectLspDiagnosticsBlock');

    // write-file.ts still has direct LSP calls for multi-file diagnostics
    expect(writeSource).toContain('getLspServiceClient');
    expect(writeSource).toContain('checkFile');
    expect(writeSource).toContain('getAllDiagnostics');

    // The shared helper contains the actual LSP integration calls
    expect(helperSource).toContain('getLspServiceClient');
    expect(helperSource).toContain('checkFile');
  });

  it('still allows setting memory filename helper through mocks', () => {
    expect(typeof mockSetLlxprtMdFilename).toBe('function');
  });
});
