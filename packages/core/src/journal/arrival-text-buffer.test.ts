/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { JournalArrivalRecorder } from './arrival-recorder.js';
import { JournalStore } from './journalStore.js';
import { draftRow, storeDeps } from './__tests__/support/storeFixtures.js';
import { useTempDir } from './__tests__/support/useTempDir.js';
import { openJournalReadOnly } from './journalReader.js';
import { TranscriptReader } from './transcript-reader.js';
import { sha256KeyHash } from './idKeys.js';
import { RECORD_KIND } from './recordKinds.js';
import { JOURNAL_HEADER_BYTES } from './fileHeader.js';
import { testJournalSeams } from './__tests__/support/journalFixtures.js';

async function observe(path: string) {
  const file = await openJournalReadOnly(path);
  try {
    let pieces = 0;
    for (
      let at = JOURNAL_HEADER_BYTES;
      at < (file.trailer?.durableEnd ?? 0);

    ) {
      const head = await file.readRecordHead(at);
      if (head.kind === RECORD_KIND.PIECE) pieces++;
      at = head.endOffset;
    }
    const reader = new TranscriptReader(file, sha256KeyHash);
    const entries = await reader.page({ direction: 'forward', limit: 1 });
    const stored = await reader.readRow(entries[0]);
    const value: unknown = JSON.parse(
      new TextDecoder().decode(stored.blocks[0]),
    );
    return { pieces, value };
  } finally {
    await file.close();
  }
}
async function begin(recorder: JournalArrivalRecorder) {
  const row = await recorder.beginRow(
    { ...draftRow(), blocks: [] },
    { id: 'buffer', submissionId: 'prompt' },
  );
  return recorder.beginNamedBlock(row, 0);
}

describe('bounded text delta admission', () => {
  const directory = useTempDir('arrival-text-buffer-');
  it('admits 1000 deltas without per-chunk suspension and writes byte-sized pieces', async () => {
    const path = join(directory(), 'buffer.llxj');
    const store = await JournalStore.create(path, storeDeps());
    const recorder = new JournalArrivalRecorder(store);
    try {
      const block = await begin(recorder);
      let suspensions = 0;
      const value = 'hello\n😺'.repeat(10);
      for (let index = 0; index < 1000; index++) {
        const pending = recorder.appendTextDelta(block, value);
        if (pending !== undefined) {
          suspensions++;
          await pending;
        }
      }
      await recorder.endBlock(block);
      expect(suspensions).toBeLessThan(10);
      expect(recorder.census.textEncodes).toBeLessThan(10);
      expect(recorder.census.peakBytes).toBeLessThanOrEqual(256 * 1024);
      const observed = await observe(path);
      expect(observed.pieces).toBeLessThan(10);
      expect(observed.value).toStrictEqual({
        type: 'text',
        text: value.repeat(1000),
      });
    } finally {
      await recorder.close();
      await store.close();
    }
  });
  it('stops synchronous admission when the charged disk queue is full', async () => {
    const seams = testJournalSeams({ gateTrailerAt: 2 });
    const store = await JournalStore.create(
      join(directory(), 'slow.llxj'),
      storeDeps({ seams }),
    );
    const recorder = new JournalArrivalRecorder(store);
    try {
      const block = await begin(recorder);
      let consumed = 0;
      const producer = (async () => {
        for (let index = 0; index < 1000; index++) {
          const pending = recorder.appendTextDelta(block, 'x'.repeat(4096));
          if (pending !== undefined) await pending;
          consumed++;
        }
      })();
      await Bun.sleep(100);
      expect(consumed).toBeGreaterThan(0);
      expect(consumed).toBeLessThan(1000);
      expect(recorder.census.peakBytes).toBeLessThanOrEqual(256 * 1024);
      seams.release();
      await producer;
      await recorder.flush();
      expect(consumed).toBe(1000);
      expect(recorder.census.chargedBytes).toBe(0);
    } finally {
      seams.release();
      await recorder.close();
      await store.close();
    }
  });
});
