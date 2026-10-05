/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  rejectedValue,
  rollbackRow,
} from './chronology-rollback-test-helpers.js';
import {
  expectPendingAdmission,
  expectPhaseEmpty,
  recordPhase,
  withPhaseFixture,
} from './snapshot-phase-test-helpers.js';
import type { IContent } from './IContent.js';

describe('snapshot callback cleanup versus durable pending admission', () => {
  it('releases all borrowed pins and generators before ack, then releases the exact admission at ack', async () => {
    await withPhaseFixture(async (fixture) => {
      const row = rollbackRow(0);
      fixture.store.apply({ kind: 'content', content: row });
      const readers: Array<Generator<IContent, void, unknown>> = [];
      const primary = new Error('phase callback failure');
      expect(
        await rejectedValue(
          fixture.store.withMutationSnapshot(async (snapshot) => {
            const reader = snapshot[Symbol.iterator]();
            readers.push(reader);
            expect(reader.next().value).toBe(row);
            throw primary;
          }),
        ),
      ).toBe(primary);
      expectPendingAdmission(fixture.owners, fixture.transaction, row);
      for (const reader of readers) expect(reader.next().done).toBe(true);
      recordPhase(
        'callback-failure-before-ack',
        fixture.owners,
        fixture.transaction,
      );
      fixture.releaseWriter();
      await fixture.store.waitForDurable();
      expectPhaseEmpty(fixture.owners);
      expectPhaseEmpty(fixture.transaction);
      expect(fixture.owners.lastEvent?.stack).toContain('absorbHistoryPending');
      recordPhase('durable-ack', fixture.owners, fixture.transaction);
    });
  });

  it('has no admission left at callback failure when the same row was already acknowledged', async () => {
    await withPhaseFixture(async (fixture) => {
      const row = { ...rollbackRow(0), metadata: {} };
      fixture.store.apply({ kind: 'content', content: row });
      fixture.releaseWriter();
      await fixture.store.waitForDurable();
      const primary = new Error('already durable callback failure');
      expect(
        await rejectedValue(
          fixture.store.withMutationSnapshot(async (snapshot) => {
            for (const borrowed of snapshot) {
              expect(borrowed).toStrictEqual(row);
              throw primary;
            }
          }),
        ),
      ).toBe(primary);
      expectPhaseEmpty(fixture.owners);
      expectPhaseEmpty(fixture.transaction);
      recordPhase(
        'already-durable-callback-failure',
        fixture.owners,
        fixture.transaction,
      );
    });
  });
});

describe('pending admission failure and cancellation retirement', () => {
  it('preserves a recorder write failure and retires its unacknowledged admission without orphaned snapshot owners', async () => {
    await withPhaseFixture(async (fixture) => {
      const row = rollbackRow(0);
      fixture.store.apply({ kind: 'content', content: row });
      const primary = new Error('callback before failed append');
      expect(
        await rejectedValue(
          fixture.store.withMutationSnapshot(async (snapshot) => {
            expect(snapshot[Symbol.iterator]().next().value).toBe(row);
            throw primary;
          }),
        ),
      ).toBe(primary);
      expectPendingAdmission(fixture.owners, fixture.transaction, row);
      const writeFailure = new Error('phase writer failure');
      const acknowledgement = fixture.store.waitForDurable();
      fixture.failWriter(writeFailure);
      expect(await rejectedValue(acknowledgement)).toBe(writeFailure);
      expectPendingAdmission(fixture.owners, fixture.transaction, row);
      recordPhase(
        'failed-append-before-retirement',
        fixture.owners,
        fixture.transaction,
      );
      fixture.store.dispose();
      expectPhaseEmpty(fixture.owners);
      expectPhaseEmpty(fixture.transaction);
      expect(fixture.owners.lastEvent?.stack).toContain('retireHistoryPending');
      recordPhase(
        'failed-recorder-retired',
        fixture.owners,
        fixture.transaction,
      );
    });
  });
});

describe('cancelled snapshot and admission retirement', () => {
  it('releases cancelled snapshot readers before store retirement releases the pending admission', async () => {
    await withPhaseFixture(async (fixture) => {
      const row = rollbackRow(0);
      fixture.store.apply({ kind: 'content', content: row });
      const controller = new AbortController();
      const primary = new Error('phase cancellation');
      const readers: Array<Generator<IContent, void, unknown>> = [];
      expect(
        await rejectedValue(
          fixture.store.withMutationSnapshot(async (snapshot) => {
            const reader = snapshot[Symbol.iterator]();
            readers.push(reader);
            expect(reader.next().value).toBe(row);
            controller.abort(primary);
            controller.signal.throwIfAborted();
          }, controller.signal),
        ),
      ).toBe(primary);
      expectPendingAdmission(fixture.owners, fixture.transaction, row);
      for (const reader of readers) expect(reader.next().done).toBe(true);
      recordPhase(
        'cancel-before-retirement',
        fixture.owners,
        fixture.transaction,
      );
      fixture.store.dispose();
      expectPhaseEmpty(fixture.owners);
      expectPhaseEmpty(fixture.transaction);
      expect(fixture.owners.lastEvent?.stack).toContain('retireHistoryPending');
      fixture.releaseWriter();
      await fixture.recorder.flush();
      expectPhaseEmpty(fixture.owners);
      recordPhase(
        'cancel-retired-and-drained',
        fixture.owners,
        fixture.transaction,
      );
    });
  });

  it('releases acquisitions when recorder enqueue fails before a pending entry exists', async () => {
    await withPhaseFixture(async (fixture) => {
      fixture.recorder.failAdmissionAfter(0);
      expect(() =>
        fixture.store.apply({ kind: 'content', content: rollbackRow(0) }),
      ).toThrow(fixture.recorder.failure);
      expectPhaseEmpty(fixture.owners);
      expect(fixture.owners.events[0].stack).toContain('admitHistoryPending');
      expect(fixture.owners.events[1].stack).toContain('admitHistoryPending');
      expect(fixture.owners.snapshot().acquisitions).toBe(1);
      recordPhase('enqueue-failure', fixture.owners, fixture.transaction);
    });
  });
});

describe('same-meter independent retaining control', () => {
  it('keeps a consumer owner visible after ack rather than misclassifying it as pending admission', async () => {
    await withPhaseFixture(async (fixture) => {
      const row = rollbackRow(0);
      fixture.store.apply({ kind: 'content', content: row });
      const retained: IContent[] = [];
      const primary = new Error('retaining consumer callback');
      try {
        expect(
          await rejectedValue(
            fixture.store.withMutationSnapshot(async (snapshot) => {
              for (const borrowed of snapshot) {
                retained.push(borrowed);
                fixture.owners.retain(borrowed);
                throw primary;
              }
            }),
          ),
        ).toBe(primary);
        expect(fixture.transaction.references).toBe(0);
        expect(fixture.owners.references).toBe(2);
        expect(fixture.owners.events[5].stack).toContain(
          'snapshot-phase-ownership.test.ts',
        );
        recordPhase(
          'retaining-control-before-ack',
          fixture.owners,
          fixture.transaction,
        );
        fixture.releaseWriter();
        await fixture.store.waitForDurable();
        expect(fixture.owners.references).toBe(1);
        expect(fixture.owners.snapshot().liveRows).not.toBe(0);
        expect(fixture.owners.snapshot().liveSerializedBytes).toBe(
          Buffer.byteLength(JSON.stringify(row), 'utf8'),
        );
        expect(fixture.owners.lastEvent?.stack).toContain(
          'absorbHistoryPending',
        );
        recordPhase(
          'retaining-control-after-ack',
          fixture.owners,
          fixture.transaction,
        );
      } finally {
        for (const borrowed of retained) fixture.owners.release(borrowed);
        retained.length = 0;
      }
      expectPhaseEmpty(fixture.owners);
      recordPhase(
        'retaining-control-released',
        fixture.owners,
        fixture.transaction,
      );
    });
  });
});
