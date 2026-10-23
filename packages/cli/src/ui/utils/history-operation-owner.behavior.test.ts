import { checkpointBindings } from '../../__tests__/recording-checkpoint-fixture.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { HistoryItemWithoutId } from '../types.js';
import { describe, expect, it } from 'bun:test';
import {
  useCommandOwners,
  commandOwnerClient,
} from '../../__tests__/command-owner-fixture.js';
import { resumeOwnerSession } from './resumeOwnerSession.js';
import { bindCompressCommand } from '../commands/compressCommandHost.js';
import {
  bindChatOwnerOperations,
  bindChatRecordingOperations,
} from '../commands/chatCommandHost.js';
import { createChatOwnerCommand } from '../commands/chatOwnerCommand.js';
import { BuiltinCommandLoader } from '../../__tests__/builtin-loader-fixture.js';
import { CommandService } from '../../services/CommandService.js';
import { createUnconfiguredBuiltinOwners } from '../../__tests__/unconfigured-model-command.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { CompressionStatus } from '@vybestack/llxprt-code-core';

describe('history operation ownership', () => {
  const makeOwner = useCommandOwners();
  it('replays the captured session without acquiring a conflicting session from the callable', async () => {
    const owner = await makeOwner('resume-callback-owner');
    const sibling = await makeOwner('resume-callback-sibling');
    await owner.setHistory([
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'captured resume conversation' }],
      },
    ]);
    await owner.session.setRecording({ enabled: true });
    const checkpoint = await owner.session.createCheckpoint('captured-resume');
    const resume = Object.assign(owner.session.resume.bind(owner.session), {
      session: sibling.session,
    });
    const replay = await resumeOwnerSession(
      resume,
      checkpoint.checkpointId,
      'allowed',
      owner.session.listBrowserTargetsDetailed.bind(owner.session),
    );
    expect(replay.uiHistory).toContainEqual(
      expect.objectContaining({
        type: 'user',
        text: 'captured resume conversation',
      }),
    );
    expect(await sibling.getHistory()).toStrictEqual([]);
    await owner.dispose();
    await sibling.setHistory([
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'surviving history' }],
      },
    ]);
    expect(JSON.stringify(await sibling.getHistory())).toContain(
      'surviving history',
    );
  });
  it('uses the compression callback instead of a conflicting method attached to it', async () => {
    const owner = await makeOwner('compression-callback-owner');
    const sibling = await makeOwner('compression-callback-sibling');
    await sibling.dispose();
    const compress = Object.assign(owner.compress.bind(owner), {
      compress: sibling.compress.bind(sibling),
    });
    const result = await bindCompressCommand(compress)('captured-compression');
    expect(result.compression.compressionStatus).toBe(CompressionStatus.NOOP);
    expect(result.compression.isPending).toBe(false);
  });
  it('lists checkpoints through the registered callback rather than the attached session', async () => {
    const owner = await makeOwner('checkpoint-callback-owner');
    const sibling = await makeOwner('checkpoint-callback-sibling');
    await owner.setHistory([
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'checkpoint conversation' }],
      },
    ]);
    await owner.session.setRecording({ enabled: true });
    await owner.session.createCheckpoint('captured-checkpoint');
    const session = owner.session;
    const command = createChatOwnerCommand(
      bindChatOwnerOperations(
        Object.assign(session.listCheckpoints.bind(session), {
          session: sibling.session,
        }),
        session.createCheckpoint.bind(session),
        session.resume.bind(session),
        session.deleteCheckpoint.bind(session),
        session.renameCheckpoint.bind(session),
        session.getHistory.bind(session),
        session.clearHistory.bind(session),
        session.restoreTurns.bind(session),
        session.nameCurrentSession.bind(session),
        () => session.getRecording().path,
        owner.getModel.bind(owner),
        () => 'auto',
      ),
      () => true,
    );
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
      ?.subCommands?.find((item) => item.name === 'list')?.action;
    if (!action) throw new Error('Missing registered chat list');
    const emitted: HistoryItemWithoutId[] = [];
    const context = createMockCommandContext({
      ui: { addItem: (item: HistoryItemWithoutId) => emitted.push(item) },
    });
    await action(context, '');
    expect(JSON.stringify(emitted)).toContain('captured-checkpoint');
    expect(await sibling.session.listCheckpoints()).toStrictEqual([]);
  });
  it('reads raw chat history through its captured reader without selecting an attached client', async () => {
    const owner = await makeOwner('raw-callback-owner');
    const sibling = await makeOwner('raw-callback-sibling');
    await commandOwnerClient(owner).startChat();
    await owner.setHistory([
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'raw captured conversation' }],
      },
    ]);
    const operations = bindChatRecordingOperations(
      Object.assign(() => null, { agent: sibling, config: null }),
      () => null,
      () => null,
      ...checkpointBindings(
        Object.assign(() => null, { agent: sibling, config: null }),
        () => null,
        () => null,
        () => commandOwnerClient(owner).mediaStore,
      ),
      () => commandOwnerClient(owner).getChat().getHistory(),
      async (history) => {
        await commandOwnerClient(owner).getChat().setHistory(history);
      },
      () => owner.getModel(),
    );
    expect(JSON.stringify(operations.getChatHistory())).toContain(
      'raw captured conversation',
    );
    expect(await sibling.getHistory()).toStrictEqual([]);
  });
});
