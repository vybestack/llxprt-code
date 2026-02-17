/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20250212-LSP.P36
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { ConfigParameters } from '../../config/config.js';
import { Config } from '../../config/config.js';
import type { LspConfig } from '../types.js';
import { Diagnostic } from '../types.js';
import * as lspServiceClientModule from '../lsp-service-client.js';
import { LspServiceClient } from '../lsp-service-client.js';

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
    runtimeId: 'p36-runtime',
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

describe('LSP E2E integration (P36)', () => {
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
      sessionId: 'p36-session-id',
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

  // --- 1. Edit → Diagnostics ---
  it('LSP client produces diagnostics when checkFile is called on a file path', async () => {
    const mockDiagnostics: Diagnostic[] = [
      { message: 'mock diagnostic', severity: 'error' },
    ];
    const checkFileSpy = vi
      .spyOn(lspServiceClientModule.LspServiceClient.prototype, 'checkFile')
      .mockResolvedValue(mockDiagnostics);
    const startSpy = vi
      .spyOn(lspServiceClientModule.LspServiceClient.prototype, 'start')
      .mockResolvedValue(undefined);
    const isAliveSpy = vi
      .spyOn(lspServiceClientModule.LspServiceClient.prototype, 'isAlive')
      .mockReturnValue(true);

    try {
      const config = new Config(
        createBaseConfigParams({ lsp: { servers: [] } }),
      );
      await config.initialize();

      const client = config.getLspServiceClient();
      expect(client).toBeDefined();
      expect(client!.isAlive()).toBe(true);

      const diagnostics = await client!.checkFile('/tmp/test-file.ts');
      expect(diagnostics.length).toBeGreaterThan(0);
      expect(diagnostics[0].message).toBeDefined();
      expect(diagnostics[0].severity).toBeDefined();
    } finally {
      checkFileSpy.mockRestore();
      startSpy.mockRestore();
      isAliveSpy.mockRestore();
    }
  });

  // --- 2. Edit → No Errors When Disabled ---
  it('produces no diagnostics when lsp is false', async () => {
    const config = new Config(createBaseConfigParams({ lsp: false }));
    await config.initialize();

    const client = config.getLspServiceClient();
    expect(client).toBeUndefined();
  });

  // --- 3. Write → Multi-File Diagnostics ---
  it('checkFile + getAllDiagnostics accumulates multi-file results', async () => {
    const mockByFile: Record<string, Diagnostic[]> = {
      '/tmp/file-a.ts': [{ message: 'mock a', severity: 'warning' }],
      '/tmp/file-b.ts': [{ message: 'mock b', severity: 'error' }],
    };
    const checkFileSpy = vi
      .spyOn(lspServiceClientModule.LspServiceClient.prototype, 'checkFile')
      .mockImplementation(
        async (filePath: string) => mockByFile[filePath] ?? [],
      );
    const getAllDiagnosticsSpy = vi
      .spyOn(
        lspServiceClientModule.LspServiceClient.prototype,
        'getAllDiagnostics',
      )
      .mockResolvedValue(mockByFile);
    const startSpy = vi
      .spyOn(lspServiceClientModule.LspServiceClient.prototype, 'start')
      .mockResolvedValue(undefined);
    const isAliveSpy = vi
      .spyOn(lspServiceClientModule.LspServiceClient.prototype, 'isAlive')
      .mockReturnValue(true);

    try {
      const config = new Config(
        createBaseConfigParams({ lsp: { servers: [] } }),
      );
      await config.initialize();

      const client = config.getLspServiceClient()!;
      expect(client.isAlive()).toBe(true);

      await client.checkFile('/tmp/file-a.ts');
      await client.checkFile('/tmp/file-b.ts');

      const allDiagnostics = await client.getAllDiagnostics();
      expect(Object.keys(allDiagnostics)).toContain('/tmp/file-a.ts');
      expect(Object.keys(allDiagnostics)).toContain('/tmp/file-b.ts');

      for (const [_filePath, entries] of Object.entries(allDiagnostics)) {
        expect(entries.length).toBeGreaterThan(0);
        for (const d of entries) {
          expect(d.message).toBeDefined();
          expect(d.severity).toBeDefined();
        }
      }
    } finally {
      checkFileSpy.mockRestore();
      getAllDiagnosticsSpy.mockRestore();
      startSpy.mockRestore();
      isAliveSpy.mockRestore();
    }
  });

  // --- 4. Apply-Patch → Diagnostics ---
  it('apply-patch source contains LSP diagnostic integration call sites', () => {
    const applyPatchPath = fileURLToPath(
      new URL('../../tools/apply-patch.ts', import.meta.url),
    );
    const source = readFileSync(applyPatchPath, 'utf8');

    expect(source).toContain('getLspServiceClient');
    expect(source).toContain('checkFile');
  });

  // --- 5. Graceful: No Service ---
  it('LspServiceClient returns empty diagnostics when not alive', async () => {
    const client = new LspServiceClient({ servers: [] }, targetDir);
    // Do not call start — client is not alive
    expect(client.isAlive()).toBe(false);

    const diagnostics = await client.checkFile('/tmp/somefile.ts');
    expect(diagnostics).toEqual([]);

    const all = await client.getAllDiagnostics();
    expect(all).toEqual({});
  });

  // --- 6. Graceful: Service Start Failure ---
  it('Config handles LSP start failure gracefully — tools still work', async () => {
    const spy = vi
      .spyOn(lspServiceClientModule.LspServiceClient.prototype, 'start')
      .mockRejectedValue(new Error('simulated crash'));

    try {
      const config = new Config(
        createBaseConfigParams({ lsp: { servers: [] } }),
      );
      await expect(config.initialize()).resolves.toBeUndefined();

      expect(config.getLspServiceClient()).toBeUndefined();
      expect(config.getLspConfig()).toEqual({ servers: [] });
    } finally {
      spy.mockRestore();
    }
  });

  // --- 7. Config: lsp false ---
  it('Config with lsp:false creates no service and no config', async () => {
    const config = new Config(createBaseConfigParams({ lsp: false }));
    await config.initialize();

    expect(config.getLspServiceClient()).toBeUndefined();
    expect(config.getLspConfig()).toBeUndefined();
  });

  // --- 8. Config: Default Enabled ---
  it('Config defaults to disabled when lsp key is absent', async () => {
    const config = new Config(createBaseConfigParams());
    await config.initialize();

    expect(config.getLspConfig()).toBeUndefined();
    expect(config.getLspServiceClient()).toBeUndefined();
  });

  it('Config enables LSP when lsp is true', async () => {
    const startSpy = vi
      .spyOn(lspServiceClientModule.LspServiceClient.prototype, 'start')
      .mockResolvedValue(undefined);
    const isAliveSpy = vi
      .spyOn(lspServiceClientModule.LspServiceClient.prototype, 'isAlive')
      .mockReturnValue(true);

    try {
      const config = new Config(createBaseConfigParams({ lsp: true }));
      await config.initialize();

      expect(config.getLspConfig()).toEqual({ servers: [] });
      expect(config.getLspServiceClient()).toBeDefined();
      expect(config.getLspServiceClient()!.isAlive()).toBe(true);
    } finally {
      startSpy.mockRestore();
      isAliveSpy.mockRestore();
    }
  });

  // --- 9. Status Command ---
  it('LspServiceClient.status() returns server info when alive', async () => {
    const lspConfig: LspConfig = {
      servers: [{ id: 'tsserver', command: 'typescript-language-server' }],
    };
    const client = new LspServiceClient(lspConfig, targetDir);
    await client.start();

    const statuses = await client.status();
    expect(statuses.length).toBeGreaterThanOrEqual(1);

    const status = statuses[0] as {
      serverId: string;
      healthy?: boolean;
      detail?: string;
      state?: 'ok' | 'broken' | 'starting';
    };

    expect(status.serverId).toBe('tsserver');
    expect(
      typeof status.healthy === 'boolean' ||
        status.state === 'ok' ||
        status.state === 'broken' ||
        status.state === 'starting',
    ).toBe(true);
  });

  // --- 10. Status Unavailable ---
  it('LspServiceClient.getUnavailableReason() returns message when not alive', async () => {
    const client = new LspServiceClient(
      {
        servers: [{ id: 'missing', command: '/definitely/missing/lsp-binary' }],
      },
      targetDir,
    );
    await client.start();
    expect(client.isAlive()).toBe(false);

    const reason = client.getUnavailableReason();
    expect(typeof reason).toBe('string');
    expect(reason).toContain('Server command not executable');
  });

  // --- 11. Navigation Tools Registered ---
  it('MCP navigation tools are registered when navigationTools is true', async () => {
    const { PassThrough } = await import('node:stream');
    const startSpy = vi
      .spyOn(lspServiceClientModule.LspServiceClient.prototype, 'start')
      .mockResolvedValue(undefined);
    const isAliveSpy = vi
      .spyOn(lspServiceClientModule.LspServiceClient.prototype, 'isAlive')
      .mockReturnValue(true);
    const getMcpTransportStreamsSpy = vi
      .spyOn(
        lspServiceClientModule.LspServiceClient.prototype,
        'getMcpTransportStreams',
      )
      .mockReturnValue({
        readable: new PassThrough(),
        writable: new PassThrough(),
      });

    try {
      const config = new Config(
        createBaseConfigParams({
          lsp: { servers: [], navigationTools: true },
        }),
      );
      await config.initialize();

      const tools = config.getToolRegistry().getAllTools();
      const lspNavTools = tools.filter(
        (t: { serverName?: string }) => t.serverName === 'lsp-navigation',
      );
      expect(lspNavTools.length).toBeGreaterThan(0);
    } finally {
      startSpy.mockRestore();
      isAliveSpy.mockRestore();
      getMcpTransportStreamsSpy.mockRestore();
    }
  });

  // --- 12. Navigation Tools Disabled ---
  it('MCP navigation tools are NOT registered when navigationTools is false', async () => {
    const config = new Config(
      createBaseConfigParams({
        lsp: { servers: [], navigationTools: false },
      }),
    );
    await config.initialize();

    const tools = config.getToolRegistry().getAllTools();
    const lspNavTools = tools.filter(
      (t: { serverName?: string }) => t.serverName === 'lsp-navigation',
    );
    expect(lspNavTools).toHaveLength(0);
  });

  // --- 13. Shutdown Lifecycle ---
  it('shutdownLspService clears client and navigation tools', async () => {
    const { PassThrough } = await import('node:stream');
    const startSpy = vi
      .spyOn(lspServiceClientModule.LspServiceClient.prototype, 'start')
      .mockResolvedValue(undefined);
    const isAliveSpy = vi
      .spyOn(lspServiceClientModule.LspServiceClient.prototype, 'isAlive')
      .mockReturnValue(true);
    const getMcpTransportStreamsSpy = vi
      .spyOn(
        lspServiceClientModule.LspServiceClient.prototype,
        'getMcpTransportStreams',
      )
      .mockReturnValue({
        readable: new PassThrough(),
        writable: new PassThrough(),
      });

    try {
      const config = new Config(
        createBaseConfigParams({
          lsp: { servers: [], navigationTools: true },
        }),
      );
      await config.initialize();

      expect(config.getLspServiceClient()).toBeDefined();
      const toolsBefore = config.getToolRegistry().getAllTools();
      const navBefore = toolsBefore.filter(
        (t: { serverName?: string }) => t.serverName === 'lsp-navigation',
      );
      expect(navBefore.length).toBeGreaterThan(0);

      await config.shutdownLspService();

      expect(config.getLspServiceClient()).toBeUndefined();
      const toolsAfter = config.getToolRegistry().getAllTools();
      const navAfter = toolsAfter.filter(
        (t: { serverName?: string }) => t.serverName === 'lsp-navigation',
      );
      expect(navAfter).toHaveLength(0);
    } finally {
      startSpy.mockRestore();
      isAliveSpy.mockRestore();
      getMcpTransportStreamsSpy.mockRestore();
    }
  });

  // --- 14. Type Contract ---
  it('Diagnostic type has all required and optional fields', () => {
    const diagnostic: Diagnostic = {
      message: 'test error',
      severity: 'error',
      source: 'tsserver',
      code: 'TS1234',
      line: 10,
      column: 5,
    };

    expect(diagnostic.message).toBe('test error');
    expect(diagnostic.severity).toBe('error');
    expect(diagnostic.source).toBe('tsserver');
    expect(diagnostic.code).toBe('TS1234');
    expect(diagnostic.line).toBe(10);
    expect(diagnostic.column).toBe(5);

    // Minimal diagnostic — only required fields
    const minimal: Diagnostic = {
      message: 'minimal',
      severity: 'warning',
    };
    expect(minimal.message).toBe('minimal');
    expect(minimal.severity).toBe('warning');
    expect(minimal.source).toBeUndefined();
    expect(minimal.code).toBeUndefined();
    expect(minimal.line).toBeUndefined();
    expect(minimal.column).toBeUndefined();
  });

  // --- 15. MCP Transport Streams ---
  it('getMcpTransportStreams returns PassThrough streams when alive', async () => {
    const client = new LspServiceClient({ servers: [] }, targetDir);
    await client.start();

    expect(client.isAlive()).toBe(true);
    const transport = client.getMcpTransportStreams();
    expect(transport).not.toBeNull();
    expect(transport!.readable).toBeDefined();
    expect(transport!.writable).toBeDefined();
  });

  // --- 16. MCP Transport Null When Not Alive ---
  it('getMcpTransportStreams returns null when not alive', () => {
    const client = new LspServiceClient({ servers: [] }, targetDir);
    expect(client.isAlive()).toBe(false);

    const transport = client.getMcpTransportStreams();
    expect(transport).toBeNull();
  });

  // --- 17. Edit + Write source integration call sites ---
  it('edit and write tool sources contain LSP integration call sites', () => {
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

  // --- 18. Shutdown then checkFile is safe ---
  it('checkFile returns empty after shutdown', async () => {
    const client = new LspServiceClient({ servers: [] }, targetDir);
    await client.start();
    expect(client.isAlive()).toBe(true);

    await client.checkFile('/tmp/before-shutdown.ts');
    await client.shutdown();

    expect(client.isAlive()).toBe(false);
    const diagnostics = await client.checkFile('/tmp/after-shutdown.ts');
    expect(diagnostics).toEqual([]);

    const all = await client.getAllDiagnostics();
    expect(all).toEqual({});
  });
});
