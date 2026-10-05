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
import { RowOwnership } from '../../recording/rowOwnership.js';
import { createRowCounters } from '../../recording/journalCounters.js';
import { withRollbackFixture } from './chronology-rollback-test-helpers.js';
import type { IContent } from './IContent.js';
import {
  expectScalarCharge,
  scalarRowCharge,
} from './scalar-owner-contract-test-helpers.js';
import type { ContextRange } from './historyEventTypes.js';

function row(index: number): IContent {
  return {
    speaker: index % 2 === 0 ? 'human' : 'ai',
    blocks: [{ type: 'text', text: `row-${index}` }],
    metadata: {
      id: `pending-${index}`,
      chronology: {
        seq: index + 1,
        userTurn: index,
        step: 1,
        recordedAt: index,
      },
    },
  };
}

describe('maintained scalar length during synchronous admission', () => {
  it.each([512, 8192])(
    'publishes %i ordered adds before the first await with one empty boundary',
    async (size) => {
      await withRollbackFixture(async (history, recorder, releaseWriter) => {
        const boundaries: ContextRange[] = [];
        let added = 0;
        history.on('contextRangeChanged', (range) => boundaries.push(range));
        history.on('contentAdded', (content) => {
          expect(content.metadata?.id).toBe(`pending-${added++}`);
          expect(history.length()).toBe(added);
        });
        for (let index = 0; index < size; index++) history.add(row(index));
        expect(added).toBe(size);
        const admittedLength = history.length();
        expect(boundaries).toHaveLength(1);
        expect(boundaries[0].totalEntries).toBe(1);
        expect(recorder.getLastEnqueuedSequence()).toBeGreaterThanOrEqual(size);
        releaseWriter();
        await history.waitForCommit();
        await history.waitForTokenUpdates();
        let index = 0;
        for await (const content of history.streamRawHistory()) {
          expect(content.metadata?.id).toBe(`pending-${index}`);
          expect(content.metadata?.chronology?.seq).toBe(index + 1);
          index++;
        }
        expect(index).toBe(size);
        expect([admittedLength, history.length()]).toStrictEqual([size, size]);
      }, true);
    },
    120000,
  );
});

async function checkPendingLength(): Promise<number> {
  return withRollbackFixture(async (_history, recorder, releaseWriter) => {
    const owners = new RowOwnership();
    const reads = createRowCounters();
    const journal = new HistoryJournalStore(recorder, {
      ...reads.counters,
      ownership: owners,
    });
    try {
      expect(journal.getLength()).toBe(0);
      const probes = submitTicketRows(journal, 512, row, undefined, (index) => {
        expect(journal.getLength()).toBe(index + 1);
      });
      const ticket = captureTicketWrite(recorder);
      expectScalarCharge(owners, 0, 0);
      await expectTicketCallersReleased(probes);
      const admissionAcquisitions = owners.snapshot().acquisitions;
      for (let index = 0; index < 512; index++)
        expect({ length: journal.getLength() }).toStrictEqual({
          length: 512,
        });
      expect([
        admissionAcquisitions,
        owners.snapshot().acquisitions,
      ]).toStrictEqual([512, 512]);
      expectTicketCursorRows(journal, owners, 512, row);
      releaseWriter();
      await journal.waitForDurable();
      expect(journal.getLength()).toBe(512);
      expect(owners.snapshot().liveRows).toBe(0);
      expect(owners.snapshot().peakRows).toBe(1);
      await expectTicketDisk(recorder, ticket, 512, row);
      expectScalarCharge(owners, 0, 0);
      return journal.getLength();
    } finally {
      journal.dispose();
    }
  }, true);
}

describe('pending scalar owner lifetime', () => {
  it('charges pending owners without acquiring them again for repeated length reads', async () => {
    expect(await checkPendingLength()).toBe(512);
  });

  it('restores emptiness after observer compensation and after compression replay', async () => {
    await withRollbackFixture(async (history, _recorder, releaseWriter) => {
      const failure = new Error('observer failed');
      const reject = (): void => {
        throw failure;
      };
      history.on('contentAdded', reject);
      expect(() => history.add(row(0))).toThrow(failure);
      const compensatedLength = history.length();
      history.off('contentAdded', reject);
      const boundaries: ContextRange[] = [];
      history.on('contextRangeChanged', (range) => boundaries.push(range));
      history.startCompression();
      history.add(row(1));
      history.add(row(2));
      const queuedLength = history.length();
      history.endCompression();
      const replayedLength = history.length();
      expect(boundaries).toHaveLength(1);
      releaseWriter();
      await history.waitForCommit();
      expect([
        compensatedLength,
        queuedLength,
        replayedLength,
        history.length(),
      ]).toStrictEqual([0, 0, 2, 2]);
    }, true);
  });

  it('does not advance the scalar count when admission throws', async () => {
    await withRollbackFixture(async (history, recorder, releaseWriter) => {
      history.add(row(0));
      recorder.failAdmissionAfter(0);
      expect(() => history.add(row(1))).toThrow(recorder.failure);
      expect(history.length()).toBe(1);
      history.add(row(2));
      const admittedLength = history.length();
      releaseWriter();
      await history.waitForCommit();
      expect([admittedLength, history.length()]).toStrictEqual([2, 2]);
    }, true);
  });
});

describe('pending scalar identity and pinned membership', () => {
  it.each([512, 8192])(
    'keeps all %i caller rows pinned across a reentrant rewind and durable acknowledgement',
    async (size) => {
      await withRollbackFixture(async (_history, recorder, releaseWriter) => {
        const owners = new RowOwnership();
        const journal = new HistoryJournalStore(recorder, {
          ...createRowCounters().counters,
          ownership: owners,
        });
        const probes = submitTicketRows(journal, size, row);
        try {
          await expectTicketCallersReleased(probes);
          expect(journal.getLength()).toBe(size);
          journal.withReadRows((cursor) => {
            let index = 0;
            for (const content of cursor.rows()) {
              expect(content).toStrictEqual(row(index));
              expectScalarCharge(owners, 1, scalarRowCharge(row(index)));
              expect(content.metadata?.id).toBe(`pending-${index}`);
              expect(cursor.isPendingRow(index)).toBe(true);
              if (index === 0) {
                const added = submitTicketRows(journal, 1, () => row(size));
                probes.rows.push(...added.rows);
                probes.markers.push(...added.markers);
                journal.apply({ kind: 'rewind', itemsRemoved: size + 1 });
              }
              expect([journal.getLength(), cursor.length]).toStrictEqual([
                0,
                size,
              ]);
              index++;
            }
            expect(index).toBe(size);
          });
          expectScalarCharge(owners, 0, 0);
          const ticket = captureTicketWrite(recorder);
          await expectTicketCallersReleased(probes);
          releaseWriter();
          await journal.waitForDurable();
          expect(journal.getLength()).toBe(0);
          expect(owners.snapshot().liveRows).toBe(0);
          await expectTicketDisk(recorder, ticket, size + 1, row);
          expectScalarCharge(owners, 0, 0);
        } finally {
          journal.dispose();
        }
      }, true);
    },
    120000,
  );
});
