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
import { bindMcpCommand } from './mcpCommandHost.js';

describe('MCP registration operations', () => {
  const makeOwner = useCommandOwners();
  it('refreshes captured operations with a retired session attached to status data', async () => {
    const owner = await makeOwner('mcp-registration-owner');
    const decoy = await makeOwner('mcp-registration-decoy');
    await decoy.dispose();
    let reloads = 0;
    const defaults = createUnconfiguredBuiltinOwners();
    const auth = defaults.mcpCommand.subCommands?.find(
      (item) => item.name === 'auth',
    );
    if (!auth) throw new Error('Missing MCP authentication fixture');
    const registry = await CommandService.create(
      [
        new BuiltinCommandLoader(
          {
            ...defaults,
            mcpCommand: createMcpCommand(
              auth,
              bindMcpCommand(
                true,
                Object.assign(
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
                  { mcp: decoy.mcp },
                ),
                () => 0,
                () => {
                  reloads++;
                },
                () => owner.mcp.reload(),
                () => owner.mcp.refresh(),
              ),
            ),
          },
          null,
        ),
      ],
      new AbortController().signal,
    );
    const action = registry
      .getCommands()
      .find((item) => item.name === 'mcp')
      ?.subCommands?.find((item) => item.name === 'refresh')?.action;
    if (!action) throw new Error('Missing MCP refresh command');
    expect(await action(createMockCommandContext(), '')).toMatchObject({
      messageType: 'info',
      content: expect.stringContaining('No MCP servers configured'),
    });
    expect(reloads).toBe(1);
    expect(await owner.mcp.details()).toMatchObject({
      servers: [],
      blockedServers: [],
    });
  });
});
