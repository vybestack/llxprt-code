/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  JournalSession,
  NativeJournalPageReader,
} from '@vybestack/llxprt-code-core';
import { encodeContentRow } from '@vybestack/llxprt-code-core/services/history/journalRowCodec.js';
import { JournalArrivalRecorder } from '@vybestack/llxprt-code-core/journal/arrival-recorder.js';
import { createRowCounters } from '@vybestack/llxprt-code-core/recording/journalCounters.js';
import { NativeJournalCursor } from './native-journal-cursor.js';
import { createScrollbackPagerStore } from './scrollbackPager.js';
import { waitFor } from '../../../__tests__/render.js';

async function compress(session: JournalSession): Promise<void> {
  const iterator = session.store.rows(2);
  const { value: retained } = await iterator.next();
  await iterator.return(undefined);
  if (retained === undefined) throw new Error('Missing retained row');
  await session.store.commit([
    {
      kind: 'compress',
      retainFromLabel: retained.label,
      expectedReplaced: 2,
      summary: encodeContentRow(
        {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'summary' }],
          metadata: { isSummary: true },
        },
        { owner: 0 },
      ),
    },
  ]);
}

function pagerFor(path: string) {
  return createScrollbackPagerStore({
    filePath: path,
    pageRows: 4,
    viewport: { visibleKeys: [], viewportLines: 4, rowHeightLines: () => 1 },
    settings: { marginViewports: 1, byteFloorBytes: 65536, purgeDebounceMs: 0 },
  });
}

describe('complete transcript pager', () => {
  let directory: string;
  let path: string;
  let session: JournalSession;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'transcript-pager-'));
    path = join(directory, 'session.llxj');
    session = await JournalSession.create(path);
  });
  afterEach(async () => {
    await session.close();
    await rm(directory, { recursive: true, force: true });
  });

  it('seeks the newest page without decoding old rows and reaches the first row after compression and reopen', async () => {
    await session.append([
      { speaker: 'human', blocks: [{ type: 'text', text: 'original first' }] },
      { speaker: 'ai', blocks: [{ type: 'text', text: 'original reply' }] },
      { speaker: 'human', blocks: [{ type: 'text', text: 'retained last' }] },
    ]);
    await compress(session);
    const decoded = createRowCounters();
    const cursor = await NativeJournalCursor.open(
      path,
      { counters: decoded.counters },
      1,
    );
    try {
      expect(decoded.snapshot().rowsDecoded).toBe(1);
      const latest = await cursor.pageBack(1);
      expect(latest.entries[0]?.kind).toBe('boundary');
      expect(latest.entries[0]?.contextState).toBe('in-context');
      const older = await cursor.pageBack(10);
      expect(
        older.entries.flatMap((entry) =>
          entry.kind === 'projected' && 'text' in entry.item
            ? [entry.item.text]
            : [],
        ),
      ).toStrictEqual(['retained last', 'original reply', 'original first']);
      expect(older.entries.map((entry) => entry.contextState)).toStrictEqual([
        'in-context',
        'purged',
        'purged',
      ]);
      expect(cursor.atStart()).toBe(true);
    } finally {
      await cursor.close();
    }
  });

  it('keeps originals pageable after clear and a later append', async () => {
    await session.append([
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'first before clear' }],
      },
    ]);
    await session.store.commit([{ kind: 'clear' }]);
    await session.append([
      { speaker: 'human', blocks: [{ type: 'text', text: 'after clear' }] },
    ]);
    const cursor = await NativeJournalCursor.open(path, {}, 4);
    try {
      const page = await cursor.pageBack(4);
      const text = page.entries.flatMap((entry) =>
        entry.kind === 'projected' && 'text' in entry.item
          ? [entry.item.text]
          : [],
      );
      expect(text.at(0)).toBe('after clear');
      expect(text.at(-1)).toBe('first before clear');
      expect(cursor.clearBoundaryOffset()).toBeNull();
      expect(cursor.atStart()).toBe(true);
    } finally {
      await cursor.close();
    }
  });

  it('refreshes an acknowledged live row in place and preserves its key on seal', async () => {
    const recorder = new JournalArrivalRecorder(session.store);
    const pager = pagerFor(path);
    try {
      const row = await recorder.beginRow(
        encodeContentRow({ speaker: 'ai', blocks: [] }, { owner: 0 }),
        { id: 'attempt', submissionId: 'prompt' },
      );
      const block = await recorder.beginNamedBlock(row, 0);
      await recorder.appendText(block, 'text', 'prefix');
      await recorder.flush();
      await pager.resumeFromJournal();
      const key = pager.getState().rows[0]?.key;
      expect(pager.getState().rows[0]?.item.text).toBe('prefix');
      await recorder.appendText(block, 'text', ' suffix');
      await recorder.flush();
      await waitFor(() =>
        expect(pager.getState().rows[0]?.item.text).toBe('prefix suffix'),
      );
      expect(pager.getState().rows).toHaveLength(1);
      expect(pager.getState().rows[0]?.key).toBe(key);
      expect(pager.getState().rows[0]?.item.text).toBe('prefix suffix');
      await recorder.endBlock(block);
      await recorder.sealRow(row);
      await waitFor(() =>
        expect(pager.getState().rows[0]?.contextState).toBe('in-context'),
      );
      expect(pager.getState().rows).toHaveLength(1);
      expect(pager.getState().rows[0]?.key).toBe(key);
      expect(pager.getState().rows[0]?.contextState).toBe('in-context');
    } finally {
      await pager.close();
      await recorder.close();
    }
  });

  it('reads exact membership through the public page reader', async () => {
    await session.append([
      { speaker: 'human', blocks: [{ type: 'text', text: 'removed' }] },
    ]);
    await session.store.commit([{ kind: 'clear' }]);
    const reader = await NativeJournalPageReader.open(path);
    try {
      expect(reader.rows).toBe(2);
      expect(await reader.inContext(await reader.entryAt(0))).toBe(false);
    } finally {
      await reader.close();
    }
  });
});
