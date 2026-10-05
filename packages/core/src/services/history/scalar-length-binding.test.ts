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
import { withRollbackFixture } from './chronology-rollback-test-helpers.js';
import { batchRow } from './addbatch-stream-test-helpers.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SessionRecordingService } from '../../recording/SessionRecordingService.js';
import { RowOwnership } from '../../recording/rowOwnership.js';
import { expectScalarCharge } from './scalar-owner-contract-test-helpers.js';
import { expectNoTicketDisk } from './ticket-disk-contract-test-helpers.js';
import { createRowCounters } from '../../recording/journalCounters.js';

describe('scalar length external binding boundaries', () => {
  it('reads new external commits until the first local admission binds their prefix', async () => {
    await withRollbackFixture(async (_history, recorder, releaseWriter) => {
      const journal = new HistoryJournalStore(recorder);
      try {
        expect(journal.getLength()).toBe(0);
        releaseWriter();
        await recorder.commit('content', { content: batchRow(0) });
        expect(journal.getLength()).toBe(1);
        await recorder.commit('content', { content: batchRow(1) });
        journal.apply({ kind: 'content', content: batchRow(2) });
        const admittedLength = journal.getLength();
        await journal.waitForDurable();
        expect([admittedLength, journal.getLength()]).toStrictEqual([3, 3]);
      } finally {
        journal.dispose();
      }
    }, true);
  });

  it('keeps an external prefix readable after failed local admission', async () => {
    await withRollbackFixture(async (_history, recorder, releaseWriter) => {
      const journal = new HistoryJournalStore(recorder);
      try {
        releaseWriter();
        await recorder.commit('content', { content: batchRow(0) });
        recorder.failAdmissionAfter(0);
        expect(() =>
          journal.apply({ kind: 'content', content: batchRow(1) }),
        ).toThrow(recorder.failure);
        await recorder.commit('content', { content: batchRow(2) });
        expect(journal.getLength()).toBe(2);
        journal.apply({ kind: 'content', content: batchRow(3) });
        const admittedLength = journal.getLength();
        await journal.waitForDurable();
        expect([admittedLength, journal.getLength()]).toStrictEqual([3, 3]);
      } finally {
        journal.dispose();
      }
    }, true);
  });
});

describe('scalar count across external record interleaving', () => {
  it('includes an external content record once a later local acknowledgement covers its bytes', async () => {
    await withRollbackFixture(async (_history, recorder, releaseWriter) => {
      const journal = new HistoryJournalStore(recorder);
      try {
        journal.apply({ kind: 'content', content: batchRow(0) });
        releaseWriter();
        await journal.waitForDurable();
        await recorder.commit('content', { content: batchRow(1) });
        journal.apply({ kind: 'content', content: batchRow(2) });
        await journal.waitForDurable();
        expect(journal.getLength()).toBe(3);
      } finally {
        journal.dispose();
      }
    }, true);
  });

  it('includes external records covered by a newer acknowledgement of an existing local line', async () => {
    await withRollbackFixture(async (_history, recorder, releaseWriter) => {
      const journal = new HistoryJournalStore(recorder);
      try {
        journal.apply({ kind: 'content', content: batchRow(0) });
        releaseWriter();
        await journal.waitForDurable();
        await recorder.commit('content', { content: batchRow(1) });
        await journal.waitForDurable();
        expect(journal.getLength()).toBe(2);
      } finally {
        journal.dispose();
      }
    }, true);
  });
});
describe('scalar count-only rewind admission', () => {
  it('truncates by count without reacquiring pending input rows', async () => {
    await withRollbackFixture(async (_history, recorder, releaseWriter) => {
      const owners = new RowOwnership();
      const journal = new HistoryJournalStore(recorder, {
        ...createRowCounters().counters,
        ownership: owners,
      });
      try {
        const probes = submitTicketRows(journal, 512, batchRow);
        journal.apply({ kind: 'rewind', itemsRemoved: 1 });
        expect(journal.getLength()).toBe(511);
        expect(owners.snapshot().acquisitions).toBe(512);
        expectScalarCharge(owners, 0, 0);
        const ticket = captureTicketWrite(recorder);
        await expectTicketCallersReleased(probes);
        expectTicketCursorRows(journal, owners, 511, batchRow);
        releaseWriter();
        await journal.waitForDurable();
        await expectTicketDisk(recorder, ticket, 512, batchRow);
        expectTicketCursorRows(journal, owners, 511, batchRow);
        expect(owners.snapshot().liveRows).toBe(0);
      } finally {
        journal.dispose();
      }
    }, true);
  });
});

describe('scalar cardinality-preserving density admission', () => {
  it('keeps replacement-only density length without reacquiring the pending input', async () => {
    await withRollbackFixture(async (_history, recorder, releaseWriter) => {
      const owners = new RowOwnership();
      const journal = new HistoryJournalStore(recorder, {
        ...createRowCounters().counters,
        ownership: owners,
      });
      try {
        for (let index = 0; index < 512; index++)
          journal.apply({ kind: 'content', content: batchRow(index) });
        journal.apply({
          kind: 'density',
          payload: {
            removedSeqs: [256],
            replacements: [{ replacedSeq: 256, replacement: batchRow(600) }],
          },
        });
        expect(journal.getLength()).toBe(512);
        expect(owners.snapshot().acquisitions).toBe(513);
        releaseWriter();
        await journal.waitForDurable();
        expect(owners.snapshot().liveRows).toBe(0);
      } finally {
        journal.dispose();
      }
    }, true);
  });
});

describe('scalar count at partial foreign-prefix acknowledgements', () => {
  it('counts each newly visible foreign interval even when later local lines are still pending', async () => {
    await withRollbackFixture(async (_history, recorder, releaseWriter) => {
      const journal = new HistoryJournalStore(recorder);
      try {
        journal.apply({ kind: 'content', content: batchRow(0) });
        recorder.enqueue('content', { content: batchRow(1) });
        journal.apply({ kind: 'content', content: batchRow(2) });
        const bookmark = recorder.enqueue('session_event', {
          severity: 'info',
          message: 'partial prefix',
        });
        if (bookmark === null) throw new Error('Missing partial prefix record');
        const partialCount = recorder
          .waitForCommit(bookmark)
          .then(() => journal.getLength());
        recorder.enqueue('content', { content: batchRow(3) });
        journal.apply({ kind: 'content', content: batchRow(4) });
        releaseWriter();
        const partial = await partialCount;
        await journal.waitForDurable();
        expect([partial, journal.getLength()]).toStrictEqual([4, 5]);
      } finally {
        journal.dispose();
      }
    }, true);
  });
});

describe('scalar pending ownership after writer failure', () => {
  it('keeps admitted rows visible and charged until disposal when acknowledgement rejects', async () => {
    const root = mkdtempSync(join(tmpdir(), 'scalar-length-failure-'));
    const failure = new Error('injected scalar journal I/O failure');
    const recorder = new SessionRecordingService({
      sessionId: 'scalar-failure',
      projectHash: 'scalar-failure',
      chatsDir: root,
      workspaceDirs: [root],
      provider: 'test',
      model: 'test',
      io: {
        appendFile: async (): Promise<void> => {
          throw failure;
        },
      },
    });
    const owners = new RowOwnership();
    const journal = new HistoryJournalStore(recorder, {
      ...createRowCounters().counters,
      ownership: owners,
    });
    try {
      const probes = submitTicketRows(journal, 1, batchRow);
      const ticket = captureTicketWrite(recorder);
      await expect(journal.waitForDurable()).rejects.toBe(failure);
      expect(recorder.getLastEnqueuedSequence()).toBe(ticket.seq);
      await expectTicketCallersReleased(probes);
      expectTicketCursorRows(journal, owners, 1, batchRow);
      expectNoTicketDisk(recorder);
      expect(journal.getLength()).toBe(1);
      const failedPendingOwners = owners.snapshot().liveRows;
      journal.withReadRows((cursor) => {
        expect(cursor.length).toBe(1);
        const first = cursor.rows().next();
        if (first.done === true) throw new Error('Missing admitted row');
        expect(first.value.metadata?.chronology?.seq).toBe(1);
      });
      expect([failedPendingOwners, owners.snapshot().liveRows]).toStrictEqual([
        0, 0,
      ]);
      expectScalarCharge(owners, 0, 0);
    } finally {
      journal.dispose();
      expect(owners.snapshot().liveRows).toBe(0);
      await recorder.dispose();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
