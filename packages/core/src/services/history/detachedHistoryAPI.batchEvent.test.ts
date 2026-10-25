/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { RowOwnership } from '../../recording/rowOwnership.js';
import { notifyDetachedRows } from './detachedHistoryAPI.js';
import type { HistoryBatchEvent } from './history-batch-values.js';
import { HistoryService } from './HistoryService.js';
import type { IContent } from './IContent.js';

function textRow(text: string): IContent {
  return { speaker: 'human', blocks: [{ type: 'text', text }] };
}

function sourceOf(rows: readonly IContent[]) {
  return {
    length: rows.length,
    async *rows() {
      for (const row of rows) yield row;
    },
    retire: () => undefined,
  };
}

describe('notifyDetachedRows', () => {
  it('emits one contentBatchAdded whose rows a listener reads asynchronously after dispatch', async () => {
    const history = new HistoryService();
    const events: HistoryBatchEvent[] = [];
    history.on('contentBatchAdded', (batch) => {
      events.push(batch);
    });

    const notification = notifyDetachedRows(
      history,
      undefined,
      sourceOf([textRow('a'), textRow('b')]),
    ).then(
      () => ({ completed: true }),
      (error: unknown) => ({ error }),
    );

    expect(events).toHaveLength(1);
    const [batch] = events;
    if (!('rows' in batch)) throw new Error('Expected a committed row source');
    expect(batch.length).toBe(2);
    const texts: string[] = [];
    for await (const row of batch.rows()) {
      const block = row.blocks[0];
      texts.push(block.type === 'text' ? block.text : '');
    }
    expect(await notification).toStrictEqual({ completed: true });
    expect(texts).toStrictEqual(['a', 'b']);
    await history.dispose();
  });

  it('counts a row as owned only while the listener holds it', async () => {
    const history = new HistoryService();
    const ownership = new RowOwnership();
    const live: number[] = [];
    let consumed: Promise<void> | undefined;
    history.on('contentBatchAdded', (batch) => {
      if (!('rows' in batch)) throw new Error('Expected a row source');
      consumed = (async () => {
        for await (const row of batch.rows()) {
          void row;
          live.push(ownership.snapshot().liveRows);
        }
      })();
    });

    await Promise.all([
      notifyDetachedRows(
        history,
        ownership,
        sourceOf([textRow('a'), textRow('b'), textRow('c')]),
      ),
      consumed,
    ]);

    expect(live).toStrictEqual([1, 1, 1]);
    expect(ownership.snapshot().liveRows).toBe(0);
    expect(ownership.snapshot().acquisitions).toBe(3);
    await history.dispose();
  });
});
