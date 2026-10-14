/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { UseHistoryManagerReturn } from '../hooks/useHistoryManager.js';
import type { SlashCommand, SlashCommandActionReturn } from './types.js';
import { CommandKind } from './types.js';
import type { RuntimeMcpServers, McpStatusReads } from './mcpDisplay.js';
import { buildMcpStatusMessage } from './mcpDisplay.js';

export interface McpCommandOperations {
  readonly isConfigured: boolean;
  readonly status: McpStatusReads | null;
  readonly reload: () => Promise<void>;
  readonly refresh: () => Promise<void>;
  readonly addItem: UseHistoryManagerReturn['addItem'];
  readonly reloadCommands: () => void;
}

const getMcpStatus = async (
  operations: McpCommandOperations,
  showDescriptions: boolean,
  showSchema: boolean,
  showTips: boolean = false,
): Promise<SlashCommandActionReturn> => {
  const { status } = operations;
  if (!operations.isConfigured) {
    return {
      type: 'message',
      messageType: 'error',
      content: 'Configuration not loaded.',
    };
  }

  if (!status) {
    return {
      type: 'message',
      messageType: 'error',
      content: 'Could not retrieve tools from the agent.',
    };
  }

  const mcpServers: RuntimeMcpServers = Object.fromEntries(
    status.listServers().map((server) => [server.name, server.config]),
  );
  const serverNames = Object.keys(mcpServers);
  const blockedMcpServers = status.listBlockedServers();

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
    status,
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

export function createMcpCommand(
  authCommand: SlashCommand,
  operations: McpCommandOperations,
): SlashCommand {
  const listCommand: SlashCommand = {
    name: 'list',
    description: 'List configured MCP servers and tools',
    kind: CommandKind.BUILT_IN,
    autoExecute: true,
    action: async (_invocation, args: string) => {
      const lowerCaseArgs = args.toLowerCase().split(/\s+/).filter(Boolean);
      const hasDesc = lowerCaseArgs.includes('desc');
      const hasNodesc = lowerCaseArgs.includes('nodesc');
      const showSchema = lowerCaseArgs.includes('schema');
      const showDescriptions = !hasNodesc && (hasDesc || showSchema);
      const showTips = lowerCaseArgs.length === 0;
      return getMcpStatus(operations, showDescriptions, showSchema, showTips);
    },
  };

  return {
    name: 'mcp',
    description:
      'list configured MCP servers and tools, or authenticate with OAuth-enabled servers',
    kind: CommandKind.BUILT_IN,
    subCommands: [
      listCommand,
      authCommand,
      createReloadCommand(operations),
      createRefreshCommand(operations),
    ],
    action: async (invocation, args: string) =>
      listCommand.action!(invocation, args),
  };
}

function createReloadCommand(operations: McpCommandOperations): SlashCommand {
  return {
    name: 'reload',
    description: 'Reloads MCP server configuration from disk.',
    kind: CommandKind.BUILT_IN,
    autoExecute: true,
    action: async (): Promise<SlashCommandActionReturn> => {
      if (!operations.isConfigured) {
        return {
          type: 'message',
          messageType: 'error',
          content: 'Configuration not loaded.',
        };
      }
      const { status } = operations;
      if (status === null) {
        return {
          type: 'message',
          messageType: 'error',
          content: 'Could not retrieve tools from the agent.',
        };
      }
      operations.addItem(
        { type: 'info', text: 'Reloading MCP configuration from disk...' },
        Date.now(),
      );
      try {
        await operations.reload();
      } catch (error) {
        return {
          type: 'message',
          messageType: 'error',
          content: `Failed to reload MCP configuration: ${
            error instanceof Error ? error.message : String(error)
          }`,
        };
      }
      operations.reloadCommands();
      return getMcpStatus(operations, false, false, false);
    },
  };
}
function createRefreshCommand(operations: McpCommandOperations): SlashCommand {
  return {
    name: 'refresh',
    description: 'Restarts MCP servers.',
    kind: CommandKind.BUILT_IN,
    autoExecute: true,
    action: async (): Promise<SlashCommandActionReturn> => {
      if (!operations.isConfigured) {
        return {
          type: 'message',
          messageType: 'error',
          content: 'Configuration not loaded.',
        };
      }
      const { status } = operations;
      if (status === null) {
        return {
          type: 'message',
          messageType: 'error',
          content: 'Could not retrieve tools from the agent.',
        };
      }
      operations.addItem(
        { type: 'info', text: 'Restarting MCP servers...' },
        Date.now(),
      );
      try {
        await operations.refresh();
      } catch (error) {
        return {
          type: 'message',
          messageType: 'error',
          content: `Failed to restart MCP servers: ${
            error instanceof Error ? error.message : String(error)
          }`,
        };
      }
      operations.reloadCommands();
      return getMcpStatus(operations, false, false, false);
    },
  };
}
