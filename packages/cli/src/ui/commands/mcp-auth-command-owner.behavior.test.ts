/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { createUnconfiguredBuiltinOwners } from '../../__tests__/unconfigured-model-command.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { BuiltinCommandLoader } from '../../__tests__/builtin-loader-fixture.js';
import { CommandService } from '../../services/CommandService.js';
import {
  createMcpAuthCommand,
  type McpAuthCommandOperations,
} from './mcpAuth.js';
import { createMcpCommand } from './mcpCommand.js';
import { bindMcpCommand } from './mcpCommandHost.js';
import type { SlashCommand } from './types.js';
import type { UseHistoryManagerReturn } from '../hooks/useHistoryManager.js';

interface McpOwner {
  readonly command: SlashCommand;
  readonly authenticated: string[];
}

function mcpOwner(
  serverName: string,
  addItem: UseHistoryManagerReturn['addItem'],
): McpOwner {
  const authenticated: string[] = [];
  const operations: McpAuthCommandOperations = {
    isConfigured: () => true,
    configuredServers: () => [{ name: serverName, oauthEnabled: true }],
    authenticationRequiredServers: async () => [],
    authenticate: async (name, display) => {
      authenticated.push(name);
      display(`Authenticated ${name}`);
    },
  };
  return {
    authenticated,
    command: createMcpCommand(
      createMcpAuthCommand(
        operations,
        () => true,
        addItem,
        () => {},
      ),
      bindMcpCommand(
        false,
        null,
        () => 0,
        () => {},
        async () => {
          throw new Error('Session agent is unavailable');
        },
        async () => {
          throw new Error('Session agent is unavailable');
        },
      ),
    ),
  };
}

async function registeredMcp(command: SlashCommand): Promise<SlashCommand> {
  const registry = await CommandService.create(
    [
      new BuiltinCommandLoader(
        {
          ...createUnconfiguredBuiltinOwners(),
          mcpCommand: command,
        },
        null,
      ),
    ],
    new AbortController().signal,
  );
  const registered = registry
    .getCommands()
    .find((candidate) => candidate.name === 'mcp');
  if (registered === undefined) throw new Error('/mcp is unavailable');
  return registered;
}

describe('MCP auth command owner', () => {
  it('authenticates through the registered owner, not invocation services', async () => {
    const reported: string[] = [];
    const context = createMockCommandContext({
      services: { agent: null, config: null },
      ui: {
        addItem: (item: { readonly text?: string }) => {
          reported.push(item.text ?? '');
          return 0;
        },
        reloadCommands: () => {},
      },
    });
    const left = mcpOwner('left', context.ui.addItem);
    const right = mcpOwner('right', () => 0);
    const mcp = await registeredMcp(left.command);
    await registeredMcp(right.command);
    const auth = mcp.subCommands?.find((command) => command.name === 'auth');
    if (auth?.action === undefined) throw new Error('/mcp auth is unavailable');

    await auth.action(context, 'left');

    expect(left.authenticated).toStrictEqual(['left']);
    expect(right.authenticated).toStrictEqual([]);
    expect(reported).toContain(
      "✅ Successfully authenticated with MCP server 'left'!",
    );
  });

  it('lists OAuth servers from the registered owner', async () => {
    const owner = mcpOwner('configured', () => 0);
    const mcp = await registeredMcp(owner.command);
    const context = createMockCommandContext({
      services: { agent: null, config: null },
    });
    const auth = mcp.subCommands?.find((command) => command.name === 'auth');
    if (auth?.action === undefined) throw new Error('/mcp auth is unavailable');

    const result = await auth.action(context, '');

    expect(result).toMatchObject({
      type: 'message',
      messageType: 'info',
      content:
        'MCP servers with OAuth authentication:\n  - configured\n\nUse /mcp auth <server-name> to authenticate.',
    });
  });
});
