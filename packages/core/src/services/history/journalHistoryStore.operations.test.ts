/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'bun:test';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';
import type { RemovedInteriorSpan } from './historyEventTypes.js';
import type { IContent } from './IContent.js';
import { JournalHistoryStore } from './journalHistoryStore.js';
import { JournalSession } from './journalSession.js';

function row(speaker: 'human' | 'ai', text: string, seq: number): IContent {
  return {
    speaker,
    blocks: [{ type: 'text', text }],
    metadata: { chronology: { seq, userTurn: 1, step: seq, recordedAt: 1 } },
  };
}

describe('journal history store whole operations', () => {
  const directory = useTempDir('journal-history-operations-');
  const open: JournalHistoryStore[] = [];
  afterEach(async () => {
    for (const store of open.splice(0)) await store.dispose();
  });

  async function created(name: string): Promise<JournalHistoryStore> {
    const session = await JournalSession.create(path.join(directory(), name));
    const store = new JournalHistoryStore(session);
    open.push(store);
    return store;
  }

  function request(
    spans: readonly RemovedInteriorSpan[],
    published: RemovedInteriorSpan[][],
    rollbackOnFailure = true,
  ) {
    return {
      spans,
      rollbackOnFailure,
      publish: (next: RemovedInteriorSpan[]) => {
        published.push(next);
      },
      restore: () => {},
    };
  }

  it('clear removes every row and publishes the cleared span of the first to the last chronology number', async () => {
    const store = await created('clear.llxj');
    for (const [index, speaker] of (
      ['human', 'ai', 'human'] as const
    ).entries())
      store.apply({
        kind: 'content',
        content: row(speaker, `r${index}`, index + 5),
      });
    const published: RemovedInteriorSpan[][] = [];

    await store.clear(request([], published));

    expect(store.getLength()).toBe(0);
    expect(await store.materialize()).toStrictEqual([]);
    expect(published).toStrictEqual([
      [{ start: 5, end: 7, reason: 'cleared' }],
    ]);
  });

  it('clear of an empty history writes no group and publishes the merged earlier spans', async () => {
    const store = await created('empty.llxj');
    const published: RemovedInteriorSpan[][] = [];
    const earlier: RemovedInteriorSpan = {
      start: 1,
      end: 2,
      reason: 'cleared',
    };

    await store.clear(request([earlier], published));

    expect(store.lastAck).toBeUndefined();
    expect(published).toStrictEqual([[earlier]]);
  });

  it('clear keeps the rows removed when publishing fails and rollback is off, and reports the failure', async () => {
    const store = await created('failure.llxj');
    store.apply({ kind: 'content', content: row('human', 'one', 1) });
    const failure = new Error('observer failed');

    await expect(
      store.clear({
        spans: [],
        rollbackOnFailure: false,
        publish: () => {
          throw failure;
        },
        restore: () => {},
      }),
    ).rejects.toBe(failure);
    expect(await store.materialize()).toStrictEqual([]);
  });

  it('clear that must roll back reports that the row restore is not implemented yet', async () => {
    const store = await created('rollback.llxj');
    store.apply({ kind: 'content', content: row('human', 'one', 1) });
    let restored = 0;

    const failure = await store
      .clear({
        spans: [],
        rollbackOnFailure: true,
        publish: () => {
          throw new Error('observer failed');
        },
        restore: () => {
          restored++;
        },
      })
      .then(
        () => undefined,
        (error: unknown) => error,
      );

    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors.map(String)).toStrictEqual([
      'Error: observer failed',
      'Error: not implemented: S05 (restore the rows of a failed clear)',
    ]);
    expect(restored).toBe(1);
  });

  it.each([
    ['validateAndFix', 'S04'],
    ['adoptMediaOwner', 'S04'],
    ['captureCompensation', 'S05'],
    ['compensate', 'S05'],
    ['captureDetached', 'S05'],
  ] as const)('%s names the slice that implements it', async (name, slice) => {
    const store = await created(`${name}.llxj`);
    const call = store[name] as unknown as (...args: unknown[]) => unknown;
    expect(() => call.call(store)).toThrow(`not implemented: ${slice}`);
  });
});
