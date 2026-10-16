/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MAX_RECORD_BYTES } from '@vybestack/llxprt-code-core';
import { createRowCounters } from '../../../../../core/src/recording/journalCounters.js';
import { ProjectedJournalCursor } from './projected-journal-cursor.js';
import { createScrollbackPagerStore } from './scrollbackPager.js';

const chunkBytes = 65_536;
const evidenceRoot = tmpdir();

function human(seq: number, text: string): string {
  return `${JSON.stringify({ v: 1, seq, ts: '', type: 'content', payload: { content: { speaker: 'human', blocks: [{ type: 'text', text }], metadata: { chronology: { seq, userTurn: seq, step: 0, recordedAt: '' } } } } })}\n`;
}

function purge(seq: number, bytes: number): string {
  const survivors = 'x'.repeat(bytes);
  return `${JSON.stringify({ v: 2, seq, ts: '', type: 'semantic_media_purge', payload: { survivors } })}\n`;
}

async function withJournal(
  body: string,
  action: (file: string, directory: string) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(evidenceRoot, 'framing-'));
  const file = join(directory, 'journal');
  try {
    await writeFile(file, body);
    await action(file, directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function pager(file: string) {
  return createScrollbackPagerStore({
    filePath: file,
    viewport: { visibleKeys: [], viewportLines: 10, rowHeightLines: () => 1 },
    pageRows: 8,
    chunkBytes,
    settings: {
      marginViewports: 2,
      byteFloorBytes: Number.POSITIVE_INFINITY,
      purgeDebounceMs: 1500,
    },
  });
}

function userTexts(store: ReturnType<typeof pager>): string[] {
  return store
    .getState()
    .rows.map((row) => (row.item.type === 'user' ? row.item.text : '?'));
}

describe('bounded production pager framing', () => {
  it('skips a large v2 purge record without decoding or assembling it', async () => {
    const body =
      human(1, 'before') + purge(2, 24 * 1024 * 1024) + human(3, 'after');
    await withJournal(body, async (file, directory) => {
      const { counters, snapshot } = createRowCounters();
      const cursor = await ProjectedJournalCursor.open(file, {
        chunkBytes,
        counters,
        temporaryRoot: directory,
      });
      try {
        expect(cursor.metrics().maxAssembledRecordBytes).toBeLessThan(
          2 * chunkBytes,
        );
        expect(snapshot().recordsDecoded).toBe(2);
        expect(cursor.size()).toBe(Buffer.byteLength(body));
      } finally {
        await cursor.close();
      }
    });
  });

  it('diagnoses an oversized record by length and keeps paging', async () => {
    const oversized = `${JSON.stringify({ v: 1, seq: 2, ts: '', type: 'content', payload: { content: { speaker: 'human', blocks: [{ type: 'text', text: 'y'.repeat(MAX_RECORD_BYTES + chunkBytes) }] } } })}\n`;
    await withJournal(
      human(1, 'first') + oversized + human(3, 'last'),
      async (file, directory) => {
        const store = pager(file);
        try {
          await store.resumeFromJournal();
          expect(userTexts(store)).toStrictEqual(['first', 'last']);
        } finally {
          await store.close();
        }
        const cursor = await ProjectedJournalCursor.open(file, {
          chunkBytes,
          temporaryRoot: directory,
        });
        try {
          const metrics = cursor.metrics();
          expect(metrics.oversizedRecords).toBe(1);
          expect(metrics.maxAssembledRecordBytes).toBeLessThan(
            MAX_RECORD_BYTES,
          );
        } finally {
          await cursor.close();
        }
      },
    );
  });

  it('drops a torn tail and an unterminated oversized tail', async () => {
    await withJournal(
      human(1, 'kept') + human(2, 'also'),
      async (file, directory) => {
        await appendFile(
          file,
          '{"v":1,"seq":3,"type":"content","payload":{"co',
        );
        await appendFile(file, 'z'.repeat(MAX_RECORD_BYTES + chunkBytes));
        const cursor = await ProjectedJournalCursor.open(file, {
          chunkBytes,
          temporaryRoot: directory,
        });
        try {
          const { entries } = await cursor.pageBack(10);
          expect(entries).toHaveLength(2);
          expect(cursor.metrics().maxAssembledRecordBytes).toBeLessThan(
            2 * chunkBytes,
          );
        } finally {
          await cursor.close();
        }
      },
    );
  });

  it('skips a malformed complete line without losing the following rows', async () => {
    await withJournal(
      human(1, 'a') +
        '{"v":1,"seq":2,"type":"content","payload":{\n' +
        human(3, 'b'),
      async (file) => {
        const store = pager(file);
        try {
          await store.resumeFromJournal();
          expect(userTexts(store)).toStrictEqual(['a', 'b']);
        } finally {
          await store.close();
        }
      },
    );
  });
});
