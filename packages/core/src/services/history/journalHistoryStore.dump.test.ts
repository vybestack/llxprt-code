/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'bun:test';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';
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

function textOf(content: IContent): string {
  const block = content.blocks[0];
  return block.type === 'text' ? block.text : '';
}

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of source) items.push(item);
  return items;
}

describe('journal history store dump snapshot', () => {
  const directory = useTempDir('journal-history-dump-');
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

  it('reads the queued rows and keeps its version when later groups commit', async () => {
    const store = await created('dump.llxj');
    store.apply({ kind: 'content', content: row('human', 'one', 1) });
    store.apply({ kind: 'content', content: row('ai', 'two', 2) });

    const dump = await store.openDumpSnapshot();
    store.apply({ kind: 'content', content: row('human', 'three', 3) });
    store.apply({ kind: 'rewind', itemsRemoved: 1 });
    await store.waitForDurable();

    expect((await collect(dump.rows())).map(textOf)).toStrictEqual([
      'one',
      'two',
    ]);
    expect(
      (await collect(dump.chronology())).map((entry) => entry.seq),
    ).toStrictEqual([1, 2]);
    await dump.close();
  });

  it('refuses to read after it is closed', async () => {
    const store = await created('closed.llxj');
    store.apply({ kind: 'content', content: row('human', 'one', 1) });
    const dump = await store.openDumpSnapshot();
    await dump.close();

    await expect(collect(dump.rows())).rejects.toThrow(
      'Dump snapshot is closed',
    );
  });

  it('stops a reader that is open when the snapshot closes', async () => {
    const store = await created('mid.llxj');
    for (let seq = 1; seq <= 3; seq++)
      store.apply({ kind: 'content', content: row('human', `r${seq}`, seq) });
    const dump = await store.openDumpSnapshot();

    const reader = dump.rows()[Symbol.asyncIterator]();
    expect(textOf((await reader.next()).value as IContent)).toBe('r1');
    await dump.close();
    await expect(reader.next()).rejects.toThrow('Dump snapshot is closed');
  });
  it('releases the actual suspended raw row when its owner closes', async () => {
    const store = await created('raw-close.llxj');
    store.apply({ kind: 'content', content: row('human', 'one', 1) });
    const dump = await store.openDumpSnapshot();
    const reader = dump.rows()[Symbol.asyncIterator]();
    const weak = await (async (): Promise<WeakRef<IContent>> => {
      const result = await reader.next();
      if (result.done === true) throw new Error('Expected a raw row');
      return new WeakRef(result.value);
    })();
    await dump.close();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    Bun.gc(true);
    expect(weak.deref()).toBeUndefined();
  });

  it('releases the actual suspended curated row when its owner closes', async () => {
    const store = await created('curated-close.llxj');
    store.apply({ kind: 'content', content: row('human', 'one', 1) });
    const input = await store.openCompressionInput();
    const source = input.rows;
    if (!(Symbol.asyncIterator in source))
      throw new Error('Expected asynchronous native input');
    const reader = source[Symbol.asyncIterator]();
    const weak = await (async (): Promise<WeakRef<IContent>> => {
      const result = await reader.next();
      if (result.done === true) throw new Error('Expected a curated row');
      return new WeakRef(result.value);
    })();
    await input.close();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    Bun.gc(true);
    expect(weak.deref()).toBeUndefined();
    await expect(reader.next()).rejects.toThrow('closed');
    await expect(source.readRow(0)).rejects.toThrow('closed');
    await expect(source.sourceOrdinalAt(0)).rejects.toThrow('closed');
  });
  it('keeps service-curated membership, raw source ordinals and immutable version together', async () => {
    const store = await created('curated-ranks.llxj');
    const original: IContent[] = [
      row('human', 'head', 1),
      { speaker: 'ai', blocks: [] },
      { speaker: 'tool', blocks: [] },
      row('ai', 'kept assistant', 3),
      { speaker: 'ai', blocks: [{ type: 'text', text: '  ' }] },
      row('human', 'tail', 2),
    ];
    for (const content of original) store.apply({ kind: 'content', content });
    const input = await store.openCompressionInput();
    try {
      store.apply({ kind: 'rewind', itemsRemoved: 6 });
      store.apply({
        kind: 'content',
        content: row('human', 'new version', 99),
      });
      await store.waitForDurable();
      expect(input.rows.length).toBe(4);
      for (const [index, ordinal] of [0, 2, 3, 5].entries()) {
        expect(await input.rows.sourceOrdinalAt(index)).toBe(ordinal);
        expect(await input.rows.readRow(index)).toStrictEqual(
          original[ordinal],
        );
      }
      expect(await collect(input.previous.rows())).toStrictEqual(original);
      for (const invalid of [-1, 4, 0.5, Number.NaN]) {
        await expect(input.rows.readRow(invalid)).rejects.toThrow(RangeError);
        await expect(input.rows.sourceOrdinalAt(invalid)).rejects.toThrow(
          RangeError,
        );
      }
    } finally {
      await input.close();
    }
  });
});
