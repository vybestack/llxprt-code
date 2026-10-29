/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, spyOn } from 'bun:test';
import { IdFactBatch } from '../../journal/idFactBatch.js';
import { requireJournalRecorder } from './recorderBackend.js';
import { JournalHistoryStore } from './journalHistoryStore.js';
import {
  detachedRows,
  withDetachedFixture,
} from './detached-rollback-test-helpers.js';

describe('recording mirror compensation cost', () => {
  it.each([512, 8192])(
    'restores %i primary and mirror rows without rebuilding their row facts',
    async (size) => {
      await withDetachedFixture(
        async ({ history, session, recording, durable, io }) => {
          await history.detachedValues.replace(detachedRows(size));
          const before = await durable();
          const host = history.detachedValues.host();
          const store = host.journal;
          if (!(store instanceof JournalHistoryStore))
            throw new Error('Expected a native journal history store');
          const mark = store.captureCompensation();
          await history.waitForCommit();
          const mirror = await requireJournalRecorder(recording).session();
          const savedPrimary = session.store.published;
          const savedMirror = mirror.store.published;
          try {
            await history.detachedValues.replace(detachedRows(3));
            const primaryVersion = session.store.published;
            const mirrorVersion = mirror.store.published;
            const beforeReads = io.descriptorReads;
            const beforeBytes = io.descriptorReadBytes;
            const finalizes = spyOn(IdFactBatch.prototype, 'commit');
            try {
              await host.journal.compensate(mark, undefined);
              await history.waitForCommit();
              expect(finalizes.mock.calls.length).toBe(0);
              const reads = io.descriptorReads - beforeReads;
              const bytes = io.descriptorReadBytes - beforeBytes;
              expect(reads).toBeLessThanOrEqual(128);
              expect(bytes).toBeLessThanOrEqual(128 * 1024);
              expect(session.store.published?.roots.idRoot).toBe(
                savedPrimary?.roots.idRoot,
              );
              expect(mirror.store.published?.roots.idRoot).toBe(
                savedMirror?.roots.idRoot,
              );
              process.stdout.write(
                `MIRROR_COMPENSATION_COST ${JSON.stringify({ size, reads, bytes, readsPerRow: reads / size, bytesPerRow: bytes / size })}\n`,
              );
              expect(session.store.published?.commitSeq).toBe(
                (primaryVersion?.commitSeq ?? 0) + 1,
              );
              expect(mirror.store.published?.commitSeq).toBe(
                (mirrorVersion?.commitSeq ?? 0) + 1,
              );
              expect(await durable()).toStrictEqual(before);
            } finally {
              finalizes.mockRestore();
            }
          } finally {
            await store.releaseCompensation(mark);
          }
        },
      );
    },
    180000,
  );
});
