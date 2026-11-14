/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, it, expect } from 'bun:test';
import { act } from 'react';
import { renderHook } from '../../__tests__/render.js';
import { useHistory } from './useHistoryManager.js';
import { createTurnStore } from '../stores/turn/turnStore.js';
import {
  readJournalItems,
  withJournalTurn,
} from '../stores/turn/journal-turn-test-helpers.js';

describe('journal-backed history commands', () => {
  it('starts without resident transcript state', () => {
    const turn = createTurnStore();
    const hook = renderHook(() => useHistory(turn));
    expect(Object.keys(hook.result.current).sort()).toStrictEqual([
      'addItem',
      'clearItems',
    ]);
    expect(turn.commands.getJournalLength()).toBe(0);
    hook.unmount();
  });

  it('publishes added notices through the journal instead of hook state', async () => {
    await withJournalTurn(async (turn, agent) => {
      const hook = renderHook(() => useHistory(turn));
      let first = 0;
      let second = 0;
      act(() => {
        first = hook.result.current.addItem({ type: 'info', text: 'First' }, 1);
        second = hook.result.current.addItem(
          { type: 'warning', text: 'Second' },
          1,
        );
      });
      const items = await readJournalItems(agent);
      expect(items.map((item) => [item.type, item.text])).toStrictEqual([
        ['info', 'First'],
        ['warning', 'Second'],
      ]);
      expect(second).toBeGreaterThan(first);
      expect(items.every((item) => item.rowIdentity?.kind === 'journal')).toBe(
        true,
      );
      hook.unmount();
    });
  });

  it('keeps complete text beyond the former count and byte limits on disk', async () => {
    await withJournalTurn(async (turn, agent, client) => {
      const owner = renderHook(() => useHistory(turn));
      const reader = renderHook(() => useHistory(turn));
      const text = 'x'.repeat(11000);
      for (let index = 0; index < 401; index++) {
        act(() => {
          owner.result.current.addItem({
            type: 'info',
            text: `${index}:${text}`,
          });
        });
        const history = client.getHistoryService();
        if (history === null) throw new Error('Missing journal history');
        await history.waitForCommit();
      }
      const items = await readJournalItems(agent, 401);
      expect(items).toHaveLength(401);
      expect(items.every((item) => item.text?.endsWith(text) === true)).toBe(
        true,
      );
      expect(items[0].text?.startsWith('0:')).toBe(true);
      expect(items.at(-1)?.text?.startsWith('400:')).toBe(true);
      reader.unmount();
      owner.unmount();
    });
  }, 180000);

  it('retains repeated model turns without a second UI duplicate filter', async () => {
    await withJournalTurn(async (_turn, agent) => {
      await agent.setHistory([
        { speaker: 'human', blocks: [{ type: 'text', text: 'Repeat' }] },
        { speaker: 'ai', blocks: [{ type: 'text', text: 'Answer' }] },
        { speaker: 'human', blocks: [{ type: 'text', text: 'Repeat' }] },
      ]);
      expect(
        (await readJournalItems(agent)).map((item) => item.text),
      ).toStrictEqual(['Repeat', 'Answer', 'Repeat']);
    });
  });

  it('invalidates the journal viewport on every clear', () => {
    const turn = createTurnStore();
    const hook = renderHook(() => useHistory(turn));
    act(() => hook.result.current.clearItems());
    expect(turn.store.getState().historyEpoch).toBe(1);
    act(() => hook.result.current.clearItems());
    expect(turn.store.getState().historyEpoch).toBe(2);
    hook.unmount();
  });

  it('fails immediately when an add has no journal binding', () => {
    const hook = renderHook(() => useHistory(createTurnStore()));
    expect(() =>
      hook.result.current.addItem({ type: 'info', text: 'lost' }),
    ).toThrow('UI journal is not bound');
    hook.unmount();
  });
});
