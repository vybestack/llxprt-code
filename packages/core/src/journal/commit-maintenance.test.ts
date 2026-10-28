/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { JournalHistoryStore } from '../services/history/journalHistoryStore.js';
import { draftRow } from './__tests__/support/storeFixtures.js';
import {
  detachedRows,
  withDetachedFixture,
} from '../services/history/detached-rollback-test-helpers.js';

describe('commit settlement before automatic maintenance', () => {
  it.each([2048, 8192])(
    'settles a token ticket without copying the replaced %i-row history',
    async (rows) => {
      await withDetachedFixture(async ({ history, session, io }) => {
        const journal = history.detachedValues.host().journal;
        if (!(journal instanceof JournalHistoryStore))
          throw new Error('Expected journal history');
        await journal.replaceFrom(detachedRows(rows), rows);
        const release = await session.store.pin();
        try {
          if (rows === 8192) {
            const abandoned = draftRow({ text: 'garbage'.repeat(8192) });
            for (let index = 0; index < 2048; index++)
              session.store.admissions.admit(abandoned);
            session.store.admissions.release(2048);
            await session.store.commit([
              {
                kind: 'setState',
                key: 'maintenance-fixture',
                value: new Uint8Array([1]),
              },
            ]);
          }
          await history.recalculateTotalTokens();
          await history.waitForCommit();
        } finally {
          await release();
        }
        const before = {
          reads: io.descriptorReads,
          writes: io.descriptorWrites,
          bytes: io.descriptorWrittenBytes,
        };
        const version = session.store.published;
        await history.waitForCommit();
        const nextRead = await session.store.openRead();
        await nextRead.close();
        const work = {
          rows,
          reads: io.descriptorReads - before.reads,
          writes: io.descriptorWrites - before.writes,
          bytes: io.descriptorWrittenBytes - before.bytes,
        };
        process.stdout.write(`COMMIT_MAINTENANCE ${JSON.stringify(work)}\n`);
        expect(work.reads).toBe(0);
        expect(work.writes).toBe(0);
        expect(work.bytes).toBe(0);
        expect(nextRead.version).toBe(version);
        await session.store.idle();
        expect(session.store.published?.rows).toBe(rows);
        expect(
          session.store.published?.selfOffset !== version?.selfOffset,
        ).toBe(rows === 8192);
      });
    },
    180000,
  );
});
