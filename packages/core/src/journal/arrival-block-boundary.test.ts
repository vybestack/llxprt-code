/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { JournalArrivalRecorder } from './arrival-recorder.js';
import { JournalStore } from './journalStore.js';
import { draftRow, storeDeps } from './__tests__/support/storeFixtures.js';
import { useTempDir } from './__tests__/support/useTempDir.js';

describe('arrival block boundary', () => {
  const directory = useTempDir('arrival-block-boundary-');
  it.each([false, true])(
    'validates pending pieces and closes a block under one terminal boundary trailer (progress flushed=%s)',
    async (flushProgress) => {
      const store = await JournalStore.create(
        join(directory(), 'boundary.llxj'),
        storeDeps(),
      );
      const recorder = new JournalArrivalRecorder(store);
      try {
        const row = await recorder.beginRow(
          { ...draftRow(), blocks: [] },
          { id: 'a', submissionId: 's' },
        );
        const block = await recorder.beginNamedBlock(row, 0);
        await recorder.appendText(block, 'text', 'completed');
        if (flushProgress) await recorder.flush();
        const previous = store.published?.commitSeq;
        if (previous === undefined) throw new Error('Missing progress trailer');
        await recorder.endBlock(block);
        expect(store.published?.commitSeq).toBe(previous + 1);
        await recorder.sealRow(row);
        expect(store.published?.rows).toBe(1);
      } finally {
        await recorder.close();
        await store.close();
      }
    },
  );
});
