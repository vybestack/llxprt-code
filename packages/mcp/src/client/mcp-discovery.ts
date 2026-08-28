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
import type { MCPServerConfig } from '../config/mcpServerConfig.js';
import type {
  McpPromptRegistry,
  McpTrustConfig,
} from '../host/hostInterfaces.js';
import type { IToolMessageBus } from '@vybestack/llxprt-code-tools';
import { getErrorMessage } from '@vybestack/llxprt-code-tools/utils/errors.js';
import { DebugLogger } from '@vybestack/llxprt-code-telemetry/debug/index.js';
import { DiscoveredMCPTool } from './mcp-tool.js';
import { McpCallableTool } from './mcp-callable-tool.js';
import { isEnabled } from './mcp-discovery-helpers.js';
import { MCP_DEFAULT_TIMEOUT_MSEC } from './mcp-transport.js';
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
  cliConfig: McpTrustConfig,
  messageBus: IToolMessageBus | undefined,
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
  cliConfig: McpTrustConfig,
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
  isAuthorized: () => boolean;
}

export async function discoverResources(
  mcpServerName: string,
  mcpClient: Client,
  options: ResourceDiscoveryOptions,
): Promise<Resource[]> {
  if (mcpClient.getServerCapabilities()?.resources == null) {
    return [];
  }
  const isAuthorized = requireAuthorization(readAuthorization(options));
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
  isAuthorized: () => boolean;
}

/**
 * Discovers and logs prompts from a connected MCP client.
 */
export async function discoverPrompts(
  mcpServerName: string,
  mcpClient: Client,
  options: PromptDiscoveryOptions,
): Promise<Prompt[]> {
  const isAuthorized = requireAuthorization(readAuthorization(options));
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
  promptRegistry: McpPromptRegistry,
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
