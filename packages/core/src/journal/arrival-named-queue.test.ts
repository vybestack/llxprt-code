/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { JournalArrivalRecorder } from './arrival-recorder.js';
import { JournalStore } from './journalStore.js';
import { openJournalReadOnly } from './journalReader.js';
import { TranscriptReader } from './transcript-reader.js';
import { sha256KeyHash } from './idKeys.js';
import { draftRow, storeDeps } from './__tests__/support/storeFixtures.js';
import { useTempDir } from './__tests__/support/useTempDir.js';
import { JOURNAL_HEADER_BYTES } from './fileHeader.js';
import { testJournalSeams } from './__tests__/support/journalFixtures.js';
import { RECORD_KIND } from './recordKinds.js';

async function manifestCount(path: string): Promise<number> {
  const file = await openJournalReadOnly(path);
  let count = 0;
  try {
    let at = JOURNAL_HEADER_BYTES;
    while (at < (file.trailer?.durableEnd ?? 0)) {
      const head = await file.readRecordHead(at);
      if (head.kind === RECORD_KIND.ROW) count++;
      at = head.endOffset;
    }
    return count;
  } finally {
    await file.close();
  }
}

describe('named arrival queue', () => {
  const directory = useTempDir('named-queue-');
  it('charges named fragments and coalesces them until the shared timer publishes progress', async () => {
    const path = join(directory(), 'queue.llxj');
    const store = await JournalStore.create(path, storeDeps());
    const recorder = new JournalArrivalRecorder(store);
    try {
      const row = await recorder.beginRow(
        { ...draftRow(), blocks: [] },
        { id: 'a', submissionId: 's' },
      );
      const block = await recorder.beginNamedBlock(row, 0);
      const before = store.published?.commitSeq;
      const manifests = await manifestCount(path);
      for (let i = 0; i < 10; i++)
        await recorder.appendText(block, 'text', 'arriving');
      expect(recorder.census.chargedPieces).toBe(10);
      expect(recorder.census.chargedBytes).toBeGreaterThan(80);
      expect(recorder.census.peakBytes).toBeLessThanOrEqual(256 * 1024);
      expect((store.published?.commitSeq ?? 0) - (before ?? 0)).toBe(0);
      await Bun.sleep(100);
      await recorder.flush();
      expect(recorder.census.chargedBytes).toBe(0);
      expect((await manifestCount(path)) - manifests).toBe(1);
      const file = await openJournalReadOnly(path);
      try {
        const reader = new TranscriptReader(file, sha256KeyHash);
        const entries = await reader.page({ direction: 'forward', limit: 1 });
        const stored = await reader.readRow(entries[0]);
        const value: unknown = JSON.parse(
          new TextDecoder().decode(stored.blocks[0]),
        );
        expect(value).toStrictEqual({
          type: 'text',
          text: 'arriving'.repeat(10),
        });
        expect(entries[0].status).toBe(0);
        expect(store.published?.rows).toBe(0);
      } finally {
        await file.close();
      }
    } finally {
      await recorder.close();
      await store.close();
    }
  });
  it('stops a named-field pull producer at the shared capacity while disk is stalled', async () => {
    const seams = testJournalSeams({ gateTrailerAt: 2 });
    const store = await JournalStore.create(
      join(directory(), 'slow.llxj'),
      storeDeps({ seams }),
    );
    const recorder = new JournalArrivalRecorder(store);
    try {
      const row = await recorder.beginRow(
        { ...draftRow(), blocks: [] },
        { id: 'slow', submissionId: 's' },
      );
      const block = await recorder.beginNamedBlock(row, 0);
      let consumed = 0;
      const producer = (async () => {
        for (let i = 0; i < 80; i++) {
          await recorder.appendText(block, 'text', 'x'.repeat(8192));
          consumed++;
        }
      })();
      await Bun.sleep(100);
      expect(consumed).toBeGreaterThan(0);
      expect(consumed).toBeLessThan(80);
      expect(recorder.census.chargedBytes).toBeGreaterThan(64 * 1024);
      expect(recorder.census.peakBytes).toBeLessThanOrEqual(256 * 1024);
      seams.release();
      await producer;
      await recorder.flush();
      expect(consumed).toBe(80);
      expect(recorder.census.chargedBytes).toBe(0);
    } finally {
      seams.release();
      await recorder.close();
      await store.close();
    }
  });
  it('rejects delta writes after a snapshot without adding their bytes', async () => {
    const store = await JournalStore.create(
      join(directory(), 'mode.llxj'),
      storeDeps(),
    );
    const recorder = new JournalArrivalRecorder(store);
    try {
      const row = await recorder.beginRow(
        { ...draftRow(), blocks: [] },
        { id: 'a', submissionId: 's' },
      );
      const block = await recorder.beginNamedBlock(row, 4);
      await recorder.appendText(block, 'thought', 'snapshot', 'snapshot');
      await expect(
        recorder.appendText(block, 'thought', 'delta'),
      ).rejects.toThrow('Cannot mix snapshot and delta modes');
      expect(recorder.census.payloadBytes).toBe(8);
      expect(store.published?.rows).toBe(0);
    } finally {
      await recorder.close();
      await store.close();
    }
  });
});
