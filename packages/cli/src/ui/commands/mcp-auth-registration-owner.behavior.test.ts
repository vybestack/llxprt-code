/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { useCommandOwners } from '../../__tests__/command-owner-fixture.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { createUnconfiguredBuiltinOwners } from '../../__tests__/unconfigured-model-command.js';
import { BuiltinCommandLoader } from '../../services/BuiltinCommandLoader.js';
import { CommandService } from '../../services/CommandService.js';
import { createMcpAuthCommand } from './mcpAuth.js';
import { createMcpCommand } from './mcpCommand.js';
import { bindMcpAuthCommandOperations } from './credentialCommandHost.js';

describe('MCP authentication registration operations', () => {
  const makeOwner = useCommandOwners();
  it('lists the captured MCP owner when the catalog callback carries a retired session', async () => {
    const owner = await makeOwner('mcp-auth-registration-owner');
    const peer = await makeOwner('mcp-auth-registration-peer');
    await peer.dispose();
    const catalog = Object.assign(
      () =>
        owner.mcp.listServers().map((server) => ({
          name: server.name,
          oauthEnabled: server.config.oauth?.enabled === true,
        })),
      { mcp: peer.mcp },
    );
    const defaults = createUnconfiguredBuiltinOwners();
    const registry = await CommandService.create(
      [
        new BuiltinCommandLoader(
          {
            ...defaults,
            mcpCommand: createMcpCommand(
              createMcpAuthCommand(
                bindMcpAuthCommandOperations(
                  catalog,
                  async () =>
                    (await owner.mcp.details()).servers
                      .filter((server) => server.requiresAuth)
                      .map((server) => server.name),
                  async (name, display) => {
                    await owner.mcp.authenticate(name, display);
                  },
                  () => true,
                ),
                () => true,
                () => 0,
                () => {},
              ),
              {
                isConfigured: true,
                status: null,
                addItem: () => 0,
                reloadCommands: () => {},
                reload: owner.mcp.reload.bind(owner.mcp),
                refresh: owner.mcp.refresh.bind(owner.mcp),
              },
            ),
          },
          null,
        ),
      ],
      new AbortController().signal,
    );
    const action = registry
      .getCommands()
      .find((command) => command.name === 'mcp')
      ?.subCommands?.find((command) => command.name === 'auth')?.action;
    if (!action) throw new Error('MCP auth registration unavailable');
    expect(await action(createMockCommandContext(), '')).toMatchObject({
      messageType: 'info',
      content: 'No MCP servers configured with OAuth authentication.',
    });
  });
});
