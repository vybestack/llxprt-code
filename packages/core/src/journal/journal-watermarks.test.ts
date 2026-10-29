/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { JournalSession } from '../services/history/journalSession.js';
import {
  subscribeJournalCommits,
  type JournalCommitWatermark,
} from './journal-watermarks.js';
import { useTempDir } from './__tests__/support/useTempDir.js';
import { JournalArrivalRecorder } from './arrival-recorder.js';
import { encodeContentRow } from '../services/history/journalRowCodec.js';
import { NativeJournalPageReader } from './native-journal-page-reader.js';

describe('session-wide journal watermarks', () => {
  const directory = useTempDir('journal-watermarks-');
  it('publishes history, in-progress recording and context mutations on one subscription', async () => {
    const path = join(directory(), 'session.llxj');
    const session = await JournalSession.create(path);
    const recorder = new JournalArrivalRecorder(session.store);
    let latest: JournalCommitWatermark | undefined;
    const unsubscribe = subscribeJournalCommits(path, (watermark) => {
      latest = watermark;
    });
    try {
      const prompt = await session.append([
        { speaker: 'human', blocks: [{ type: 'text', text: 'prompt' }] },
      ]);
      await Promise.resolve();
      expect(latest?.commitSeq).toBe(prompt.commitSeq);
      const row = await recorder.beginRow(
        encodeContentRow({ speaker: 'ai', blocks: [] }, { owner: 0 }),
        { id: 'a', submissionId: 's' },
      );
      const block = await recorder.beginNamedBlock(row, 0);
      await recorder.appendText(block, 'text', 'partial');
      await recorder.flush();
      await Promise.resolve();
      expect(latest?.commitSeq).toBeGreaterThan(prompt.commitSeq);
      expect(latest?.durableEnd).toBe(session.store.published?.durableEnd);
      const before = latest?.commitSeq;
      await session.store.commit([{ kind: 'clear' }]);
      await Promise.resolve();
      expect(latest?.commitSeq).toBeGreaterThan(before ?? 0);
      unsubscribe();
      const after = latest;
      await session.append([
        { speaker: 'human', blocks: [{ type: 'text', text: 'later' }] },
      ]);
      await Promise.resolve();
      expect(latest).toBe(after);
    } finally {
      unsubscribe();
      await recorder.close();
      await session.close();
    }
  });
  it('opens exactly the acknowledged watermark instead of a newer physical tail', async () => {
    const path = join(directory(), 'pinned.llxj');
    const session = await JournalSession.create(path);
    try {
      const first = await session.append([
        { speaker: 'human', blocks: [{ type: 'text', text: 'first' }] },
      ]);
      await session.append([
        { speaker: 'ai', blocks: [{ type: 'text', text: 'newer' }] },
      ]);
      const reader = await NativeJournalPageReader.open(
        path,
        undefined,
        first.durableEnd,
      );
      try {
        expect(reader.rows).toBe(1);
        expect(
          (await reader.readContent(await reader.entryAt(0))).blocks,
        ).toStrictEqual([{ type: 'text', text: 'first' }]);
      } finally {
        await reader.close();
      }
    } finally {
      await session.close();
    }
  });
});
