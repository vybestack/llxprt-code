/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  Config,
  AnyDeclarativeTool,
  MCPServerConfig,
  DiscoveredMCPResource,
} from '@vybestack/llxprt-code-core';
import {
  DiscoveredMCPTool,
  getMCPDiscoveryState,
  getMCPServerStatus,
  MCPDiscoveryState,
  MCPServerStatus,
  mcpServerRequiresOAuth,
  type DiscoveredMCPPrompt,
} from '@vybestack/llxprt-code-mcp';

export const COLOR_GREEN = '\u001b[32m';
export const COLOR_YELLOW = '\u001b[33m';
export const COLOR_RED = '\u001b[31m';
export const COLOR_CYAN = '\u001b[36m';
export const COLOR_GREY = '\u001b[90m';
export const RESET_COLOR = '\u001b[0m';

export const MAX_MCP_RESOURCES_TO_SHOW = 10;

export type RuntimeConfigWithOptionalServices = Omit<
  Config,
  | 'getAgentClient'
  | 'getMcpClientManager'
  | 'getResourceRegistry'
  | 'getToolRegistry'
> & {
  getAgentClient?: () => ReturnType<Config['getAgentClient']> | undefined;
  getMcpClientManager?: () =>
    | ReturnType<Config['getMcpClientManager']>
    | undefined;
  getResourceRegistry?: () =>
    | ReturnType<Config['getResourceRegistry']>
    | undefined;
  getToolRegistry?: () => ReturnType<Config['getToolRegistry']> | undefined;
};

export type RuntimeMcpServers = Record<string, MCPServerConfig | undefined>;

type RuntimeMcpResource = Omit<DiscoveredMCPResource, 'name'> & {
  name?: string;
};

export const asRuntimeConfig = (
  config: Config,
): RuntimeConfigWithOptionalServices => config;

export const getResourceName = (resource: DiscoveredMCPResource): string => {
  const runtimeResource = resource as RuntimeMcpResource;
  return runtimeResource.name ?? runtimeResource.uri;
};

/** Narrow interface for the dynamically-imported token storage static method. */
interface TokenStorageStatic {
  isTokenExpired(token: unknown): boolean;
}

function resolveTokenStatus(
  tokenStorage: TokenStorageStatic,
  token: unknown,
): { suffix: string; needsAuthHint: boolean } {
  const isExpired = tokenStorage.isTokenExpired(token);
  if (isExpired === true) {
    return {
      suffix: ` ${COLOR_YELLOW}(OAuth token expired)${RESET_COLOR}`,
      needsAuthHint: true,
    };
  }
  return {
    suffix: ` ${COLOR_GREEN}(OAuth authenticated)${RESET_COLOR}`,
    needsAuthHint: false,
  };
}

async function buildOAuthStatusSuffix(
  serverName: string,
  server: MCPServerConfig,
): Promise<{ suffix: string; needsAuthHint: boolean }> {
  let suffix = '';
  let needsAuthHint = mcpServerRequiresOAuth.get(serverName) ?? false;
  if (
    server.oauth?.enabled === true ||
    mcpServerRequiresOAuth.has(serverName)
  ) {
    needsAuthHint = true;
    try {
      const { MCPOAuthTokenStorage } = await import(
        '@vybestack/llxprt-code-core'
      );
      const tokenStorage = new MCPOAuthTokenStorage();
      const credentials = await tokenStorage.getCredentials(serverName);
      if (credentials !== null) {
        ({ suffix, needsAuthHint } = resolveTokenStatus(
          MCPOAuthTokenStorage as unknown as TokenStorageStatic,
          credentials.token,
        ));
      } else {
        suffix = ` ${COLOR_RED}(OAuth not authenticated)${RESET_COLOR}`;
      }
    } catch {
      // If we can't check OAuth status, just continue
    }
  }
  return { suffix, needsAuthHint };
}

function appendIndentedLines(
  lines: readonly string[],
  indent: string,
  color: string,
): string {
  let result = '';
  for (const line of lines) {
    result += `${indent}${color}${line}${RESET_COLOR}\n`;
  }
  return result;
}

function buildToolCountSuffix(
  status: MCPServerStatus,
  serverTools: DiscoveredMCPTool[],
  serverPrompts: DiscoveredMCPPrompt[],
  serverResources: DiscoveredMCPResource[],
): string {
  if (status === MCPServerStatus.CONNECTED) {
    const parts: string[] = [];
    if (serverTools.length > 0) {
      parts.push(
        `${serverTools.length} ${serverTools.length === 1 ? 'tool' : 'tools'}`,
      );
    }
    if (serverPrompts.length > 0) {
      parts.push(
        `${serverPrompts.length} ${
          serverPrompts.length === 1 ? 'prompt' : 'prompts'
        }`,
      );
    }
    if (serverResources.length > 0) {
      parts.push(
        `${serverResources.length} ${
          serverResources.length === 1 ? 'resource' : 'resources'
        }`,
      );
    }
    return parts.length > 0 ? ` (${parts.join(', ')})` : ' (0 tools)';
  }
  if (status === MCPServerStatus.CONNECTING) {
    return ' (tools and prompts will appear when ready)';
  }
  return ` (${serverTools.length} tools cached)`;
}

function buildToolSchemaSection(tool: DiscoveredMCPTool): string {
  const parameters = tool.schema.parametersJsonSchema ?? tool.schema.parameters;
  if (!parameters) {
    return '';
  }
  const paramsLines = JSON.stringify(parameters, null, 2).trim().split('\n');
  let section = `    ${COLOR_CYAN}Parameters:${RESET_COLOR}\n`;
  section += appendIndentedLines(paramsLines, '      ', COLOR_GREEN);
  return section;
}

function buildToolsSection(
  serverTools: DiscoveredMCPTool[],
  showDescriptions: boolean,
  showSchema: boolean,
): string {
  if (serverTools.length === 0) {
    return '';
  }
  let section = `  ${COLOR_CYAN}Tools:${RESET_COLOR}\n`;
  const toolsToShow = serverTools.slice(0, MAX_MCP_RESOURCES_TO_SHOW);
  for (const tool of toolsToShow) {
    const toolName = tool.serverToolName;

    if (showDescriptions && tool.description) {
      const descLines = tool.description.trim().split('\n');
      section += `  - ${COLOR_CYAN}${toolName}${RESET_COLOR}:\n`;
      section += appendIndentedLines(descLines, '      ', COLOR_GREEN);
    } else {
      section += `  - ${COLOR_CYAN}${toolName}${RESET_COLOR}\n`;
    }
    if (showSchema) {
      section += buildToolSchemaSection(tool);
    }
  }
  if (serverTools.length > MAX_MCP_RESOURCES_TO_SHOW) {
    const remaining = serverTools.length - MAX_MCP_RESOURCES_TO_SHOW;
    section += `  ${COLOR_GREY}... and ${remaining} more ${remaining === 1 ? 'tool' : 'tools'}${RESET_COLOR}\n`;
  }
  return section;
}

function buildPromptsSection(
  serverPrompts: DiscoveredMCPPrompt[],
  showDescriptions: boolean,
  hasPriorSection: boolean,
): string {
  if (serverPrompts.length === 0) {
    return '';
  }
  let section = hasPriorSection ? '\n' : '';
  section += `  ${COLOR_CYAN}Prompts:${RESET_COLOR}\n`;
  const promptsToShow = serverPrompts.slice(0, MAX_MCP_RESOURCES_TO_SHOW);
  for (const prompt of promptsToShow) {
    if (showDescriptions && prompt.description) {
      const descLines = prompt.description.trim().split('\n');
      section += `  - ${COLOR_CYAN}${prompt.name}${RESET_COLOR}:\n`;
      section += appendIndentedLines(descLines, '      ', COLOR_GREEN);
    } else {
      section += `  - ${COLOR_CYAN}${prompt.name}${RESET_COLOR}\n`;
    }
  }
  if (serverPrompts.length > MAX_MCP_RESOURCES_TO_SHOW) {
    const remaining = serverPrompts.length - MAX_MCP_RESOURCES_TO_SHOW;
    section += `  ${COLOR_GREY}... and ${remaining} more ${remaining === 1 ? 'prompt' : 'prompts'}${RESET_COLOR}\n`;
  }
  return section;
}

function buildResourcesSection(
  serverResources: DiscoveredMCPResource[],
  showDescriptions: boolean,
  hasPriorSection: boolean,
): string {
  if (serverResources.length === 0) {
    return '';
  }
  let section = hasPriorSection ? '\n' : '';
  section += `  ${COLOR_CYAN}Resources:${RESET_COLOR}\n`;
  const resourcesToShow = serverResources.slice(0, MAX_MCP_RESOURCES_TO_SHOW);
  for (const resource of resourcesToShow) {
    const resourceName = getResourceName(resource);
    const resourceUri = resource.uri;

    if (showDescriptions && resource.description) {
      const descLines = resource.description.trim().split('\n');
      section += `  - ${COLOR_CYAN}${resourceName}${RESET_COLOR} (${resourceUri}):\n`;
      section += appendIndentedLines(descLines, '      ', COLOR_GREEN);
    } else {
      section += `  - ${COLOR_CYAN}${resourceName}${RESET_COLOR} (${resourceUri})\n`;
    }
  }
  if (serverResources.length > MAX_MCP_RESOURCES_TO_SHOW) {
    const remaining = serverResources.length - MAX_MCP_RESOURCES_TO_SHOW;
    section += `  ${COLOR_GREY}... and ${remaining} more ${remaining === 1 ? 'resource' : 'resources'}${RESET_COLOR}\n`;
  }
  return section;
}

function buildAuthHintSuffix(
  serverTools: DiscoveredMCPTool[],
  serverPrompts: DiscoveredMCPPrompt[],
  serverResources: DiscoveredMCPResource[],
  originalStatus: MCPServerStatus,
  needsAuthHint: boolean,
  serverName: string,
): string {
  if (
    serverTools.length === 0 &&
    serverPrompts.length === 0 &&
    serverResources.length === 0
  ) {
    return '  No tools, prompts, or resources available\n';
  }
  if (serverTools.length === 0) {
    let hint = '  No tools available';
    if (originalStatus === MCPServerStatus.DISCONNECTED && needsAuthHint) {
      hint += ` ${COLOR_GREY}(type: "/mcp auth ${serverName}" to authenticate this server)${RESET_COLOR}`;
    }
    return hint + '\n';
  }
  if (originalStatus === MCPServerStatus.DISCONNECTED && needsAuthHint) {
    return `  ${COLOR_GREY}(type: "/mcp auth ${serverName}" to authenticate this server)${RESET_COLOR}\n`;
  }
  return '';
}

function getServerDisplayStatus(
  serverName: string,
  serverTools: DiscoveredMCPTool[],
  serverPrompts: DiscoveredMCPPrompt[],
  serverResources: DiscoveredMCPResource[],
): {
  status: MCPServerStatus;
  originalStatus: MCPServerStatus;
  indicator: string;
  text: string;
} {
  const originalStatus = getMCPServerStatus(serverName);
  const hasCachedItems =
    serverTools.length > 0 ||
    serverPrompts.length > 0 ||
    serverResources.length > 0;
  const status =
    originalStatus === MCPServerStatus.DISCONNECTED && hasCachedItems
      ? MCPServerStatus.CONNECTED
      : originalStatus;

  let indicator = '';
  let text = '';
  switch (status) {
    case MCPServerStatus.CONNECTED:
      indicator = '[READY]';
      text = 'Ready';
      break;
    case MCPServerStatus.CONNECTING:
      indicator = '[STARTING]';
      text = 'Starting... (first startup may take longer)';
      break;
    case MCPServerStatus.DISCONNECTED:
    default:
      indicator = '[DISCONNECTED]';
      text = 'Disconnected';
      break;
  }
  return { status, originalStatus, indicator, text };
}

async function buildServerHeader(
  serverName: string,
  server: MCPServerConfig,
  statusInfo: ReturnType<typeof getServerDisplayStatus>,
  serverTools: DiscoveredMCPTool[],
  serverPrompts: DiscoveredMCPPrompt[],
  serverResources: DiscoveredMCPResource[],
): Promise<{
  header: string;
  needsAuthHint: boolean;
  originalStatus: MCPServerStatus;
}> {
  let serverDisplayName = serverName;
  if (server.extensionName) {
    serverDisplayName += ` (from ${server.extensionName})`;
  }

  let message = `${statusInfo.indicator} \u001b[1m${serverDisplayName}\u001b[0m - ${statusInfo.text}`;

  const { suffix: oauthSuffix, needsAuthHint } = await buildOAuthStatusSuffix(
    serverName,
    server,
  );
  message += oauthSuffix;

  message += buildToolCountSuffix(
    statusInfo.status,
    serverTools,
    serverPrompts,
    serverResources,
  );
  return {
    header: message,
    needsAuthHint,
    originalStatus: statusInfo.originalStatus,
  };
}

async function buildServerEntry(
  serverName: string,
  server: MCPServerConfig,
  allTools: AnyDeclarativeTool[],
  promptRegistry: {
    getPromptsByServer(name: string): DiscoveredMCPPrompt[];
  },
  allResources: DiscoveredMCPResource[],
  showDescriptions: boolean,
  showSchema: boolean,
): Promise<string> {
  const serverTools = allTools.filter((tool: AnyDeclarativeTool) => {
    const isMcpTool = tool instanceof DiscoveredMCPTool;
    return isMcpTool && tool.serverName === serverName;
  }) as DiscoveredMCPTool[];
  const serverPrompts = promptRegistry.getPromptsByServer(serverName);
  const serverResources = allResources.filter(
    (resource) => resource.serverName === serverName,
  );

  const statusInfo = getServerDisplayStatus(
    serverName,
    serverTools,
    serverPrompts,
    serverResources,
  );
  const { header, needsAuthHint, originalStatus } = await buildServerHeader(
    serverName,
    server,
    statusInfo,
    serverTools,
    serverPrompts,
    serverResources,
  );

  let message = header;
  if (showDescriptions && server.description) {
    const descLines = server.description.trim().split('\n');
    message += ':\n';
    message += appendIndentedLines(descLines, '    ', COLOR_GREEN);
  } else {
    message += '\n';
  }

  message += RESET_COLOR;

  const toolsSection = buildToolsSection(
    serverTools,
    showDescriptions,
    showSchema,
  );
  const hasTools = toolsSection.length > 0;
  message += toolsSection;

  const promptsSection = buildPromptsSection(
    serverPrompts,
    showDescriptions,
    hasTools,
  );
  message += promptsSection;
  const hasPriorSection = hasTools || promptsSection.length > 0;

  message += buildResourcesSection(
    serverResources,
    showDescriptions,
    hasPriorSection,
  );

  message += buildAuthHintSuffix(
    serverTools,
    serverPrompts,
    serverResources,
    originalStatus,
    needsAuthHint,
    serverName,
  );

  message += '\n';
  return message;
}

export function buildTipsSection(): string {
  return (
    `\n${COLOR_CYAN}TIP: Tips:${RESET_COLOR}\n` +
    `  • Use ${COLOR_CYAN}/mcp desc${RESET_COLOR} to show server and tool descriptions\n` +
    `  • Use ${COLOR_CYAN}/mcp schema${RESET_COLOR} to show tool parameter schemas\n` +
    `  • Use ${COLOR_CYAN}/mcp nodesc${RESET_COLOR} to hide descriptions\n` +
    `  • Use ${COLOR_CYAN}/mcp auth <server-name>${RESET_COLOR} to authenticate with OAuth-enabled servers\n` +
    `  • Press ${COLOR_CYAN}Ctrl+T${RESET_COLOR} to toggle tool descriptions on/off\n\n`
  );
}

function buildBlockedServersSection(
  blockedMcpServers: ReadonlyArray<{ name: string; extensionName?: string }>,
): string {
  let message = '';
  for (const server of blockedMcpServers) {
    let serverDisplayName = server.name;
    if (server.extensionName) {
      serverDisplayName += ` (from ${server.extensionName})`;
    }
    message += `[BLOCKED] \u001b[1m${serverDisplayName}\u001b[0m - Blocked\n\n`;
  }
  return message;
}

export async function buildMcpStatusMessage(
  config: Config,
  runtimeConfig: RuntimeConfigWithOptionalServices,
  serverNames: string[],
  mcpServers: RuntimeMcpServers,
  blockedMcpServers: ReadonlyArray<{ name: string; extensionName?: string }>,
  showDescriptions: boolean,
  showSchema: boolean,
  showTips: boolean,
): Promise<string> {
  const toolRegistry = runtimeConfig.getToolRegistry?.();
  if (!toolRegistry) {
    return '';
  }

  const connectingServers = serverNames.filter(
    (name) => getMCPServerStatus(name) === MCPServerStatus.CONNECTING,
  );
  const discoveryState = getMCPDiscoveryState();

  let message = '';

  if (
    discoveryState === MCPDiscoveryState.IN_PROGRESS ||
    connectingServers.length > 0
  ) {
    message += `${COLOR_YELLOW}MCP servers are starting up (${connectingServers.length} initializing)...${RESET_COLOR}\n`;
    message += `${COLOR_CYAN}Note: First startup may take longer. Tool availability will update automatically.${RESET_COLOR}\n\n`;
  }

  message += 'Configured MCP servers:\n\n';

  const allTools = toolRegistry.getAllTools();
  const promptRegistry = config.getPromptRegistry();
  const allResources =
    runtimeConfig.getResourceRegistry?.()?.getAllResources() ?? [];

  for (const serverName of serverNames) {
    const server = mcpServers[serverName];
    if (!server) {
      continue;
    }
    message += await buildServerEntry(
      serverName,
      server,
      allTools,
      promptRegistry,
      allResources,
      showDescriptions,
      showSchema,
    );
  }

  message += buildBlockedServersSection(blockedMcpServers);

  if (showTips) {
    message += buildTipsSection();
  }

  message += RESET_COLOR;
  return message;
}
