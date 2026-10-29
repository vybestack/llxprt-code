/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  appendFile,
  mkdtemp,
  readFile,
  rm,
  stat,
  truncate,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IContent } from '@vybestack/llxprt-code-core';
import { JournalSession } from '@vybestack/llxprt-code-core/services/history/journalSession.js';
import { encodeContentRow } from '@vybestack/llxprt-code-core/services/history/journalRowCodec.js';
import { TRAILER_RECORD_BYTES } from '@vybestack/llxprt-code-core/journal/trailerRecord.js';
import { writeNativeEdits } from './native-pager.fixtures.js';
import {
  createScrollbackPagerStore,
  type ScrollbackPagerStore,
} from './scrollbackPager.js';

let directory: string;
let file: string;
const stores: ScrollbackPagerStore[] = [];

function row(seq: number): IContent {
  return {
    speaker: 'human',
    blocks: [{ type: 'text', text: `row-${seq}` }],
    metadata: { chronology: { seq, userTurn: seq, step: 0, recordedAt: 0 } },
  };
}

async function replace(seqs: readonly number[]): Promise<void> {
  const session = await JournalSession.open(file);
  try {
    await session.store.commit([
      {
        kind: 'replace',
        rows: seqs.map((seq) => encodeContentRow(row(seq), { owner: 0 })),
      },
    ]);
  } finally {
    await session.close();
  }
}

type Stage =
  | 'at begin'
  | 'after the first row'
  | 'mid rows'
  | 'before commit'
  | 'with a torn native trailer';

async function stagedReplacement(
  seqs: readonly number[],
  stage: Stage,
): Promise<(next?: Stage) => Promise<void>> {
  const before = (await stat(file)).size;
  await replace(seqs);
  const bytes = await readFile(file);
  const session = await JournalSession.open(file);
  const ends: number[] = [];
  try {
    for await (const entry of session.store.rows())
      ends.push(entry.recordOffset + entry.recordLength);
  } finally {
    await session.close();
  }
  function endAt(point?: Stage): number {
    switch (point) {
      case 'at begin':
        return before;
      case 'after the first row':
        return ends[0];
      case 'mid rows':
        return ends[1];
      case 'before commit':
        return bytes.length - TRAILER_RECORD_BYTES;
      case 'with a torn native trailer':
        return bytes.length - 20;
      default:
        return bytes.length;
    }
  }
  let end = endAt(stage);
  await truncate(file, end);
  return async (next): Promise<void> => {
    const target = endAt(next);
    await appendFile(file, bytes.subarray(end, target));
    end = target;
  };
}

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

async function shown(): Promise<string[]> {
  const store = open();
  await walkToFloor(store);
  return texts(store);
}

describe('production pager applies replace transactions', () => {
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'pager-replace-'));
    file = join(directory, 'journal.llxj');
    await writeNativeEdits(file, [row(1), row(2)]);
  });
  afterEach(async () => {
    await Promise.all(stores.splice(0).map((store) => store.close()));
    await rm(directory, { recursive: true, force: true });
  });

  it('retains prior rows out of context once the replacement commits', async () => {
    await replace([4, 5, 6]);
    expect(await shown()).toStrictEqual([
      'row-1',
      'row-2',
      'row-4',
      'row-5',
      'row-6',
    ]);
    expect(
      stores
        .at(-1)
        ?.getState()
        .rows.map((row) => row.contextState),
    ).toStrictEqual([
      'purged',
      'purged',
      'in-context',
      'in-context',
      'in-context',
    ]);
  });
  it('keeps the transcript floor at file start after replacement', async () => {
    await replace([4]);
    const summary = await open().resumeFromJournal();
    expect(summary.atClearBoundary).toBe(false);
  });
  it.each<Stage>([
    'at begin',
    'after the first row',
    'mid rows',
    'before commit',
    'with a torn native trailer',
  ])('keeps the prior rows when interrupted %s', async (stage) => {
    await stagedReplacement([4, 5, 6], stage);
    expect(await shown()).toStrictEqual(['row-1', 'row-2']);
  });
  it('shows the prior rows when the transaction is aborted', async () => {
    const session = await JournalSession.open(file);
    async function* abortedRows(): AsyncGenerator<
      ReturnType<typeof encodeContentRow>
    > {
      yield encodeContentRow(row(4), { owner: 0 });
      yield encodeContentRow(row(5), { owner: 0 });
      throw new Error('Abort native replacement');
    }
    try {
      await expect(
        session.store.commit([{ kind: 'replace', rows: abortedRows() }]),
      ).rejects.toThrow('Abort native replacement');
    } finally {
      await session.close();
    }
    await writeNativeEdits(file, [row(7)], true);
    expect(await shown()).toStrictEqual(['row-1', 'row-2', 'row-7']);
  });
  it('appends after an unfinished transaction left by a crash', async () => {
    await stagedReplacement([4, 5], 'mid rows');
    await writeNativeEdits(file, [row(6)], true);
    expect(await shown()).toStrictEqual(['row-1', 'row-2', 'row-6']);
  });
  it('abandons the unfinished transaction on a later native mutation', async () => {
    await stagedReplacement([4], 'after the first row');
    const session = await JournalSession.open(file);
    try {
      await session.store.commit([
        { kind: 'setState', key: 'fixture', value: new Uint8Array([1]) },
      ]);
    } finally {
      await session.close();
    }
    await writeNativeEdits(file, [row(6)], true);
    expect(await shown()).toStrictEqual(['row-1', 'row-2', 'row-6']);
  });
  it('hides a live transaction until its commit arrives', async () => {
    const advance = await stagedReplacement([4, 5], 'after the first row');
    const store = open();
    await walkToFloor(store);
    expect(texts(store)).toStrictEqual(['row-1', 'row-2']);
    await advance('mid rows');
    await store.invalidate();
    await walkToFloor(store);
    expect(texts(store)).toStrictEqual(['row-1', 'row-2']);
    await advance();
    await writeNativeEdits(file, [row(7)], true);
    await store.invalidate();
    await walkToFloor(store);
    expect(texts(store)).toStrictEqual([
      'row-1',
      'row-2',
      'row-4',
      'row-5',
      'row-7',
    ]);
    expect(store.getState().rows.map((row) => row.contextState)).toStrictEqual([
      'purged',
      'purged',
      'in-context',
      'in-context',
      'in-context',
    ]);
  });
  it('pages a committed replacement across restarts', async () => {
    await replace([4, 5, 6, 7]);
    for (const pageRows of [3, 1]) {
      const store = open(pageRows);
      await walkToFloor(store);
      expect(texts(store)).toStrictEqual([
        'row-1',
        'row-2',
        'row-4',
        'row-5',
        'row-6',
        'row-7',
      ]);
      expect(
        store.getState().rows.map((row) => row.contextState),
      ).toStrictEqual([
        'purged',
        'purged',
        'in-context',
        'in-context',
        'in-context',
        'in-context',
      ]);
    }
  });
});
