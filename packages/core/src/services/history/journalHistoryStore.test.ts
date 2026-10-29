/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as path from 'node:path';
import { journalPathOf } from './__tests__/support/journalPathOf.js';
import { afterEach, describe, expect, it } from 'bun:test';
import { openJournalReadOnly } from '../../journal/journalReader.js';
import { RECORD_KIND } from '../../journal/recordKinds.js';
import {
  testJournalSeams,
  type Failures,
} from '../../journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';
import type { IContent } from './IContent.js';
import { JournalHistoryStore } from './journalHistoryStore.js';
import { JournalSession } from './journalSession.js';

function row(speaker: 'human' | 'ai', text: string, seq?: number): IContent {
  return {
    speaker,
    blocks: [{ type: 'text', text }],
    ...(seq === undefined
      ? {}
      : {
          metadata: {
            chronology: { seq, userTurn: 1, step: seq, recordedAt: 1 },
          },
        }),
  };
}

function texts(contents: readonly IContent[]): string[] {
  return contents.map((content) =>
    content.blocks
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join(''),
  );
}

describe('journal history store', () => {
  const directory = useTempDir('journal-history-store-');
  const open: JournalHistoryStore[] = [];
  afterEach(async () => {
    for (const store of open.splice(0)) await store.dispose();
  });

  async function created(
    name: string,
    failures: Failures = {},
  ): Promise<{
    store: JournalHistoryStore;
    seams: ReturnType<typeof testJournalSeams>;
  }> {
    const seams = testJournalSeams(failures);
    const session = await JournalSession.create(path.join(directory(), name), {
      journal: seams.dependencies,
    });
    const store = new JournalHistoryStore(session);
    open.push(store);
    return { store, seams };
  }

  it('answers the length at once and the rows after the queue is durable', async () => {
    const { store } = await created('append.llxj');
    store.apply({ kind: 'content', content: row('human', 'one', 1) });
    store.apply({ kind: 'content', content: row('ai', 'two', 2) });
    expect(store.getLength()).toBe(2);

    await store.waitForDurable();
    expect(texts(await store.materialize())).toStrictEqual(['one', 'two']);
    expect(store.getLength()).toBe(2);
  });

  it('does not report durable, or publish, a group whose trailer write is held (defect 1)', async () => {
    const { store, seams } = await created('held.llxj', {
      gateTrailerAt: 0,
      recordKinds: true,
    });
    store.apply({ kind: 'content', content: row('human', 'held', 1) });
    let durable = false;
    const waiting = store.waitForDurable().then(() => {
      durable = true;
    });
    for (let spin = 0; spin < 500; spin++) {
      if (
        seams.events.some(
          (event) =>
            event.type === 'write' && event.kind === RECORD_KIND.TRAILER,
        )
      )
        break;
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    expect(store.getLength()).toBe(1);
    expect(durable).toBe(false);
    expect(store.lastAck).toBeUndefined();
    const outside = await openJournalReadOnly(journalPathOf(store));
    expect(outside.trailer).toBeUndefined();
    await outside.close();

    seams.release();
    await waiting;
    expect(durable).toBe(true);
    expect(store.lastAck?.commitSeq).toBe(1);
    const after = await openJournalReadOnly(journalPathOf(store));
    expect(after.trailer?.commitSeq).toBe(1);
    await after.close();
  });

  it('flushes each queued operation before it is acked, in order', async () => {
    const { store, seams } = await created('order.llxj');
    store.apply({ kind: 'content', content: row('human', 'a', 1) });
    store.apply({ kind: 'content', content: row('ai', 'b', 2) });
    await store.waitForDurable();
    const kinds = seams.events
      .filter((event) => event.type === 'flush' || event.type === 'write')
      .map((event) => event.type);
    // The header, then each group's row/transcript writes, flush and trailer.
    expect(kinds).toStrictEqual([
      'write',
      'write',
      'write',
      'flush',
      'write',
      'write',
      'write',
      'flush',
      'write',
    ]);
    expect(store.lastAck?.commitSeq).toBe(2);
  });

  it('rewinds exactly the rows asked for even when a merged row repeats a chronology number (defect 2)', async () => {
    const { store } = await created('rewind.llxj');
    for (const content of [
      row('human', 'r1', 1),
      row('ai', 'r2', 2),
      row('human', 'r3', 3),
      row('ai', 'm1', 1),
      row('human', 'm2', 2),
    ])
      store.apply({ kind: 'content', content });
    store.apply({ kind: 'rewind', itemsRemoved: 1, cutSeq: 2 });
    expect(store.getLength()).toBe(4);
    store.apply({ kind: 'rewind', itemsRemoved: 1, cutSeq: 1 });
    expect(store.getLength()).toBe(3);

    await store.waitForDurable();
    expect(texts(await store.materialize())).toStrictEqual(['r1', 'r2', 'r3']);
  });

  it('rewinds the whole history and rows appended after a rewind get fresh labels', async () => {
    const { store } = await created('rewind-all.llxj');
    store.apply({ kind: 'content', content: row('human', 'a', 1) });
    store.apply({ kind: 'content', content: row('ai', 'b', 2) });
    store.apply({ kind: 'rewind', itemsRemoved: 2 });
    expect(store.getLength()).toBe(0);
    store.apply({ kind: 'content', content: row('human', 'c', 3) });
    await store.waitForDurable();
    expect(texts(await store.materialize())).toStrictEqual(['c']);
  });

  it('refuses a rewind of more rows than the history holds, at once', async () => {
    const { store } = await created('rewind-over.llxj');
    store.apply({ kind: 'content', content: row('human', 'a', 1) });
    expect(() => store.apply({ kind: 'rewind', itemsRemoved: 2 })).toThrow(
      /rewind of 2 rows/,
    );
    expect(store.getLength()).toBe(1);
  });

  it('replaces the whole history by the summary on compression', async () => {
    const { store } = await created('compress.llxj');
    store.apply({ kind: 'content', content: row('human', 'a', 1) });
    store.apply({ kind: 'content', content: row('ai', 'b', 2) });
    store.apply({
      kind: 'compressed',
      summary: row('ai', 'summary', 3),
      itemsCompressed: 2,
    });
    expect(store.getLength()).toBe(1);
    store.apply({ kind: 'content', content: row('human', 'kept', 4) });
    await store.waitForDurable();
    expect(texts(await store.materialize())).toStrictEqual(['summary', 'kept']);
  });

  it('inserts a synthetic row after the first row with the anchor chronology number', async () => {
    const { store } = await created('insert.llxj');
    store.apply({ kind: 'content', content: row('human', 'a', 1) });
    store.apply({ kind: 'content', content: row('ai', 'b', 2) });
    store.apply({
      kind: 'syntheticInsert',
      payload: {
        content: row('ai', 'inserted', 9),
        chronologySeq: 9,
        afterSeq: 1,
      },
    });
    expect(store.getLength()).toBe(3);
    await store.waitForDurable();
    expect(texts(await store.materialize())).toStrictEqual([
      'a',
      'inserted',
      'b',
    ]);
  });

  it('fails the queue, and refuses more work, when a synthetic insert names no row', async () => {
    const { store } = await created('insert-missing.llxj');
    store.apply({ kind: 'content', content: row('human', 'a', 1) });
    store.apply({
      kind: 'syntheticInsert',
      payload: { content: row('ai', 'x', 9), chronologySeq: 9, afterSeq: 5 },
    });
    await expect(store.waitForDurable()).rejects.toThrow(/anchor/);
    await expect(store.waitForDurable()).rejects.toThrow(/anchor/);
    expect(() =>
      store.apply({ kind: 'content', content: row('human', 'b', 2) }),
    ).toThrow(/anchor/);
  });

  it('fails the queue on a failed flush and keeps what was acked', async () => {
    const { store } = await created('flush.llxj', { failFlushAt: 1 });
    store.apply({ kind: 'content', content: row('human', 'ok', 1) });
    await store.waitForDurable();
    store.apply({ kind: 'content', content: row('ai', 'lost', 2) });
    await expect(store.waitForDurable()).rejects.toThrow(
      /injected flush failure/,
    );
    expect(() =>
      store.apply({ kind: 'content', content: row('human', 'more', 3) }),
    ).toThrow(/injected flush failure/);
  });

  it('refuses the operations that later slices implement', async () => {
    const { store } = await created('later.llxj');
    expect(() => store.apply({ kind: 'replaceBegin', txId: 'tx' })).toThrow(
      /not implemented/,
    );
  });

  describe('streamRows', () => {
    async function filled(name: string): Promise<JournalHistoryStore> {
      const { store } = await created(name);
      for (const [index, word] of ['aaaa', 'bb', 'cccccc', 'd'].entries())
        store.apply({
          kind: 'content',
          content: row(index % 2 === 0 ? 'human' : 'ai', word, index + 1),
        });
      return store;
    }

    async function collect(rows: AsyncIterable<IContent>): Promise<string[]> {
      const out: IContent[] = [];
      for await (const content of rows) out.push(content);
      return texts(out);
    }

    it('settles the queue and yields every row', async () => {
      const store = await filled('stream-all.llxj');
      expect(await collect(store.streamRows())).toStrictEqual([
        'aaaa',
        'bb',
        'cccccc',
        'd',
      ]);
    });

    it('yields the most recent rows for a recent query', async () => {
      const store = await filled('stream-recent.llxj');
      expect(
        await collect(store.streamRows({ kind: 'recent', count: 2 })),
      ).toStrictEqual(['cccccc', 'd']);
    });

    it('yields the longest suffix inside the token budget', async () => {
      const store = await filled('stream-tokens.llxj');
      const countTokens = (content: IContent): number =>
        texts([content])[0].length;
      expect(
        await collect(
          store.streamRows({ kind: 'tokens', maxTokens: 6, countTokens }),
        ),
      ).toStrictEqual(['d']);
      expect(
        await collect(
          store.streamRows({ kind: 'tokens', maxTokens: 9, countTokens }),
        ),
      ).toStrictEqual(['bb', 'cccccc', 'd']);
    });

    it('stops when the signal aborts', async () => {
      const store = await filled('stream-abort.llxj');
      const controller = new AbortController();
      controller.abort(new Error('stop reading'));
      await expect(
        collect(store.streamRows(undefined, controller.signal)),
      ).rejects.toThrow(/stop reading/);
    });
  });

  it('reopens with what was acked', async () => {
    const file = path.join(directory(), 'reopen.llxj');
    const seams = testJournalSeams();
    const first = new JournalHistoryStore(
      await JournalSession.create(file, { journal: seams.dependencies }),
    );
    first.apply({ kind: 'content', content: row('human', 'a', 1) });
    first.apply({ kind: 'content', content: row('ai', 'b', 2) });
    await first.dispose();

    const second = new JournalHistoryStore(
      await JournalSession.open(file, {
        journal: testJournalSeams().dependencies,
      }),
    );
    open.push(second);
    expect(second.getLength()).toBe(2);
    expect(texts(await second.materialize())).toStrictEqual(['a', 'b']);
  });
});
