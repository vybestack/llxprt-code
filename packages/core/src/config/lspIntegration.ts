/**
 * LSP integration — extracted from Config.registerMcpNavigationTools() and Config.shutdownLspService().
 *
 * Handles MCP transport setup, tool registration, and cleanup for
 * LSP-provided navigation tools.
 */

import type { ToolRegistry } from '../tools/tool-registry.js';
import type { CallableTool, Tool, Part, FunctionCall } from '@google/genai';
import type { Config } from './config.js';
import { debugLogger } from '../utils/debugLogger.js';

const MCP_NAVIGATION_REGISTRATION_TIMEOUT_MS = 2_000;

export interface LspState {
  lspConfig?: import('../lsp/types.js').LspConfig;
  lspServiceClient?: import('../lsp/lsp-service-client.js').LspServiceClient;
  lspMcpClient?: import('@modelcontextprotocol/sdk/client/index.js').Client;
  lspMcpTransport?: import('@modelcontextprotocol/sdk/shared/transport.js').Transport;
}

/** Narrow interface for LSP integration — avoids full Config dependency */
export interface LspHost {
  getTargetDir(): string;
  getToolRegistry(): ToolRegistry;
}

/**
 * Initialize LSP service client and register MCP navigation tools.
 * Non-fatal: any failure disables LSP without crashing.
 */
export async function initializeLsp(
  state: LspState,
  host: LspHost,
): Promise<void> {
  if (state.lspConfig === undefined) {
    return;
  }

  try {
    const { LspServiceClient } = await import('../lsp/lsp-service-client.js');
    state.lspServiceClient = new LspServiceClient(
      state.lspConfig,
      host.getTargetDir(),
    );
    await state.lspServiceClient.start();

    if (!state.lspServiceClient.isAlive()) {
      const reason = state.lspServiceClient.getUnavailableReason();
      if (reason?.includes('not found')) {
        debugLogger.error(
          'LSP: @vybestack/llxprt-code-lsp package not found. Install with: npm install -g @vybestack/llxprt-code-lsp',
        );
      }
    }

    if (
      state.lspServiceClient.isAlive() &&
      state.lspConfig.navigationTools !== false
    ) {
      const streams = state.lspServiceClient.getMcpTransportStreams();
      if (streams != null) {
        try {
          await Promise.race([
            registerMcpNavigationTools(state, host, streams),
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
          ]);
        } catch {
          state.lspMcpClient = undefined;
          state.lspMcpTransport = undefined;
        }
      }
    }
  } catch (_error) {
    state.lspServiceClient = undefined;
  }
}

/**
 * Parse LSP config from ConfigParameters.lsp field.
 * Returns undefined if disabled, LspConfig if enabled.
 */
export function parseLspConfig(
  lsp: boolean | import('../lsp/types.js').LspConfig | undefined,
): import('../lsp/types.js').LspConfig | undefined {
  if (lsp === false || lsp === undefined) {
    return undefined;
  }
  if (lsp === true) {
    return { servers: [] };
  }
  return lsp.servers === undefined ? { ...lsp, servers: [] } : lsp;
}

/**
 * Register MCP navigation tools from LSP service streams.
 */
async function registerMcpNavigationTools(
  state: LspState,
  host: LspHost,
  streams: {
    readable: import('node:stream').Readable;
    writable: import('node:stream').Writable;
  },
): Promise<void> {
  type JSONRPCMessage =
    import('@modelcontextprotocol/sdk/types.js').JSONRPCMessage;
  type Transport =
    import('@modelcontextprotocol/sdk/shared/transport.js').Transport;

  const registry = host.getToolRegistry();

  const cleanup = async () => {
    registry.removeMcpToolsByServer('lsp-navigation');

    if (state.lspMcpClient != null) {
      try {
        await state.lspMcpClient.close();
      } catch {
        // Close errors are non-fatal during cleanup.
      }
    }
    state.lspMcpClient = undefined;

    if (state.lspMcpTransport != null) {
      try {
        await state.lspMcpTransport.close();
      } catch {
        // Close errors are non-fatal during cleanup.
      }
    }
    state.lspMcpTransport = undefined;
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

    state.lspMcpTransport = transport;

    const client = new Client(
      {
        name: 'lsp-navigation-client',
        version: '1.0.0',
      },
      { capabilities: {} },
    );
    state.lspMcpClient = client;

    const requestTimeoutMs = 250;
    await client.connect(transport, { timeout: requestTimeoutMs });

    const capabilities = client.getServerCapabilities?.();
    if (capabilities?.tools == null) {
      await cleanup();
      return;
    }

    const toolsResponse = await client.listTools(undefined, {
      timeout: requestTimeoutMs,
    });
    const toolDefs = toolsResponse.tools ?? [];
    if (toolDefs.length === 0) {
      await cleanup();
      return;
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
        // LspHost is a strict subset of Config; the runtime value is always a
        // full Config instance, but this module only depends on the narrow interface.
        host as unknown as Config,
      );

      registry.registerTool(discoveredTool);
    }

    registry.sortTools();
  } catch {
    await cleanup();
  }
}

/**
 * Shutdown LSP service and clean up MCP resources.
 */
export async function shutdownLsp(
  state: LspState,
  registry: ToolRegistry,
): Promise<void> {
  registry.removeMcpToolsByServer('lsp-navigation');

  if (state.lspMcpClient != null) {
    try {
      await state.lspMcpClient.close();
    } catch {
      // Close errors are non-fatal
    }
  }
  state.lspMcpClient = undefined;

  if (state.lspMcpTransport != null) {
    try {
      await state.lspMcpTransport.close();
    } catch {
      // Close errors are non-fatal
    }
  }
  state.lspMcpTransport = undefined;

  if (state.lspServiceClient != null) {
    try {
      await state.lspServiceClient.shutdown();
    } catch {
      // Shutdown failure is non-fatal
    }
    state.lspServiceClient = undefined;
  }
}
