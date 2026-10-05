/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RowOwnership } from '../../../../../core/src/recording/rowOwnership.js';
import { createRowCounters } from '../../../../../core/src/recording/journalCounters.js';
import { ProjectedJournalCursor } from './projected-journal-cursor.js';
import type { DisplayJournalEntry } from './journal-page-file.js';

function human(seq: number): string {
  return `${JSON.stringify({ v: 1, seq, ts: '', type: 'content', payload: { content: { speaker: 'human', blocks: [{ type: 'text', text: `user:${seq}` }] } } })}\n`;
}

function item(entry: DisplayJournalEntry | undefined): object {
  if (entry?.kind !== 'projected') throw new Error('Expected projected row');
  return entry.item;
}

async function withCursor(
  execute: (
    cursor: ProjectedJournalCursor,
    ownership: RowOwnership,
    damage: (index: number) => Promise<() => Promise<void>>,
  ) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'journal-page-failure-'));
  const file = join(directory, 'journal');
  await writeFile(file, human(1) + human(2) + human(3));
  const ownership = new RowOwnership();
  const cursor = await ProjectedJournalCursor.open(file, {
    temporaryRoot: directory,
    counters: { ...createRowCounters().counters, ownership },
  });
  try {
    await execute(cursor, ownership, async (index) => {
      const scratch = (await readdir(directory)).find((name) =>
        name.startsWith('llxprt-display-pages-'),
      );
      if (!scratch) throw new Error('Missing display index');
      const offsets = join(directory, scratch, 'offsets');
      const original = await readFile(offsets);
      const data = await readFile(join(directory, scratch, 'data'));
      const damaged = Buffer.from(original);
      damaged.writeDoubleLE(data.length + 1, index * 16);
      await writeFile(offsets, damaged);
      return async (): Promise<void> => {
        await writeFile(offsets, original);
      };
    });
  } finally {
    await cursor.close();
    expect(ownership.snapshot().liveRows).toBe(0);
    expect(await readdir(directory)).toStrictEqual(['journal']);
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
          await expect(read(2)).rejects.toThrow('Truncated journal page');
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
      await withCursor(async (cursor, _ownership, damage) => {
        if (!reverse) {
          await cursor.pageBack(3);
          cursor.retainWindow(undefined, undefined, 'newer');
        }
        const read = (
          count: number,
        ): Promise<{ entries: DisplayJournalEntry[] }> =>
          reverse ? cursor.pageBack(count) : cursor.pageForward(count);
        await read(1);
        const heads = reverse
          ? [
              Buffer.byteLength(human(1) + human(2)),
              Buffer.byteLength(human(1) + human(2) + human(3)),
            ]
          : [0, Buffer.byteLength(human(1))];
        const restore = await damage(reverse ? 0 : 2);
        try {
          await expect(read(2)).rejects.toThrow('Truncated journal page');
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
