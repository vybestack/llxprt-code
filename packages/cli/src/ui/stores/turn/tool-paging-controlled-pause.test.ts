/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  appendFile,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { RowOwnership } from '../../../../../core/src/recording/rowOwnership.js';
import { createRowCounters } from '../../../../../core/src/recording/journalCounters.js';
import { ProjectedJournalCursor } from './projected-journal-cursor.js';
import { createScrollbackPagerStore } from './scrollbackPager.js';
import type { HistoryItem } from '../../types.js';
import type { DisplayJournalEntry } from './journal-page-file.js';

const bound = { rows: 440, serializedBytes: 8_388_608 };
const pageCount = 512;
const callsPerPage = 16;
const callCount = pageCount * callsPerPage;

function line(seq: number, content: unknown): string {
  return (
    JSON.stringify({
      v: 1,
      seq,
      ts: '',
      type: 'content',
      payload: { content },
    }) + '\n'
  );
}

function call(id: string): object {
  return { type: 'tool_call', id, name: 'read_file', parameters: {} };
}

function journal(): string {
  const rows: string[] = [
    line(1, {
      speaker: 'ai',
      blocks: Array.from({ length: 35 }, (_, index) =>
        call(`opening-${index}`),
      ),
    }),
    line(2, {
      speaker: 'ai',
      blocks: Array.from({ length: callCount }, (_, index) =>
        call(`call-${index}`),
      ),
    }),
  ];
  for (let index = 1023; index >= 0; index -= 1) {
    rows.push(
      line(1026 - index, {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: `call-${index}`,
            toolName: 'read_file',
            result: `result-${index}`,
          },
        ],
      }),
    );
  }
  return rows.join('');
}

function group(
  item: HistoryItem,
): Extract<HistoryItem, { type: 'tool_group' }> {
  if (item.type !== 'tool_group') throw new Error('Expected tool group');
  return item;
}

function projected(entry: DisplayJournalEntry): HistoryItem {
  if (entry.kind !== 'projected') throw new Error('Expected projected page');
  return entry.item;
}

async function recordPause(
  charge: ReturnType<RowOwnership['snapshot']>,
  rowReleased: number,
): Promise<void> {
  await writeFile(
    join(
      process.cwd(),
      'tmp/verify854/p05d',
      `controlled-page-abort-${process.pid}.json`,
    ),
    JSON.stringify({ charge, rowReleased, scope: 'registered rows only' }),
  );
}

async function nextPage(
  iterator: AsyncGenerator<HistoryItem, void, unknown>,
): Promise<HistoryItem> {
  const result = await iterator.next();
  if (result.done === true) throw new Error('Missing yielded page');
  return result.value;
}

function register(ownership: RowOwnership) {
  const stats = createRowCounters();
  return { stats, counters: { ...stats.counters, ownership } };
}

async function withJournal(
  action: (directory: string, file: string) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(
    join(process.cwd(), 'tmp/verify854/p05d/controlled-page-'),
  );
  const file = join(directory, 'journal');
  try {
    await writeFile(file, journal());
    await action(directory, file);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function assertBound(ownership: RowOwnership): void {
  const live = ownership.snapshot();
  expect(live.liveRows).toBeLessThanOrEqual(bound.rows);
  expect(live.liveSerializedBytes).toBeLessThanOrEqual(bound.serializedBytes);
  expect(ownership.within(bound)).toBe(true);
}

describe('controlled projected-page lifetimes', () => {
  it(
    'keeps a caller-held page charged across a second read and rejects retained consumers',
    verifyTraversalAndConsumer,
    120000,
  );
  it(
    'aborts a signal-aware reader after yielding, including an EOF race, without publishing pages',
    verifyAbortAndEof,
    120000,
  );
  it(
    'invalidates queued pager calls without publishing the old generation',
    verifyPagerInvalidation,
    120000,
  );
  it(
    'keeps a yielded consumer charged while a second page read waits for abort',
    verifyYieldAndPendingRead,
    120000,
  );
});

async function verifyTraversalAndConsumer(): Promise<void> {
  await withJournal(async (directory, file) => {
    const ownership = new RowOwnership();
    const { counters, stats } = register(ownership);
    const checkpoints = await walkPages(
      directory,
      file,
      ownership,
      counters,
      stats,
    );
    await verifyRetainedPages(
      directory,
      file,
      ownership,
      counters,
      stats,
      checkpoints,
    );
    expect(ownership.snapshot().liveRows).toBe(0);
  });
}

interface PageCheckpoint {
  phase: string;
  charge: ReturnType<RowOwnership['snapshot']>;
}

async function verifyForwardPages(
  cursor: ProjectedJournalCursor,
  ownership: RowOwnership,
): Promise<void> {
  cursor.retainWindow(undefined, undefined, 'newer');
  for (let index = 0; index < pageCount + 3; index += 1) {
    const { entries } = await cursor.pageForward(1);
    const item = group(projected(entries[0]));
    const opener = index < 3;
    const start = opener ? index * callsPerPage : (index - 3) * callsPerPage;
    const prefix = opener ? 'opening-' : 'call-';
    expect(item.toolPage?.start).toBe(start);
    expect(item.tools.map((tool) => tool.callId)).toStrictEqual(
      Array.from(
        { length: opener ? Math.min(callsPerPage, 35 - start) : callsPerPage },
        (_, slot) => `${prefix}${start + slot}`,
      ),
    );
    assertBound(ownership);
  }
  expect((await cursor.pageForward(1)).entries).toHaveLength(0);
}

async function walkPages(
  directory: string,
  file: string,
  ownership: RowOwnership,
  counters: ReturnType<typeof register>['counters'],
  stats: ReturnType<typeof createRowCounters>,
): Promise<PageCheckpoint[]> {
  const cursor = await ProjectedJournalCursor.open(file, {
    counters,
    temporaryRoot: directory,
  });
  const retained: HistoryItem[] = [];
  const checkpoints: PageCheckpoint[] = [];
  try {
    const first = await cursor.pageBack(1);
    const held = group(projected(first.entries[0]));
    ownership.retain(held);
    retained.push(held);
    const second = await cursor.pageBack(1);
    expect(group(projected(second.entries[0])).toolPage?.start).toBe(
      callCount - 32,
    );
    expect(ownership.snapshot().liveRows).toBe(2);
    checkpoints.push({
      phase: 'caller-held old + cursor-held new',
      charge: ownership.snapshot(),
    });
    expect(stats.snapshot().rowsDecoded).toBe(1026);
    expect(stats.snapshot().peakDecodedRows).toBeLessThanOrEqual(1);
    assertBound(ownership);
    ownership.release(held);
    retained.pop();
    for (let index = 2; index < pageCount; index += 1) {
      const { entries } = await cursor.pageBack(1);
      const item = group(projected(entries[0]));
      expect(item.toolPage?.start).toBe(callCount - (index + 1) * callsPerPage);
      expect(item.tools.map((tool) => tool.callId)).toStrictEqual(
        Array.from(
          { length: callsPerPage },
          (_, slot) => `call-${callCount - (index + 1) * callsPerPage + slot}`,
        ),
      );
      for (const tool of item.tools) {
        const id = Number(tool.callId.slice(5));
        expect(tool.resultDisplay).toBe(id < 1024 ? `result-${id}` : undefined);
      }
      assertBound(ownership);
    }
    for (const start of [32, 16, 0]) {
      const { entries } = await cursor.pageBack(1);
      const item = group(projected(entries[0]));
      expect(item.toolPage).toStrictEqual({ start, total: 35, groupIndex: 0 });
      expect(item.tools.map((tool) => tool.callId)).toStrictEqual(
        Array.from(
          { length: Math.min(16, 35 - start) },
          (_, slot) => `opening-${start + slot}`,
        ),
      );
      assertBound(ownership);
    }
    await verifyForwardPages(cursor, ownership);
    await cursor.close();
    checkpoints.push({
      phase: 'cursor close',
      charge: ownership.snapshot(),
    });
    expect(ownership.snapshot().liveRows).toBe(0);
  } finally {
    await cursor.close();
    for (const item of retained) ownership.release(item);
  }
  return checkpoints;
}

async function verifyRetainedPages(
  directory: string,
  file: string,
  ownership: RowOwnership,
  counters: ReturnType<typeof register>['counters'],
  stats: ReturnType<typeof createRowCounters>,
  checkpoints: PageCheckpoint[],
): Promise<void> {
  const retained: HistoryItem[] = [];
  const negative = await ProjectedJournalCursor.open(file, {
    counters,
    temporaryRoot: directory,
  });
  try {
    for (let index = 0; index < pageCount; index += 1) {
      const { entries } = await negative.pageBack(1);
      const entry = entries[0];
      if (entry.kind !== 'projected')
        throw new Error('Expected projected page');
      ownership.retain(entry.item);
      retained.push(entry.item);
    }
  } finally {
    await negative.close();
  }
  expect(ownership.snapshot().liveRows).toBe(pageCount);
  expect(ownership.within(bound)).toBe(false);
  await writeFile(
    join(
      process.cwd(),
      'tmp/verify854/p05d',
      `controlled-page-row-charge-${process.pid}.json`,
    ),
    JSON.stringify({
      fixture: {
        calls: callCount,
        pages: pageCount,
        responses: 1024,
        openerCalls: 35,
      },
      afterConsumerClose: ownership.snapshot(),
      checkpoints,
      producer: stats.snapshot(),
      scope:
        'registered rows only; strings, buffers, parsed pages, wrappers and unregistered consumers excluded',
    }),
  );
  for (const item of retained) ownership.release(item);
  expect(ownership.snapshot().liveRows).toBe(0);
  expect(await readdir(directory)).toStrictEqual(['journal']);
}

async function verifyAbortAndEof(): Promise<void> {
  await withJournal(async (directory, file) => {
    for (const completion of ['reject', 'eof']) {
      const ownership = new RowOwnership();
      const { counters } = register(ownership);
      const controller = new AbortController();
      let enter!: () => void;
      const entered = new Promise<void>((resolve) => {
        enter = resolve;
      });
      let finalized = false;
      async function* read(
        _path: string,
        signal: AbortSignal,
      ): AsyncIterable<string> {
        try {
          yield await readFile(file, 'utf8');
          await new Promise<void>((resolve, reject) => {
            signal.addEventListener(
              'abort',
              () =>
                completion === 'reject' ? reject(signal.reason) : resolve(),
              { once: true },
            );
            enter();
          });
          if (completion === 'eof') return;
        } finally {
          finalized = true;
        }
      }
      const opening = ProjectedJournalCursor.open(file, {
        read,
        signal: controller.signal,
        counters,
        temporaryRoot: directory,
      });
      try {
        await entered;
        assertBound(ownership);
        controller.abort(new Error('cancel page read'));
        await expect(opening).rejects.toThrow('cancel page read');
        expect(finalized).toBe(true);
        expect(ownership.snapshot().liveRows).toBe(0);
        expect(await readdir(directory)).toStrictEqual(['journal']);
      } finally {
        controller.abort();
        await opening.catch(() => undefined);
      }
    }
  });
}

async function verifyPagerInvalidation(): Promise<void> {
  await withJournal(async (_directory, file) => {
    const ownership = new RowOwnership();
    const { counters } = register(ownership);
    const viewport = {
      visibleKeys: [] as string[],
      viewportLines: 1,
      rowHeightLines: () => 1,
    };
    const pager = createScrollbackPagerStore({
      filePath: file,
      viewport,
      pageRows: 1,
      counters,
      settings: {
        marginViewports: 0,
        byteFloorBytes: Infinity,
        purgeDebounceMs: 0,
      },
    });
    try {
      const older = pager.pageBack();
      const queued = pager.pageBack();
      await pager.invalidate();
      await Promise.all([older, queued]);
      expect(pager.getState().generation).toBe(1);
      expect(pager.getState().rows).toHaveLength(0);
      expect(ownership.snapshot().liveSerializedBytes).toBe(0);
      await pager.pageBack();
      expect(pager.getState().rows).toHaveLength(1);
      expect(
        group(pager.getState().rows[0].item).tools.length,
      ).toBeLessThanOrEqual(16);
      assertBound(ownership);
    } finally {
      await pager.close();
    }
    expect(ownership.snapshot().liveRows).toBe(0);
  });
}

async function verifyYieldAndPendingRead(): Promise<void> {
  await withJournal(async (directory, file) => {
    const ownership = new RowOwnership();
    const stats = createRowCounters();
    let released = 0;
    const counters = {
      ...stats.counters,
      ownership,
      rowReleased: () => {
        released += 1;
        stats.counters.rowReleased();
      },
    };
    let reads = 0;
    let enter!: () => void;
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    let settled = false;
    async function* read(
      _path: string,
      signal: AbortSignal,
    ): AsyncIterable<string> {
      reads += 1;
      try {
        yield await readFile(file, 'utf8');
        if (reads === 2) {
          await new Promise<void>((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), {
              once: true,
            });
            enter();
          });
        }
      } finally {
        if (reads === 2) settled = true;
      }
    }
    const cursor = await ProjectedJournalCursor.open(file, {
      read,
      counters,
      temporaryRoot: directory,
    });
    let consumer: HistoryItem | undefined;
    try {
      async function* consume(): AsyncGenerator<HistoryItem, void, unknown> {
        const page = await cursor.pageBack(1);
        yield projected(page.entries[0]);
      }
      const slow = consume();
      consumer = await nextPage(slow);
      ownership.retain(consumer);
      await appendFile(
        file,
        line(1027, {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'new tail' }],
        }),
      );
      const pending = cursor.pageForward(1);
      const outcome = pending.then(
        () => false,
        () => true,
      );
      await entered;
      expect(released).toBe(2053);
      assertBound(ownership);
      await recordPause(ownership.snapshot(), released);
      await cursor.close();
      expect(await outcome).toBe(true);
      expect(settled).toBe(true);
      expect(ownership.snapshot().liveRows).toBe(1);
      await slow.return(undefined);
    } finally {
      await cursor.close();
      if (consumer) ownership.release(consumer);
    }
    expect(ownership.snapshot().liveRows).toBe(0);
  });
}
