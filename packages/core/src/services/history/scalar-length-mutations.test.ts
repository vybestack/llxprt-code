/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  submitTicketRows,
  expectTicketCallersReleased,
  expectTicketCursorRows,
} from './ticket-owner-contract-test-helpers.js';
import {
  captureTicketWrite,
  expectTicketDisk,
} from './ticket-disk-contract-test-helpers.js';
import { HistoryJournalStore } from './historyJournalStore.js';
import { withBatchFixture, batchRow } from './addbatch-stream-test-helpers.js';
import { withRollbackFixture } from './chronology-rollback-test-helpers.js';
import { RowOwnership } from '../../recording/rowOwnership.js';
import { expectScalarCharge } from './scalar-owner-contract-test-helpers.js';
import { withSynchronousHistoryCursor } from '../../recording/synchronousHistoryCursor.js';
import { createRowCounters } from '../../recording/journalCounters.js';

function expectMembership(
  journal: HistoryJournalStore,
  seqs: readonly number[],
): void {
  expect(journal.getLength()).toBe(seqs.length);
  journal.withReadRows((cursor) => {
    expect(cursor.length).toBe(seqs.length);
    for (let index = 0; index < seqs.length; index++)
      expect(cursor.chronologySeqAt(index)).toBe(seqs[index]);
  });
}

describe('scalar cardinality across journal operations', () => {
  it('matches pending and durable marker membership through inserts, density, cuts and compression', async () => {
    await withRollbackFixture(async (_history, recorder, releaseWriter) => {
      const journal = new HistoryJournalStore(recorder);
      try {
        for (let index = 0; index < 4; index++)
          journal.apply({ kind: 'content', content: batchRow(index) });
        journal.apply({
          kind: 'syntheticInsert',
          payload: {
            content: batchRow(8),
            chronologySeq: 9,
            afterSeq: 2,
          },
        });
        expectMembership(journal, [1, 2, 9, 3, 4]);
        journal.apply({
          kind: 'syntheticInsert',
          payload: {
            content: batchRow(9),
            chronologySeq: 10,
            afterSeq: 99,
          },
        });
        expectMembership(journal, [1, 2, 9, 3, 4]);
        journal.apply({
          kind: 'density',
          payload: {
            removedSeqs: [2, 2, 3, 99],
            replacements: [{ replacedSeq: 2, replacement: batchRow(10) }],
          },
        });
        expectMembership(journal, [1, 11, 9, 4]);
        journal.apply({ kind: 'rewind', cutSeq: 9, itemsRemoved: 1 });
        expectMembership(journal, [1, 11]);
        journal.apply({ kind: 'rewind', cutSeq: 99, itemsRemoved: 1 });
        expectMembership(journal, [1]);
        journal.apply({
          kind: 'compressed',
          summary: batchRow(11),
          itemsCompressed: 1,
        });
        expectMembership(journal, [12]);
        journal.apply({ kind: 'content', content: batchRow(12) });
        expectMembership(journal, [12, 13]);
        releaseWriter();
        await journal.waitForDurable();
        expectMembership(journal, [12, 13]);
        journal.apply({ kind: 'rewind', itemsRemoved: 100 });
        expectMembership(journal, []);
        await journal.waitForDurable();
        expectMembership(journal, []);
        expect(journal.getLength()).toBe(0);
      } finally {
        journal.dispose();
      }
    }, true);
  });
});

describe('scalar failures and cancellation', () => {
  it('keeps count and owners after failed admission and aborted cursor, then releases on acknowledgement', async () => {
    await withBatchFixture(
      async ({ recorder, owners, reads, pauseWriter, releaseWriter }) => {
        const journal = new HistoryJournalStore(recorder, {
          ...reads.counters,
          ownership: owners,
        });
        pauseWriter();
        try {
          const probes = submitTicketRows(journal, 1, batchRow);
          const admittedOwners = owners.snapshot().liveRows;
          recorder.failAdmissionAfter(0);
          expect(() =>
            journal.apply({
              kind: 'compressed',
              summary: batchRow(1),
              itemsCompressed: 1,
            }),
          ).toThrow(recorder.failure);
          expectMembership(journal, [1]);
          const cancellation = new Error('cancel scalar cursor');
          const controller = new AbortController();
          controller.abort(cancellation);
          expect(() =>
            journal.withReadRows(() => undefined, controller.signal),
          ).toThrow(cancellation);
          expect(journal.getLength()).toBe(1);
          expect([admittedOwners, owners.snapshot().liveRows]).toStrictEqual([
            0, 0,
          ]);
          const ticket = captureTicketWrite(recorder);
          await expectTicketCallersReleased(probes);
          expectTicketCursorRows(journal, owners, 1, batchRow);
          releaseWriter();
          await journal.waitForDurable();
          await expectTicketDisk(recorder, ticket, 1, batchRow);
          expectMembership(journal, [1]);
          expectScalarCharge(owners, 0, 0);
          expect(owners.snapshot().liveRows).toBe(0);
        } finally {
          releaseWriter();
          journal.dispose();
        }
      },
    );
  });

  it('restores the previous binding count on adoption rollback even after its pending acknowledgement', async () => {
    await withRollbackFixture(async (_history, first, releaseFirst) => {
      await withRollbackFixture(async (_other, second, releaseSecond) => {
        const journal = new HistoryJournalStore(first);
        const destination = new HistoryJournalStore(second);
        try {
          journal.apply({ kind: 'content', content: batchRow(0) });
          destination.apply({ kind: 'content', content: batchRow(5) });
          destination.apply({ kind: 'content', content: batchRow(6) });
          releaseSecond();
          await destination.waitForDurable();
          const watermark = await second.commit('session_event', {
            severity: 'info',
            message: 'adoption boundary',
          });
          const adoption = journal.adoptJournal(second, watermark);
          expectMembership(journal, [6, 7]);
          releaseFirst();
          await first.flush();
          adoption.rollback();
          expectMembership(journal, [1]);
          await journal.waitForDurable();
          expectMembership(journal, [1]);
          expect(journal.getLength()).toBe(1);
        } finally {
          journal.dispose();
          destination.dispose();
        }
      }, true);
    }, true);
  });
});

describe('scalar pending binding retirement', () => {
  it('releases retired pending content on adoption commit without requiring the old writer acknowledgement', async () => {
    await withRollbackFixture(async (_history, first, releaseFirst) => {
      await withRollbackFixture(async (_other, second, releaseSecond) => {
        const owners = new RowOwnership();
        const journal = new HistoryJournalStore(first, {
          ...createRowCounters().counters,
          ownership: owners,
        });
        try {
          const probes = submitTicketRows(journal, 1, batchRow);
          const ticket = captureTicketWrite(first);
          await expectTicketCallersReleased(probes);
          expectTicketCursorRows(journal, owners, 1, batchRow);
          const captured = journal.capturePendingFold();
          expectScalarCharge(owners, 0, 0);
          releaseSecond();
          const watermark = await second.commit('content', {
            content: batchRow(5),
          });
          const adoption = journal.adoptJournal(second, watermark);
          expectMembership(journal, [6]);
          await adoption.commit();
          withSynchronousHistoryCursor(captured, (cursor) => {
            expect(cursor.length).toBe(1);
            for (const row of cursor.rows())
              expect(row).toStrictEqual(batchRow(0));
          });
          const retiredOwners = owners.snapshot().liveRows;
          releaseFirst();
          await first.flush();
          await expectTicketDisk(first, ticket, 1, batchRow);
          expectMembership(journal, [6]);
          expectScalarCharge(owners, 0, 0);
          expect([retiredOwners, owners.snapshot().liveRows]).toStrictEqual([
            0, 0,
          ]);
        } finally {
          journal.dispose();
        }
      }, true);
    }, true);
  });
});
