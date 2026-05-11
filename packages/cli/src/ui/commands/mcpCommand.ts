/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable complexity, sonarjs/cognitive-complexity, eslint-comments/disable-enable-pair -- Phase 5: legacy UI boundary retained while larger decomposition continues. */

import type {
  SlashCommand,
  SlashCommandActionReturn,
  CommandContext,
  MessageActionReturn,
} from './types.js';
import { CommandKind } from './types.js';
import { type CommandArgumentSchema } from './schema/types.js';
import type {
  Config,
  DiscoveredMCPPrompt,
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
  getErrorMessage,
} from '@vybestack/llxprt-code-core';
import { appEvents, AppEvent } from '../../utils/events.js';
import { withFuzzyFilter } from '../utils/fuzzyFilter.js';

const COLOR_GREEN = '\u001b[32m';
const COLOR_YELLOW = '\u001b[33m';
const COLOR_RED = '\u001b[31m';
const COLOR_CYAN = '\u001b[36m';
const COLOR_GREY = '\u001b[90m';
const RESET_COLOR = '\u001b[0m';

const MAX_MCP_RESOURCES_TO_SHOW = 10;

type RuntimeConfigWithOptionalServices = Omit<
  Config,
  | 'getGeminiClient'
  | 'getMcpClientManager'
  | 'getResourceRegistry'
  | 'getToolRegistry'
> & {
  getGeminiClient?: () => ReturnType<Config['getGeminiClient']> | undefined;
  getMcpClientManager?: () =>
    | ReturnType<Config['getMcpClientManager']>
    | undefined;
  getResourceRegistry?: () =>
    | ReturnType<Config['getResourceRegistry']>
    | undefined;
  getToolRegistry?: () => ReturnType<Config['getToolRegistry']> | undefined;
};

type RuntimeMcpServers = Record<string, MCPServerConfig | undefined>;

type RuntimeMcpResource = Omit<DiscoveredMCPResource, 'name'> & {
  name?: string;
};

const asRuntimeConfig = (config: Config): RuntimeConfigWithOptionalServices =>
  config;

const getResourceName = (resource: DiscoveredMCPResource): string => {
  const runtimeResource = resource as RuntimeMcpResource;
  return runtimeResource.name ?? runtimeResource.uri;
};

const mcpAuthSchema: CommandArgumentSchema = [
  {
    kind: 'value',
    name: 'server',
    description: 'Select MCP server to authenticate',
    /**
     * @plan:PLAN-20251013-AUTOCOMPLETE.P11
     * @requirement:REQ-004
     * Schema completer replaces legacy server list.
     */
    completer: withFuzzyFilter(async (ctx) => {
      const { config } = ctx.services;
      if (!config) {
        return [];
      }

      const mcpServers: RuntimeMcpServers = config.getMcpServers() ?? {};
      return Object.keys(mcpServers).map((name) => ({
        value: name,
        description: 'Configured MCP server',
      }));
    }),
  },
];

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
      const hasToken = await tokenStorage.getCredentials(serverName);
      if (hasToken) {
        ({ suffix, needsAuthHint } = resolveTokenStatus(
          MCPOAuthTokenStorage,
          hasToken.token,
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

function resolveTokenStatus(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic import type
  MCPOAuthTokenStorage: any,
  token: unknown,
): { suffix: string; needsAuthHint: boolean } {
  const isExpired = MCPOAuthTokenStorage.isTokenExpired(token);
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
    if (parts.length > 0) {
      return ` (${parts.join(', ')})`;
    }
    return ` (0 tools)`;
  }
  if (status === MCPServerStatus.CONNECTING) {
    return ` (tools and prompts will appear when ready)`;
  }
  return ` (${serverTools.length} tools cached)`;
}

function buildToolsSection(
  serverTools: DiscoveredMCPTool[],
  showDescriptions: boolean,
  showSchema: boolean,
): string {
  if (serverTools.length === 0) return '';
  let section = `  ${COLOR_CYAN}Tools:${RESET_COLOR}\n`;
  const toolsToShow = serverTools.slice(0, MAX_MCP_RESOURCES_TO_SHOW);
  for (const tool of toolsToShow) {
    const toolName = tool.serverToolName;

    if (showDescriptions && tool.description) {
      section += `  - ${COLOR_CYAN}${toolName}${RESET_COLOR}`;

      const descLines = tool.description.trim().split('\n');
      section += ':\n';
      // eslint-disable-next-line sonarjs/nested-control-flow -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
      for (const descLine of descLines) {
        section += `      ${COLOR_GREEN}${descLine}${RESET_COLOR}\n`;
      }
    } else {
      section += `  - ${COLOR_CYAN}${toolName}${RESET_COLOR}\n`;
    }
    const parameters =
      tool.schema.parametersJsonSchema ?? tool.schema.parameters;
    if (showSchema && parameters) {
      section += `    ${COLOR_CYAN}Parameters:${RESET_COLOR}\n`;

      const paramsLines = JSON.stringify(parameters, null, 2)
        .trim()
        .split('\n');
      // eslint-disable-next-line sonarjs/nested-control-flow -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
      for (const paramsLine of paramsLines) {
        section += `      ${COLOR_GREEN}${paramsLine}${RESET_COLOR}\n`;
      }
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
  if (serverPrompts.length === 0) return '';
  let section = hasPriorSection ? '\n' : '';
  section += `  ${COLOR_CYAN}Prompts:${RESET_COLOR}\n`;
  const promptsToShow = serverPrompts.slice(0, MAX_MCP_RESOURCES_TO_SHOW);
  for (const prompt of promptsToShow) {
    if (showDescriptions && prompt.description) {
      section += `  - ${COLOR_CYAN}${prompt.name}${RESET_COLOR}`;
      const descLines = prompt.description.trim().split('\n');
      section += ':\n';
      // eslint-disable-next-line sonarjs/nested-control-flow -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
      for (const descLine of descLines) {
        section += `      ${COLOR_GREEN}${descLine}${RESET_COLOR}\n`;
      }
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
  if (serverResources.length === 0) return '';
  let section = hasPriorSection ? '\n' : '';
  section += `  ${COLOR_CYAN}Resources:${RESET_COLOR}\n`;
  const resourcesToShow = serverResources.slice(0, MAX_MCP_RESOURCES_TO_SHOW);
  for (const resource of resourcesToShow) {
    const resourceName = getResourceName(resource);
    const resourceUri = resource.uri;

    if (showDescriptions && resource.description) {
      section += `  - ${COLOR_CYAN}${resourceName}${RESET_COLOR} (${resourceUri}):\n`;
      const descLines = resource.description.trim().split('\n');
      // eslint-disable-next-line sonarjs/nested-control-flow -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
      for (const descLine of descLines) {
        section += `      ${COLOR_GREEN}${descLine}${RESET_COLOR}\n`;
      }
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
    for (const descLine of descLines) {
      message += `    ${COLOR_GREEN}${descLine}${RESET_COLOR}\n`;
    }
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

function buildTipsSection(): string {
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

async function buildMcpStatusMessage(
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
  if (!toolRegistry) return '';

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

const getMcpStatus = async (
  context: CommandContext,
  showDescriptions: boolean,
  showSchema: boolean,
  showTips: boolean = false,
): Promise<SlashCommandActionReturn> => {
  const { config } = context.services;
  if (!config) {
    return {
      type: 'message',
      messageType: 'error',
      content: 'Config not loaded.',
    };
  }

  const runtimeConfig = asRuntimeConfig(config);
  const toolRegistry = runtimeConfig.getToolRegistry?.();
  if (!toolRegistry) {
    return {
      type: 'message',
      messageType: 'error',
      content: 'Could not retrieve tool registry.',
    };
  }

  const mcpServers: RuntimeMcpServers = config.getMcpServers() ?? {};
  const serverNames = Object.keys(mcpServers);
  const blockedMcpServers = config.getBlockedMcpServers() ?? [];

  if (serverNames.length === 0 && blockedMcpServers.length === 0) {
    const docsUrl =
      'https://github.com/vybestack/llxprt-code/blob/main/docs/tools/mcp-server.md';
    return {
      type: 'message',
      messageType: 'info',
      content: `No MCP servers configured. Please view MCP documentation in your browser: ${docsUrl} or use the cli /docs command`,
    };
  }

  const message = await buildMcpStatusMessage(
    config,
    runtimeConfig,
    serverNames,
    mcpServers,
    blockedMcpServers,
    showDescriptions,
    showSchema,
    showTips,
  );

  return {
    type: 'message',
    messageType: 'info',
    content: message,
  };
};

function listOAuthServers(mcpServers: RuntimeMcpServers): MessageActionReturn {
  const oauthServersFromConfig = Object.entries(mcpServers)
    .filter(
      ([_, server]: [string, MCPServerConfig | undefined]) =>
        server?.oauth?.enabled === true,
    )
    .map(([name, _]) => name);

  const discoveredOAuthServers = Array.from(
    mcpServerRequiresOAuth.keys(),
  ).filter((name) => mcpServers[name] !== undefined);

  const allOAuthServers = [
    ...new Set([...oauthServersFromConfig, ...discoveredOAuthServers]),
  ];

  if (allOAuthServers.length === 0) {
    return {
      type: 'message',
      messageType: 'info',
      content: 'No MCP servers configured with OAuth authentication.',
    };
  }

  return {
    type: 'message',
    messageType: 'info',
    content: `MCP servers with OAuth authentication:\n${allOAuthServers.map((s) => `  - ${s}`).join('\n')}\n\nUse /mcp auth <server-name> to authenticate.`,
  };
}

async function performMcpOAuth(
  context: CommandContext,
  serverName: string,
  server: MCPServerConfig,
  runtimeConfig: RuntimeConfigWithOptionalServices,
): Promise<MessageActionReturn> {
  const displayListener = (message: string) => {
    context.ui.addItem({ type: 'info', text: message });
  };

  appEvents.on(AppEvent.OauthDisplayMessage, displayListener);

  try {
    context.ui.addItem(
      {
        type: 'info',
        text: `Starting OAuth authentication for MCP server '${serverName}'...`,
      },
      Date.now(),
    );

    const { MCPOAuthProvider } = await import('@vybestack/llxprt-code-core');

    let oauthConfig = server.oauth;
    oauthConfig ??= { enabled: false };

    const mcpServerUrl = server.httpUrl ?? server.url;
    await MCPOAuthProvider.authenticate(
      serverName,
      oauthConfig,
      mcpServerUrl,
      appEvents,
    );

    context.ui.addItem(
      {
        type: 'info',
        text: `✅ Successfully authenticated with MCP server '${serverName}'!`,
      },
      Date.now(),
    );

    const mcpClientManager = runtimeConfig.getMcpClientManager?.();
    if (mcpClientManager) {
      context.ui.addItem(
        {
          type: 'info',
          text: `Re-discovering tools from '${serverName}'...`,
        },
        Date.now(),
      );
      await mcpClientManager.restartServer(serverName);
    }
    const geminiClient = runtimeConfig.getGeminiClient?.();
    if (geminiClient) {
      await geminiClient.setTools();
    }

    context.ui.reloadCommands();

    return {
      type: 'message',
      messageType: 'info',
      content: `Successfully authenticated and refreshed tools for '${serverName}'.`,
    };
  } catch (error) {
    return {
      type: 'message',
      messageType: 'error',
      content: `Failed to authenticate with MCP server '${serverName}': ${getErrorMessage(error)}`,
    };
  } finally {
    appEvents.removeListener(AppEvent.OauthDisplayMessage, displayListener);
  }
}

const authCommand: SlashCommand = {
  name: 'auth',
  description: 'Authenticate with an OAuth-enabled MCP server',
  kind: CommandKind.BUILT_IN,
  schema: mcpAuthSchema,
  autoExecute: true,
  action: async (
    context: CommandContext,
    args: string,
  ): Promise<MessageActionReturn> => {
    const serverName = args.trim();
    const { config } = context.services;

    if (!config) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'Config not loaded.',
      };
    }

    const mcpServers: RuntimeMcpServers = config.getMcpServers() ?? {};

    const runtimeConfig = asRuntimeConfig(config);

    if (!serverName) {
      return listOAuthServers(mcpServers);
    }

    const server = mcpServers[serverName];
    if (!server) {
      return {
        type: 'message',
        messageType: 'error',
        content: `MCP server '${serverName}' not found.`,
      };
    }

    return performMcpOAuth(context, serverName, server, runtimeConfig);
  },
};

const listCommand: SlashCommand = {
  name: 'list',
  description: 'List configured MCP servers and tools',
  kind: CommandKind.BUILT_IN,
  autoExecute: true,
  action: async (context: CommandContext, args: string) => {
    const lowerCaseArgs = args.toLowerCase().split(/\s+/).filter(Boolean);

    const hasDesc =
      lowerCaseArgs.includes('desc') || lowerCaseArgs.includes('descriptions');
    const hasNodesc =
      lowerCaseArgs.includes('nodesc') ||
      lowerCaseArgs.includes('nodescriptions');
    const showSchema = lowerCaseArgs.includes('schema');

    // Show descriptions if `desc` or `schema` is present,
    // but `nodesc` takes precedence and disables them.
    const showDescriptions = !hasNodesc && (hasDesc || showSchema);

    // Show tips only when no arguments are provided
    const showTips = lowerCaseArgs.length === 0;

    return getMcpStatus(context, showDescriptions, showSchema, showTips);
  },
};

const refreshCommand: SlashCommand = {
  name: 'refresh',
  description: 'Restarts MCP servers.',
  kind: CommandKind.BUILT_IN,
  autoExecute: true,
  action: async (
    context: CommandContext,
  ): Promise<SlashCommandActionReturn> => {
    const { config } = context.services;
    if (!config) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'Config not loaded.',
      };
    }

    const runtimeConfig = asRuntimeConfig(config);
    const toolRegistry = runtimeConfig.getToolRegistry?.();
    if (!toolRegistry) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'Could not retrieve tool registry.',
      };
    }

    context.ui.addItem(
      {
        type: 'info',
        text: 'Restarting MCP servers...',
      },
      Date.now(),
    );

    await toolRegistry.discoverAllTools();

    // Update the client with the new tools
    const geminiClient = runtimeConfig.getGeminiClient?.();
    if (geminiClient) {
      await geminiClient.setTools();
    }

    // Reload the slash commands to reflect the changes.
    context.ui.reloadCommands();

    return getMcpStatus(context, false, false, false);
  },
};

export const mcpCommand: SlashCommand = {
  name: 'mcp',
  description:
    'list configured MCP servers and tools, or authenticate with OAuth-enabled servers',
  kind: CommandKind.BUILT_IN,
  subCommands: [listCommand, authCommand, refreshCommand],
  // Default action when no subcommand is provided
  action: async (context: CommandContext, args: string) =>
    // If no subcommand, run the list command
    listCommand.action!(context, args),
};
