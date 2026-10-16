/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { createHistoryStore } from './historyBackend.js';
import type { RemovedInteriorSpan } from './historyEventTypes.js';
import type { IContent } from './IContent.js';

function row(speaker: 'human' | 'ai', text: string, seq: number): IContent {
  return {
    speaker,
    blocks: [{ type: 'text', text }],
    metadata: { chronology: { seq, userTurn: 1, step: seq, recordedAt: 1 } },
  };
}

describe('HistoryStorePort whole operations on the old store', () => {
  it('clear empties the store and publishes the cleared span', async () => {
    const store = createHistoryStore({}, 'old');
    try {
      store.apply({ kind: 'content', content: row('human', 'one', 3) });
      store.apply({ kind: 'content', content: row('ai', 'two', 4) });
      const published: RemovedInteriorSpan[][] = [];

      store.clear({
        spans: [],
        rollbackOnFailure: true,
        publish: (spans) => {
          published.push(spans);
        },
        restore: () => {},
      });

      expect(published).toStrictEqual([
        [{ start: 3, end: 4, reason: 'cleared' }],
      ]);
      expect(store.getLength()).toBe(0);
    } finally {
      await store.dispose();
    }
  });

  it('validateAndFix inserts the missing tool response and rollback removes it', async () => {
    const store = createHistoryStore({}, 'old');
    try {
      store.apply({
        kind: 'content',
        content: {
          speaker: 'ai',
          blocks: [
            { type: 'tool_call', id: 'call-1', name: 'tool', parameters: {} },
          ],
          metadata: {
            chronology: { seq: 1, userTurn: 1, step: 1, recordedAt: 1 },
          },
        },
      });
      let next = 2;
      const repair = store.validateAndFix({
        stamp: (content) => {
          if (content.metadata?.chronology !== undefined) return content;
          const seq = next++;
          content.metadata = {
            ...content.metadata,
            chronology: { seq, userTurn: 1, step: seq, recordedAt: 1 },
          };
          return content;
        },
      });
      expect(repair.inserted.length).toBe(1);
      expect(store.getLength()).toBe(2);

      repair.rollback();
      repair.close();
      expect(store.getLength()).toBe(1);
    } finally {
      await store.dispose();
    }
  });
});
