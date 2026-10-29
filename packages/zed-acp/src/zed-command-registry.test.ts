/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi, type Mock } from 'bun:test';
import type * as acp from '@agentclientprotocol/sdk';
import type { Agent } from '@vybestack/llxprt-code-agents';
import {
  buildAvailableCommandsUpdate,
  createZedCommandExecutor,
  getZedAvailableCommands,
  parseZedCommandPrompt,
} from './zed-command-registry.js';
import { tryHandleZedCommand } from './zed-prompt-command.js';

function buildAgent(): Agent {
  return {
    getModel: () => 'test-model',
    compress: vi.fn(async () => ({ status: 'compressed' as const })),
    tools: { list: () => [] },
    memory: { getFilePaths: () => [] },
    profiles: { list: () => [] },
    tasks: { list: () => [] },
  } as unknown as Agent;
}

function commandExecutor(agent: Agent = buildAgent()) {
  return createZedCommandExecutor(
    agent.compress.bind(agent),
    agent.getModel.bind(agent),
    agent.tools.list.bind(agent.tools),
    agent.memory.getFilePaths.bind(agent.memory),
    agent.profiles.list.bind(agent.profiles),
    agent.tasks.list.bind(agent.tasks),
  );
}

describe('Zed available commands', () => {
  it('advertises only commands backed by honest Agent API reads/actions', () => {
    const commands = getZedAvailableCommands();
    expect(new Set(commands.map(({ name }) => name))).toStrictEqual(
      new Set(['compact', 'tools', 'memory', 'profile', 'model', 'task']),
    );
    expect(commands.every(({ description }) => description.length > 0)).toBe(
      true,
    );
    expect(buildAvailableCommandsUpdate()).toStrictEqual({
      sessionUpdate: 'available_commands_update',
      availableCommands: commands,
    });
  });

  it('parses arguments and leaves unknown commands for the model', async () => {
    expect(parseZedCommandPrompt('')).toBeNull();
    expect(parseZedCommandPrompt('/')).toBeNull();
    expect(parseZedCommandPrompt('   ')).toBeNull();
    expect(parseZedCommandPrompt('/model ignored')).toStrictEqual({
      name: 'model',
      args: 'ignored',
    });
    expect(parseZedCommandPrompt('/model')).toStrictEqual({
      name: 'model',
      args: '',
    });
    await expect(commandExecutor()('/unknown')).resolves.toBeNull();
    await expect(commandExecutor()('/MODEL')).resolves.toStrictEqual({
      text: 'Current model: test-model',
    });
  });

  it('returns a protocol-visible error without exposing command details', async () => {
    const agent = buildAgent();
    (agent.compress as Mock<typeof agent.compress>).mockRejectedValue(
      new Error('secret compression diagnostic'),
    );
    await expect(commandExecutor(agent)('/compact')).resolves.toStrictEqual({
      text: 'Command /compact failed. See logs for details.',
    });
  });

  it('executes a command and emits a protocol-visible result', async () => {
    const updates: acp.SessionUpdate[] = [];
    const handled = await tryHandleZedCommand(
      [{ type: 'text', text: '/model' }],
      commandExecutor(),
      async (update) => {
        updates.push(update);
      },
    );

    expect(handled).toStrictEqual({ response: { stopReason: 'end_turn' } });
    expect(updates).toStrictEqual([
      {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'Current model: test-model' },
      },
    ]);
  });

  it('does not dispatch command-looking text when another block is present', async () => {
    const updates: acp.SessionUpdate[] = [];
    const result = await tryHandleZedCommand(
      [
        { type: 'text', text: '/compact' },
        { type: 'image', data: 'image', mimeType: 'image/png' },
      ],
      commandExecutor(),
      async (update) => {
        updates.push(update);
      },
    );

    expect(result).toBeNull();
    expect(updates).toStrictEqual([]);
  });
});
