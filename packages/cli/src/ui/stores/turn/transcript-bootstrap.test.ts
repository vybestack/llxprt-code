/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  JournalSession,
  NativeJournalPageReader,
  type IContent,
} from '@vybestack/llxprt-code-core';
import { createRowCounters } from '@vybestack/llxprt-code-core/recording/journalCounters.js';
import { RowOwnership } from '@vybestack/llxprt-code-core/recording/rowOwnership.js';
import { NativeJournalCursor } from './native-journal-cursor.js';
import { createScrollbackPagerStore } from './scrollbackPager.js';
import { waitFor } from '../../../__tests__/render.js';

function assertWindow(count: number): void {
  if (count > 5) throw new Error('Decoded rows exceed the viewport window');
}

describe('transcript bootstrap and residency', () => {
  let directory: string;
  let path: string;
  let session: JournalSession;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'transcript-bootstrap-'));
    path = join(directory, 'session.llxj');
    session = await JournalSession.create(path);
  });
  afterEach(async () => {
    await session.close();
    await rm(directory, { recursive: true, force: true });
  });

  it('reconciles an append after the initial file size was captured', async () => {
    await session.append([
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'before bootstrap' }],
      },
    ]);
    let injected = false;
    const pager = createScrollbackPagerStore({
      filePath: path,
      pageRows: 4,
      viewport: { visibleKeys: [], viewportLines: 4, rowHeightLines: () => 1 },
      settings: {
        marginViewports: 1,
        byteFloorBytes: 65536,
        purgeDebounceMs: 0,
      },
      journal: {
        open: async (file, flags) => {
          const handle = await open(file, flags);
          return {
            fd: handle.fd,
            stat: async () => {
              const sizeBeforeAppend = await handle.stat();
              if (!injected) {
                injected = true;
                await session.append([
                  {
                    speaker: 'ai',
                    blocks: [{ type: 'text', text: 'during bootstrap' }],
                  },
                ]);
              }
              return sizeBeforeAppend;
            },
            read: (buffer, offset, length, position) =>
              handle.read(buffer, offset, length, position),
            write: (buffer, offset, length, position) =>
              handle.write(buffer, offset, length, position),
            writev: (buffers, position) => handle.writev(buffers, position),
            truncate: (length) => handle.truncate(length),
            close: () => handle.close(),
          };
        },
      },
    });
    try {
      await pager.resumeFromJournal();
      await waitFor(() =>
        expect(pager.getState().rows.map((row) => row.item.text)).toStrictEqual(
          ['before bootstrap', 'during bootstrap'],
        ),
      );
      expect(pager.getState().error).toBeNull();
    } finally {
      await pager.close();
    }
  });

  it('keeps only the decoded page and rejects a control retaining the entire transcript', async () => {
    for (let index = 0; index < 128; index++)
      await session.append([
        { speaker: 'human', blocks: [{ type: 'text', text: `row ${index}` }] },
      ]);
    const ownership = new RowOwnership();
    const decoded = createRowCounters();
    const cursor = await NativeJournalCursor.open(
      path,
      { counters: { ...decoded.counters, ownership } },
      4,
    );
    try {
      expect(decoded.snapshot().rowsDecoded).toBe(4);
      await cursor.pageBack(4);
      for (let page = 0; page < 10; page++) await cursor.pageBack(4);
      expect(() => assertWindow(ownership.snapshot().peakRows)).not.toThrow();
    } finally {
      await cursor.close();
    }
    expect(ownership.snapshot().liveRows).toBe(0);
    const reader = await NativeJournalPageReader.open(path);
    const retained: IContent[] = [];
    try {
      for await (const entry of reader.entries())
        retained.push(await reader.readContent(entry));
      expect(() => assertWindow(retained.length)).toThrow('viewport window');
      expect(retained[0].blocks).toStrictEqual([
        { type: 'text', text: 'row 0' },
      ]);
    } finally {
      await reader.close();
    }
  });
});
