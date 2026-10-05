/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  submitTicketRows,
  seedTicketRows,
  expectTicketCallersReleased,
} from './ticket-owner-contract-test-helpers.js';
import {
  captureTicketWrite,
  expectTicketDisk,
  expectTicketDiskContents,
} from './ticket-disk-contract-test-helpers.js';
import {
  recordScalarOwners,
  expectNoScalarOwners,
} from './scalar-test-evidence.js';
import { batchRow, withBatchFixture } from './addbatch-stream-test-helpers.js';
import { HistoryJournalStore } from './historyJournalStore.js';
import { RowOwnership } from '../../recording/rowOwnership.js';
import type { IContent } from './IContent.js';

import {
  expectScalarCharge,
  expectScalarRow,
  expectScalarDurableRows,
  scalarRowCharge,
} from './scalar-owner-contract-test-helpers.js';

const bound = { rows: 440, serializedBytes: 8 * 1024 * 1024 };

describe('pinned synchronous history cursor', () => {
  it.each([512, 8192])(
    'pins %i rows across reentrant append and rewind',
    async (size) => {
      await withBatchFixture(
        async ({
          recorder,
          owners,
          reads,
          pauseWriter,
          waitForPausedWrite,
          releaseWriter,
        }) => {
          const probes = await seedTicketRows(recorder, size, batchRow);
          expectTicketDiskContents(recorder, size, batchRow);
          const journal = new HistoryJournalStore(recorder, {
            ...reads.counters,
            ownership: owners,
          });
          pauseWriter();
          try {
            journal.withReadRows((cursor) => {
              expect(cursor.length).toBe(size);
              let index = 0;
              for (const row of cursor.rows()) {
                expect(row).toStrictEqual(batchRow(index));
                expectScalarRow(row, index);
                expectScalarCharge(owners, 1, scalarRowCharge(batchRow(index)));
                if (index === 0) {
                  const added = submitTicketRows(journal, 1, () =>
                    batchRow(size),
                  );
                  probes.rows.push(...added.rows);
                  probes.markers.push(...added.markers);
                  journal.apply({ kind: 'rewind', itemsRemoved: size + 1 });
                }
                index++;
              }
              expect(index).toBe(size);
            });
            await waitForPausedWrite;
            expect(journal.withReadRows((cursor) => cursor.length)).toBe(0);
            expectScalarCharge(owners, 0, 0);
            const ticket = captureTicketWrite(recorder);
            await expectTicketCallersReleased(probes);
            recordScalarOwners('cursor-before-ack', size, owners);
            releaseWriter();
            await journal.waitForDurable();
            await expectTicketDisk(recorder, ticket, 1, () => batchRow(size));
            expectNoScalarOwners(owners);
            recordScalarOwners('cursor-after-ack', size, owners);
            await expectScalarDurableRows(recorder, 0, batchRow);
            expect(journal.getLength()).toBe(0);
            expect(owners.within(bound)).toBe(true);
          } finally {
            releaseWriter();
            journal.dispose();
          }
        },
      );
    },
    180000,
  );
});

describe('scalar cursor callback lifecycle', () => {
  it('releases rows and pinned descriptors on return, callback fault and abort', async () => {
    await withBatchFixture(async ({ recorder, owners, reads }) => {
      await recorder.commit('content', { content: batchRow(0) });
      const journal = new HistoryJournalStore(recorder, {
        ...reads.counters,
        ownership: owners,
      });
      const controller = new AbortController();
      try {
        const first = journal.withReadRows((cursor) => {
          for (const row of cursor.rows()) return row;
          return undefined;
        });
        expect(first).toStrictEqual(batchRow(0));
        journal.withReadRows((cursor) => {
          const iterator = cursor.rows();
          expect(iterator.next().value).toStrictEqual(batchRow(0));
        });
        expectNoScalarOwners(owners);
        expect(() =>
          journal.withReadRows((cursor) => {
            for (const row of cursor.rows()) {
              expect(row.speaker).toBe('human');
              throw new Error('callback fault');
            }
          }),
        ).toThrow('callback fault');
        expect(() =>
          journal.withReadRows((cursor) => {
            for (const row of cursor.rows()) {
              expect(row.speaker).toBe('human');
              controller.abort(new Error('cursor abort'));
            }
          }, controller.signal),
        ).toThrow('cursor abort');
        expect(() => journal.withReadRows(() => 0, controller.signal)).toThrow(
          'cursor abort',
        );
        expectNoScalarOwners(owners);
        expect(journal.withReadRows((cursor) => cursor.length)).toBe(1);
        expect(reads.snapshot().peakDecodedRows).toBe(1);
      } finally {
        journal.dispose();
      }
    });
  });
});

describe('scalar cursor retaining controls', () => {
  it.each(
    [512, 8192].flatMap((size) =>
      [false, true].map((copy) => ({ size, copy })),
    ),
  )(
    'does not excuse $size retained consumer rows copy=$copy',
    async ({ size, copy }) => {
      await withBatchFixture(async ({ recorder }) => {
        for (let index = 0; index < size; index++)
          await recorder.commit('content', { content: batchRow(index) });
        const journal = new HistoryJournalStore(recorder);
        const owners = new RowOwnership();
        const retained: IContent[] = [];
        try {
          journal.withReadRows((cursor) => {
            for (const row of cursor.rows()) {
              const held = copy ? { ...row } : row;
              retained.push(held);
              owners.retain(held);
            }
          });
          recordScalarOwners(
            copy ? 'retained-copy' : 'retained-borrowed',
            size,
            owners,
          );
          expect(retained).toHaveLength(size);
          expect(owners.within(bound)).toBe(
            process.env.SCALAR_RETAINING_TRAP === '1',
          );
        } finally {
          for (const row of retained) owners.release(row);
          retained.length = 0;
          journal.dispose();
          expectNoScalarOwners(owners);
        }
      });
    },
    180000,
  );
});
