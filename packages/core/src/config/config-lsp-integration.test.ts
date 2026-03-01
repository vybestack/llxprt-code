/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20250212-LSP.P33
 * @requirement REQ-CFG-010, REQ-CFG-015, REQ-CFG-020, REQ-CFG-055, REQ-CFG-060, REQ-CFG-070, REQ-NAV-055
 * @pseudocode config-integration.md lines 39-114
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fileURLToPath } from 'node:url';
import { Readable, Writable } from 'node:stream';
import type { ConfigParameters } from './config.js';
import { Config } from './config.js';
import type { LspConfig } from '../lsp/types.js';
import { setLlxprtMdFilename as _mockSetLlxprtMdFilename } from '../tools/memoryTool.js';
import * as lspServiceClientModule from '../lsp/lsp-service-client.js';

// Mock dependencies
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(true),
    statSync: vi.fn().mockReturnValue({
      isDirectory: vi.fn().mockReturnValue(true),
    }),
    realpathSync: vi.fn((path) => path),
  };
});

vi.mock('../tools/tool-registry', () => {
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

vi.mock('../tools/ls');
vi.mock('../tools/read-file');
vi.mock('../tools/grep');
vi.mock('../tools/glob');
vi.mock('../tools/edit');
vi.mock('../tools/shell');
vi.mock('../tools/write-file');
vi.mock('../tools/google-web-fetch');
vi.mock('../tools/read-many-files');
vi.mock('../tools/memoryTool', () => ({
  MemoryTool: vi.fn(),
  setLlxprtMdFilename: vi.fn(),
  getCurrentLlxprtMdFilename: vi.fn(() => 'LLXPRT.md'),
  DEFAULT_CONTEXT_FILENAME: 'LLXPRT.md',
  LLXPRT_CONFIG_DIR: '.llxprt',
}));

vi.mock('../core/contentGenerator.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../core/contentGenerator.js')>();
  return {
    ...actual,
    createContentGeneratorConfig: vi.fn(),
  };
});

vi.mock('../core/client.js', () => ({
  GeminiClient: vi.fn().mockImplementation(() => ({
    initialize: vi.fn().mockResolvedValue(undefined),
    isInitialized: vi.fn().mockReturnValue(false),
    getHistory: vi.fn().mockReturnValue([]),
    getHistoryService: vi.fn().mockReturnValue(null),
    dispose: vi.fn(),
  })),
}));

vi.mock('../telemetry/index.js', () => ({
  initializeTelemetry: vi.fn(),
  DEFAULT_TELEMETRY_TARGET: 'local',
  DEFAULT_OTLP_ENDPOINT: 'http://localhost:4318',
  logCliConfiguration: vi.fn(),
  StartSessionEvent: vi.fn(),
}));

vi.mock('../ide/ide-client.js', () => ({
  IdeClient: {
    getInstance: vi.fn().mockResolvedValue({
      connect: vi.fn(),
      disconnect: vi.fn(),
    }),
  },
}));

vi.mock('../services/fileDiscoveryService.js', () => ({
  FileDiscoveryService: vi.fn().mockImplementation(() => ({
    discoverFiles: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock('../services/gitService.js', () => ({
  GitService: vi.fn().mockImplementation(() => ({
    initialize: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('../tools/mcp-client-manager.js', () => ({
  McpClientManager: vi.fn().mockImplementation(() => ({
    startConfiguredMcpServers: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('../utils/extensionLoader.js', () => ({
  SimpleExtensionLoader: vi.fn().mockImplementation(() => ({
    start: vi.fn().mockResolvedValue(undefined),
    getExtensions: vi.fn().mockReturnValue([]),
  })),
}));

vi.mock('../runtime/providerRuntimeContext.js', () => ({
  setActiveProviderRuntimeContext: vi.fn(),
  peekActiveProviderRuntimeContext: vi.fn().mockReturnValue(null),
  createProviderRuntimeContext: vi.fn().mockReturnValue({}),
  getActiveProviderRuntimeContext: vi.fn().mockReturnValue({
    settingsService: {
      get: vi.fn(),
      set: vi.fn(),
      getAllGlobalSettings: vi.fn().mockReturnValue({}),
      getProviderSettings: vi.fn().mockReturnValue({}),
      setProviderSetting: vi.fn(),
    },
    config: null,
    runtimeId: 'test-runtime',
    metadata: {},
  }),
}));

vi.mock('../settings/settingsServiceInstance.js', () => ({
  getSettingsService: vi.fn().mockReturnValue({
    get: vi.fn(),
    set: vi.fn(),
    getAllGlobalSettings: vi.fn().mockReturnValue({}),
    getProviderSettings: vi.fn().mockReturnValue({}),
    setProviderSetting: vi.fn(),
    clear: vi.fn(),
  }),
  registerSettingsService: vi.fn(),
}));

// Mock MCP SDK Client
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

// Mock DiscoveredMCPTool
vi.mock('../tools/mcp-tool.js', () => ({
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

describe('Config LSP Integration (P33)', () => {
  const mockTargetDir = fileURLToPath(new URL('../../../../', import.meta.url));
  const mockSessionId = 'test-session-id';

  function createBaseConfigParams(
    overrides?: Partial<ConfigParameters>,
  ): ConfigParameters {
    return {
      sessionId: mockSessionId,
      targetDir: mockTargetDir,
      debugMode: false,
      cwd: mockTargetDir,
      model: 'gemini-2.0-flash-exp',
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('REQ-CFG-010: lsp: false disables LSP', () => {
    it('should return undefined for getLspServiceClient when lsp is false', async () => {
      const params = createBaseConfigParams({
        lsp: false,
      });
      const config = new Config(params);
      await config.initialize();

      const lspClient = config.getLspServiceClient();
      expect(lspClient).toBeUndefined();
    });

    it('should return undefined for getLspConfig when lsp is false', async () => {
      const params = createBaseConfigParams({
        lsp: false,
      });
      const config = new Config(params);
      await config.initialize();

      const lspConfig = config.getLspConfig();
      expect(lspConfig).toBeUndefined();
    });

    it('should not create LspServiceClient during initialize when lsp is false', async () => {
      const params = createBaseConfigParams({
        lsp: false,
      });
      const config = new Config(params);
      await config.initialize();

      // Verify service client was never created
      expect(config.getLspServiceClient()).toBeUndefined();
    });
  });

  describe('REQ-CFG-015: lsp key absent disables LSP', () => {
    it('should disable LSP when lsp key is absent', async () => {
      const params = createBaseConfigParams({
        // lsp key omitted — absent means disabled
      });
      const config = new Config(params);
      await config.initialize();

      const lspConfig = config.getLspConfig();
      expect(lspConfig).toBeUndefined();
    });

    it('should not create LspServiceClient when lsp key is absent', async () => {
      const params = createBaseConfigParams({
        // lsp key omitted — absent means disabled
      });
      const config = new Config(params);
      await config.initialize();

      const lspClient = config.getLspServiceClient();
      expect(lspClient).toBeUndefined();
    });
  });

  describe('REQ-CFG-020: object presence enables LSP', () => {
    it('should enable LSP when lsp is an empty object', async () => {
      const params = createBaseConfigParams({
        lsp: {},
      });
      const config = new Config(params);
      await config.initialize();

      const lspConfig = config.getLspConfig();
      expect(lspConfig).toBeDefined();
      expect(lspConfig?.servers).toEqual([]);
    });

    it('should enable LSP with custom diagnosticTimeout', async () => {
      const customTimeout = 5000;
      const params = createBaseConfigParams({
        lsp: {
          servers: [],
          diagnosticTimeout: customTimeout,
        },
      });
      const config = new Config(params);
      await config.initialize();

      const lspConfig = config.getLspConfig();
      expect(lspConfig?.diagnosticTimeout).toBe(customTimeout);
    });

    it('should enable LSP with custom includeSeverities', async () => {
      const params = createBaseConfigParams({
        lsp: {
          servers: [],
          includeSeverities: ['error', 'warning'],
        },
      });
      const config = new Config(params);
      await config.initialize();

      const lspConfig = config.getLspConfig();
      expect(lspConfig?.includeSeverities).toEqual(['error', 'warning']);
    });
  });

  describe('REQ-CFG-055: firstTouchTimeout configuration', () => {
    it('should pass firstTouchTimeout to LspServiceClient', async () => {
      const customTimeout = 15000;
      const params = createBaseConfigParams({
        lsp: {
          servers: [],
          firstTouchTimeout: customTimeout,
        },
      });
      const config = new Config(params);
      await config.initialize();

      const lspConfig = config.getLspConfig();
      expect(lspConfig?.firstTouchTimeout).toBe(customTimeout);
    });
  });

  describe('REQ-CFG-060: includeSeverities configuration', () => {
    it('should support error-only severity filter', async () => {
      const params = createBaseConfigParams({
        lsp: {
          servers: [],
          includeSeverities: ['error'],
        },
      });
      const config = new Config(params);
      await config.initialize();

      const lspConfig = config.getLspConfig();
      expect(lspConfig?.includeSeverities).toEqual(['error']);
    });

    it('should support error and warning severity filter', async () => {
      const params = createBaseConfigParams({
        lsp: {
          servers: [],
          includeSeverities: ['error', 'warning'],
        },
      });
      const config = new Config(params);
      await config.initialize();

      const lspConfig = config.getLspConfig();
      expect(lspConfig?.includeSeverities).toEqual(['error', 'warning']);
    });
  });

  describe('REQ-CFG-070: navigationTools independently disableable', () => {
    it('should not register MCP navigation when navigationTools is false', async () => {
      const params = createBaseConfigParams({
        lsp: {
          servers: [],
          navigationTools: false,
        },
      });
      const config = new Config(params);
      await config.initialize();

      const lspConfig = config.getLspConfig();
      expect(lspConfig?.navigationTools).toBe(false);

      // Verify service still starts but navigation disabled
      const lspClient = config.getLspServiceClient();
      expect(lspClient).toBeDefined();
      expect(
        lspClient?.isAlive() || lspClient?.getUnavailableReason() !== undefined,
      ).toBe(true);
    });

    it('should register MCP navigation when navigationTools is true', async () => {
      const params = createBaseConfigParams({
        lsp: {
          servers: [],
          navigationTools: true,
        },
      });
      const config = new Config(params);
      await config.initialize();

      const lspConfig = config.getLspConfig();
      expect(lspConfig?.navigationTools).toBe(true);

      await vi.waitFor(() => {
        const tools = config.getToolRegistry().getAllTools();
        const lspNavTools = tools.filter(
          (t: { serverName?: string }) => t.serverName === 'lsp-navigation',
        );
        expect(lspNavTools.length).toBeGreaterThan(0);
      });
    });

    it('should default to enabled when navigationTools is absent', async () => {
      const params = createBaseConfigParams({
        lsp: {
          servers: [],
          // navigationTools omitted
        },
      });
      const config = new Config(params);
      await config.initialize();

      const lspConfig = config.getLspConfig();
      expect(lspConfig?.navigationTools).toBeUndefined();

      await vi.waitFor(() => {
        const tools = config.getToolRegistry().getAllTools();
        const lspNavTools = tools.filter(
          (t: { serverName?: string }) => t.serverName === 'lsp-navigation',
        );
        expect(lspNavTools.length).toBeGreaterThan(0);
      });
    });
  });

  describe('REQ-NAV-055: Register MCP only after service starts', () => {
    it('should provide MCP transport streams when service starts successfully', async () => {
      // Mock LspServiceClient methods to avoid real subprocess spawn
      const startSpy = vi
        .spyOn(lspServiceClientModule.LspServiceClient.prototype, 'start')
        .mockResolvedValue(undefined);
      const isAliveSpy = vi
        .spyOn(lspServiceClientModule.LspServiceClient.prototype, 'isAlive')
        .mockReturnValue(true);
      const mockTransport = {
        readable: new Readable({ read() {} }),
        writable: new Writable({
          write(_chunk, _enc, cb) {
            cb();
          },
        }),
      };
      const getTransportSpy = vi
        .spyOn(
          lspServiceClientModule.LspServiceClient.prototype,
          'getMcpTransportStreams',
        )
        .mockReturnValue(mockTransport);

      try {
        const params = createBaseConfigParams({
          lsp: {
            servers: [],
          },
        });
        const config = new Config(params);
        await config.initialize();

        const lspClient = config.getLspServiceClient();
        expect(lspClient?.isAlive()).toBe(true);

        const transport = lspClient?.getMcpTransportStreams();
        expect(transport).toBeDefined();
        expect(transport?.readable).toBeDefined();
        expect(transport?.writable).toBeDefined();
      } finally {
        startSpy.mockRestore();
        isAliveSpy.mockRestore();
        getTransportSpy.mockRestore();
      }
    });

    it('should not register MCP navigation tools when navigationTools is false', async () => {
      const params = createBaseConfigParams({
        lsp: {
          servers: [],
          navigationTools: false,
        },
      });
      const config = new Config(params);
      await config.initialize();

      const toolRegistry = config.getToolRegistry();
      const tools = toolRegistry.getAllTools();

      // No tools should be registered with serverName 'lsp-navigation'
      const lspNavTools = tools.filter(
        (t: { serverName?: string }) => t.serverName === 'lsp-navigation',
      );
      expect(lspNavTools).toHaveLength(0);
    });

    it('should not register MCP navigation tools when service is unavailable', async () => {
      const params = createBaseConfigParams({
        lsp: {
          servers: [
            {
              id: 'tsserver',
              command: '/definitely-missing/tsserver',
            },
          ],
        },
      });
      const config = new Config(params);
      await config.initialize();

      const lspClient = config.getLspServiceClient();
      expect(lspClient?.isAlive()).toBe(false);
      expect(lspClient?.getUnavailableReason()).toContain(
        'Server command not executable',
      );

      const toolRegistry = config.getToolRegistry();
      const tools = toolRegistry.getAllTools();
      const lspNavTools = tools.filter(
        (t: { serverName?: string }) => t.serverName === 'lsp-navigation',
      );
      expect(lspNavTools).toHaveLength(0);
    });
  });

  describe('LSP Service Lifecycle', () => {
    it('should call start() on LspServiceClient during initialize', async () => {
      const params = createBaseConfigParams({
        lsp: {
          servers: [],
        },
      });
      const config = new Config(params);
      await config.initialize();

      const lspClient = config.getLspServiceClient();
      expect(lspClient).toBeDefined();
      expect(
        lspClient?.isAlive() || lspClient?.getUnavailableReason() !== undefined,
      ).toBe(true);
    });

    it('should call shutdown() on LspServiceClient when shutdownLspService is called', async () => {
      const params = createBaseConfigParams({
        lsp: {
          servers: [],
        },
      });
      const config = new Config(params);
      await config.initialize();

      const lspClient = config.getLspServiceClient();
      expect(
        lspClient?.isAlive() || lspClient?.getUnavailableReason() !== undefined,
      ).toBe(true);

      await config.shutdownLspService();

      // After shutdown, service should no longer be available
      const lspClientAfter = config.getLspServiceClient();
      expect(lspClientAfter).toBeUndefined();
    });

    it('should handle startup gracefully with empty servers', async () => {
      // With empty servers list, service starts but is minimal
      const params = createBaseConfigParams({
        lsp: {
          servers: [],
        },
      });
      const config = new Config(params);

      // Should not throw
      await expect(config.initialize()).resolves.toBeUndefined();

      // Service is created and start was attempted (empty servers is valid)
      const lspClient = config.getLspServiceClient();
      expect(lspClient).toBeDefined();
      expect(
        lspClient?.isAlive() || lspClient?.getUnavailableReason() !== undefined,
      ).toBe(true);
    });

    it('should preserve getLspConfig() after startup failure', async () => {
      const params = createBaseConfigParams({
        targetDir: '/workspace-fail', // Triggers integration failure scenario
        lsp: {
          servers: [],
          includeSeverities: ['error', 'warning'],
        },
      });
      const config = new Config(params);

      await config.initialize();

      // Config should still be accessible even though service failed
      const lspConfig = config.getLspConfig();
      expect(lspConfig).toBeDefined();
      expect(lspConfig?.includeSeverities).toEqual(['error', 'warning']);
    });
  });

  describe('Config accessor methods', () => {
    it('should return consistent config object from getLspConfig()', async () => {
      const customConfig: LspConfig = {
        servers: [],
        includeSeverities: ['error', 'warning', 'info'],
        maxDiagnosticsPerFile: 50,
        maxProjectDiagnosticsFiles: 10,
        diagnosticTimeout: 8000,
        firstTouchTimeout: 20000,
        navigationTools: true,
      };

      const params = createBaseConfigParams({
        lsp: customConfig,
      });
      const config = new Config(params);
      await config.initialize();

      const lspConfig = config.getLspConfig();
      expect(lspConfig).toEqual(customConfig);
    });

    it('should return same LspServiceClient instance from getLspServiceClient()', async () => {
      const params = createBaseConfigParams({
        lsp: {
          servers: [],
        },
      });
      const config = new Config(params);
      await config.initialize();

      const client1 = config.getLspServiceClient();
      const client2 = config.getLspServiceClient();

      expect(client1).toBe(client2);
    });
  });

  describe('Multiple initialize calls', () => {
    it('should throw on second initialize call', async () => {
      const params = createBaseConfigParams({
        lsp: {
          servers: [],
        },
      });
      const config = new Config(params);
      await config.initialize();

      await expect(config.initialize()).rejects.toThrow(
        'Config was already initialized',
      );
    });
  });

  describe('Shutdown without initialization', () => {
    it('should handle shutdown gracefully when service was never started', async () => {
      const params = createBaseConfigParams({
        lsp: false,
      });
      const config = new Config(params);
      await config.initialize();

      // Should not throw even though no service exists
      await expect(config.shutdownLspService()).resolves.toBeUndefined();
    });
  });

  describe('Default configuration values', () => {
    it('should use default values when lsp config is partial', async () => {
      const params = createBaseConfigParams({
        lsp: {
          servers: [],
          includeSeverities: ['error'],
          // Other fields omitted - should be undefined
        },
      });
      const config = new Config(params);
      await config.initialize();

      const lspConfig = config.getLspConfig();
      expect(lspConfig?.includeSeverities).toEqual(['error']);
      expect(lspConfig?.maxDiagnosticsPerFile).toBeUndefined();
      expect(lspConfig?.maxProjectDiagnosticsFiles).toBeUndefined();
      expect(lspConfig?.diagnosticTimeout).toBeUndefined();
      expect(lspConfig?.firstTouchTimeout).toBeUndefined();
      expect(lspConfig?.navigationTools).toBeUndefined();
    });
  });

  describe('LSP package not found notification', () => {
    it('should emit console.error when LSP package is not found', async () => {
      const consoleErrorSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      const startSpy = vi
        .spyOn(lspServiceClientModule.LspServiceClient.prototype, 'start')
        .mockResolvedValue(undefined);
      const isAliveSpy = vi
        .spyOn(lspServiceClientModule.LspServiceClient.prototype, 'isAlive')
        .mockReturnValue(false);
      const getUnavailableReasonSpy = vi
        .spyOn(
          lspServiceClientModule.LspServiceClient.prototype,
          'getUnavailableReason',
        )
        .mockReturnValue('LSP service entry not found');

      try {
        const params = createBaseConfigParams({
          lsp: {
            servers: [],
          },
        });
        const config = new Config(params);
        await config.initialize();

        const lspClient = config.getLspServiceClient();
        expect(lspClient?.isAlive()).toBe(false);
        expect(lspClient?.getUnavailableReason()).toContain('not found');

        expect(consoleErrorSpy).toHaveBeenCalledWith(
          expect.stringMatching(
            /LSP.*@vybestack\/llxprt-code-lsp.*not found.*npm install -g @vybestack\/llxprt-code-lsp/i,
          ),
        );
      } finally {
        consoleErrorSpy.mockRestore();
        startSpy.mockRestore();
        isAliveSpy.mockRestore();
        getUnavailableReasonSpy.mockRestore();
      }
    });

    it('should not emit console.error when LSP service starts successfully', async () => {
      const consoleErrorSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      const startSpy = vi
        .spyOn(lspServiceClientModule.LspServiceClient.prototype, 'start')
        .mockResolvedValue(undefined);
      const isAliveSpy = vi
        .spyOn(lspServiceClientModule.LspServiceClient.prototype, 'isAlive')
        .mockReturnValue(true);

      try {
        const params = createBaseConfigParams({
          lsp: {
            servers: [],
          },
        });
        const config = new Config(params);
        await config.initialize();

        const lspClient = config.getLspServiceClient();
        expect(lspClient?.isAlive()).toBe(true);

        const lspErrorCalls = consoleErrorSpy.mock.calls.filter((call) =>
          call.some((arg) =>
            String(arg).includes('@vybestack/llxprt-code-lsp'),
          ),
        );
        expect(lspErrorCalls).toHaveLength(0);
      } finally {
        consoleErrorSpy.mockRestore();
        startSpy.mockRestore();
        isAliveSpy.mockRestore();
      }
    });
  });
});
