/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  SlashCommand,
  SlashCommandActionReturn,
  MessageActionReturn,
} from './types.js';
import { CommandKind } from './types.js';
import { type CommandArgumentSchema } from './schema/types.js';
import { getErrorMessage } from '@vybestack/llxprt-code-core';
import { withFuzzyFilter } from '../utils/fuzzyFilter.js';
import type { HistoryItemWithoutId } from '../types.js';

export type McpAuthOutput = (
  item: HistoryItemWithoutId,
  timestamp?: number,
) => void | number | Promise<void>;

export interface McpAuthCommandOperations {
  readonly isConfigured: () => boolean;
  readonly configuredServers: () => ReadonlyArray<{
    readonly name: string;
    readonly oauthEnabled: boolean;
  }>;
  readonly authenticationRequiredServers: () => Promise<readonly string[]>;
  readonly authenticate: (
    serverName: string,
    displayListener: (message: string) => void | Promise<void>,
  ) => Promise<void>;
}

function createMcpAuthSchema(
  operations: McpAuthCommandOperations,
  readFuzzyFiltering: () => boolean,
): CommandArgumentSchema {
  return [
    {
      kind: 'value',
      name: 'server',
      description: 'Select MCP server to authenticate',
      /**
       * @plan:PLAN-20251013-AUTOCOMPLETE.P11
       * @requirement:REQ-004
       * Schema completer replaces legacy server list.
       */
      completer: withFuzzyFilter(async () => {
        if (!operations.isConfigured()) {
          return [];
        }
        return operations.configuredServers().map(({ name }) => ({
          value: name,
          description: 'Configured MCP server',
        }));
      }, readFuzzyFiltering),
    },
  ];
}

export async function listOAuthServers(
  operations: McpAuthCommandOperations,
): Promise<MessageActionReturn> {
  const configuredServers = operations.configuredServers();
  const oauthServersFromConfig = configuredServers
    .filter((server) => server.oauthEnabled)
    .map((server) => server.name);
  const configuredNames = new Set(
    configuredServers.map((server) => server.name),
  );
  const discoveredOAuthServers = (
    await operations.authenticationRequiredServers()
  ).filter((name) => configuredNames.has(name));
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
    content: `MCP servers with OAuth authentication:\n${allOAuthServers.map((server) => `  - ${server}`).join('\n')}\n\nUse /mcp auth <server-name> to authenticate.`,
  };
}

async function performMcpOAuth(
  operations: McpAuthCommandOperations,
  writeOutput: McpAuthOutput,
  reloadCommands: () => void,
  serverName: string,
): Promise<MessageActionReturn> {
  const displayListener = async (message: string): Promise<void> => {
    await writeOutput({ type: 'info', text: message });
  };

  try {
    await writeOutput(
      {
        type: 'info',
        text: `Starting OAuth authentication for MCP server '${serverName}'...`,
      },
      Date.now(),
    );

    await operations.authenticate(serverName, displayListener);

    await writeOutput(
      {
        type: 'info',
        text: `✅ Successfully authenticated with MCP server '${serverName}'!`,
      },
      Date.now(),
    );

    reloadCommands();

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

export function createMcpAuthCommand(
  operations: McpAuthCommandOperations,
  readFuzzyFiltering: () => boolean,
  writeOutput: McpAuthOutput,
  reloadCommands: () => void,
): SlashCommand {
  return {
    name: 'auth',
    description: 'Authenticate with an OAuth-enabled MCP server',
    kind: CommandKind.BUILT_IN,
    schema: createMcpAuthSchema(operations, readFuzzyFiltering),
    autoExecute: true,
    action: async (
      _invocation,
      args: string,
    ): Promise<SlashCommandActionReturn> => {
      const serverName = args.trim();

      if (!operations.isConfigured()) {
        return {
          type: 'message',
          messageType: 'error',
          content: 'Configuration not loaded.',
        };
      }

      if (!serverName) {
        return listOAuthServers(operations);
      }

      if (
        !operations
          .configuredServers()
          .some((server) => server.name === serverName)
      ) {
        return {
          type: 'message',
          messageType: 'error',
          content: `MCP server '${serverName}' not found.`,
        };
      }

      return performMcpOAuth(
        operations,
        writeOutput,
        reloadCommands,
        serverName,
      );
    },
  };
}
