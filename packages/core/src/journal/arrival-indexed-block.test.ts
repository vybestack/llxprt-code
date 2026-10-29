/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { JournalArrivalRecorder } from './arrival-recorder.js';
import { JournalStore } from './journalStore.js';
import { ROW_BLOCK_TYPE } from './rowRecord.js';
import { draftRow, storeDeps } from './__tests__/support/storeFixtures.js';
import { useTempDir } from './__tests__/support/useTempDir.js';

describe('arrival source identity index', () => {
  const directory = useTempDir('arrival-index-');
  it('recovers source bindings from the journal in a fresh recorder', async () => {
    const store = await JournalStore.create(
      join(directory(), 'indexed.llxj'),
      storeDeps(),
    );
    const first = new JournalArrivalRecorder(store);
    const second = new JournalArrivalRecorder(store);
    try {
      const row = await first.beginRow(
        { ...draftRow(), blocks: [] },
        { id: 'attempt', submissionId: 'prompt' },
      );
      const original = await first.indexedBlock(
        row,
        ROW_BLOCK_TYPE.thinking,
        'a',
      );
      await first.appendText(original, 'thought', 'first', 'snapshot');
      await first.close();
      const other = await second.indexedBlock(
        row,
        ROW_BLOCK_TYPE.thinking,
        'b',
      );
      const resumed = await second.indexedBlock(
        row,
        ROW_BLOCK_TYPE.thinking,
        'a',
      );
      expect(resumed.ordinal).toBe(original.ordinal);
      expect(other.ordinal).toBe(original.ordinal + 1);
      await second.appendText(
        resumed,
        'thought',
        'first conclusion',
        'snapshot',
      );
      await second.appendText(other, 'thought', 'other');
      await second.endRowBlocks(row);
      await second.sealRow(row);
      const snapshot = await store.snapshot();
      try {
        const stored = await snapshot.readRow(await snapshot.entryAt(0));
        expect(snapshot.rows).toBe(1);
        expect(stored.blocks).toHaveLength(2);
        expect(
          JSON.parse(new TextDecoder().decode(stored.blocks[0])),
        ).toStrictEqual({
          type: 'thinking',
          thought: 'first conclusion',
        });
      } finally {
        await snapshot.close();
      }
    } finally {
      await first.close();
      await second.close();
      await store.close();
    }
  });
});
