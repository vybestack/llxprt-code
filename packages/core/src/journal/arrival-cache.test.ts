/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { JournalArrivalRecorder } from './arrival-recorder.js';
import { JournalStore } from './journalStore.js';
import { draftRow, storeDeps } from './__tests__/support/storeFixtures.js';
import { testJournalSeams } from './__tests__/support/journalFixtures.js';
import { useTempDir as tempDirectory } from './__tests__/support/useTempDir.js';

const directory = tempDirectory('arrival-path-cache-');

async function record(reuse: boolean): Promise<number> {
  const readCounter = { reads: 0 };
  const store = await JournalStore.create(
    join(directory(), reuse ? 'warm.llxj' : 'cold.llxj'),
    storeDeps({
      seams: testJournalSeams({ readCounter }, 1, false),
      compactionDue: () => false,
    }),
  );
  let recorder = new JournalArrivalRecorder(store);
  try {
    for (let index = 0; index < 64; index++) {
      const row = await recorder.beginRow(
        { ...draftRow(), blocks: [] },
        { id: `attempt-${index}`, submissionId: 'submission' },
      );
      const block = await recorder.beginBlock(row, 0);
      await recorder.appendField(
        block,
        new TextEncoder().encode(`row ${index}`),
      );
      await recorder.endBlock(block);
      await recorder.sealRow(row);
      if (!reuse) {
        await recorder.close();
        recorder = new JournalArrivalRecorder(store);
      }
    }
    expect(store.published?.rows).toBe(64);
    const snapshot = await store.snapshot();
    try {
      let index = 0;
      for await (const entry of snapshot.entries()) {
        const row = await snapshot.readRow(entry);
        expect(new TextDecoder().decode(row.blocks[0])).toBe(`row ${index++}`);
      }
      expect(index).toBe(64);
    } finally {
      await snapshot.close();
    }
    return readCounter.reads;
  } finally {
    await recorder.close();
    await store.close();
  }
}

describe('arrival recording path reuse', () => {
  it('avoids cold transcript path reads across durable rows without changing payloads', async () => {
    const cold = await record(false);
    const warm = await record(true);
    expect(warm).toBeLessThan(cold);
  });
});
