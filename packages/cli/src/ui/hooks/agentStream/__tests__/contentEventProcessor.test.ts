import { waitFor } from '../../../../__tests__/render.js';
/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, it, expect } from 'bun:test';
import {
  withJournalTurn,
  readJournalItems,
} from '../../../stores/turn/journal-turn-test-helpers.js';

describe('journal content-prefix identity (issue #2263)', () => {
  it('keeps the selected profile label before its answer and thinking', async () => {
    await withJournalTurn(async (turn, agent, client) => {
      turn.commands.addItem({
        type: 'profile_change',
        profileName: 'work:gpt-4',
      });
      await waitFor(async () => {
        const rows = await readJournalItems(agent);
        expect(rows[0]).toMatchObject({
          type: 'profile_change',
          profileName: 'work:gpt-4',
        });
      });
      const history = client.getHistoryService();
      if (history === null) throw new Error('Missing history');
      const arrival = await history.openResponseArrival({
        id: 'answer',
        submissionId: 'prompt',
      });
      await arrival.append({
        type: 'thinking',
        thought: 'Analyzing the request',
      });
      await arrival.append({ type: 'text', text: 'hello world' });
      await arrival.seal({ model: 'gpt-4' });
      const items = await readJournalItems(agent);
      expect(items).toHaveLength(2);
      expect(items[0]).toMatchObject({
        type: 'profile_change',
        profileName: 'work:gpt-4',
      });
      expect(items[1]).toMatchObject({
        type: 'gemini',
        model: 'gpt-4',
        text: 'hello world',
        thinkingBlocks: [{ thought: 'Analyzing the request' }],
      });
    });
  });

  it('does not invent a profile identity from a model name', async () => {
    await withJournalTurn(async (_turn, agent) => {
      await agent.setHistory([
        {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'hello world' }],
          metadata: { model: 'gpt-4' },
        },
      ]);
      const items = await readJournalItems(agent);
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        type: 'gemini',
        text: 'hello world',
        model: 'gpt-4',
      });
      expect(items[0]).not.toHaveProperty('profileName');
    });
  });

  it('preserves earlier profile labels when the live identity changes', async () => {
    await withJournalTurn(async (turn, agent) => {
      turn.commands.addItem({
        type: 'profile_change',
        profileName: 'old:gpt-4',
      });
      turn.commands.addItem({
        type: 'profile_change',
        profileName: 'new:claude-3',
      });
      const labels = (await readJournalItems(agent)).flatMap((item) =>
        item.type === 'profile_change' ? [item.profileName] : [],
      );
      expect(labels).toStrictEqual(['old:gpt-4', 'new:claude-3']);
    });
  });
});
