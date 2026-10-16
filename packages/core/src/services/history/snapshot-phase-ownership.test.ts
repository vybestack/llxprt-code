/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  rejectedValue,
  rollbackRow,
} from './chronology-rollback-test-helpers.js';
import {
  expectPhaseEmpty,
  recordPhase,
  withPhaseFixture,
} from './snapshot-phase-test-helpers.js';

describe('snapshot callback cleanup versus durable pending admission', () => {
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

describe('cancelled snapshot and admission retirement', () => {
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
