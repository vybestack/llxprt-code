/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { JournalSession, RowOwnership } from '@vybestack/llxprt-code-core';
import { createRowCounters } from '../../../../core/src/recording/journalCounters.js';
import { useTempDir } from '@vybestack/llxprt-code-core/journal/__tests__/support/useTempDir.js';
import { createScrollbackPagerStore } from '../stores/turn/scrollbackPager.js';
import { NativeJournalCursor } from '../stores/turn/native-journal-cursor.js';
import type { HistoryItem } from '../types.js';
import type { NativeDisplayEntry } from '../stores/turn/native-journal-types.js';

const ROWS = 2048;
const PAGE_ROWS = 8;
const WINDOW_BOUND = { rows: 24, serializedBytes: 128 * 1024 };

async function seed(path: string): Promise<void> {
  const session = await JournalSession.create(path);
  try {
    for (let batch = 0; batch < ROWS / 64; batch++) {
      await session.append(
        Array.from({ length: 64 }, (_, index) => ({
          speaker: 'human',
          blocks: [
            {
              type: 'text',
              text: `row-${batch * 64 + index}: ${'x'.repeat(2048)}`,
            },
          ],
        })),
      );
    }
  } finally {
    await session.close();
  }
}

function retainPage(
  entries: readonly NativeDisplayEntry[],
  ownership: RowOwnership,
  retained: HistoryItem[],
): void {
  for (const entry of entries) {
    if (entry.kind !== 'projected') continue;
    ownership.retain(entry.item);
    retained.push(entry.item);
  }
}

async function retainingControl(path: string): Promise<RowOwnership> {
  const ownership = new RowOwnership();
  const cursor = await NativeJournalCursor.open(
    path,
    {
      counters: { ...createRowCounters().counters, ownership },
    },
    PAGE_ROWS,
  );
  const retained: HistoryItem[] = [];
  try {
    for (;;) {
      const page = await cursor.pageBack(PAGE_ROWS);
      retainPage(page.entries, ownership, retained);
      if (page.entries.length === 0) break;
    }
    expect(retained).toHaveLength(ROWS);
    return ownership;
  } finally {
    await cursor.close();
    for (const item of retained) ownership.release(item);
  }
}

describe('journal window residency', () => {
  const directory = useTempDir('journal-window-residency-');

  it('preserves the complete giant response in the session journal', async () => {
    const text = 'a very long assistant response. '.repeat(12500);
    const session = await JournalSession.create(
      join(directory(), 'giant.llxj'),
    );
    try {
      await session.append([
        { speaker: 'ai', blocks: [{ type: 'text', text }] },
      ]);
      let count = 0;
      for await (const row of session.rows()) {
        expect(row.content.blocks).toStrictEqual([{ type: 'text', text }]);
        count++;
      }
      expect(count).toBe(1);
    } finally {
      await session.close();
    }
  });

  it('keeps a complete session on disk while residency stays window-bounded and rejects a load-all consumer', async () => {
    const path = join(directory(), 'session.llxj');
    await seed(path);
    const ownership = new RowOwnership();
    const viewport = {
      visibleKeys: new Array<string>(),
      viewportLines: 4,
      rowHeightLines: () => 1,
    };
    const pager = createScrollbackPagerStore({
      filePath: path,
      pageRows: PAGE_ROWS,
      viewport,
      settings: { marginViewports: 1, byteFloorBytes: 0, purgeDebounceMs: 0 },
      counters: { ...createRowCounters().counters, ownership },
    });
    try {
      await pager.resumeFromJournal();
      expect(pager.getState().rows.at(-1)?.item.text).toContain(
        `row-${ROWS - 1}:`,
      );
      for (
        let pages = 0;
        pages <= ROWS / PAGE_ROWS && !pager.getState().atVisibilityFloor;
        pages++
      ) {
        const previousFirst = pager.getState().rows[0]?.key;
        viewport.visibleKeys = pager
          .getState()
          .rows.slice(0, 4)
          .map((row) => row.key);
        pager.reportViewport();
        pager.pageOut('newer');
        await new Promise((resolve) => setTimeout(resolve, 1));
        await pager.pageBack();
        expect(pager.getState().rows[0]?.key).not.toBe(previousFirst);
        expect(pager.metrics().residentRows).toBeLessThanOrEqual(16);
        expect(ownership.within(WINDOW_BOUND)).toBe(true);
      }
      expect(pager.getState().atVisibilityFloor).toBe(true);
      expect(pager.getState().rows[0]?.item.text).toContain('row-0:');
    } finally {
      await pager.close();
    }
    expect(ownership.snapshot().liveRows).toBe(0);
    const control = await retainingControl(path);
    expect(control.within(WINDOW_BOUND)).toBe(false);
    expect(control.snapshot().peakRows).toBeGreaterThanOrEqual(ROWS);
    expect(control.snapshot().liveRows).toBe(0);
  }, 180000);
});
