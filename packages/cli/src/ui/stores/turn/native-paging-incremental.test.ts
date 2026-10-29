/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IContent } from '@vybestack/llxprt-code-core';
import { JournalSession } from '@vybestack/llxprt-code-core/services/history/journalSession.js';
import { createRowCounters } from '../../../../../core/src/recording/journalCounters.js';
import { NativeJournalCursor } from './native-journal-cursor.js';
import { createScrollbackPagerStore } from './scrollbackPager.js';

import { JournalDisplayWriter } from '@vybestack/llxprt-code-core/journal/display-recording.js';

function human(seq: number): IContent {
  return {
    speaker: 'human',
    blocks: [{ type: 'text', text: `user${seq}` }],
    metadata: { chronology: { seq, userTurn: seq, step: 0, recordedAt: 0 } },
  };
}

async function fixture(
  action: (session: JournalSession) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'native-incremental-'));
  const session = await JournalSession.create(join(directory, 'journal.llxj'));
  try {
    await action(session);
  } finally {
    await session.close();
    await rm(directory, { recursive: true, force: true });
  }
}

describe('native incremental paging', () => {
  it('follows a notice committed after a displayed slash command', async () => {
    await fixture(async (session) => {
      const writer = new JournalDisplayWriter(session.store);
      await writer.append({ type: 'user' }, '/model fake-model');
      const cursor = await NativeJournalCursor.open(session.path, {}, 16);
      try {
        await cursor.pageBack(16);
        await writer.append(
          { type: 'slash' },
          "Switched model in provider 'fake'",
        );
        const page = await cursor.pageForward(16);
        expect(
          page.entries.flatMap((entry) =>
            entry.kind === 'projected' ? [entry.item.text] : [],
          ),
        ).toContain("Switched model in provider 'fake'");
      } finally {
        await cursor.close();
      }
    });
  });
  it('decodes only appended rows rather than rebuilding the journal', async () => {
    await fixture(async (session) => {
      const large = 1500;
      await session.append(
        Array.from({ length: large }, (_, index) => human(index + 1)),
      );
      const stats = createRowCounters();
      const cursor = await NativeJournalCursor.open(session.path, {
        counters: stats.counters,
      });
      try {
        expect(stats.snapshot().recordsDecoded).toBeLessThanOrEqual(large + 1);
        const before = stats.snapshot().recordsDecoded;
        for (let index = 1; index <= 40; index++) {
          await session.append([human(large + index)]);
          const { entries } = await cursor.pageForward(10);
          expect(entries.length).toBeLessThanOrEqual(2);
          expect(JSON.stringify(entries.at(-1))).toContain(
            `user${large + index}`,
          );
        }
        expect(stats.snapshot().recordsDecoded - before).toBeLessThanOrEqual(
          80,
        );
      } finally {
        await cursor.close();
      }
    });
  });

  it('refreshes pending tool results without duplicating user output', async () => {
    await fixture(async (session) => {
      await session.append([
        human(1),
        {
          speaker: 'ai',
          blocks: [
            { type: 'tool_call', id: 'c', name: 'read_file', parameters: {} },
          ],
        },
      ]);
      const store = createScrollbackPagerStore({
        filePath: session.path,
        pageRows: 1,
        viewport: {
          visibleKeys: [],
          viewportLines: 1,
          rowHeightLines: () => 1,
        },
        settings: {
          marginViewports: 0,
          byteFloorBytes: Infinity,
          purgeDebounceMs: 0,
        },
      });
      try {
        await store.resumeFromJournal();
        await store.pageBack();
        await session.append([
          {
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
          human(4),
        ]);
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
    });
  });
});
