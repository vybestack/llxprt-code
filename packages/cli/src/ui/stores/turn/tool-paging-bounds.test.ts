/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ProjectedJournalCursor } from './projected-journal-cursor.js';
import { RowOwnership } from '../../../../../core/src/recording/rowOwnership.js';
import { createRowCounters } from '../../../../../core/src/recording/journalCounters.js';
import type { HistoryItem } from '../../types.js';
import type { DisplayJournalEntry } from './journal-page-file.js';

function groupPage(
  entry: DisplayJournalEntry,
): Extract<HistoryItem, { type: 'tool_group' }> {
  if (entry.kind !== 'projected' || entry.item.type !== 'tool_group')
    throw new Error('Missing group page');
  return entry.item;
}

describe('disk paging ownership', () => {
  it('keeps disk paging bounded while distinguishing a retaining consumer', async () => {
    const directory = await mkdtemp(
      join(process.cwd(), 'tmp/verify854/p05d/toolpaging-recovery-bounds-'),
    );
    const file = join(directory, 'journal');
    const bound = { rows: 440, serializedBytes: 8 * 1024 * 1024 };
    const line = (content: unknown, seq: number): string =>
      JSON.stringify({ v: 1, seq, type: 'content', payload: { content } }) +
      '\n';
    try {
      const opener = {
        speaker: 'ai',
        blocks: Array.from({ length: 8192 }, (_, index) => ({
          type: 'tool_call',
          id: String(index),
          name: 'read_file',
          parameters: {},
        })),
      };
      await writeFile(file, line(opener, 1));
      const ownership = new RowOwnership();
      const cursor = await ProjectedJournalCursor.open(file, {
        temporaryRoot: directory,
        counters: { ...createRowCounters().counters, ownership },
      });
      const retained: HistoryItem[] = [];
      try {
        for (let index = 0; index < 512; index += 1) {
          const { entries } = await cursor.pageBack(1);
          const item = groupPage(entries[0]);
          expect(item.tools).toHaveLength(16);
          expect(item.toolPage?.start).toBe((511 - index) * 16);
        }
        expect(ownership.snapshot().liveRows).toBe(1);
        expect(ownership.within(bound)).toBe(true);
        await writeFile(
          'tmp/verify854/p05d/toolpaging-recovery-bounded.json',
          JSON.stringify(ownership.snapshot()),
        );
        cursor.retainWindow(undefined, undefined, 'newer');
        for (let index = 0; index < 512; index += 1) {
          const { entries } = await cursor.pageForward(1);
          const item = groupPage(entries[0]);
          ownership.retain(item);
          retained.push(item);
        }
        await cursor.close();
        expect(ownership.snapshot().liveRows).toBe(512);
        expect(ownership.within(bound)).toBe(false);
        await writeFile(
          'tmp/verify854/p05d/toolpaging-recovery-consumer.json',
          JSON.stringify(ownership.snapshot()),
        );
      } finally {
        await cursor.close();
        for (const item of retained) ownership.release(item);
      }
      expect(ownership.snapshot().liveRows).toBe(0);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 30000);
});
