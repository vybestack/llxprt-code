/**
 * LSP integration — extracted from Config.registerMcpNavigationTools() and Config.shutdownLspService().
 *
 * Handles MCP transport setup, tool registration, and cleanup for
 * LSP-provided navigation tools.
 */

import type { ToolRegistry } from '@vybestack/llxprt-code-tools';
import type { CallableTool, Tool, Part, FunctionCall } from '@google/genai';
import { debugLogger } from '../utils/debugLogger.js';
import type { LspConfig } from '@vybestack/llxprt-code-ide-integration';
import type { LspServiceClient } from '@vybestack/llxprt-code-ide-integration';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { Readable, Writable } from 'node:stream';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { DiscoveredMCPTool } from '@vybestack/llxprt-code-mcp';
import type { Config } from './config.js';

const MCP_NAVIGATION_REGISTRATION_TIMEOUT_MS = 2_000;

export interface LspState {
  lspConfig?: LspConfig;
  lspServiceClient?: LspServiceClient;
  lspMcpClient?: Client;
  lspMcpTransport?: Transport;
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
    const { LspServiceClient } = await import(
      '@vybestack/llxprt-code-ide-integration'
    );
    state.lspServiceClient = new LspServiceClient(
      state.lspConfig,
      host.getTargetDir(),
    );
    await state.lspServiceClient.start();

    if (state.lspServiceClient.isAlive() !== true) {
      const reason = state.lspServiceClient.getUnavailableReason();
      if (
        typeof reason === 'string' &&
        reason !== '' &&
        reason.includes('not found')
      ) {
        debugLogger.error(
          'LSP: @vybestack/llxprt-code-lsp package not found. Install with: npm install -g @vybestack/llxprt-code-lsp',
        );
      }
    }

    if (
      state.lspServiceClient.isAlive() &&
      state.lspConfig.navigationTools !== false
    ) {
      await registerAvailableNavigationTools(state, host);
    }
  } catch {
    // LSP service initialization failed - continue without LSP
    state.lspServiceClient = undefined;
  }
}

/**
 * Parse LSP config from ConfigParameters.lsp field.
 * Returns undefined if disabled, LspConfig if enabled.
 */
export function parseLspConfig(
  lsp: boolean | LspConfig | undefined,
): LspConfig | undefined {
  if (lsp === false || lsp === undefined) {
    return undefined;
  }
  if (lsp === true) {
    return { servers: [] };
  }
  return normalizeLspConfig(lsp);
}

/**
 * Normalize an externally-supplied LspConfig to ensure `servers` is present.
 * JSON-parsed configs may omit the field despite the declared type requiring it.
 */
function normalizeLspConfig(lsp: LspConfig): LspConfig {
  const raw = lsp as Partial<LspConfig>;
  return Array.isArray(raw.servers) ? lsp : { ...lsp, servers: [] };
}

async function registerAvailableNavigationTools(
  state: LspState,
  host: LspHost,
): Promise<void> {
  const streams = state.lspServiceClient?.getMcpTransportStreams();
  if (streams === undefined || streams === null) {
    return;
  }
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
              signal.reason ?? new Error('MCP navigation registration timeout'),
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

const LSP_NAVIGATION_REQUEST_TIMEOUT_MS = 250;

function createStreamTransport(streams: {
  readable: Readable;
  writable: Writable;
}): Transport {
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
        const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
        readBuffer += text;

        let newlineIndex = readBuffer.indexOf('\n');
        while (newlineIndex !== -1) {
          const line = readBuffer.slice(0, newlineIndex).trim();
          readBuffer = readBuffer.slice(newlineIndex + 1);
          if (line) {
            try {
              const message = JSON.parse(line) as JSONRPCMessage;
              transport.onmessage?.(message);
            } catch {
              // Ignore malformed transport messages.
            }
          }
          newlineIndex = readBuffer.indexOf('\n');
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

  return transport;
}

async function connectLspMcpClient(
  state: LspState,
  transport: Transport,
): Promise<Client | null> {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const client = new Client(
    { name: 'lsp-navigation-client', version: '1.0.0' },
    { capabilities: {} },
  );
  state.lspMcpClient = client;

  await client.connect(transport, {
    timeout: LSP_NAVIGATION_REQUEST_TIMEOUT_MS,
  });

  const capabilities = client.getServerCapabilities();
  if (capabilities?.tools === undefined) {
    return null;
  }
  return client;
}

async function fetchLspToolDefs(
  client: Client,
): Promise<
  Array<{ name: string; description?: string; inputSchema?: unknown }>
> {
  const toolsResponse = await client.listTools(undefined, {
    timeout: LSP_NAVIGATION_REQUEST_TIMEOUT_MS,
  });
  return extractToolDefs(toolsResponse);
}

function extractToolDefs(response: {
  tools?: Array<{ name: string; description?: string; inputSchema?: unknown }>;
}): Array<{ name: string; description?: string; inputSchema?: unknown }> {
  const tools = (
    response as {
      tools:
        | Array<{ name: string; description?: string; inputSchema?: unknown }>
        | undefined;
    }
  ).tools;
  return tools ?? [];
}

class LspNavigationCallableTool implements CallableTool {
  constructor(
    private readonly mcpClient: Client,
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
      { timeout: LSP_NAVIGATION_REQUEST_TIMEOUT_MS },
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

async function registerDiscoveredTools(
  client: Client,
  toolDefs: Array<{
    name: string;
    description?: string;
    inputSchema?: unknown;
  }>,
  registry: ToolRegistry,
  host: LspHost,
): Promise<void> {
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
}

/**
 * Register MCP navigation tools from LSP service streams.
 */
async function registerMcpNavigationTools(
  state: LspState,
  host: LspHost,
  streams: {
    readable: Readable;
    writable: Writable;
  },
): Promise<void> {
  const registry = host.getToolRegistry();

  const cleanup = async () => {
    registry.removeMcpToolsByServer('lsp-navigation');

    if (state.lspMcpClient) {
      try {
        await state.lspMcpClient.close();
      } catch {
        // Close errors are non-fatal during cleanup.
      }
    }
    state.lspMcpClient = undefined;

    if (state.lspMcpTransport) {
      try {
        await state.lspMcpTransport.close();
      } catch {
        // Close errors are non-fatal during cleanup.
      }
    }
    state.lspMcpTransport = undefined;
  };

  try {
    const transport = createStreamTransport(streams);
    state.lspMcpTransport = transport;

    const client = await connectLspMcpClient(state, transport);
    if (!client) {
      await cleanup();
      return;
    }

    const toolDefs = await fetchLspToolDefs(client);
    if (toolDefs.length === 0) {
      await cleanup();
      return;
    }

    await registerDiscoveredTools(client, toolDefs, registry, host);
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

  if (state.lspMcpClient) {
    try {
      await state.lspMcpClient.close();
    } catch {
      // Close errors are non-fatal
    }
  }
  state.lspMcpClient = undefined;

  if (state.lspMcpTransport) {
    try {
      await state.lspMcpTransport.close();
    } catch {
      // Close errors are non-fatal
    }
  }
  state.lspMcpTransport = undefined;

  if (state.lspServiceClient) {
    try {
      await state.lspServiceClient.shutdown();
    } catch {
      // Shutdown failure is non-fatal
    }
    state.lspServiceClient = undefined;
  }
}
