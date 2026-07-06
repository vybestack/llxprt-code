/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  SlashCommand,
  SlashCommandActionReturn,
  CommandContext,
  MessageActionReturn,
} from './types.js';
import { CommandKind } from './types.js';
import type { RuntimeMcpServers } from './mcpDisplay.js';
import { buildMcpStatusMessage } from './mcpDisplay.js';
import { mcpAuthSchema, listOAuthServers, performMcpOAuth } from './mcpAuth.js';

function hasToolRefreshClient(
  value: unknown,
): value is { setTools(): Promise<void> } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'setTools' in value &&
    typeof value.setTools === 'function'
  );
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
      content: 'Configuration not loaded.',
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
        content: 'Configuration not loaded.',
      };
    }

    const mcpServers: RuntimeMcpServers = config.getMcpServers() ?? {};

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

    return performMcpOAuth(context, serverName, server, config);
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
        content: 'Configuration not loaded.',
      };
    }

    const toolRegistry = config.getToolRegistry();

    context.ui.addItem(
      {
        type: 'info',
        text: 'Restarting MCP servers...',
      },
      Date.now(),
    );

    try {
      await toolRegistry.discoverAllTools();

      // Update the client with the new tools
      const agentClient: unknown = config.getAgentClient();
      if (!hasToolRefreshClient(agentClient)) {
        throw new Error('Agent client is not available');
      }
      await agentClient.setTools();
    } catch (error) {
      return {
        type: 'message',
        messageType: 'error',
        content: `Failed to restart MCP servers: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
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
