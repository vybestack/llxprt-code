/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { JournalStore } from './journalStore.js';
import { JournalWriterPoisonedError } from './errors.js';
import { testJournalSeams } from './__tests__/support/journalFixtures.js';
import { draftRow, storeDeps } from './__tests__/support/storeFixtures.js';
import { useTempDir } from './__tests__/support/useTempDir.js';

describe('journal commit settlement', () => {
  const directory = useTempDir('journal-commit-settlement-');

  it('waits for the queued trailer without flushing it again', async () => {
    const seams = testJournalSeams({ gateTrailerAt: 0 });
    const store = await JournalStore.create(
      join(directory(), 'queued.llxj'),
      storeDeps({ seams }),
    );
    try {
      const commit = store.commit([{ kind: 'append', rows: [draftRow()] }]);
      let settled = false;
      const settlement = store.settleCommitted().then(() => {
        settled = true;
      });
      await Bun.sleep(0);
      expect(settled).toBe(false);
      expect(store.published).toBeUndefined();
      seams.release();
      const ack = await commit;
      const flushes = seams.events.filter((event) => event.type === 'flush');
      await settlement;
      expect(store.published?.commitSeq).toBe(ack.commitSeq);
      expect(
        seams.events.filter((event) => event.type === 'flush'),
      ).toStrictEqual(flushes);
    } finally {
      seams.release();
      await store.close();
    }
  });

  it('leaves a rejected write on its commit while preserving the prior version and writer poison', async () => {
    const seams = testJournalSeams({ failTrailerAt: 1 });
    const store = await JournalStore.create(
      join(directory(), 'failed.llxj'),
      storeDeps({ seams }),
    );
    try {
      await store.commit([{ kind: 'append', rows: [draftRow()] }]);
      const before = store.published;
      await expect(
        store.commit([
          { kind: 'append', rows: [draftRow({ text: 'failed' })] },
        ]),
      ).rejects.toThrow('injected write failure');
      await store.settleCommitted();
      expect(store.published).toBe(before);
      await expect(store.flushCommitted()).rejects.toThrow(
        'injected write failure',
      );
      await expect(
        store.commit([{ kind: 'append', rows: [draftRow()] }]),
      ).rejects.toBeInstanceOf(JournalWriterPoisonedError);
    } finally {
      await store.close();
    }
  });
});
