/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { mkdtemp, open, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JournalSession } from '@vybestack/llxprt-code-core/services/history/journalSession.js';
import type { IContent } from '@vybestack/llxprt-code-core';
import { RowOwnership } from '../../../../../core/src/recording/rowOwnership.js';
import { createRowCounters } from '../../../../../core/src/recording/journalCounters.js';
import { NativeJournalCursor } from './native-journal-cursor.js';
import type { NativeDisplayEntry as DisplayJournalEntry } from './native-journal-types.js';

function human(seq: number): IContent {
  return {
    speaker: 'human',
    blocks: [{ type: 'text', text: `user:${seq}` }],
    metadata: { chronology: { seq, userTurn: seq, step: 0, recordedAt: 0 } },
  };
}

function item(entry: DisplayJournalEntry | undefined): object {
  if (entry?.kind !== 'projected') throw new Error('Expected projected row');
  return entry.item;
}

async function withCursor(
  execute: (
    cursor: NativeJournalCursor,
    ownership: RowOwnership,
    damage: (index: number) => Promise<() => Promise<void>>,
    fileBytes: number,
  ) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'journal-page-failure-'));
  const file = join(directory, 'journal.llxj');
  const session = await JournalSession.create(file);
  const offsets: number[] = [];
  try {
    await session.append([human(1), human(2), human(3)]);
    for await (const entry of session.store.rows())
      offsets.push(entry.recordOffset);
  } finally {
    await session.close();
  }
  const fileBytes = (await stat(file)).size;
  let damagedOffset: number | undefined;
  const ownership = new RowOwnership();
  const cursor = await NativeJournalCursor.open(file, {
    journal: {
      async open(path, flags) {
        const handle = await open(path, flags);
        return {
          fd: handle.fd,
          stat: () => handle.stat(),
          truncate: (length) => handle.truncate(length),
          close: () => handle.close(),
          write: (buffer, offset, length, position) =>
            handle.write(buffer, offset, length, position),
          writev: (buffers, position) => handle.writev(buffers, position),
          read: (buffer, offset, length, position) => {
            if (
              damagedOffset !== undefined &&
              position <= damagedOffset &&
              position + length > damagedOffset
            )
              throw new Error('Controlled native page read failure');
            return handle.read(buffer, offset, length, position);
          },
        };
      },
    },
    counters: { ...createRowCounters().counters, ownership },
  });
  try {
    await execute(
      cursor,
      ownership,
      async (index) => {
        damagedOffset = offsets[index];
        return async (): Promise<void> => {
          damagedOffset = undefined;
        };
      },
      fileBytes,
    );
  } finally {
    await cursor.close();
    expect(ownership.snapshot().liveRows).toBe(0);
    expect(await readdir(directory)).toStrictEqual(['journal.llxj']);
    await rm(directory, { recursive: true, force: true });
  }
}

for (const reverse of [true, false]) {
  describe(`atomic projected page failure, reverse=${reverse}`, () => {
    it('releases an unpublished partial page while preserving an independent consumer', async () => {
      await withCursor(async (cursor, ownership, damage) => {
        if (!reverse) {
          await cursor.pageBack(3);
          cursor.retainWindow(undefined, undefined, 'newer');
        }
        const read = (
          count: number,
        ): Promise<{ entries: DisplayJournalEntry[] }> =>
          reverse ? cursor.pageBack(count) : cursor.pageForward(count);
        const held = item((await read(1)).entries[0]);
        ownership.retain(held);
        const restore = await damage(reverse ? 0 : 2);
        try {
          await expect(read(2)).rejects.toThrow(
            'Controlled native page read failure',
          );
          expect(ownership.snapshot().liveRows).toBe(1);
          expect(
            ownership.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
          ).toBe(true);
        } finally {
          await restore();
          ownership.release(held);
        }
        expect(ownership.snapshot().liveRows).toBe(0);
      });
    });

    it('retries the same page after a read fault without skipping any row or moving either head', async () => {
      await withCursor(async (cursor, _ownership, damage, fileBytes) => {
        if (!reverse) {
          await cursor.pageBack(3);
          cursor.retainWindow(undefined, undefined, 'newer');
        }
        const read = (
          count: number,
        ): Promise<{ entries: DisplayJournalEntry[] }> =>
          reverse ? cursor.pageBack(count) : cursor.pageForward(count);
        await read(1);
        const heads = reverse ? [2, fileBytes] : [0, 1];
        const restore = await damage(reverse ? 0 : 2);
        try {
          await expect(read(2)).rejects.toThrow(
            'Controlled native page read failure',
          );
        } finally {
          await restore();
        }
        expect([cursor.windowStart(), cursor.windowEnd()]).toStrictEqual(heads);
        expect((await read(2)).entries.map((entry) => entry.seq)).toStrictEqual(
          reverse ? [2, 1] : [2, 3],
        );
        expect((await read(2)).entries).toStrictEqual([]);
      });
    });
  });
}
