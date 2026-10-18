/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { useCommandOwners } from '../../__tests__/command-owner-fixture.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { createUnconfiguredBuiltinOwners } from '../../__tests__/unconfigured-model-command.js';
import { BuiltinCommandLoader } from '../../__tests__/builtin-loader-fixture.js';
import { CommandService } from '../../services/CommandService.js';
import { createMcpCommand } from './mcpCommand.js';
import { createMcpAuthCommand } from './mcpAuth.js';
import { bindMcpAuthCommandOperations } from './credentialCommandHost.js';
import { bindMcpCommand } from './mcpCommandHost.js';

describe('registered MCP command owner', () => {
  const makeOwner = useCommandOwners();

  it('lists and refreshes the registered session with no invocation Agent', async () => {
    const owner = await makeOwner('owner');
    const decoy = await makeOwner('decoy');
    const context = createMockCommandContext({ services: { agent: owner } });
    let reloads = 0;
    const registry = await CommandService.create(
      [
        new BuiltinCommandLoader(
          {
            ...createUnconfiguredBuiltinOwners(),
            mcpCommand: createMcpCommand(
              createMcpAuthCommand(
                bindMcpAuthCommandOperations(
                  () =>
                    owner.mcp.listServers().map((server) => ({
                      name: server.name,
                      oauthEnabled: server.config.oauth?.enabled === true,
                    })),
                  async () =>
                    (await owner.mcp.details()).servers
                      .filter((server) => server.requiresAuth)
                      .map((server) => server.name),
                  async (name, display) => {
                    await owner.mcp.authenticate(name, display);
                  },
                  () => context.services.config !== null,
                ),
                () => true,
                context.ui.addItem,
                context.ui.reloadCommands,
              ),
              bindMcpCommand(
                context.services.config !== null,
                {
                  listServers: () => owner.mcp.listServers(),
                  listBlockedServers: () => owner.mcp.listBlockedServers(),
                  discoveryState: () => owner.mcp.discoveryState(),
                  readDetails: () =>
                    owner.mcp.details({
                      includeTools: true,
                      includePrompts: true,
                      includeResources: true,
                    }),
                },
                context.ui.addItem,
                () => {
                  reloads++;
                },
                async () => {
                  await owner.mcp.reload();
                },
                async () => {
                  await owner.mcp.refresh();
                },
              ),
            ),
          },
          null,
        ),
      ],
      new AbortController().signal,
    );
    const command = registry
      .getCommands()
      .find((candidate) => candidate.name === 'mcp');
    if (!command?.action) throw new Error('MCP command unavailable');
    const invocation = createMockCommandContext({
      services: { agent: null, config: null },
    });
    expect(await command.action(invocation, '')).toMatchObject({
      type: 'message',
      messageType: 'info',
      content: expect.stringContaining('No MCP servers configured'),
    });
    const refresh = command.subCommands?.find(
      (candidate) => candidate.name === 'refresh',
    );
    if (!refresh?.action) throw new Error('MCP refresh unavailable');
    await refresh.action(invocation, '');
    expect(reloads).toBe(1);
    await owner.dispose();
    expect(await decoy.mcp.details()).toMatchObject({
      servers: [],
      blockedServers: [],
    });
  });
});
