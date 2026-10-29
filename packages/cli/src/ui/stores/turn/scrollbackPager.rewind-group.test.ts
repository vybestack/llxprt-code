/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  writeNativeEdits,
  type NativePagerEdit as Edit,
} from './native-pager.fixtures.js';
import type { IContent } from '@vybestack/llxprt-code-core';
import {
  createScrollbackPagerStore,
  type ScrollbackPagerStore,
} from './scrollbackPager.js';

let directory: string;
let file: string;
const stores: ScrollbackPagerStore[] = [];

function chronology(seq: number) {
  return { chronology: { seq, userTurn: seq, step: 0, recordedAt: 0 } };
}

function human(seq: number): IContent {
  return {
    speaker: 'human',
    blocks: [{ type: 'text', text: `row-${seq}` }],
    metadata: chronology(seq),
  };
}

function opener(seq: number, ids: string[]): IContent {
  return {
    speaker: 'ai',
    blocks: ids.map((id) => ({
      type: 'tool_call',
      id,
      name: 'read_file',
      parameters: {},
    })),
    metadata: chronology(seq),
  };
}

function result(seq: number, id: string): IContent {
  return {
    speaker: 'tool',
    blocks: [
      {
        type: 'tool_response',
        callId: id,
        toolName: 'read_file',
        result: `result-${id}`,
      },
    ],
    metadata: chronology(seq),
  };
}

function rewind(_seq: number, removed: number, cutSeq?: number): Edit {
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

/** One label per row; a tool call is `id=done` once its result shows. */
function shape(store: ScrollbackPagerStore): string[] {
  return store.getState().rows.map(({ item, contextState }) => {
    expect(contextState).toBe(item.type === 'gemini' ? 'purged' : 'in-context');
    if (item.type === 'user') return item.text;
    if (item.type !== 'tool_group') return item.type;
    const calls = item.tools.map((tool) =>
      JSON.stringify(tool).includes(`result-${tool.callId}`)
        ? `${tool.callId}=done`
        : `${tool.callId}=open`,
    );
    return `tools:${calls.join(',')}`;
  });
}

async function walkToFloor(store: ScrollbackPagerStore): Promise<void> {
  await store.resumeFromJournal();
  for (let guard = 0; guard < 10_000; guard += 1) {
    if (store.getState().atVisibilityFloor) return;
    await store.pageBack();
  }
  throw new Error('Never reached the visibility floor');
}

async function shapesAcrossRestart(): Promise<string[][]> {
  const shapes: string[][] = [];
  for (const attempt of [open(25), open(1)]) {
    await walkToFloor(attempt);
    shapes.push(shape(attempt));
  }
  return shapes;
}

const OPEN_AND_RESULTS: readonly Edit[] = [
  human(1),
  opener(2, ['c1', 'c2', 'c3']),
  result(3, 'c1'),
  result(4, 'c2'),
];

describe('production pager rewinds through a projected tool group', () => {
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'pager-rewind-group-'));
    file = join(directory, 'journal.llxj');
  });

  afterEach(async () => {
    await Promise.all(stores.splice(0).map((store) => store.close()));
    await rm(directory, { recursive: true, force: true });
  });

  it('keeps the answered call visible when its result leaves context', async () => {
    await writeNativeEdits(file, [
      human(1),
      opener(2, ['c1']),
      result(3, 'c1'),
      rewind(4, 1, 3),
    ]);
    const store = open(10);
    await store.resumeFromJournal();
    expect(shape(store)).toStrictEqual(['row-1', 'tools:c1=done', 'gemini']);
  });

  it('keeps all answered calls visible when the last result leaves context', async () => {
    await writeNativeEdits(file, [
      ...OPEN_AND_RESULTS,
      result(5, 'c3'),
      rewind(6, 1, 5),
    ]);
    for (const rows of await shapesAcrossRestart())
      expect(rows).toStrictEqual([
        'row-1',
        'tools:c1=done,c2=done,c3=done',
        'gemini',
      ]);
  });

  it('retains answers when the cut lands right after the opener', async () => {
    await writeNativeEdits(file, [...OPEN_AND_RESULTS, rewind(5, 2, 3)]);
    for (const rows of await shapesAcrossRestart())
      expect(rows).toStrictEqual([
        'row-1',
        'tools:c1=done,c2=done,c3=open',
        'gemini',
      ]);
  });

  it('cuts inside the group by removed-row count when there is no cutSeq', async () => {
    await writeNativeEdits(file, [...OPEN_AND_RESULTS, rewind(5, 1)]);
    for (const rows of await shapesAcrossRestart())
      expect(rows).toStrictEqual([
        'row-1',
        'tools:c1=done,c2=done,c3=open',
        'gemini',
      ]);
  });

  it('pages back from a resumed tail through a prefix and a cut group', async () => {
    const body: Edit[] = [];
    for (let seq = 1; seq <= 40; seq += 1) body.push(human(seq));
    body.push(
      opener(41, ['c1', 'c2']),
      result(42, 'c1'),
      result(43, 'c2'),
      rewind(44, 1, 43),
    );
    await writeNativeEdits(file, body);
    const store = open(5);
    await store.resumeFromJournal();
    const tail = 'tools:c1=done,c2=done';
    const resumed = shape(store);
    expect(resumed.at(-1)).toBe('gemini');
    expect(resumed.at(-2)).toBe(tail);
    expect(resumed.at(-3)).toBe('row-40');
    await store.pageBack();
    const older = shape(store);
    expect(older.length).toBeGreaterThan(resumed.length);
    expect(older.at(-1)).toBe('gemini');
    expect(older.at(-2)).toBe(tail);
    expect(older.at(-3)).toBe('row-40');
    expect(store.getState().atVisibilityFloor).toBe(false);
  });

  it('applies a cut through a group appended after the pager opened', async () => {
    await writeNativeEdits(file, OPEN_AND_RESULTS);
    const store = open(10);
    await walkToFloor(store);
    expect(shape(store)).toStrictEqual([
      'row-1',
      'tools:c1=done,c2=done,c3=open',
    ]);
    await writeNativeEdits(file, [rewind(5, 1, 4), human(6)], true);
    await store.invalidate();
    await walkToFloor(store);
    expect(shape(store)).toStrictEqual([
      'row-1',
      'tools:c1=done,c2=done,c3=open',
      'gemini',
      'row-6',
    ]);
  });
});
