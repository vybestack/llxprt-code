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

const debugLogger = DebugLogger.getLogger('llxprt:core:tools:mcp-client');

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

    mcpClient.onerror = (error) => {
      debugLogger.error(`MCP ERROR (${mcpServerName}):`, error.toString());
      if (!mcpClient) return;
      toolRegistry.removeMcpToolsByServer(mcpServerName);
      promptRegistry.removePromptsByServer(mcpServerName);
      updateMCPServerStatus(mcpServerName, MCPServerStatus.DISCONNECTED);
      mcpClient.close().catch(() => {});
      mcpClient = undefined;
    };

    const prompts = await discoverPrompts(
      mcpServerName,
      mcpClient,
      promptRegistry,
    );
    const tools = await discoverTools(
      mcpServerName,
      mcpServerConfig,
      mcpClient,
      cliConfig,
      undefined,
      { timeout: mcpServerConfig.timeout ?? MCP_DEFAULT_TIMEOUT_MSEC },
    );

    if (prompts.length === 0 && tools.length === 0) {
      throw new Error('No prompts or tools found on the server.');
    }

    updateMCPServerStatus(mcpServerName, MCPServerStatus.CONNECTED);

    for (const tool of tools) {
      toolRegistry.registerTool(tool);
    }
    toolRegistry.sortTools();
  } catch (error) {
    if (mcpClient) {
      mcpClient.close().catch(() => {});
    }
    debugLogger.error(
      `Error connecting to MCP server '${mcpServerName}': ${getErrorMessage(error)}`,
    );
    updateMCPServerStatus(mcpServerName, MCPServerStatus.DISCONNECTED);
  }
}

/**
 * Discovers and sanitizes tools from a connected MCP client.
 */
export async function discoverTools(
  mcpServerName: string,
  mcpServerConfig: MCPServerConfig,
  mcpClient: Client,
  cliConfig: Config,
  messageBus?: MessageBus,
  options?: { timeout?: number; signal?: AbortSignal },
): Promise<DiscoveredMCPTool[]> {
  const debug = new DebugLogger('llxprt:mcp:discovery');

  try {
    debug.log(`Starting tool discovery for server: ${mcpServerName}`);

    if (mcpClient.getServerCapabilities()?.tools == null) return [];

    const response = await mcpClient.listTools({}, options);
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

export async function discoverResources(
  mcpServerName: string,
  mcpClient: Client,
): Promise<Resource[]> {
  if (mcpClient.getServerCapabilities()?.resources == null) {
    return [];
  }

  const resources = await listResources(mcpServerName, mcpClient);
  return resources;
}

async function listResources(
  mcpServerName: string,
  mcpClient: Client,
): Promise<Resource[]> {
  const resources: Resource[] = [];
  let cursor: string | undefined;
  try {
    do {
      const response = await mcpClient.request(
        {
          method: 'resources/list',
          params: cursor ? { cursor } : {},
        },
        ListResourcesResultSchema,
      );
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

/**
 * Discovers and logs prompts from a connected MCP client.
 */
export async function discoverPrompts(
  mcpServerName: string,
  mcpClient: Client,
  promptRegistry: PromptRegistry,
): Promise<Prompt[]> {
  try {
    if (mcpClient.getServerCapabilities()?.prompts == null) return [];

    const response = await mcpClient.listPrompts({});

    for (const prompt of response.prompts) {
      promptRegistry.registerPrompt({
        ...prompt,
        serverName: mcpServerName,
        invoke: (params: Record<string, unknown>) =>
          invokeMcpPrompt(mcpServerName, mcpClient, prompt.name, params),
      });
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

/**
 * Invokes a prompt on a connected MCP client.
 */
export async function invokeMcpPrompt(
  mcpServerName: string,
  mcpClient: Client,
  promptName: string,
  promptParams: Record<string, unknown>,
): Promise<GetPromptResult> {
  try {
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
