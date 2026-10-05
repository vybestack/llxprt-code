/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import { appendFile, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createScrollbackPagerStore } from './scrollbackPager.js';
import { ProjectedJournalCursor } from './projected-journal-cursor.js';
import { RowOwnership } from '../../../../../core/src/recording/rowOwnership.js';
import { createRowCounters } from '../../../../../core/src/recording/journalCounters.js';

let directory: string;

function line(seq: number, type: string, payload: unknown): string {
  return JSON.stringify({ v: 1, seq, ts: '', type, payload }) + '\n';
}

function human(seq: number): string {
  return line(seq, 'content', {
    content: {
      speaker: 'human',
      blocks: [{ type: 'text', text: `user${seq}` }],
    },
  });
}

function pager(filePath: string) {
  const viewport = {
    visibleKeys: [] as string[],
    viewportLines: 1,
    rowHeightLines: () => 1,
  };
  return {
    viewport,
    store: createScrollbackPagerStore({
      filePath,
      pageRows: 1,
      viewport,
      settings: {
        marginViewports: 0,
        byteFloorBytes: Infinity,
        purgeDebounceMs: 0,
      },
    }),
  };
}

function purge(
  store: ReturnType<typeof pager>['store'],
  direction: 'older' | 'newer',
): void {
  vi.useFakeTimers();
  try {
    store.pageOut(direction);
    vi.runAllTimers();
  } finally {
    vi.useRealTimers();
  }
}

describe('journal paging boundaries and cancellation', () => {
  beforeEach(async () => {
    directory = await mkdtemp(
      join(process.cwd(), 'tmp/verify854/p05d/toolpaging-recovery-fixture-'),
    );
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it(
    'does not mistake an older rewind for the current page floor',
    verifyDoesNotMistakeAnOlderRewindForTheCurrentPageFloor,
  );

  it(
    'evicts and restores individual same-span tool pages in both directions',
    verifyEvictsAndRestoresIndividualSameSpanToolPagesInBothDirections,
  );
  it(
    'refreshes pending pages when responses are appended without duplicating user output',
    verifyRefreshesPendingPagesWhenResponsesAreAppendedWithoutDuplicatingUserOutput,
  );

  it.each(['reject', 'late', 'complete'])(
    'aborts an unresolved controlled journal read (%s) and deletes both scratch indexes',
    verifyControlledReadCancellation,
  );
  it(
    'waits for an interrupted forward journal reader to close before close resolves',
    verifyWaitsForAnInterruptedForwardJournalReaderToCloseBeforeCloseResolves,
  );
  it(
    'does not publish an empty cursor when cancellation races end of file',
    verifyDoesNotPublishAnEmptyCursorWhenCancellationRacesEndOfFile,
  );
});

async function verifyDoesNotMistakeAnOlderRewindForTheCurrentPageFloor(): Promise<void> {
  const file = join(directory, 'journal');
  await writeFile(
    file,
    human(1) + line(2, 'rewind', {}) + human(3) + human(4) + human(5),
  );
  const { store } = pager(file);
  try {
    await store.resumeFromJournal();
    expect(store.getState().atVisibilityFloor).toBe(false);
    await store.pageBack();
    await store.pageBack();
    await store.pageBack();
    expect(
      store
        .getState()
        .rows.map((row) => (row.item.type === 'user' ? row.item.text : '')),
    ).toStrictEqual(['user3', 'user4', 'user5']);
    expect(store.getState().atVisibilityFloor).toBe(true);
  } finally {
    await store.close();
  }
}

function expectToolPages(
  store: ReturnType<typeof pager>['store'],
  keys: readonly string[],
): void {
  expect(store.getState().rows.map((row) => row.key)).toStrictEqual([...keys]);
  for (const [pageIndex, row] of store.getState().rows.entries()) {
    if (row.item.type !== 'tool_group') throw new Error('Missing tool page');
    const start = pageIndex * 16;
    expect(
      row.item.tools.map((tool) => [tool.callId, tool.resultDisplay]),
    ).toStrictEqual(
      Array.from({ length: Math.min(16, 65 - start) }, (_, index) => [
        `c${start + index}`,
        `response${start + index}`,
      ]),
    );
  }
}

async function writeToolPageJournal(file: string): Promise<void> {
  await writeFile(
    file,
    line(1, 'content', {
      content: {
        speaker: 'ai',
        blocks: Array.from({ length: 65 }, (_, index) => ({
          type: 'tool_call',
          id: `c${index}`,
          name: 'read_file',
          parameters: {},
        })),
      },
    }) +
      Array.from({ length: 65 }, (_, index) =>
        line(index + 2, 'content', {
          content: {
            speaker: 'tool',
            blocks: [
              {
                type: 'tool_response',
                callId: `c${index}`,
                toolName: 'read_file',
                result: `response${index}`,
              },
            ],
          },
        }),
      ).join(''),
  );
}

function expectBoundedToolPageOwnership(ownership: RowOwnership): void {
  const peak = ownership.snapshot();
  expect(peak.peakRows).toBeLessThanOrEqual(440);
  expect(peak.peakSerializedBytes).toBeLessThanOrEqual(8 * 1024 * 1024);
  expect(
    ownership.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
  ).toBe(true);
}

async function verifyEvictsAndRestoresIndividualSameSpanToolPagesInBothDirections(): Promise<void> {
  const file = join(directory, 'journal');
  await writeToolPageJournal(file);
  const ownership = new RowOwnership();
  const { viewport } = pager(file);
  const store = createScrollbackPagerStore({
    filePath: file,
    pageRows: 1,
    viewport,
    counters: { ...createRowCounters().counters, ownership },
    settings: {
      marginViewports: 0,
      byteFloorBytes: Infinity,
      purgeDebounceMs: 0,
    },
  });
  try {
    await store.resumeFromJournal();
    expect(store.getState().rows.map((row) => row.key)).toStrictEqual([
      'journal:0:toolGroup:tools:64',
    ]);
    expectBoundedToolPageOwnership(ownership);
    for (let index = 0; index < 4; index += 1) await store.pageBack();
    const keys = [0, 16, 32, 48, 64].map((start) =>
      start === 0
        ? 'journal:0:toolGroup'
        : `journal:0:toolGroup:tools:${start}`,
    );
    expectToolPages(store, keys);
    expectBoundedToolPageOwnership(ownership);
    for (let cycle = 0; cycle < 3; cycle += 1) {
      viewport.visibleKeys = [keys[2]];
      store.reportViewport();
      purge(store, 'older');
      purge(store, 'newer');
      expect(store.getState().rows.map((row) => row.key)).toStrictEqual([
        keys[2],
      ]);
      await store.pageBack();
      await store.pageBack();
      await store.pageForward();
      await store.pageForward();
      expectToolPages(store, keys);
      expectBoundedToolPageOwnership(ownership);
    }
    store.setContextWindow({ firstSeq: 2, lastSeq: 3 });
    expect(store.getState().rows).toHaveLength(1);
    await store.pageBack();
    await store.pageBack();
    await store.pageForward();
    await store.pageForward();
    expectToolPages(store, keys);
    expectBoundedToolPageOwnership(ownership);
    await store.invalidate();
    expect(store.getState().rows).toHaveLength(0);
    await store.resumeFromJournal();
    for (let index = 0; index < 4; index += 1) await store.pageBack();
    expectToolPages(store, keys);
    expectBoundedToolPageOwnership(ownership);
  } finally {
    await store.close();
  }
  expect(ownership.snapshot().liveRows).toBe(0);
}

async function verifyRefreshesPendingPagesWhenResponsesAreAppendedWithoutDuplicatingUserOutput(): Promise<void> {
  const file = join(directory, 'journal');
  await writeFile(
    file,
    human(1) +
      line(2, 'content', {
        content: {
          speaker: 'ai',
          blocks: [
            { type: 'tool_call', id: 'c', name: 'read_file', parameters: {} },
          ],
        },
      }),
  );
  const { store } = pager(file);
  try {
    await store.resumeFromJournal();
    await store.pageBack();
    await appendFile(
      file,
      line(3, 'content', {
        content: {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'c',
              toolName: 'read_file',
              result: 'completed',
            },
          ],
        },
      }) + human(4),
    );
    await store.pageForward();
    await store.pageForward();
    expect(
      store
        .getState()
        .rows.map((row) =>
          row.item.type === 'tool_group'
            ? row.item.tools[0].resultDisplay
            : row.item.text,
        ),
    ).toStrictEqual(['user1', 'completed', 'user4']);
    expect(store.getState().error).toBeNull();
  } finally {
    await store.close();
  }
}

async function verifyWaitsForAnInterruptedForwardJournalReaderToCloseBeforeCloseResolves(): Promise<void> {
  const file = join(directory, 'journal');
  await writeFile(file, human(1));
  let enter!: () => void;
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  let reads = 0;
  let released = false;
  const ownership = new RowOwnership();
  async function* read(
    _path: string,
    signal: AbortSignal,
  ): AsyncIterable<string> {
    reads += 1;
    yield human(1);
    if (reads === 1) return;
    try {
      yield line(2, 'content', {
        content: {
          speaker: 'ai',
          blocks: [
            { type: 'tool_call', id: 'c', name: 'read_file', parameters: {} },
          ],
        },
      });
      yield line(3, 'content', {
        content: {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'c',
              toolName: 'read_file',
              result: 'result',
            },
          ],
        },
      });
      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), {
          once: true,
        });
        enter();
      });
    } finally {
      released = true;
    }
  }
  const cursor = await ProjectedJournalCursor.open(file, {
    read,
    temporaryRoot: directory,
    counters: { ...createRowCounters().counters, ownership },
  });
  try {
    await appendFile(file, human(2));
    const pending = cursor.pageForward(1);
    const outcome = pending.then(
      () => 'published',
      () => 'cancelled',
    );
    await entered;
    await cursor.close();
    expect(released).toBe(true);
    expect(ownership.snapshot().liveRows).toBe(0);
    expect(await readdir(directory)).toStrictEqual(['journal']);
    expect(await outcome).toBe('cancelled');
  } finally {
    await cursor.close();
  }
}

async function verifyDoesNotPublishAnEmptyCursorWhenCancellationRacesEndOfFile(): Promise<void> {
  const file = join(directory, 'journal');
  await writeFile(file, '');
  const controller = new AbortController();
  const pending = ProjectedJournalCursor.open(file, {
    signal: controller.signal,
    temporaryRoot: directory,
    async *read(_path, signal) {
      controller.abort(new Error('cancel empty read'));
      expect(signal.aborted).toBe(true);
      yield* [];
    },
  });
  await expect(pending).rejects.toThrow('cancel empty read');
  expect(await readdir(directory)).toStrictEqual(['journal']);
}

async function verifyControlledReadCancellation(
  completion: string,
): Promise<void> {
  const file = join(directory, 'journal');
  await writeFile(file, '');
  let enter!: () => void;
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  const controller = new AbortController();
  const ownership = new RowOwnership();
  let closed = false;
  async function* read(
    _path: string,
    signal: AbortSignal,
  ): AsyncIterable<string> {
    try {
      yield line(1, 'content', {
        content: {
          speaker: 'ai',
          blocks: [
            {
              type: 'tool_call',
              id: 'c',
              name: 'read_file',
              parameters: {},
            },
          ],
        },
      });
      yield line(2, 'content', {
        content: {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'c',
              toolName: 'read_file',
              result: 'result',
            },
          ],
        },
      });
      await new Promise<void>((resolve, reject) => {
        signal.addEventListener(
          'abort',
          () => (completion === 'reject' ? reject(signal.reason) : resolve()),
          {
            once: true,
          },
        );
        enter();
      });
      if (completion === 'complete') return;
      yield human(3);
    } finally {
      closed = true;
    }
  }
  const pending = ProjectedJournalCursor.open(file, {
    signal: controller.signal,
    temporaryRoot: directory,
    read,
    counters: { ...createRowCounters().counters, ownership },
  });
  await entered;
  expect((await readdir(directory)).length).toBe(3);
  controller.abort(new Error('cancel journal'));
  await expect(pending).rejects.toThrow('cancel journal');
  expect(closed).toBe(true);
  expect(await readdir(directory)).toStrictEqual(['journal']);
  expect(ownership.snapshot().liveRows).toBe(0);
}
