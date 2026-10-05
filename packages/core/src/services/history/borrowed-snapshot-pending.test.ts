/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  borrowedRow,
  expectBorrowedBoundary,
  rowDigest,
  withBorrowedFixture,
} from './borrowed-snapshot-test-helpers.js';
import { rejectedValue } from './chronology-rollback-test-helpers.js';

describe('borrowed snapshot versus pending admission ownership', () => {
  it('releases both snapshot references on for-of failure while the blocked journal still owns its pending row', async () => {
    await withBorrowedFixture(async (fixture) => {
      const row = borrowedRow(0);
      fixture.store.apply({ kind: 'content', content: row });
      expect({
        referenceCount: fixture.owners.references,
        ...fixture.owners.snapshot(),
      }).toMatchObject({ referenceCount: 1, liveRows: 1, acquisitions: 1 });
      const primary = new Error('original for-of callback failure');
      expect(
        await rejectedValue(
          fixture.store.withMutationSnapshot(async (snapshot) => {
            expect(fixture.owners.references).toBe(2);
            expect(fixture.transaction.references).toBe(1);
            for (const borrowed of snapshot) {
              expect(borrowed).toBe(row);
              expect(fixture.owners.references).toBe(3);
              expect(fixture.transaction.references).toBe(2);
              throw primary;
            }
          }),
        ),
      ).toBe(primary);
      expect(fixture.owners.snapshot().liveRows).toBe(1);
      expect(fixture.owners.references).toBe(1);
      expect(fixture.transaction.references).toBe(0);
      expect(fixture.owners.releases).toBe(3);
      expect(fixture.decoded()).toBe(fixture.released());
      fixture.releaseWriter();
      await fixture.store.waitForDurable();
      expect(fixture.owners.references).toBe(0);
      expect(fixture.owners.snapshot().liveRows).toBe(0);
      for await (const durable of fixture.store.streamRows())
        expect(rowDigest(durable)).toBe(rowDigest(row));
      expectBorrowedBoundary(fixture, 0);
    }, true);
  });
});

describe('pending admission cleanup on abandoned reader and store retirement', () => {
  it('releases an abandoned pending iterator but preserves admission ownership until durable acknowledgement', async () => {
    await withBorrowedFixture(async (fixture) => {
      fixture.store.apply({ kind: 'content', content: borrowedRow(0) });
      const primary = new Error('pending abandoned reader');
      expect(
        await rejectedValue(
          fixture.store.withMutationSnapshot(async (snapshot) => {
            expect(snapshot[Symbol.iterator]().next().done).toBe(false);
            expect(fixture.owners.references).toBe(3);
            throw primary;
          }),
        ),
      ).toBe(primary);
      expect(fixture.owners.references).toBe(1);
      expect(fixture.transaction.references).toBe(0);
      fixture.releaseWriter();
      await fixture.store.waitForDurable();
      expect(fixture.owners.references).toBe(0);
    }, true);
  });

  it('releases the final pinned pending owner when the store is retired during a failing callback', async () => {
    await withBorrowedFixture(async (fixture) => {
      const row = borrowedRow(0);
      fixture.store.apply({ kind: 'content', content: row });
      const primary = new Error('retired pending reader');
      expect(
        await rejectedValue(
          fixture.store.withMutationSnapshot(async (snapshot) => {
            fixture.store.dispose();
            expect(fixture.owners.references).toBe(1);
            for (const borrowed of snapshot) {
              expect(borrowed).toBe(row);
              expect(fixture.owners.references).toBe(2);
              throw primary;
            }
          }),
        ),
      ).toBe(primary);
      expect(fixture.owners.references).toBe(0);
      expect(fixture.transaction.references).toBe(0);
    }, true);
  });
});
