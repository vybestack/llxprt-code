/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createScrollbackPagerStore,
  type ScrollbackPagerStore,
} from './scrollbackPager.js';

let directory: string;
let file: string;
const stores: ScrollbackPagerStore[] = [];

function line(seq: number, type: string, payload: unknown): string {
  return JSON.stringify({ v: 1, seq, ts: '', type, payload }) + '\n';
}

function row(seq: number, tx?: string): string {
  return line(seq, 'content', {
    ...(tx === undefined ? {} : { tx }),
    content: {
      speaker: 'human',
      blocks: [{ type: 'text', text: `row-${seq}` }],
      metadata: {
        chronology: { seq, userTurn: seq, step: 0, recordedAt: '' },
      },
    },
  });
}

const begin = (seq: number): string =>
  line(seq, 'replace_begin', { txId: 'tx1' });
const commit = (seq: number, rowCount: number): string =>
  line(seq, 'replace_commit', { txId: 'tx1', rowCount });
const abort = (seq: number, rowCount: number): string =>
  line(seq, 'replace_abort', { txId: 'tx1', rowCount });
const densityMutation = (seq: number): string =>
  line(seq, 'density_mutation', { removedSeqs: [] });

const prior = row(1) + row(2);
const tx = (...seqs: number[]): string =>
  seqs.map((seq) => row(seq, 'tx1')).join('');

function open(pageRows = 10): ScrollbackPagerStore {
  const store = createScrollbackPagerStore({
    filePath: file,
    pageRows,
    viewport: { visibleKeys: [], viewportLines: 1, rowHeightLines: () => 1 },
    settings: {
      marginViewports: 0,
      byteFloorBytes: Infinity,
      purgeDebounceMs: 0,
    },
  });
  stores.push(store);
  return store;
}

function texts(store: ScrollbackPagerStore): string[] {
  return store
    .getState()
    .rows.map((r) => (r.item.type === 'user' ? r.item.text : r.item.type));
}

async function walkToFloor(store: ScrollbackPagerStore): Promise<void> {
  await store.resumeFromJournal();
  for (let guard = 0; guard < 10_000; guard += 1) {
    if (store.getState().atVisibilityFloor) return;
    await store.pageBack();
  }
  throw new Error('Never reached the visibility floor');
}

async function shownFor(body: string): Promise<string[]> {
  await writeFile(file, body);
  const store = open();
  await walkToFloor(store);
  return texts(store);
}

describe('production pager applies replace transactions', () => {
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'pager-replace-'));
    file = join(directory, 'journal');
  });

  afterEach(async () => {
    await Promise.all(stores.splice(0).map((store) => store.close()));
    await rm(directory, { recursive: true, force: true });
  });

  it('shows only the new rows once the transaction commits', async () => {
    const shown = await shownFor(prior + begin(3) + tx(4, 5, 6) + commit(7, 3));
    expect(shown).toStrictEqual(['row-4', 'row-5', 'row-6']);
  });

  it('reports a committed replacement as a clear boundary', async () => {
    await writeFile(file, prior + begin(3) + tx(4) + commit(5, 1));
    const store = open();
    const summary = await store.resumeFromJournal();
    expect(summary.atClearBoundary).toBe(true);
  });

  it.each([
    ['at begin', prior + begin(3)],
    ['after the first row', prior + begin(3) + tx(4)],
    ['mid rows', prior + begin(3) + tx(4, 5)],
    ['before commit', prior + begin(3) + tx(4, 5, 6)],
    [
      'with a torn commit line',
      prior + begin(3) + tx(4, 5, 6) + commit(7, 3).slice(0, 20),
    ],
  ])('keeps the prior rows when interrupted %s', async (_name, body) => {
    expect(await shownFor(body)).toStrictEqual(['row-1', 'row-2']);
  });

  it('shows the prior rows when the transaction is aborted', async () => {
    const shown = await shownFor(
      prior + begin(3) + tx(4, 5) + abort(6, 2) + row(7),
    );
    expect(shown).toStrictEqual(['row-1', 'row-2', 'row-7']);
  });

  it('appends after an unfinished transaction left by a crash', async () => {
    const shown = await shownFor(prior + begin(3) + tx(4, 5) + row(6));
    expect(shown).toStrictEqual(['row-1', 'row-2', 'row-6']);
  });

  it('abandons the unfinished transaction on any later history record', async () => {
    const shown = await shownFor(
      prior + begin(3) + tx(4) + densityMutation(5) + row(6),
    );
    expect(shown).toStrictEqual(['row-1', 'row-2', 'row-6']);
  });

  it('hides a live transaction until its commit arrives', async () => {
    await writeFile(file, prior + begin(3) + tx(4));
    const store = open();
    await walkToFloor(store);
    expect(texts(store)).toStrictEqual(['row-1', 'row-2']);

    await appendFile(file, tx(5));
    await store.invalidate();
    await walkToFloor(store);
    expect(texts(store)).toStrictEqual(['row-1', 'row-2']);

    await appendFile(file, commit(6, 2) + row(7));
    await store.invalidate();
    await walkToFloor(store);
    expect(texts(store)).toStrictEqual(['row-4', 'row-5', 'row-7']);
  });

  it('pages a committed replacement across restarts', async () => {
    await writeFile(file, prior + begin(3) + tx(4, 5, 6, 7) + commit(8, 4));
    for (const pageRows of [3, 1]) {
      const store = open(pageRows);
      await walkToFloor(store);
      expect(texts(store)).toStrictEqual(['row-4', 'row-5', 'row-6', 'row-7']);
    }
  });

  it('fails resume on a commit whose row count does not match', async () => {
    await writeFile(file, prior + begin(3) + tx(4, 5) + commit(6, 3));
    const store = open();
    await expect(store.resumeFromJournal()).rejects.toThrow(
      'journal cursor unavailable',
    );
    expect(texts(store)).toStrictEqual([]);
  });
});
