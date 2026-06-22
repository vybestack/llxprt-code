/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  SlashCommandActionReturn,
  CommandContext,
  MessageActionReturn,
} from './types.js';
import { CommandKind } from './types.js';
import { type CommandArgumentSchema } from './schema/types.js';
import type { MCPServerConfig } from '@vybestack/llxprt-code-core';
import { getErrorMessage } from '@vybestack/llxprt-code-core';
import { mcpServerRequiresOAuth } from '@vybestack/llxprt-code-mcp';
import { appEvents, AppEvent } from '../../utils/events.js';
import { withFuzzyFilter } from '../utils/fuzzyFilter.js';
import type {
  RuntimeConfigWithOptionalServices,
  RuntimeMcpServers,
} from './mcpDisplay.js';

export const mcpAuthSchema: CommandArgumentSchema = [
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

export function listOAuthServers(
  mcpServers: RuntimeMcpServers,
): MessageActionReturn {
  const oauthServersFromConfig = Object.entries(mcpServers)
    .filter(
      ([_name, server]: [string, MCPServerConfig | undefined]) =>
        server?.oauth?.enabled === true,
    )
    .map(([name, _server]) => name);

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

export async function performMcpOAuth(
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

    const { MCPOAuthProvider } = await import('@vybestack/llxprt-code-mcp');

    const oauthConfig = server.oauth ?? { enabled: false };

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
    if (mcpClientManager !== undefined) {
      context.ui.addItem(
        {
          type: 'info',
          text: `Re-discovering tools from '${serverName}'...`,
        },
        Date.now(),
      );
      await mcpClientManager.restartServer(serverName);
    }
    const agentClient = runtimeConfig.getAgentClient?.();
    if (agentClient) {
      await agentClient.setTools();
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

export { CommandKind };
export type { SlashCommandActionReturn, CommandContext, MessageActionReturn };
