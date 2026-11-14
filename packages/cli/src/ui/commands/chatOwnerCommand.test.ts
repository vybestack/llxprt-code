/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { readJournalItems } from '../stores/turn/journal-turn-test-helpers.js';

import type { IContent } from '@vybestack/llxprt-code-core';
import { describe, expect, it, spyOn } from 'bun:test';
import { readFile, readdir } from 'node:fs/promises';
import { readJournalCheckpoints } from '@vybestack/llxprt-code-core/recording/journalSessionListing.js';
import {
  readRecordedFacts,
  readRecordedRows,
} from '../../__tests__/journal-recording.js';
import { withRecordingLifetimeFixture } from '../../../../agents/src/api/__tests__/helpers/recording-owner-lifetime-fixture.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import type { Agent } from '@vybestack/llxprt-code-agents';
import { bindChatOwnerOperations } from './chatCommandHost.js';
import { createChatOwnerCommand } from './chatOwnerCommand.js';

const human = (text: string): IContent => ({
  speaker: 'human',
  blocks: [{ type: 'text', text }],
});
const ai = (text: string): IContent => ({
  speaker: 'ai',
  blocks: [{ type: 'text', text }],
});

type RestoreTurns = Agent['session']['restoreTurns'];

// Registers /chat the way the session host does: bound to this one owner.
// `restoreTurns` replaces only the restore operation handed to the production
// binding, so a failure can be injected at the command's collaborator boundary.
function ownerActions(
  agent: Agent,
  restoreTurns: RestoreTurns = (turns, options) =>
    agent.session.restoreTurns(turns, options),
) {
  const chat = createChatOwnerCommand(
    bindChatOwnerOperations(
      () => agent.session.listCheckpoints(),
      (name, options) => agent.session.createCheckpoint(name, options),
      (tag) => agent.session.resume(tag),
      (checkpointId) => agent.session.deleteCheckpoint(checkpointId),
      (checkpointId, name, options) =>
        agent.session.renameCheckpoint(checkpointId, name, options),
      () => agent.session.getJournalLength(),
      (options) => agent.session.clearHistory(options),
      restoreTurns,
      (name, options) => agent.session.nameCurrentSession(name, options),
      () => agent.session.getRecording().path,
      () => agent.getModel(),
    ),
    () => true,
  );
  return (name: string) => {
    const handler = chat.subCommands?.find((cmd) => cmd.name === name)?.action;
    if (!handler) throw new Error(`Missing /chat ${name}`);
    return handler;
  };
}

describe('owner-backed /chat command route', () => {
  it('creates, lists, renames and deletes through one active owner and durable journal state', async () => {
    await withRecordingLifetimeFixture(async ({ agent, chatsDir }) => {
      await agent.setHistory([human('seed'), ai('reply')]);
      await agent.session.setRecording({ enabled: true });
      const action = ownerActions(agent);
      const context = createMockCommandContext({ services: { agent } });
      const path = agent.session.getRecording().path;
      if (!path) throw new Error('No owner recording');
      expect(await action('save')(context, 'first')).toMatchObject({
        messageType: 'info',
      });
      await action('list')(context, '');
      expect(context.ui.addItem).toHaveBeenCalledWith({
        type: 'chat_list',
        chats: [expect.objectContaining({ name: 'first' })],
      });
      expect(await action('rename')(context, 'first renamed')).toMatchObject({
        messageType: 'info',
      });
      expect(await action('delete')(context, 'renamed')).toMatchObject({
        type: 'confirm_action',
      });
      context.overwriteConfirmed = true;
      expect(await action('delete')(context, 'renamed')).toMatchObject({
        messageType: 'info',
      });
      expect(await readJournalCheckpoints(path)).toStrictEqual([]);
      expect(
        (await readdir(chatsDir)).filter((file) => file.endsWith('.lock')),
      ).toHaveLength(1);
    });
  }, 30000);

  it('refuses collisions until confirmation and overwrites create, rename and name', async () => {
    await withRecordingLifetimeFixture(async ({ agent }) => {
      await agent.setHistory([human('seed')]);
      await agent.session.setRecording({ enabled: true });
      const action = ownerActions(agent);
      const context = createMockCommandContext({ services: { agent } });
      await action('save')(context, 'occupied');
      expect(await action('save')(context, 'occupied')).toMatchObject({
        type: 'confirm_action',
      });
      expect(await agent.session.listCheckpoints()).toHaveLength(1);
      context.overwriteConfirmed = true;
      expect(await action('save')(context, 'occupied')).toMatchObject({
        messageType: 'info',
      });
      context.overwriteConfirmed = false;
      await action('save')(context, 'source');
      expect(await action('rename')(context, 'source occupied')).toMatchObject({
        type: 'confirm_action',
      });
      context.overwriteConfirmed = true;
      expect(await action('rename')(context, 'source occupied')).toMatchObject({
        messageType: 'info',
      });
      context.overwriteConfirmed = false;
      expect(await action('name')(context, 'occupied')).toMatchObject({
        type: 'confirm_action',
      });
      context.overwriteConfirmed = true;
      expect(await action('name')(context, 'occupied')).toMatchObject({
        messageType: 'info',
      });
      const path = agent.session.getRecording().path;
      if (!path) throw new Error('No owner recording');
      expect((await readRecordedFacts(path)).name).toBe('occupied');
      expect(await agent.session.listCheckpoints()).toHaveLength(0);
    });
  }, 30000);

  it('restores and clears owner history with journal projection and no duplicate client history write', async () => {
    await withRecordingLifetimeFixture(async ({ agent, chatsDir }) => {
      await agent.setHistory([
        human('first'),
        ai('one'),
        human('second'),
        ai('two'),
      ]);
      await agent.session.setRecording({ enabled: true });
      const action = ownerActions(agent);
      const context = createMockCommandContext({ services: { agent } });
      const setHistory = spyOn(agent.session, 'replaceHistory');
      try {
        const restored = await action('restore')(context, '1');
        expect(restored).toBeUndefined();
        expect(setHistory).not.toHaveBeenCalled();
        expect(JSON.stringify(await agent.session.getHistory())).not.toContain(
          'second',
        );
        expect(await readJournalItems(agent, 64, true)).toMatchObject([
          expect.objectContaining({ type: 'user', text: 'first' }),
          expect.objectContaining({ type: 'gemini', text: 'one' }),
        ]);
        await agent.setHistory([human('first'), ai('one'), human('third')]);
        expect(await action('clear')(context, '')).toBeUndefined();
        expect(JSON.stringify(await agent.session.getHistory())).not.toContain(
          'third',
        );
        expect(context.ui.clear).toHaveBeenCalled();
      } finally {
        setHistory.mockRestore();
      }
      const path = agent.session.getRecording().path;
      if (!path) throw new Error('No owner recording');
      expect(JSON.stringify(await readRecordedRows(path))).not.toContain(
        'third',
      );
      expect(
        (await readdir(chatsDir)).filter((file) => file.endsWith('.lock')),
      ).toHaveLength(1);
    });
  }, 30000);

  it('preserves live and durable history on restore failure and does not repaint UI', async () => {
    await withRecordingLifetimeFixture(async ({ agent }) => {
      await agent.setHistory([human('first'), ai('one'), human('second')]);
      await agent.session.setRecording({ enabled: true });
      const path = agent.session.getRecording().path;
      if (!path) throw new Error('No owner recording');
      const action = ownerActions(agent, async () => {
        throw new Error('restore interrupted');
      });
      const context = createMockCommandContext({ services: { agent } });

      const result = await action('restore')(context, '1');

      expect(result).toStrictEqual({
        type: 'message',
        messageType: 'error',
        content: 'Failed to restore history: restore interrupted',
      });
      expect(context.ui.clear).not.toHaveBeenCalled();
      expect(context.ui.addItem).not.toHaveBeenCalled();
      await agent.session.flushRecording();
      expect(JSON.stringify(await readRecordedRows(path))).toContain('second');
      expect(JSON.stringify(await agent.session.getHistory())).toContain(
        'second',
      );
      expect(context.ui.clear).not.toHaveBeenCalled();
    });
  }, 30000);

  for (const name of ['clear', 'restore']) {
    it(`rolls back the registered owner's ${name} when UI publication fails`, async () => {
      await withRecordingLifetimeFixture(async ({ agent }) => {
        await agent.setHistory([human('first'), ai('one'), human('second')]);
        await agent.session.setRecording({ enabled: true });
        const path = agent.session.getRecording().path;
        if (!path) throw new Error('No owner recording');
        const context = createMockCommandContext({ services: { agent } });
        const failure = new Error('UI invalidation failed');
        context.ui.clear = () => {
          throw failure;
        };

        expect(await ownerActions(agent)(name)(context, '1')).toStrictEqual({
          type: 'message',
          messageType: 'error',
          content: `Failed to ${name} history: ${failure.message}`,
        });
        expect(await agent.session.getHistory()).toMatchObject([
          human('first'),
          ai('one'),
          human('second'),
        ]);
        await agent.session.flushRecording();
        expect(await readRecordedRows(path)).toMatchObject([
          human('first'),
          ai('one'),
          human('second'),
        ]);
      });
    });
  }

  it('isolates borrowed sibling and resolves closed checkpoints by ID', async () => {
    await withRecordingLifetimeFixture(async ({ agent, borrow, chatsDir }) => {
      const sibling = await borrow();
      await agent.setHistory([human('owner')]);
      await agent.session.setRecording({ enabled: true });
      await sibling.setHistory([human('sibling')]);
      await sibling.session.setRecording({ enabled: true });
      const saved = await sibling.session.createCheckpoint('foreign');
      const siblingPath = sibling.session.getRecording().path;
      await sibling.session.setRecording({ enabled: false });
      const action = ownerActions(agent);
      const context = createMockCommandContext({ services: { agent } });
      expect(
        await action('rename')(context, 'foreign new-foreign'),
      ).toMatchObject({ messageType: 'info' });
      expect(
        await action('delete')(context, `${saved.checkpointId} --force`),
      ).toMatchObject({ messageType: 'info' });
      if (!siblingPath) throw new Error('No sibling recording');
      expect(await readJournalCheckpoints(siblingPath)).toStrictEqual([]);
      const ownerPath = agent.session.getRecording().path;
      if (!ownerPath) throw new Error('No owner recording');
      expect(await readFile(ownerPath, 'utf8')).not.toContain('new-foreign');
      expect(
        (await readdir(chatsDir)).filter((file) => file.endsWith('.lock')),
      ).toHaveLength(1);
    });
  }, 30000);
  it('resumes a checkpoint through the same owner with journal projection', async () => {
    await withRecordingLifetimeFixture(async ({ agent, chatsDir }) => {
      await agent.setHistory([human('branch-point'), ai('first')]);
      await agent.session.setRecording({ enabled: true });
      await agent.session.createCheckpoint('branch');
      await agent.setHistory([
        human('branch-point'),
        ai('first'),
        human('later'),
      ]);
      const action = ownerActions(agent);
      const context = createMockCommandContext({ services: { agent } });
      expect(await action('resume')(context, 'branch')).toBeUndefined();
      expect(await readJournalItems(agent, 64, true)).toMatchObject([
        expect.objectContaining({ type: 'user', text: 'branch-point' }),
        expect.objectContaining({ type: 'gemini', text: 'first' }),
      ]);
      expect(context.ui.clear).not.toHaveBeenCalled();
      expect(JSON.stringify(await agent.session.getHistory())).not.toContain(
        'later',
      );
      expect(
        (await readdir(chatsDir)).filter((file) => file.endsWith('.lock')),
      ).toHaveLength(1);
    });
  }, 30000);
  it('reads empty history from the owner without opening a second recorder', async () => {
    await withRecordingLifetimeFixture(async ({ agent, chatsDir }) => {
      await agent.session.setRecording({ enabled: true });
      const action = ownerActions(agent);
      const context = createMockCommandContext({ services: { agent } });
      expect(await action('clear')(context, '')).toMatchObject({
        content: 'No conversation to clear.',
      });
      expect(await agent.session.getHistory()).toHaveLength(0);
      expect(
        (await readdir(chatsDir)).filter((file) => file.endsWith('.lock')),
      ).toHaveLength(1);
    });
  }, 30000);

  it('counts history for /chat clear without materializing or streaming it', async () => {
    await withRecordingLifetimeFixture(async ({ agent }) => {
      await agent.session.setRecording({ enabled: true });
      const context = createMockCommandContext({ services: { agent } });
      const action = ownerActions(agent);
      const materialized = spyOn(agent.session, 'getHistory');
      const clientScan = spyOn(agent.session, 'readInitializedHistory');
      const publicScan = spyOn(agent, 'streamHistory');
      try {
        expect(await action('clear')(context, '')).toMatchObject({
          content: 'No conversation to clear.',
        });
        expect(materialized).not.toHaveBeenCalled();
        expect(clientScan).not.toHaveBeenCalled();
        expect(publicScan).not.toHaveBeenCalled();
      } finally {
        materialized.mockRestore();
        clientScan.mockRestore();
        publicScan.mockRestore();
      }
    });
  }, 30000);

  it('counts history for /chat debug without materializing or streaming it', async () => {
    await withRecordingLifetimeFixture(async ({ agent }) => {
      await agent.setHistory([human('first'), ai('one'), human('second')]);
      await agent.session.setRecording({ enabled: true });
      const context = createMockCommandContext({ services: { agent } });
      const action = ownerActions(agent);
      const materialized = spyOn(agent.session, 'getHistory');
      const clientScan = spyOn(agent.session, 'readInitializedHistory');
      const publicScan = spyOn(agent, 'streamHistory');
      try {
        const debug = await action('debug')(context, '');
        expect(debug).toMatchObject({
          content: expect.stringMatching(
            /Chat initialized: true[\s\S]*History entries: 3/,
          ),
        });
        expect(materialized).not.toHaveBeenCalled();
        expect(clientScan).not.toHaveBeenCalled();
        expect(publicScan).not.toHaveBeenCalled();
      } finally {
        materialized.mockRestore();
        clientScan.mockRestore();
        publicScan.mockRestore();
      }
    });
  }, 30000);

  it('keeps the complete restored transcript on disk beyond former history limits', async () => {
    await withRecordingLifetimeFixture(async ({ agent }) => {
      const pairs = 1000;
      await agent.session.setRecording({ enabled: true });
      await agent.setHistory(
        Array.from({ length: pairs }, (_unused, index) => [
          human(`question ${index}`),
          ai(`answer ${index}`),
        ]).flat(),
      );
      const context = createMockCommandContext({
        services: {
          agent,
        },
      });

      const action = ownerActions(agent);
      expect(await action('restore')(context, '1')).toBeUndefined();

      let restoredRows = 0;
      let lastText: string | undefined;
      for await (const row of agent.streamHistory()) {
        restoredRows += 1;
        const block = row.blocks.at(-1);
        lastText = block?.type === 'text' ? block.text : undefined;
      }
      expect(restoredRows).toBe((pairs - 1) * 2);
      expect(lastText).toBe(`answer ${pairs - 2}`);
    });
  }, 60000);
});
