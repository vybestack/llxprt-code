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
import type { Agent } from '@vybestack/llxprt-code-agents';
import { withFuzzyFilter } from '../utils/fuzzyFilter.js';
import type { RuntimeMcpServers } from './mcpDisplay.js';

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

      const mcpServers: RuntimeMcpServers = Object.fromEntries(
        (ctx.services.agent?.mcp.listServers() ?? []).map((server) => [
          server.name,
          server.config,
        ]),
      );
      return Object.keys(mcpServers).map((name) => ({
        value: name,
        description: 'Configured MCP server',
      }));
    }),
  },
];

export async function listOAuthServers(
  agent: Agent | null,
  mcpServers: RuntimeMcpServers,
): Promise<MessageActionReturn> {
  const oauthServersFromConfig = Object.entries(mcpServers)
    .filter(
      ([_name, server]: [string, MCPServerConfig | undefined]) =>
        server?.oauth?.enabled === true,
    )
    .map(([name, _server]) => name);

  const discoveredOAuthServers =
    agent === null
      ? []
      : (await agent.mcp.details()).servers
          .filter(
            (server) =>
              server.requiresAuth && mcpServers[server.name] !== undefined,
          )
          .map((server) => server.name);

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
): Promise<MessageActionReturn> {
  const displayListener = (message: string) => {
    context.ui.addItem({ type: 'info', text: message });
  };

  try {
    context.ui.addItem(
      {
        type: 'info',
        text: `Starting OAuth authentication for MCP server '${serverName}'...`,
      },
      Date.now(),
    );

    const agent = context.services.agent;
    if (!agent) throw new Error('Agent is not available.');
    await agent.mcp.authenticate(serverName, displayListener);

    context.ui.addItem(
      {
        type: 'info',
        text: `✅ Successfully authenticated with MCP server '${serverName}'!`,
      },
      Date.now(),
    );

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
  }
}

export { CommandKind };
export type { SlashCommandActionReturn, CommandContext, MessageActionReturn };
