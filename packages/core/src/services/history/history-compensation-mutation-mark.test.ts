/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { HistoryService } from './HistoryService.js';
import type { IContent } from './IContent.js';

function row(text: string): IContent {
  return { speaker: 'human', blocks: [{ type: 'text', text }] };
}

describe('history mutation identity after compensation', () => {
  it('restores the prior identity without reusing an abandoned mutation identity', async () => {
    const history = new HistoryService();
    try {
      await history.addBatch([row('original')]);
      const original = history.historyMutationGuard();
      let abandoned = (): boolean => false;
      const failure = new Error('observer rejected publication');
      history.once('contentBatchAdded', () => {
        abandoned = history.historyMutationGuard();
        throw failure;
      });
      await expect(history.addBatch([row('rejected')])).rejects.toBe(failure);
      expect(original()).toBe(true);
      expect(abandoned()).toBe(false);
      const rows: IContent[] = [];
      for await (const content of history.streamRawHistory())
        rows.push(content);
      expect(rows.map((content) => content.blocks)).toStrictEqual([
        row('original').blocks,
      ]);
      await history.addBatch([row('accepted')]);
      expect(original()).toBe(false);
      expect(abandoned()).toBe(false);
    } finally {
      await history.dispose();
    }
  });
});
