/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { HistoryService } from './HistoryService.js';
import type { IContent } from './IContent.js';
import { mergeRow } from './__tests__/support/history-merge-test-helpers.js';
import { exactTokenizer, rowsOf } from './chronology-rollback-test-helpers.js';

async function withHistories(
  action: (source: HistoryService, target: HistoryService) => Promise<void>,
): Promise<void> {
  const source = new HistoryService();
  const target = new HistoryService();
  source.setTokenizerFactory(exactTokenizer());
  target.setTokenizerFactory(exactTokenizer());
  try {
    await source.addBatch([mergeRow(10), mergeRow(11)]);
    await target.addBatch([mergeRow(0)]);
    await action(source, target);
  } finally {
    await source.dispose();
    await target.dispose();
  }
}

describe('journal merge row observers', () => {
  it('emits the batch, each appended row, tokens and range in order', async () => {
    await withHistories(async (source, target) => {
      const order: string[] = [];
      target.on('contentBatchAdded', () => order.push('batch'));
      target.on('contentAdded', (row) =>
        order.push(`row:${row.metadata?.chronology?.seq}`),
      );
      target.on('tokensUpdated', () => order.push('tokens'));
      target.on('contextRangeChanged', () => order.push('range'));
      await target.merge(source);
      expect(order).toStrictEqual([
        'batch',
        'row:11',
        'row:12',
        'tokens',
        'range',
      ]);
      expect(await rowsOf(target)).toStrictEqual([
        mergeRow(0),
        mergeRow(10),
        mergeRow(11),
      ]);
      expect(target.getTotalTokens()).toBe(12);
    });
  });

  it('restores rows, tokens and chronology when a row observer rejects publication', async () => {
    await withHistories(async (source, target) => {
      const failure = new Error('merge row observer failed');
      const seen: IContent[] = [];
      target.once('contentAdded', (row) => {
        seen.push(row);
        throw failure;
      });
      await expect(target.merge(source)).rejects.toBe(failure);
      expect(seen).toStrictEqual([mergeRow(10)]);
      expect(await rowsOf(target)).toStrictEqual([mergeRow(0)]);
      expect(target.getTotalTokens()).toBe(4);
      expect(await rowsOf(source)).toStrictEqual([mergeRow(10), mergeRow(11)]);
      const following: IContent = {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'following' }],
      };
      await target.addBatch([following]);
      const rows = await rowsOf(target);
      expect(rows).toHaveLength(2);
      expect(rows[1].metadata?.chronology?.seq).toBe(2);
      expect(following.metadata).toBeUndefined();
    });
  });
});
