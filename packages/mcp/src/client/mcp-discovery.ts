/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type {
  GetPromptResult,
  Prompt,
  Resource,
} from '@modelcontextprotocol/sdk/types.js';
import {
  ListResourcesResultSchema,
  type Tool as McpTool,
} from '@modelcontextprotocol/sdk/types.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { MCPServerConfig } from '@vybestack/llxprt-code-core/config/configTypes.js';
import type { PromptRegistry } from '@vybestack/llxprt-code-core/prompts/prompt-registry.js';
import type { ToolRegistry } from '@vybestack/llxprt-code-tools';
import type { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import type { WorkspaceContext } from '@vybestack/llxprt-code-core/utils/workspaceContext.js';
import { getErrorMessage } from '@vybestack/llxprt-code-core/utils/errors.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { DiscoveredMCPTool } from './mcp-tool.js';
import { McpCallableTool } from './mcp-callable-tool.js';
import {
  isEnabled,
  populateMcpServerCommand,
} from './mcp-discovery-helpers.js';
import {
  MCPServerStatus,
  MCPDiscoveryState,
  setMCPDiscoveryState,
  updateMCPServerStatus,
} from './mcp-status.js';
import { MCP_DEFAULT_TIMEOUT_MSEC } from './mcp-transport.js';
import { connectToMcpServer } from './mcp-connection.js';
import { MCP_CAPABILITY_NOT_AUTHORIZED_MESSAGE } from './mcp-errors.js';

const debugLogger = DebugLogger.getLogger('llxprt:core:tools:mcp-client');

interface DiscoveryRequestOptions {
  timeout?: number;
  signal?: AbortSignal;
}

function buildSdkRequestOptions(
  options: DiscoveryRequestOptions | undefined,
): { timeout?: number; signal?: AbortSignal } | undefined {
  if (options === undefined) {
    return undefined;
  }
  const sdkOptions: { timeout?: number; signal?: AbortSignal } = {};
  if (options.timeout !== undefined) {
    sdkOptions.timeout = options.timeout;
  }
  if (options.signal !== undefined) {
    sdkOptions.signal = options.signal;
  }
  return sdkOptions;
}

/**
 * Discovers tools from all configured MCP servers and registers them with the tool registry.
 */
export async function discoverMcpTools(
  clientVersion: string,
  mcpServers: Record<string, MCPServerConfig>,
  mcpServerCommand: string | undefined,
  toolRegistry: ToolRegistry,
  promptRegistry: PromptRegistry,
  debugMode: boolean,
  workspaceContext: WorkspaceContext,
  cliConfig: Config,
): Promise<void> {
  setMCPDiscoveryState(MCPDiscoveryState.IN_PROGRESS);
  try {
    const servers = populateMcpServerCommand(mcpServers, mcpServerCommand);

    const discoveryPromises = Object.entries(servers).map(
      ([mcpServerName, mcpServerConfig]) =>
        connectAndDiscover(
          clientVersion,
          mcpServerName,
          mcpServerConfig,
          toolRegistry,
          promptRegistry,
          debugMode,
          workspaceContext,
          cliConfig,
        ),
    );
    await Promise.all(discoveryPromises);
  } finally {
    setMCPDiscoveryState(MCPDiscoveryState.COMPLETED);
  }
}

/**
 * Connects to an MCP server and discovers available tools, registering them with the tool registry.
 */
export async function connectAndDiscover(
  clientVersion: string,
  mcpServerName: string,
  mcpServerConfig: MCPServerConfig,
  toolRegistry: ToolRegistry,
  promptRegistry: PromptRegistry,
  debugMode: boolean,
  workspaceContext: WorkspaceContext,
  cliConfig: Config,
): Promise<void> {
  if (!cliConfig.isTrustedFolder()) {
    updateMCPServerStatus(mcpServerName, MCPServerStatus.DISCONNECTED);
    return;
  }

  updateMCPServerStatus(mcpServerName, MCPServerStatus.CONNECTING);

  let mcpClient: Client | undefined;
  try {
    mcpClient = await connectToMcpServer(
      clientVersion,
      mcpServerName,
      mcpServerConfig,
      debugMode,
      workspaceContext,
    );

    if (!cliConfig.isTrustedFolder()) {
      mcpClient.close().catch(() => {});
      mcpClient = undefined;
      updateMCPServerStatus(mcpServerName, MCPServerStatus.DISCONNECTED);
      return;
    }

    mcpClient.onerror = createServerErrorHandler(
      mcpServerName,
      mcpClient,
      toolRegistry,
      promptRegistry,
      () => {
        mcpClient = undefined;
      },
    );

    const authorized = await discoverAndAuthorize(
      mcpServerName,
      mcpServerConfig,
      mcpClient,
      toolRegistry,
      promptRegistry,
      cliConfig,
    );
    if (authorized === null) {
      return;
    }

    const published = publishDiscoveredCapabilities(
      mcpServerName,
      mcpClient,
      toolRegistry,
      promptRegistry,
      authorized.prompts,
      authorized.tools,
      cliConfig,
    );
    if (!published) {
      return;
    }
  } catch (error) {
    rollbackOnError(
      mcpServerName,
      mcpClient,
      toolRegistry,
      promptRegistry,
      error,
    );
  }
}

function cleanupServerArtifacts(
  mcpServerName: string,
  toolRegistry: ToolRegistry,
  promptRegistry: PromptRegistry,
): void {
  for (const [label, cleanup] of [
    ['tools', () => toolRegistry.removeMcpToolsByServer(mcpServerName)],
    ['prompts', () => promptRegistry.removePromptsByServer(mcpServerName)],
  ] as const) {
    try {
      cleanup();
    } catch (cleanupError) {
      debugLogger.error(
        `Error cleaning up ${label} for '${mcpServerName}': ${getErrorMessage(cleanupError)}`,
      );
    }
  }
}

function rollbackOnError(
  mcpServerName: string,
  mcpClient: Client | undefined,
  toolRegistry: ToolRegistry,
  promptRegistry: PromptRegistry,
  error: unknown,
): void {
  mcpClient?.close().catch(() => {});
  cleanupServerArtifacts(mcpServerName, toolRegistry, promptRegistry);
  debugLogger.error(
    `Error connecting to MCP server '${mcpServerName}': ${getErrorMessage(error)}`,
  );
  updateMCPServerStatus(mcpServerName, MCPServerStatus.DISCONNECTED);
}

function createServerErrorHandler(
  mcpServerName: string,
  client: Client,
  toolRegistry: ToolRegistry,
  promptRegistry: PromptRegistry,
  onClientCleared: () => void,
): (error: Error) => void {
  return (error) => {
    debugLogger.error(`MCP ERROR (${mcpServerName}):`, error.toString());
    cleanupServerArtifacts(mcpServerName, toolRegistry, promptRegistry);
    updateMCPServerStatus(mcpServerName, MCPServerStatus.DISCONNECTED);
    client.close().catch(() => {});
    onClientCleared();
  };
}

async function discoverAndAuthorize(
  mcpServerName: string,
  mcpServerConfig: MCPServerConfig,
  connectedClient: Client,
  toolRegistry: ToolRegistry,
  promptRegistry: PromptRegistry,
  cliConfig: Config,
): Promise<{ prompts: Prompt[]; tools: DiscoveredMCPTool[] } | null> {
  const isAuthorized = () => cliConfig.isTrustedFolder();
  const timeout = mcpServerConfig.timeout ?? MCP_DEFAULT_TIMEOUT_MSEC;

  const prompts = await discoverPrompts(mcpServerName, connectedClient, {
    timeout,
    isAuthorized,
  });
  if (!isAuthorized()) {
    rollbackAndDisconnect(
      mcpServerName,
      toolRegistry,
      promptRegistry,
      connectedClient,
    );
    return null;
  }
  const tools = await discoverTools(
    mcpServerName,
    mcpServerConfig,
    connectedClient,
    cliConfig,
    undefined,
    { timeout, isAuthorized },
  );
  if (!isAuthorized()) {
    rollbackAndDisconnect(
      mcpServerName,
      toolRegistry,
      promptRegistry,
      connectedClient,
    );
    return null;
  }
  if (prompts.length === 0 && tools.length === 0) {
    throw new Error('No prompts or tools found on the server.');
  }
  if (!isAuthorized()) {
    rollbackAndDisconnect(
      mcpServerName,
      toolRegistry,
      promptRegistry,
      connectedClient,
    );
    return null;
  }
  return { prompts, tools };
}

function publishDiscoveredCapabilities(
  mcpServerName: string,
  mcpClient: Client,
  toolRegistry: ToolRegistry,
  promptRegistry: PromptRegistry,
  prompts: readonly Prompt[],
  tools: readonly DiscoveredMCPTool[],
  cliConfig: Config,
): boolean {
  const isAuthorized = () => cliConfig.isTrustedFolder();
  const continuePublication = (): boolean => {
    if (isAuthorized()) {
      return true;
    }
    rollbackAndDisconnect(
      mcpServerName,
      toolRegistry,
      promptRegistry,
      mcpClient,
    );
    return false;
  };

  if (!continuePublication()) {
    return false;
  }
  updateMCPServerStatus(mcpServerName, MCPServerStatus.CONNECTED);
  if (!continuePublication()) {
    return false;
  }

  if (
    !registerMcpPrompts(
      mcpServerName,
      mcpClient,
      promptRegistry,
      prompts,
      isAuthorized,
    )
  ) {
    rollbackAndDisconnect(
      mcpServerName,
      toolRegistry,
      promptRegistry,
      mcpClient,
    );
    return false;
  }

  for (const tool of tools) {
    if (!continuePublication()) {
      return false;
    }
    toolRegistry.registerTool(tool);
    if (!continuePublication()) {
      return false;
    }
  }
  if (!continuePublication()) {
    return false;
  }
  toolRegistry.sortTools();
  return continuePublication();
}

function rollbackAndDisconnect(
  mcpServerName: string,
  toolRegistry: ToolRegistry,
  promptRegistry: PromptRegistry,
  client: Client,
): void {
  cleanupServerArtifacts(mcpServerName, toolRegistry, promptRegistry);
  client.close().catch(() => {});
  updateMCPServerStatus(mcpServerName, MCPServerStatus.DISCONNECTED);
}

function requireAuthorization(
  isAuthorized: (() => boolean) | undefined,
): () => boolean {
  if (!isAuthorized) {
    throw new Error(MCP_CAPABILITY_NOT_AUTHORIZED_MESSAGE);
  }
  return isAuthorized;
}

function readAuthorization(
  options:
    | {
        isAuthorized: () => boolean;
      }
    | undefined,
): (() => boolean) | undefined {
  return options?.isAuthorized;
}

/**
 * Discovers and sanitizes tools from a connected MCP client.
 */
export async function discoverTools(
  mcpServerName: string,
  mcpServerConfig: MCPServerConfig,
  mcpClient: Client,
  cliConfig: Config,
  messageBus: MessageBus | undefined,
  options: {
    timeout?: number;
    signal?: AbortSignal;
    isAuthorized: () => boolean;
  },
): Promise<DiscoveredMCPTool[]> {
  const debug = new DebugLogger('llxprt:mcp:discovery');
  const isAuthorized = requireAuthorization(readAuthorization(options));

  try {
    debug.log(`Starting tool discovery for server: ${mcpServerName}`);

    if (mcpClient.getServerCapabilities()?.tools == null) return [];

    if (!isAuthorized()) {
      debug.log(
        `Tool discovery denied for ${mcpServerName}: authorization not granted`,
      );
      return [];
    }

    const response = await mcpClient.listTools(
      {},
      buildSdkRequestOptions(options),
    );

    if (!isAuthorized()) {
      debug.log(
        `Tool discovery discarded for ${mcpServerName}: authorization revoked after listTools`,
      );
      return [];
    }

    debug.log(`Found ${response.tools.length} tools for ${mcpServerName}`);
    const discoveredTools: DiscoveredMCPTool[] = [];
    for (const toolDef of response.tools) {
      const tool = processToolDefinition(
        toolDef,
        mcpServerName,
        mcpServerConfig,
        mcpClient,
        cliConfig,
        debug,
        isAuthorized,
      );
      if (tool) {
        discoveredTools.push(tool);
      }
    }
    debug.log(
      `Returning ${discoveredTools.length} discovered tools for ${mcpServerName}`,
    );
    return discoveredTools;
  } catch (error) {
    if (error instanceof Error && !error.message.includes('Method not found')) {
      debugLogger.error(
        `Error discovering tools from ${mcpServerName}: ${getErrorMessage(error)}`,
      );
    }
    return [];
  }
}

function processToolDefinition(
  toolDef: McpTool,
  mcpServerName: string,
  mcpServerConfig: MCPServerConfig,
  mcpClient: Client,
  cliConfig: Config,
  debug: DebugLogger,
  isAuthorized: () => boolean,
): DiscoveredMCPTool | undefined {
  try {
    debug.log(`Processing tool: ${toolDef.name}`);

    if (!isEnabled(toolDef, mcpServerName, mcpServerConfig)) {
      debug.log(`Tool ${toolDef.name} is disabled by configuration`);
      return undefined;
    }

    const mcpCallableTool = new McpCallableTool(
      mcpClient,
      toolDef,
      mcpServerConfig.timeout ?? MCP_DEFAULT_TIMEOUT_MSEC,
      isAuthorized,
    );
    debug.log(`Created McpCallableTool for ${toolDef.name}`);

    return new DiscoveredMCPTool(
      mcpCallableTool,
      mcpServerName,
      toolDef.name,
      toolDef.description ?? '',
      toolDef.inputSchema,
      mcpServerConfig.trust,
      undefined,
      cliConfig,
    );
  } catch (error) {
    debugLogger.error(
      `Error discovering tool: '${
        toolDef.name
      }' from MCP server '${mcpServerName}': ${(error as Error).message}`,
    );
    return undefined;
  }
}

interface ResourceDiscoveryOptions {
  timeout?: number;
  signal?: AbortSignal;
  isAuthorized?: () => boolean;
}

export async function discoverResources(
  mcpServerName: string,
  mcpClient: Client,
  options?: ResourceDiscoveryOptions,
): Promise<Resource[]> {
  if (mcpClient.getServerCapabilities()?.resources == null) {
    return [];
  }
  const isAuthorized = requireAuthorization(options?.isAuthorized);
  if (!isAuthorized()) {
    return [];
  }
  const requestOptions = buildSdkRequestOptions(options);
  return listResources(mcpServerName, mcpClient, isAuthorized, requestOptions);
}

async function listResources(
  mcpServerName: string,
  mcpClient: Client,
  isAuthorized: () => boolean,
  options?: { timeout?: number; signal?: AbortSignal },
): Promise<Resource[]> {
  const resources: Resource[] = [];
  let cursor: string | undefined;
  try {
    do {
      if (!isAuthorized()) {
        return [];
      }
      const response = await mcpClient.request(
        {
          method: 'resources/list',
          params: cursor ? { cursor } : {},
        },
        ListResourcesResultSchema,
        options,
      );
      if (!isAuthorized()) {
        return [];
      }
      resources.push(...response.resources);
      cursor = response.nextCursor ?? undefined;
    } while (cursor);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Method not found')) {
      return [];
    }
    debugLogger.error(
      `Error discovering resources from ${mcpServerName}: ${getErrorMessage(error)}`,
    );
    throw error;
  }
  return resources;
}

interface PromptDiscoveryOptions {
  timeout?: number;
  signal?: AbortSignal;
  isAuthorized?: () => boolean;
}

/**
 * Discovers and logs prompts from a connected MCP client.
 */
export async function discoverPrompts(
  mcpServerName: string,
  mcpClient: Client,
  options?: PromptDiscoveryOptions,
): Promise<Prompt[]> {
  const isAuthorized = requireAuthorization(options?.isAuthorized);
  try {
    if (mcpClient.getServerCapabilities()?.prompts == null) return [];

    if (!isAuthorized()) {
      return [];
    }

    const requestOptions = buildSdkRequestOptions(options);

    const response = await mcpClient.listPrompts({}, requestOptions);

    if (!isAuthorized()) {
      return [];
    }

    return response.prompts;
  } catch (error) {
    if (error instanceof Error && !error.message.includes('Method not found')) {
      debugLogger.error(
        `Error discovering prompts from ${mcpServerName}: ${getErrorMessage(error)}`,
      );
    }
    return [];
  }
}

export function registerMcpPrompts(
  mcpServerName: string,
  mcpClient: Client,
  promptRegistry: PromptRegistry,
  prompts: readonly Prompt[],
  isAuthorized: () => boolean,
): boolean {
  for (const prompt of prompts) {
    if (!isAuthorized()) {
      return false;
    }
    promptRegistry.registerPrompt({
      ...prompt,
      serverName: mcpServerName,
      invoke: (params: Record<string, unknown>) =>
        invokeMcpPrompt(
          mcpServerName,
          mcpClient,
          prompt.name,
          params,
          isAuthorized,
        ),
    });
    if (!isAuthorized()) {
      return false;
    }
  }
  return true;
}

/**
 * Invokes a prompt on a connected MCP client.
 */
export async function invokeMcpPrompt(
  mcpServerName: string,
  mcpClient: Client,
  promptName: string,
  promptParams: Record<string, unknown>,
  isAuthorized: () => boolean,
): Promise<GetPromptResult> {
  const checkAuthorized = requireAuthorization(isAuthorized);
  try {
    if (!checkAuthorized()) {
      throw new Error(MCP_CAPABILITY_NOT_AUTHORIZED_MESSAGE);
    }
    const sanitizedParams: Record<string, string> = {};
    for (const [key, value] of Object.entries(promptParams)) {
      if (value !== undefined && value !== null) {
        sanitizedParams[key] = String(value);
      }
    }

    const response = await mcpClient.getPrompt({
      name: promptName,
      arguments: sanitizedParams,
    });
    if (!checkAuthorized()) {
      throw new Error(MCP_CAPABILITY_NOT_AUTHORIZED_MESSAGE);
    }

    return response;
  } catch (error) {
    if (error instanceof Error && !error.message.includes('Method not found')) {
      debugLogger.error(
        `Error invoking prompt '${promptName}' from ${mcpServerName} ${promptParams}: ${getErrorMessage(error)}`,
      );
    }
    throw error;
  }
}
