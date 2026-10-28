/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { JournalArrivalRecorder } from './arrival-recorder.js';
import { JournalStore } from './journalStore.js';
import { draftRow, storeDeps } from './__tests__/support/storeFixtures.js';
import { testJournalSeams } from './__tests__/support/journalFixtures.js';
import { useTempDir as tempDirectory } from './__tests__/support/useTempDir.js';

const directory = tempDirectory('arrival-read-cost-');

async function assertPayloads(
  store: JournalStore,
  size: number,
  payload: Uint8Array,
): Promise<void> {
  const snapshot = await store.snapshot();
  try {
    let count = 0;
    for await (const entry of snapshot.entries()) {
      const stored = await snapshot.readRow(entry);
      expect(stored.blocks[0]).toStrictEqual(payload);
      count++;
    }
    expect(count).toBe(size);
  } finally {
    await snapshot.close();
  }
}

describe('arrival recording physical read cost', () => {
  for (const size of [1024, 4096]) {
    it(`records ${size} rows within a tree-depth read budget`, async () => {
      const counter = { reads: 0 };
      const path = join(directory(), `${size}.llxj`);
      const store = await JournalStore.create(
        path,
        storeDeps({
          seams: testJournalSeams({ readCounter: counter }, 1, false),
          compactionDue: () => false,
        }),
      );
      const recorder = new JournalArrivalRecorder(store);
      const payload = new TextEncoder().encode('arrival payload');
      try {
        const before = counter.reads;
        let lastRowReads = 0;
        for (let index = 0; index < size; index++) {
          const rowStart = counter.reads;
          const row = await recorder.beginRow(
            { ...draftRow(), blocks: [] },
            { id: `attempt-${index}`, submissionId: 'submission' },
          );
          const block = await recorder.beginBlock(row, 0);
          await recorder.appendField(block, payload);
          await recorder.endBlock(block);
          await recorder.sealRow(row);
          lastRowReads = counter.reads - rowStart;
        }
        const recordingReads = counter.reads - before;
        const depth = Math.ceil(Math.log(size * 2) / Math.log(16));
        const readBound = 4 * depth + 8;
        expect(recordingReads / size).toBeLessThanOrEqual(readBound);
        expect(lastRowReads).toBeLessThanOrEqual(readBound);
        expect(store.published?.rows).toBe(size);
        await assertPayloads(store, size, payload);
      } finally {
        await recorder.close();
        await store.close();
      }
    });
  }
});
