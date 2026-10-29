/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IContent } from '@vybestack/llxprt-code-core';
import {
  writeNativeEdits,
  type NativePagerEdit,
} from './native-pager.fixtures.js';
import {
  createScrollbackPagerStore,
  type ScrollbackPagerStore,
} from './scrollbackPager.js';

let directory: string;
let file: string;
const stores: ScrollbackPagerStore[] = [];

function row(seq: number, speaker: 'human' | 'ai' = 'human'): IContent {
  return {
    speaker,
    blocks: [{ type: 'text', text: `row-${seq}` }],
    metadata: { chronology: { seq, userTurn: seq, step: 0, recordedAt: 0 } },
  };
}

function rewind(
  _seq: number,
  removed: number,
  cutSeq?: number,
): NativePagerEdit {
  return { removed, cutSeq };
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
    file = join(directory, 'journal.llxj');
  });

  afterEach(async () => {
    await Promise.all(stores.splice(0).map((store) => store.close()));
    await rm(directory, { recursive: true, force: true });
  });

  it('retains the rewound row with its context marker', async () => {
    await writeNativeEdits(file, [row(1), row(2), row(3), rewind(4, 1, 3)]);
    const store = open(10);
    const summary = await store.resumeFromJournal();
    expect(texts(store)).toStrictEqual(['row-1', 'row-2', 'row-3', 'gemini']);
    expect(store.getState().rows.map((row) => row.contextState)).toStrictEqual([
      'in-context',
      'in-context',
      'purged',
      'purged',
    ]);
    expect(summary.atClearBoundary).toBe(false);
  });

  it('keeps a large retained prefix pageable after a restore, across restart', async () => {
    const prefix = 600;
    const body: NativePagerEdit[] = [];
    for (let seq = 1; seq <= prefix + 50; seq += 1) body.push(row(seq));
    body.push(rewind(prefix + 51, 50, prefix + 1));
    for (let seq = prefix + 52; seq <= prefix + 54; seq += 1)
      body.push(row(seq));
    await writeNativeEdits(file, body);

    for (const attempt of [open(25), open(7)]) {
      await walkToFloor(attempt);
      expect(texts(attempt)).toStrictEqual([
        ...labels(1, prefix + 50),
        'gemini',
        ...labels(prefix + 52, prefix + 54),
      ]);
      expect(
        attempt.getState().rows.map((row) => row.contextState),
      ).toStrictEqual([
        ...Array(prefix).fill('in-context'),
        ...Array(51).fill('purged'),
        ...Array(3).fill('in-context'),
      ]);
    }
  });

  it('pages back through the retained prefix from a resumed tail window', async () => {
    const body: NativePagerEdit[] = [];
    for (let seq = 1; seq <= 40; seq += 1) body.push(row(seq));
    body.push(rewind(41, 10, 31));
    await writeNativeEdits(file, body);
    const store = open(10);
    await store.resumeFromJournal();
    expect(texts(store)).toStrictEqual([...labels(32, 40), 'gemini']);
    await store.pageBack();
    expect(texts(store)).toStrictEqual([...labels(22, 40), 'gemini']);
    expect(store.getState().atVisibilityFloor).toBe(false);
  });

  it('keeps the full transcript after a rewind cuts the first context row', async () => {
    await writeNativeEdits(file, [
      row(1),
      row(2),
      row(3),
      rewind(4, 3, 1),
      row(5),
      row(6),
    ]);
    const store = open(10);
    const summary = await store.resumeFromJournal();
    expect(texts(store)).toStrictEqual([
      'row-1',
      'row-2',
      'row-3',
      'gemini',
      'row-5',
      'row-6',
    ]);
    expect(store.getState().rows.map((row) => row.contextState)).toStrictEqual([
      'purged',
      'purged',
      'purged',
      'purged',
      'in-context',
      'in-context',
    ]);
    expect(summary.atClearBoundary).toBe(false);
    expect(store.getState().atVisibilityFloor).toBe(true);
  });

  it('keeps cleared rows visible and marked out of context', async () => {
    await writeNativeEdits(file, [row(1), row(2), rewind(3, 2, 1)]);
    const store = open(10);
    await store.resumeFromJournal();
    expect(texts(store)).toStrictEqual(['row-1', 'row-2', 'gemini']);
    expect(store.getState().rows.map((row) => row.contextState)).toStrictEqual([
      'purged',
      'purged',
      'purged',
    ]);
    expect(store.getState().atVisibilityFloor).toBe(true);
  });

  it('falls back to the removed-row count when the rewind has no cutSeq', async () => {
    await writeNativeEdits(file, [
      row(1),
      row(2),
      row(3),
      rewind(4, 2),
      row(5),
    ]);
    const store = open(10);
    await walkToFloor(store);
    expect(texts(store)).toStrictEqual([
      'row-1',
      'row-2',
      'row-3',
      'gemini',
      'row-5',
    ]);
    expect(store.getState().rows.map((row) => row.contextState)).toStrictEqual([
      'in-context',
      'purged',
      'purged',
      'purged',
      'in-context',
    ]);
  });

  it('applies a rewind appended after the pager opened', async () => {
    await writeNativeEdits(file, [row(1), row(2), row(3)]);
    const store = open(10);
    await walkToFloor(store);
    await writeNativeEdits(file, [rewind(4, 1, 3), row(5)], true);
    await store.invalidate();
    await walkToFloor(store);
    expect(texts(store)).toStrictEqual([
      'row-1',
      'row-2',
      'row-3',
      'gemini',
      'row-5',
    ]);
    expect(store.getState().rows.map((row) => row.contextState)).toStrictEqual([
      'in-context',
      'in-context',
      'purged',
      'purged',
      'in-context',
    ]);
  });
});
