/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, spyOn, type Mock } from 'bun:test';
import { readFile, readdir } from 'node:fs/promises';
import { readJournalCheckpoints } from '@vybestack/llxprt-code-core/recording/journalSessionListing.js';
import {
  readRecordedFacts,
  readRecordedRows,
} from '../../__tests__/journal-recording.js';
import { withRecordingLifetimeFixture } from '../../../../agents/src/api/__tests__/helpers/recording-owner-lifetime-fixture.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { chatOwnerCommand } from './chatOwnerCommand.js';

const human = (text: string) => ({
  speaker: 'human' as const,
  blocks: [{ type: 'text' as const, text }],
});
const ai = (text: string) => ({
  speaker: 'ai' as const,
  blocks: [{ type: 'text' as const, text }],
});

function action(name: string) {
  const handler = chatOwnerCommand.subCommands?.find(
    (cmd) => cmd.name === name,
  )?.action;
  if (!handler) throw new Error(`Missing /chat ${name}`);
  return handler;
}

describe('owner-backed /chat command route', () => {
  it('creates, lists, renames and deletes through one active owner and durable journal state', async () => {
    await withRecordingLifetimeFixture(async ({ agent, chatsDir }) => {
      await agent.setHistory([human('seed'), ai('reply')]);
      await agent.session.setRecording({ enabled: true });
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

  it('restores and clears owner history with UI-only replay and no duplicate client history write', async () => {
    await withRecordingLifetimeFixture(async ({ agent, chatsDir }) => {
      await agent.setHistory([
        human('first'),
        ai('one'),
        human('second'),
        ai('two'),
      ]);
      await agent.session.setRecording({ enabled: true });
      const context = createMockCommandContext({ services: { agent } });
      const client = agent.agentClient;
      const setHistory = spyOn(client, 'setHistory');
      try {
        const restored = await action('restore')(context, '1');
        expect(restored).toBeUndefined();
        expect(setHistory).not.toHaveBeenCalled();
        expect(JSON.stringify(await agent.session.getHistory())).not.toContain(
          'second',
        );
        expect(context.ui.loadHistory).toHaveBeenCalledWith([
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
      const context = createMockCommandContext({ services: { agent } });
      const client = agent.agentClient;
      const original = client.resetChat.bind(client);
      const fault = spyOn(client, 'resetChat').mockImplementationOnce(
        async (...args) => {
          await original(...args);
          throw new Error('restore interrupted');
        },
      );
      try {
        expect(await action('restore')(context, '1')).toMatchObject({
          messageType: 'error',
        });
      } finally {
        fault.mockRestore();
      }
      const path = agent.session.getRecording().path;
      if (!path) throw new Error('No owner recording');
      await agent.session.flushRecording();
      expect(JSON.stringify(await readRecordedRows(path))).toContain('second');
      expect(JSON.stringify(await agent.session.getHistory())).toContain(
        'second',
      );
      expect(context.ui.clear).not.toHaveBeenCalled();
    });
  }, 30000);

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
  it('resumes a checkpoint through the same owner with UI history replay', async () => {
    await withRecordingLifetimeFixture(async ({ agent, chatsDir }) => {
      await agent.setHistory([human('branch-point'), ai('first')]);
      await agent.session.setRecording({ enabled: true });
      await agent.session.createCheckpoint('branch');
      await agent.setHistory([
        human('branch-point'),
        ai('first'),
        human('later'),
      ]);
      const context = createMockCommandContext({ services: { agent } });
      expect(await action('resume')(context, 'branch')).toBeUndefined();
      expect(context.ui.loadHistory).toHaveBeenCalledWith([
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
      const materialized = spyOn(agent.session, 'getHistory');
      const clientScan = spyOn(agent.agentClient, 'getHistory');
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
      const materialized = spyOn(agent.session, 'getHistory');
      const clientScan = spyOn(agent.agentClient, 'getHistory');
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

  it('replays a restored transcript up to the configured historyMaxItems', async () => {
    await withRecordingLifetimeFixture(async ({ agent }) => {
      const pairs = 1000;
      await agent.setHistory(
        Array.from({ length: pairs }, (_unused, index) => [
          human(`question ${index}`),
          ai(`answer ${index}`),
        ]).flat(),
      );
      await agent.session.setRecording({ enabled: true });
      const context = createMockCommandContext({
        services: {
          agent,
          settings: { merged: { ui: { historyMaxItems: pairs * 2 } } },
        },
      });

      expect(await action('restore')(context, '1')).toBeUndefined();

      const [loaded] = (
        context.ui.loadHistory as Mock<(items: readonly unknown[]) => void>
      ).mock.calls[0];
      expect(loaded).toHaveLength((pairs - 1) * 2);
      expect(loaded.at(-1)).toMatchObject({ text: `answer ${pairs - 2}` });
    });
  }, 60000);
});
