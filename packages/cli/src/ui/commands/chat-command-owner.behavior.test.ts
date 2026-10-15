/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { readFile } from 'node:fs/promises';
import type { Agent } from '@vybestack/llxprt-code-agents';
import { useCommandOwners } from '../../__tests__/command-owner-fixture.js';
import { createUnconfiguredBuiltinOwners } from '../../__tests__/unconfigured-model-command.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { BuiltinCommandLoader } from '../../services/BuiltinCommandLoader.js';
import { CommandService } from '../../services/CommandService.js';
import { bindChatOwnerOperations } from './chatCommandHost.js';
import { createChatOwnerCommand } from './chatOwnerCommand.js';
import type { SlashCommand } from './types.js';

describe('registered chat command ownership', () => {
  const owner = useCommandOwners();

  async function registered(agent: Agent): Promise<SlashCommand> {
    const registry = await CommandService.create(
      [
        new BuiltinCommandLoader(
          {
            ...createUnconfiguredBuiltinOwners(),
            chatCommand: createChatOwnerCommand(
              bindChatOwnerOperations(agent, null),
              () => true,
            ),
          },
          null,
        ),
      ],
      new AbortController().signal,
    );
    const command = registry.getCommands().find((item) => item.name === 'chat');
    if (!command) throw new Error('Registered chat command is unavailable');
    return command;
  }

  async function run(
    command: SlashCommand,
    subCommand: string,
    args: string,
    decoy: Agent,
  ) {
    const action = command.subCommands?.find(
      (item) => item.name === subCommand,
    )?.action;
    if (!action) throw new Error(`Missing /chat ${subCommand}`);
    const context = createMockCommandContext({ services: { agent: decoy } });
    return { result: await action(context, args), context };
  }

  async function materialize(agent: Agent, label: string): Promise<void> {
    const reply = await agent.chat(`materialize the ${label} recording`, {
      mcpDiscovery: 'skip',
    });
    expect(reply.text).toBe('turn one reply');
    await agent.session.setRecording({ enabled: true });
  }

  it('keeps checkpoints and their recordings with the registered owner despite different invocation owners', async () => {
    const left = await owner('left');
    const right = await owner('right');
    const leftChat = await registered(left);
    const rightChat = await registered(right);
    await Promise.all([materialize(left, 'left'), materialize(right, 'right')]);

    const [saveLeft, saveRight] = await Promise.all([
      run(leftChat, 'save', 'left-only', right),
      run(rightChat, 'save', 'right-only', left),
    ]);
    expect(saveLeft.result).toMatchObject({
      type: 'message',
      messageType: 'info',
      content: 'Checkpoint saved: left-only.',
    });
    expect(saveRight.result).toMatchObject({
      type: 'message',
      messageType: 'info',
      content: 'Checkpoint saved: right-only.',
    });

    expect(
      (await left.session.listCheckpoints()).map((c) => c.name),
    ).toStrictEqual(['left-only']);
    expect(
      (await right.session.listCheckpoints()).map((c) => c.name),
    ).toStrictEqual(['right-only']);

    const listed = await run(leftChat, 'list', '', right);
    expect(listed.context.ui.addItem).toHaveBeenCalledWith({
      type: 'chat_list',
      chats: [expect.objectContaining({ name: 'left-only' })],
    });

    const leftPath = left.session.getRecording().path;
    const rightPath = right.session.getRecording().path;
    if (!leftPath || !rightPath)
      throw new Error('Owner recording paths are unavailable');
    const [leftLog, rightLog] = await Promise.all([
      readFile(leftPath, 'utf8'),
      readFile(rightPath, 'utf8'),
    ]);
    expect(leftLog).toContain('left-only');
    expect(leftLog).not.toContain('right-only');
    expect(rightLog).toContain('right-only');
    expect(rightLog).not.toContain('left-only');
  }, 30000);

  it('clears and reports only the registered owner history', async () => {
    const left = await owner('clear-left');
    const right = await owner('clear-right');
    const leftChat = await registered(left);
    await Promise.all([
      materialize(left, 'clear-left'),
      materialize(right, 'clear-right'),
    ]);
    await Promise.all([
      left.chat('second left turn', { mcpDiscovery: 'skip' }),
      right.chat('second right turn', { mcpDiscovery: 'skip' }),
    ]);
    const leftBefore = await left.session.getHistory();
    const rightBefore = await right.session.getHistory();
    expect(leftBefore.length).toBeGreaterThan(2);

    const debug = await run(leftChat, 'debug', '', right);
    expect(debug.result).toMatchObject({
      type: 'message',
      messageType: 'info',
      content: expect.stringContaining('Current model: clear-left-initial'),
    });

    const cleared = await run(leftChat, 'clear', '', right);
    expect(cleared.result).toBeUndefined();
    expect(cleared.context.ui.clear).toHaveBeenCalled();
    expect((await left.session.getHistory()).length).toBeLessThan(
      leftBefore.length,
    );
    expect(await right.session.getHistory()).toHaveLength(rightBefore.length);
  }, 30000);

  it('does not reroute a retired owner command to a surviving invocation owner', async () => {
    const left = await owner('retired');
    const right = await owner('surviving');
    const leftChat = await registered(left);
    const rightChat = await registered(right);
    await materialize(right, 'surviving');
    await left.dispose();

    const rejected = await run(leftChat, 'save', 'late-save', right);
    expect(rejected.result).toMatchObject({
      type: 'message',
      messageType: 'error',
    });
    expect(await right.session.listCheckpoints()).toHaveLength(0);

    const survived = await run(rightChat, 'save', 'still-works', left);
    expect(survived.result).toMatchObject({
      type: 'message',
      messageType: 'info',
      content: 'Checkpoint saved: still-works.',
    });
    expect(
      (await right.session.listCheckpoints()).map((c) => c.name),
    ).toStrictEqual(['still-works']);
  }, 30000);

  it('fails visibly when the registering host has no session owner', async () => {
    const decoy = await owner('decoy');
    await materialize(decoy, 'decoy');
    const command = createChatOwnerCommand(
      bindChatOwnerOperations(null, null),
      () => true,
    );
    const saved = await run(command, 'save', 'orphan', decoy);
    expect(saved.result).toStrictEqual({
      type: 'message',
      messageType: 'error',
      content: 'Failed to save checkpoint: No session owner available',
    });
    expect(await decoy.session.listCheckpoints()).toHaveLength(0);
  }, 30000);
});
