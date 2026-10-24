/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'bun:test';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';
import type { DetachedHistoryHost } from './detachedHistoryMutation.js';
import { ChronologyStamper } from './historyChronology.js';
import type { HistoryBatchRowSource } from './history-batch-values.js';
import type { HistoryMergeRequest } from './historyStorePort.js';
import type { IContent } from './IContent.js';
import { JournalHistoryStore } from './journalHistoryStore.js';
import { JournalSession } from './journalSession.js';

function row(
  speaker: IContent['speaker'],
  text: string,
  seq: number,
): IContent {
  return {
    speaker,
    blocks: text === '' ? [] : [{ type: 'text', text }],
    metadata: { chronology: { seq, userTurn: 1, step: seq, recordedAt: 7 } },
  };
}

async function shapes(store: JournalHistoryStore): Promise<unknown[]> {
  const out: unknown[] = [];
  for await (const content of store.streamRows()) {
    out.push([
      content.speaker,
      content.blocks
        .map((block) => (block.type === 'text' ? block.text : block.type))
        .join(''),
      content.metadata?.chronology?.seq,
    ]);
  }
  return out;
}

describe('JournalHistoryStore.mergeFrom', () => {
  const directory = useTempDir('journal-merge-');
  const open: JournalHistoryStore[] = [];
  let counter = 0;

  afterEach(async () => {
    for (const store of open.splice(0)) await store.dispose();
  });

  async function openStore(rows: IContent[]): Promise<JournalHistoryStore> {
    const session = await JournalSession.create(
      path.join(directory(), `merge-${counter++}.llxj`),
    );
    const store = new JournalHistoryStore(session);
    open.push(store);
    for (const content of rows) store.apply({ kind: 'content', content });
    await store.waitForDurable();
    return store;
  }

  function hostFor(
    store: JournalHistoryStore,
    batches: HistoryBatchRowSource[],
  ): DetachedHistoryHost {
    return {
      journal: store,
      chronology: new ChronologyStamper(() => 0),
      snapshot: () => ({
        tokens: 0,
        spans: [],
        chronology: new ChronologyStamper(() => 0).snapshot(),
      }),
      apply: () => {},
      waitForTokenUpdates: () => Promise.resolve(),
      estimate: (rows) => Promise.resolve([...rows].length),
      notify: () => {},
      notifyBatch: () => undefined,
      notifyRows: (source) => {
        batches.push(source);
      },
      notifyTokens: () => {},
      notifyRange: () => {},
    };
  }

  function requestOf(
    source: JournalHistoryStore,
    target: JournalHistoryStore,
    batches: HistoryBatchRowSource[],
  ): HistoryMergeRequest {
    return {
      source,
      host: hostFor(target, batches),
      publish: reject,
    };
  }

  it('appends the accepted source rows after the target rows, with their markers, and skips rows with no blocks', async () => {
    const source = await openStore([
      row('human', 'one', 11),
      row('ai', '', 12),
      row('ai', 'three', 13),
    ]);
    const target = await openStore([row('human', 'base', 1)]);
    const batches: HistoryBatchRowSource[] = [];

    await target.mergeFrom(requestOf(source, target, batches));

    expect(await shapes(target)).toStrictEqual([
      ['human', 'base', 1],
      ['human', 'one', 11],
      ['ai', 'three', 13],
    ]);
    expect(await shapes(source)).toHaveLength(3);
    expect(batches).toHaveLength(1);
  });

  it('writes and announces nothing when no source row is accepted', async () => {
    const source = await openStore([row('human', '', 11)]);
    const target = await openStore([row('human', 'base', 1)]);
    const batches: HistoryBatchRowSource[] = [];

    await target.mergeFrom(requestOf(source, target, batches));

    expect(await shapes(target)).toStrictEqual([['human', 'base', 1]]);
    expect(batches).toHaveLength(0);
  });

  it('merges an empty source without touching the target', async () => {
    const source = await openStore([]);
    const target = await openStore([row('human', 'base', 1)]);

    await target.mergeFrom(requestOf(source, target, []));

    expect(await shapes(target)).toStrictEqual([['human', 'base', 1]]);
  });
  it('keeps distinct rows sharing a sequence through native self-merge, pop and pinned membership lookup', async () => {
    const target = await openStore([
      row('human', 'first', 7),
      row('ai', 'second', 7),
      row('tool', 'third', 2),
    ]);
    await target.mergeFrom(requestOf(target, target, []));
    expect(await shapes(target)).toStrictEqual([
      ['human', 'first', 7],
      ['ai', 'second', 7],
      ['tool', 'third', 2],
      ['human', 'first', 7],
      ['ai', 'second', 7],
      ['tool', 'third', 2],
    ]);
    target.apply({ kind: 'rewind', itemsRemoved: 1 });
    await target.waitForDurable();
    const input = await target.openCompressionInput();
    try {
      expect(input.rows.length).toBe(5);
      if (input.previous.compressionSpan === undefined)
        throw new Error('Expected native chronology lookup');
      expect(
        (
          await input.previous.compressionSpan(
            { ranges: [{ from: 0, to: 4 }], generated: [] },
            false,
          )
        ).span,
      ).toStrictEqual({ fromSeq: Infinity, toSeq: -Infinity, itemCount: 0 });
      expect(await input.rows.sourceOrdinalAt(4)).toBe(4);
    } finally {
      await input.close();
    }
  });
});

/** The journal store publishes detached groups; the mutation-snapshot arm belongs to the old store. */
function reject(): Promise<never> {
  return Promise.reject(new Error('the journal store does not use this'));
}
