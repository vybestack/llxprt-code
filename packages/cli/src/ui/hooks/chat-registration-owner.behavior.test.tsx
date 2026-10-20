import { checkpointBindings } from '../../__tests__/recording-checkpoint-fixture.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import type { Agent } from '@vybestack/llxprt-code-agents';
import { renderHook } from '../../__tests__/render.js';
import {
  useCommandOwners,
  commandOwnerClient,
} from '../../__tests__/command-owner-fixture.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { createUnconfiguredBuiltinOwners } from '../../__tests__/unconfigured-model-command.js';
import { BuiltinCommandLoader } from '../../__tests__/builtin-loader-fixture.js';
import { CommandService } from '../../services/CommandService.js';
import type { ChatOwnerOperations } from '../commands/chatOwnerCommand.js';
import type { ChatRecordingOperations } from '../commands/chatCommand.js';
import type { SlashCommand } from '../commands/types.js';
import { useChatCommand } from './useChatCommand.js';

function ownerOperations(owner: Agent): ChatOwnerOperations {
  return {
    listCheckpoints: () => owner.session.listCheckpoints(),
    createCheckpoint: (name, options) =>
      owner.session.createCheckpoint(name, options),
    resume: (tag) => owner.session.resume(tag),
    deleteCheckpoint: (id) => owner.session.deleteCheckpoint(id),
    renameCheckpoint: (id, name, options) =>
      owner.session.renameCheckpoint(id, name, options),
    getHistory: () => owner.session.getHistory(),
    clearHistory: () => owner.session.clearHistory(),
    restoreTurns: (turns) => owner.session.restoreTurns(turns),
    nameCurrentSession: (name, options) =>
      owner.session.nameCurrentSession(name, options),
    getRecordingPath: () => owner.session.getRecording().path,
    getModel: () => owner.getModel(),
    getEmojiFilterMode: () => 'auto',
  };
}

function rawOperations(owner: Agent): ChatRecordingOperations {
  const [
    listTargets,
    saveCheckpoint,
    deleteCheckpoint,
    renameCheckpoint,
    nameSession,
  ] = checkpointBindings(
    () => null,
    () => null,
    () => null,
    () => commandOwnerClient(owner).mediaStore,
  );
  return {
    getRecording: () => null,
    getProjectHash: () => null,
    getChatsDir: () => null,
    listTargets,
    saveCheckpoint,
    deleteCheckpoint,
    renameCheckpoint,
    nameSession,
    getChatHistory: () => null,
    replaceChatHistory: async (history) => {
      await commandOwnerClient(owner).getChat().setHistory(history);
    },
    getModel: () => owner.getModel(),
  };
}

async function save(command: SlashCommand, name: string): Promise<void> {
  const registry = await CommandService.create(
    [
      new BuiltinCommandLoader(
        { ...createUnconfiguredBuiltinOwners(), chatCommand: command },
        null,
      ),
    ],
    new AbortController().signal,
  );
  const action = registry
    .getCommands()
    .find((item) => item.name === 'chat')
    ?.subCommands?.find((item) => item.name === 'save')?.action;
  if (!action) throw new Error('Missing registered chat save');
  const result = await action(createMockCommandContext(), name);
  expect(result).toMatchObject({ messageType: 'info' });
}

describe('chat registration operation ownership', () => {
  const makeOwner = useCommandOwners();
  it('saves through bound operations and follows mounted owner replacement without selecting the attached session', async () => {
    const owner = await makeOwner('chat-registration-owner');
    const sibling = await makeOwner('chat-registration-sibling');
    await owner.setHistory([
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'captured owner history' }],
      },
    ]);
    await sibling.setHistory([
      { speaker: 'human', blocks: [{ type: 'text', text: 'sibling history' }] },
    ]);
    await owner.session.setRecording({ enabled: true });
    await sibling.session.setRecording({ enabled: true });
    const hook = renderHook(
      ({ active, decoy }: { active: Agent; decoy: Agent }) =>
        useChatCommand(
          Object.assign(ownerOperations(active), {
            session: decoy.session,
            getModel: () => active.getModel(),
          }),
          rawOperations(active),
          'agent',
          () => true,
        ),
      { initialProps: { active: owner, decoy: sibling } },
    );
    try {
      await save(hook.result.current, 'captured-registration');
      expect(await owner.session.listCheckpoints()).toContainEqual(
        expect.objectContaining({ name: 'captured-registration' }),
      );
      expect(await sibling.session.listCheckpoints()).toStrictEqual([]);
      await owner.dispose();
      hook.rerender({ active: sibling, decoy: owner });
      await save(hook.result.current, 'surviving-registration');
      expect(await sibling.session.listCheckpoints()).toContainEqual(
        expect.objectContaining({ name: 'surviving-registration' }),
      );
    } finally {
      hook.unmount();
    }
  });
});
