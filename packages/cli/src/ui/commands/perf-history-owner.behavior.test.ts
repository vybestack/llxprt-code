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
import { createPerfCommand } from './perfCommand.js';

describe('registered performance history owner', () => {
  const makeOwner = useCommandOwners();

  it('attributes retained tool output to the registered session, not the invocation session', async () => {
    const owner = await makeOwner('owner');
    const sibling = await makeOwner('sibling');
    await owner.setHistory([
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'read',
            toolName: 'read_file',
            result: { body: 'retained bytes' },
          },
        ],
      },
    ]);
    await owner.agentClient.startChat(await owner.agentClient.getHistory());
    await sibling.setHistory([]);
    const command = createPerfCommand({
      readHistory: () =>
        owner.agentClient.getHistoryService()?.getRawHistory() ?? null,
    });
    const registry = await CommandService.create(
      [
        new BuiltinCommandLoader(
          { ...createUnconfiguredBuiltinOwners(), perfCommand: command },
          null,
        ),
      ],
      new AbortController().signal,
    );
    const memory = registry
      .getCommands()
      .find((entry) => entry.name === 'perf')
      ?.subCommands?.find((entry) => entry.name === 'memory');
    if (!memory?.action)
      throw new Error('Performance memory command unavailable');
    const result = await memory.action(
      createMockCommandContext({ services: { agent: sibling } }),
      '',
    );

    if (!result || result.type !== 'message')
      throw new Error('Expected memory report');
    expect(result.content).toContain('read_file');
    expect(result.content).toContain('across 1 history items');
    await owner.dispose();
    expect(await sibling.getHistory()).toStrictEqual([]);
  });
});
