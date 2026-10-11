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

/** A content row stamped with the chronology marker that rewinds cut by. */
function row(seq: number, speaker: 'human' | 'ai' = 'human'): string {
  return line(seq, 'content', {
    content: {
      speaker,
      blocks: [{ type: 'text', text: `row-${seq}` }],
      metadata: {
        chronology: { seq, userTurn: seq, step: 0, recordedAt: '' },
      },
    },
  });
}

function rewind(seq: number, itemsRemoved: number, cutSeq?: number): string {
  return line(
    seq,
    'rewind',
    cutSeq === undefined ? { itemsRemoved } : { itemsRemoved, cutSeq },
  );
}

function open(pageRows: number): ScrollbackPagerStore {
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

function labels(from: number, to: number): string[] {
  return Array.from({ length: to - from + 1 }, (_, i) => `row-${from + i}`);
}

describe('production pager applies rewind membership', () => {
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'pager-rewind-'));
    file = join(directory, 'journal');
  });

  afterEach(async () => {
    await Promise.all(stores.splice(0).map((store) => store.close()));
    await rm(directory, { recursive: true, force: true });
  });

  it('shows the two surviving rows when the last of three is rewound', async () => {
    await writeFile(file, row(1) + row(2) + row(3) + rewind(4, 1, 3));
    const store = open(10);
    const summary = await store.resumeFromJournal();
    expect(texts(store)).toStrictEqual(['row-1', 'row-2']);
    expect(summary.atClearBoundary).toBe(false);
  });

  it('keeps a large retained prefix pageable after a restore, across restart', async () => {
    const prefix = 600;
    let body = '';
    for (let seq = 1; seq <= prefix + 50; seq += 1) body += row(seq);
    body += rewind(prefix + 51, 50, prefix + 1);
    for (let seq = prefix + 52; seq <= prefix + 54; seq += 1) body += row(seq);
    await writeFile(file, body);

    for (const attempt of [open(25), open(7)]) {
      await walkToFloor(attempt);
      expect(texts(attempt)).toStrictEqual([
        ...labels(1, prefix),
        ...labels(prefix + 52, prefix + 54),
      ]);
    }
  });

  it('pages back through the retained prefix from a resumed tail window', async () => {
    let body = '';
    for (let seq = 1; seq <= 40; seq += 1) body += row(seq);
    body += rewind(41, 10, 31);
    await writeFile(file, body);
    const store = open(10);
    await store.resumeFromJournal();
    expect(texts(store)).toStrictEqual(labels(21, 30));
    await store.pageBack();
    expect(texts(store)).toStrictEqual(labels(11, 30));
    expect(store.getState().atVisibilityFloor).toBe(false);
  });

  it('treats a rewind that cuts the first row as a full clear', async () => {
    await writeFile(
      file,
      row(1) + row(2) + row(3) + rewind(4, 3, 1) + row(5) + row(6),
    );
    const store = open(10);
    const summary = await store.resumeFromJournal();
    expect(texts(store)).toStrictEqual(['row-5', 'row-6']);
    expect(summary.atClearBoundary).toBe(true);
    expect(store.getState().atVisibilityFloor).toBe(true);
  });

  it('shows nothing after a clear with no later rows', async () => {
    await writeFile(file, row(1) + row(2) + rewind(3, 2, 1));
    const store = open(10);
    await store.resumeFromJournal();
    expect(texts(store)).toStrictEqual([]);
    expect(store.getState().atVisibilityFloor).toBe(true);
  });

  it('falls back to the removed-row count when the rewind has no cutSeq', async () => {
    await writeFile(file, row(1) + row(2) + row(3) + rewind(4, 2) + row(5));
    const store = open(10);
    await walkToFloor(store);
    expect(texts(store)).toStrictEqual(['row-1', 'row-5']);
  });

  it('applies a rewind appended after the pager opened', async () => {
    await writeFile(file, row(1) + row(2) + row(3));
    const store = open(10);
    await walkToFloor(store);
    await appendFile(file, rewind(4, 1, 3) + row(5));
    await store.invalidate();
    await walkToFloor(store);
    expect(texts(store)).toStrictEqual(['row-1', 'row-2', 'row-5']);
  });
});
