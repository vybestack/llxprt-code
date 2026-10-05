/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  submitTicketRows,
  expectTicketCallersReleased,
} from './ticket-owner-contract-test-helpers.js';
import {
  captureTicketWrite,
  expectTicketDisk,
} from './ticket-disk-contract-test-helpers.js';
import {
  recordScalarOwners,
  expectEmptyScalarJournal,
  expectNoScalarOwners,
} from './scalar-test-evidence.js';
import { batchRow, withBatchFixture } from './addbatch-stream-test-helpers.js';
import { HistoryJournalStore } from './historyJournalStore.js';
import type { RowOwnership } from '../../recording/rowOwnership.js';
import {
  expectScalarCharge,
  expectScalarRow,
  expectScalarDurableRows,
  scalarRowCharge,
} from './scalar-owner-contract-test-helpers.js';

const bound = { rows: 440, serializedBytes: 8 * 1024 * 1024 };

function visitPinnedPending(
  journal: HistoryJournalStore,
  owners: RowOwnership,
  size: number,
  admittedAcquisitions: number,
): void {
  journal.withReadRows((cursor) => {
    expect(cursor.length).toBe(size);
    let index = 0;
    for (const row of cursor.rows()) {
      expect(row).toStrictEqual(batchRow(index));
      expectScalarRow(row, index);
      if (index === 0) recordScalarOwners('pending-scalar', size, owners);
      expectScalarCharge(owners, 1, scalarRowCharge(batchRow(index)));
      const reentrantAdmissions = index === 0 ? 0 : 1;
      expect(owners.snapshot().acquisitions - admittedAcquisitions).toBe(
        index + 1 + reentrantAdmissions,
      );
      expect(owners.within(bound)).toBe(true);
      if (index === 0) {
        journal.apply({ kind: 'content', content: batchRow(size) });
        journal.apply({ kind: 'rewind', itemsRemoved: size + 1 });
      }
      index++;
    }
    expect(index).toBe(size);
  });
}

async function checkPendingScalarOwners(size: number): Promise<number> {
  return withBatchFixture(
    async ({
      recorder,
      owners,
      reads,
      pauseWriter,
      releaseWriter,
      waitForPausedWrite,
    }) => {
      const journal = new HistoryJournalStore(recorder, {
        ...reads.counters,
        ownership: owners,
      });

      pauseWriter();
      try {
        const probes = submitTicketRows(journal, size, batchRow, (row) =>
          owners.registerInput([row]),
        );
        await waitForPausedWrite;
        expectScalarCharge(owners, 0, 0);
        expectScalarCharge(owners.external, 0, 0);
        await expectTicketCallersReleased(probes);
        expectScalarCharge(owners.internal, 0, 0);
        const admittedAcquisitions = owners.snapshot().acquisitions;
        expect(admittedAcquisitions).toBe(size);
        visitPinnedPending(journal, owners, size, admittedAcquisitions);
        expectEmptyScalarJournal(journal);
        expectScalarCharge(owners, 0, 0);
        expectScalarCharge(owners.external, 0, 0);
        expectScalarCharge(owners.internal, 0, 0);
        const ticket = captureTicketWrite(recorder);
        recordScalarOwners('pending-after-cursor-before-ack', size, owners);
        releaseWriter();
        await journal.waitForDurable();
        await expectTicketDisk(recorder, ticket, size + 1, batchRow);
        expectEmptyScalarJournal(journal);
        expectNoScalarOwners(owners);
        expectNoScalarOwners(owners.external);
        expectNoScalarOwners(owners.internal);
        recordScalarOwners('pending-after-ack', size, owners);
        await expectScalarDurableRows(recorder, 0, batchRow);
        return journal.getLength();
      } finally {
        releaseWriter();
        journal.dispose();
        expectNoScalarOwners(owners);
      }
    },
  );
}

describe('scalar cursor pending membership owners', () => {
  it.each([512, 8192])(
    'keeps actual %i pending rows charged while the writer is paused',
    async (size) => {
      expect(await checkPendingScalarOwners(size)).toBe(0);
    },
    180000,
  );
});
