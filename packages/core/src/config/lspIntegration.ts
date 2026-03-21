/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * LSP integration module for Config class.
 * Handles initialization, navigation tool registration, and shutdown of LSP services.
 *
 * @plan PLAN-20250212-LSP.P33
 * @requirement REQ-CFG-010, REQ-CFG-015, REQ-CFG-020, REQ-NAV-055, REQ-GRACE-050
 */

import type { CallableTool, FunctionCall, Part, Tool } from '@google/genai';
import type { ToolRegistry } from '../tools/tool-registry.js';
import { debugLogger } from '../utils/debugLogger.js';

const MCP_NAVIGATION_REGISTRATION_TIMEOUT_MS = 2_000;

/**
 * State container for LSP service references.
 */
export interface LspState {
  lspServiceClient?: import('../lsp/lsp-service-client.js').LspServiceClient;
  lspMcpClient?: import('@modelcontextprotocol/sdk/client/index.js').Client;
  lspMcpTransport?: import('@modelcontextprotocol/sdk/shared/transport.js').Transport;
}

/**
 * Initialize LSP service client and optionally register navigation tools.
 *
 * @plan PLAN-20250212-LSP.P33
 * @requirement REQ-CFG-010, REQ-CFG-015, REQ-CFG-020, REQ-NAV-055
 * @param lspConfig - LSP configuration
 * @param targetDir - Target directory for LSP service
 * @param toolRegistry - Tool registry to register navigation tools
 * @param config - Config instance (needed by DiscoveredMCPTool constructor)
 * @returns Promise resolving to LspState with client/transport references
 */
export async function initializeLsp(
  lspConfig: import('../lsp/types.js').LspConfig,
  targetDir: string,
  toolRegistry: ToolRegistry,
  config: unknown,
): Promise<LspState> {
  const state: LspState = {};

  try {
    const { LspServiceClient } = await import('../lsp/lsp-service-client.js');
    state.lspServiceClient = new LspServiceClient(lspConfig, targetDir);
    await state.lspServiceClient.start();

    if (!state.lspServiceClient.isAlive()) {
      const reason = state.lspServiceClient.getUnavailableReason();
      if (reason?.includes('not found')) {
        debugLogger.error(
          'LSP: @vybestack/llxprt-code-lsp package not found. Install with: npm install -g @vybestack/llxprt-code-lsp',
        );
      }
    }

    /**
     * @plan PLAN-20250212-LSP.P33
     * @requirement REQ-NAV-055, REQ-CFG-070
     * Register MCP navigation tools only if service started successfully and navigationTools not disabled
     */
    if (
      state.lspServiceClient.isAlive() &&
      lspConfig.navigationTools !== false
    ) {
      const streams = state.lspServiceClient.getMcpTransportStreams();
      if (streams) {
        try {
          await Promise.race([
            registerMcpNavigationTools(streams, toolRegistry, config),
            new Promise<void>((_, reject) => {
              const signal = AbortSignal.timeout(
                MCP_NAVIGATION_REGISTRATION_TIMEOUT_MS,
              );
              signal.addEventListener(
                'abort',
                () =>
                  reject(
                    signal.reason ??
                      new Error('MCP navigation registration timeout'),
                  ),
                { once: true },
              );
            }),
          ]).then((result) => {
            if (result) {
              state.lspMcpClient = result.lspMcpClient;
              state.lspMcpTransport = result.lspMcpTransport;
            }
          });
        } catch {
          // MCP navigation registration timed out or failed — non-fatal (REQ-GRACE-050)
          state.lspMcpClient = undefined;
          state.lspMcpTransport = undefined;
        }
      }
    }
  } catch (_error) {
    // LSP startup failure is non-fatal (REQ-GRACE-050)
    // Service remains undefined, tools will not use it
    state.lspServiceClient = undefined;
  }

  return state;
}

/**
 * Register MCP navigation tools from LSP service.
 *
 * @plan PLAN-20250212-LSP.P33
 * @requirement REQ-NAV-055, REQ-CFG-070
 * @param streams - Readable/writable streams for MCP transport
 * @param toolRegistry - Tool registry to register navigation tools
 * @param config - Config instance (needed by DiscoveredMCPTool constructor)
 * @returns Promise resolving to client/transport references (or undefined if cleaned up)
 */
export async function registerMcpNavigationTools(
  streams: {
    readable: import('node:stream').Readable;
    writable: import('node:stream').Writable;
  },
  toolRegistry: ToolRegistry,
  config: unknown,
): Promise<{
  lspMcpClient?: import('@modelcontextprotocol/sdk/client/index.js').Client;
  lspMcpTransport?: import('@modelcontextprotocol/sdk/shared/transport.js').Transport;
}> {
  type JSONRPCMessage =
    import('@modelcontextprotocol/sdk/types.js').JSONRPCMessage;
  type Transport =
    import('@modelcontextprotocol/sdk/shared/transport.js').Transport;

  let lspMcpClient:
    | import('@modelcontextprotocol/sdk/client/index.js').Client
    | undefined;
  let lspMcpTransport:
    | import('@modelcontextprotocol/sdk/shared/transport.js').Transport
    | undefined;

  const cleanup = async () => {
    toolRegistry.removeMcpToolsByServer('lsp-navigation');

    if (lspMcpClient) {
      try {
        await lspMcpClient.close();
      } catch {
        // Close errors are non-fatal during cleanup.
      }
    }
    lspMcpClient = undefined;

    if (lspMcpTransport) {
      try {
        await lspMcpTransport.close();
      } catch {
        // Close errors are non-fatal during cleanup.
      }
    }
    lspMcpTransport = undefined;
  };

  try {
    const { Client } = await import(
      '@modelcontextprotocol/sdk/client/index.js'
    );
    const { DiscoveredMCPTool } = await import('../tools/mcp-tool.js');

    let readBuffer = '';
    let started = false;
    const transport: Transport = {
      onclose: undefined,
      onerror: undefined,
      onmessage: undefined,
      start: async () => {
        if (started) {
          return;
        }
        started = true;

        const onData = (chunk: Buffer | string) => {
          const text =
            typeof chunk === 'string' ? chunk : chunk.toString('utf8');
          readBuffer += text;

          while (true) {
            const newlineIndex = readBuffer.indexOf('\n');
            if (newlineIndex === -1) {
              break;
            }

            const line = readBuffer.slice(0, newlineIndex).trim();
            readBuffer = readBuffer.slice(newlineIndex + 1);
            if (!line) {
              continue;
            }

            try {
              const message = JSON.parse(line) as JSONRPCMessage;
              transport.onmessage?.(message);
            } catch {
              // Ignore malformed transport messages.
            }
          }
        };

        const onError = (error: Error) => {
          transport.onerror?.(error);
        };

        const onClose = () => {
          transport.onclose?.();
        };

        streams.readable.on('data', onData);
        streams.readable.on('error', onError);
        streams.readable.on('close', onClose);
        streams.readable.on('end', onClose);

        const closeTransport = async () => {
          if (!started) {
            return;
          }
          started = false;
          streams.readable.off('data', onData);
          streams.readable.off('error', onError);
          streams.readable.off('close', onClose);
          streams.readable.off('end', onClose);
          streams.writable.end();
        };

        transport.close = closeTransport;
      },
      send: async (message: JSONRPCMessage) => {
        streams.writable.write(`${JSON.stringify(message)}\n`);
      },
      close: async () => {
        if (!started) {
          return;
        }
        started = false;
        streams.writable.end();
      },
    };

    lspMcpTransport = transport;

    const client = new Client(
      {
        name: 'lsp-navigation-client',
        version: '1.0.0',
      },
      { capabilities: {} },
    );
    lspMcpClient = client;

    const requestTimeoutMs = 250;
    await client.connect(transport, { timeout: requestTimeoutMs });

    const capabilities = client.getServerCapabilities?.();
    if (!capabilities?.tools) {
      await cleanup();
      return {};
    }

    const toolsResponse = await client.listTools(undefined, {
      timeout: requestTimeoutMs,
    });
    const toolDefs = toolsResponse.tools ?? [];
    if (toolDefs.length === 0) {
      await cleanup();
      return {};
    }

    class LspNavigationCallableTool implements CallableTool {
      constructor(
        private readonly mcpClient: import('@modelcontextprotocol/sdk/client/index.js').Client,
        private readonly toolDef: {
          name: string;
          description?: string;
          inputSchema?: unknown;
        },
      ) {}

      async tool(): Promise<Tool> {
        return {
          functionDeclarations: [
            {
              name: this.toolDef.name,
              description: this.toolDef.description,
              parametersJsonSchema: this.toolDef.inputSchema,
            },
          ],
        };
      }

      async callTool(functionCalls: FunctionCall[]): Promise<Part[]> {
        if (functionCalls.length !== 1) {
          throw new Error(
            'LspNavigationCallableTool only supports single function call',
          );
        }
        const call = functionCalls[0];
        const result = await this.mcpClient.callTool(
          {
            name: call.name ?? this.toolDef.name,
            arguments: call.args ?? {},
          },
          undefined,
          { timeout: requestTimeoutMs },
        );

        return [
          {
            functionResponse: {
              name: call.name,
              response: result,
            },
          },
        ];
      }
    }

    for (const toolDef of toolDefs) {
      const callableTool = new LspNavigationCallableTool(client, toolDef);

      const discoveredTool = new DiscoveredMCPTool(
        callableTool,
        'lsp-navigation',
        toolDef.name,
        toolDef.description ?? '',
        toolDef.inputSchema ?? { type: 'object', properties: {} },
        true,
        undefined,
        config as import('../config/config.js').Config | undefined,
      );

      toolRegistry.registerTool(discoveredTool);
    }

    toolRegistry.sortTools();

    return { lspMcpClient, lspMcpTransport };
  } catch {
    await cleanup();
    return {};
  }
}

/**
 * Shutdown LSP service and clean up MCP navigation tools.
 *
 * @plan PLAN-20250212-LSP.P33
 * @requirement REQ-CFG-010, REQ-CFG-015
 * @param state - LSP state containing client/transport references
 * @param toolRegistry - Tool registry to remove navigation tools
 */
export async function shutdownLspService(
  state: LspState,
  toolRegistry: ToolRegistry,
): Promise<void> {
  toolRegistry.removeMcpToolsByServer('lsp-navigation');

  if (state.lspMcpClient) {
    try {
      await state.lspMcpClient.close();
    } catch {
      // Close errors are non-fatal
    }
  }

  if (state.lspMcpTransport) {
    try {
      await state.lspMcpTransport.close();
    } catch {
      // Close errors are non-fatal
    }
  }

  if (state.lspServiceClient) {
    try {
      await state.lspServiceClient.shutdown();
    } catch {
      // Shutdown failure is non-fatal
    }
  }
}
