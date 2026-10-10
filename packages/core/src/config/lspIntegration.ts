/**
 * LSP navigation transport integration for the explicit workspace owner.
 *
 * Handles MCP transport setup, tool registration, and cleanup for
 * LSP-provided navigation tools.
 */

import type {
  McpToolPublication,
  CallableTool,
  ContentPart,
} from '@vybestack/llxprt-code-tools';
import type { ToolCallRequest } from '../llm-types/toolCall.js';
import { debugLogger } from '../utils/debugLogger.js';
import type { LspConfig } from '@vybestack/llxprt-code-ide-integration';
import type { LspServiceClient } from '@vybestack/llxprt-code-ide-integration';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { Readable, Writable } from 'node:stream';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { DiscoveredMCPTool } from '@vybestack/llxprt-code-mcp';
import type { McpApprovalPolicy } from '@vybestack/llxprt-code-mcp';

const MCP_NAVIGATION_REGISTRATION_TIMEOUT_MS = 2_000;

export interface LspState {
  lspConfig?: LspConfig;
  lspServiceClient?: LspServiceClient;
  lspMcpClient?: Client;
  lspMcpTransport?: Transport;
}

/** Narrow interface for LSP integration — avoids full Config dependency */
export interface LspHost {
  isTrustedFolder(): boolean;
  getTargetDir(): string;
  readonly registration: Pick<
    McpToolPublication,
    'registerTool' | 'sortTools' | 'removeMcpToolsByServer'
  >;
  assertActive(): void;
  assertInvocation(): void;
  acceptInvocation<T>(operation: Promise<T>): Promise<T>;
}

/**
 * Initialize LSP service client and register MCP navigation tools.
 * Unavailable external service startup disables LSP; activation and cleanup errors propagate.
 */
export async function initializeLsp(
  state: LspState,
  host: LspHost,
  approvalPolicy: McpApprovalPolicy,
): Promise<void> {
  if (state.lspConfig === undefined) {
    return;
  }

  const { LspServiceClient } = await import(
    '@vybestack/llxprt-code-ide-integration'
  );
  state.lspServiceClient ??= new LspServiceClient(
    state.lspConfig,
    host.getTargetDir(),
  );
  await state.lspServiceClient.start();
  host.assertActive();

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
    await registerAvailableNavigationTools(state, host, approvalPolicy);
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
  return Array.isArray(lsp.servers)
    ? structuredClone(lsp)
    : { ...structuredClone(lsp), servers: [] };
}

async function registerAvailableNavigationTools(
  state: LspState,
  host: LspHost,
  approvalPolicy: McpApprovalPolicy,
): Promise<void> {
  const streams = state.lspServiceClient?.getMcpTransportStreams();
  if (streams === undefined || streams === null) {
    return;
  }
  const abortController = new AbortController();
  const timeout = setTimeout(() => {
    abortController.abort(new Error('MCP navigation registration timeout'));
  }, MCP_NAVIGATION_REGISTRATION_TIMEOUT_MS);
  try {
    await registerMcpNavigationTools(
      state,
      host,
      approvalPolicy,
      streams,
      abortController.signal,
    );
  } finally {
    clearTimeout(timeout);
  }
}

function throwIfNavigationRegistrationAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new Error('MCP navigation registration aborted');
  }
}

export async function cleanupLspMcpResources(
  state: LspState,
  registry: Pick<McpToolPublication, 'removeMcpToolsByServer'>,
): Promise<void> {
  const client = state.lspMcpClient;
  const transport = state.lspMcpTransport;
  state.lspMcpClient = undefined;
  state.lspMcpTransport = undefined;
  const failures: unknown[] = [];
  for (const close of [
    () => registry.removeMcpToolsByServer('lsp-navigation'),
    () => client?.close(),
    () => transport?.close(),
  ]) {
    try {
      await Promise.resolve(close());
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0)
    throw new AggregateError(failures, 'LSP navigation cleanup failed');
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
    private readonly assertActive: () => void,
    private readonly accept: LspHost['acceptInvocation'],
    private readonly toolDef: {
      name: string;
      description?: string;
      inputSchema?: unknown;
    },
  ) {}

  async tool(): Promise<Awaited<ReturnType<CallableTool['tool']>>> {
    return [
      {
        name: this.toolDef.name,
        description: this.toolDef.description,
        parametersJsonSchema: this.toolDef.inputSchema,
      },
    ];
  }

  async callTool(functionCalls: ToolCallRequest[]): Promise<ContentPart[]> {
    if (functionCalls.length !== 1) {
      throw new Error(
        'LspNavigationCallableTool only supports single function call',
      );
    }
    this.assertActive();
    const call = functionCalls[0];
    const result = await this.accept(
      this.mcpClient.callTool(
        {
          name: call.name,
          arguments: call.args,
        },
        undefined,
        { timeout: LSP_NAVIGATION_REQUEST_TIMEOUT_MS },
      ),
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
  registry: Pick<
    McpToolPublication,
    'registerTool' | 'sortTools' | 'removeMcpToolsByServer'
  >,
  host: LspHost,
  approvalPolicy: McpApprovalPolicy,
): Promise<void> {
  for (const toolDef of toolDefs) {
    const callableTool = new LspNavigationCallableTool(
      client,
      () => host.assertInvocation(),
      (operation) => host.acceptInvocation(operation),
      toolDef,
    );

    const discoveredTool = new DiscoveredMCPTool(
      approvalPolicy,
      callableTool,
      'lsp-navigation',
      toolDef.name,
      toolDef.description ?? '',
      toolDef.inputSchema ?? { type: 'object', properties: {} },
      true,
      undefined,
      host,
    );

    host.assertActive();
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
  approvalPolicy: McpApprovalPolicy,
  streams: {
    readable: Readable;
    writable: Writable;
  },
  signal: AbortSignal,
): Promise<void> {
  const registry = host.registration;

  try {
    const transport = createStreamTransport(streams);
    state.lspMcpTransport = transport;
    throwIfNavigationRegistrationAborted(signal);

    const client = await connectLspMcpClient(state, transport);
    throwIfNavigationRegistrationAborted(signal);
    if (!client) {
      await cleanupLspMcpResources(state, registry);
      return;
    }

    const toolDefs = await fetchLspToolDefs(client);
    throwIfNavigationRegistrationAborted(signal);
    if (toolDefs.length === 0) {
      await cleanupLspMcpResources(state, registry);
      return;
    }

    await registerDiscoveredTools(
      client,
      toolDefs,
      registry,
      host,
      approvalPolicy,
    );
    throwIfNavigationRegistrationAborted(signal);
  } catch (error) {
    try {
      await cleanupLspMcpResources(state, registry);
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'MCP navigation registration failed',
      );
    }
    throw error;
  }
}

/**
 * Shutdown LSP service and clean up MCP resources.
 */
export async function shutdownLsp(
  state: LspState,
  registry: Pick<McpToolPublication, 'removeMcpToolsByServer'>,
  stopService = true,
): Promise<void> {
  const service = state.lspServiceClient;
  state.lspServiceClient = undefined;
  const failures: unknown[] = [];
  try {
    await cleanupLspMcpResources(state, registry);
  } catch (error) {
    failures.push(error);
  }
  if (stopService) {
    try {
      await service?.shutdown();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0)
    throw new AggregateError(failures, 'LSP shutdown failed');
}
