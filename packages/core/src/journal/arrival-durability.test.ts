/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { JournalStore } from './journalStore.js';
import { JournalArrivalRecorder } from './arrival-recorder.js';
import {
  testJournalSeams,
  type Failures,
} from './__tests__/support/journalFixtures.js';
import { draftRow, storeDeps } from './__tests__/support/storeFixtures.js';
import { useTempDir } from './__tests__/support/useTempDir.js';

const encoder = new TextEncoder();
describe('arrival writer durability and backpressure', () => {
  const directory = useTempDir('arrival-durable-');
  it('charges pending pieces and writer buffers while a slow disk stops the pull producer', async () => {
    const seams = testJournalSeams({ gateTrailerAt: 2 });
    const store = await JournalStore.create(
      join(directory(), 'slow.llxj'),
      storeDeps({ seams }),
    );
    const recorder = new JournalArrivalRecorder(store);
    try {
      const row = await recorder.beginRow(
        { ...draftRow(), blocks: [] },
        { id: 'slow', submissionId: 'prompt' },
      );
      const block = await recorder.beginBlock(row, 0);
      const bytes = new Uint8Array(64 * 1024);
      let consumed = 0;
      const produce = (async () => {
        for (let i = 0; i < 20; i++) {
          await recorder.appendField(block, bytes);
          consumed++;
        }
      })();
      await Bun.sleep(30);
      expect(consumed).toBeGreaterThan(0);
      expect(consumed).toBeLessThan(20);
      expect(recorder.census.chargedBytes).toBeLessThanOrEqual(256 * 1024);
      expect(recorder.census.chargedBytes).toBeGreaterThan(
        recorder.census.chargedPieces * bytes.length,
      );
      seams.release();
      await produce;
      await recorder.flush();
      expect(consumed).toBe(20);
      expect(recorder.census.chargedBytes).toBe(0);
    } finally {
      seams.release();
      await recorder.close();
      await store.close();
    }
  });
  it('rejects concurrent push overflow instead of admitting an uncharged burst', async () => {
    const store = await JournalStore.create(
      join(directory(), 'push.llxj'),
      storeDeps(),
    );
    const recorder = new JournalArrivalRecorder(store);
    try {
      const row = await recorder.beginRow(
        { ...draftRow(), blocks: [] },
        { id: 'push', submissionId: 'prompt' },
      );
      const block = await recorder.beginBlock(row, 0);
      const results = await Promise.allSettled(
        Array.from({ length: 20 }, () =>
          recorder.appendField(block, new Uint8Array(64 * 1024)),
        ),
      );
      expect(results.some((result) => result.status === 'rejected')).toBe(true);
      expect(recorder.census.peakBytes).toBeLessThanOrEqual(256 * 1024);
    } finally {
      await recorder.close();
      await store.close();
    }
  });

  it('flushes the trailer before acknowledging every recording boundary', async () => {
    const seams = testJournalSeams();
    const store = await JournalStore.create(
      join(directory(), 'flush.llxj'),
      storeDeps({ seams }),
    );
    const recorder = new JournalArrivalRecorder(store);
    try {
      const row = await recorder.beginRow(
        { ...draftRow(), blocks: [] },
        { id: 'flush', submissionId: 'prompt' },
      );
      const events = seams.events.filter(
        (event) => event.type === 'flush' || event.type === 'write',
      );
      expect(events[events.length - 1]?.type).toBe('flush');
      expect(events.filter((event) => event.type === 'flush')).toHaveLength(2);
      const block = await recorder.beginBlock(row, 0);
      await recorder.appendField(block, encoder.encode('accepted'));
      await recorder.finishAttempt(row, 'error');
      expect(seams.events[seams.events.length - 1]?.type).toBe('flush');
    } finally {
      await recorder.close();
      await store.close();
    }
  });
  it('poisons on disk failure and rejects the next admission instead of accumulating', async () => {
    const failures: Failures = {};
    const seams = testJournalSeams(failures);
    const store = await JournalStore.create(
      join(directory(), 'failed.llxj'),
      storeDeps({ seams }),
    );
    const recorder = new JournalArrivalRecorder(store);
    try {
      const row = await recorder.beginRow(
        { ...draftRow(), blocks: [] },
        { id: 'fail', submissionId: 'prompt' },
      );
      const block = await recorder.beginBlock(row, 0);
      failures.failFlushAt = 4;
      await recorder.appendField(block, encoder.encode('accepted'));
      await expect(recorder.flush()).rejects.toThrow('injected flush failure');
      await expect(
        recorder.appendField(block, encoder.encode('must not be consumed')),
      ).rejects.toThrow('injected flush failure');
      expect(recorder.census.payloadBytes).toBe(8);
      await expect(recorder.close()).rejects.toThrow('injected flush failure');
    } finally {
      await store.close();
    }
  });
});
