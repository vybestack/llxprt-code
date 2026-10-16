/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { RowOwnership } from '../../recording/rowOwnership.js';
import {
  expectBorrowedBoundary,
  expectBorrowedClosed,
  seedBorrowed,
  withBorrowedFixture,
} from './borrowed-snapshot-test-helpers.js';
import type { IContent } from './IContent.js';

for (const size of [512, 8192]) {
  describe(`borrowed snapshot retaining control: ${size} rows`, () => {
    it('rejects explicit whole-stream retention without hiding it in reader cleanup', async () => {
      await withBorrowedFixture(async (fixture) => {
        await seedBorrowed(fixture, size);
        const retained: IContent[] = [];
        const trap = new RowOwnership();
        try {
          await fixture.store.withMutationSnapshot(async (snapshot) => {
            for (const row of snapshot) {
              retained.push(row);
              trap.retain(row);
            }
            expectBorrowedBoundary(fixture, 0);
            expect(trap.snapshot().liveRows).toBe(size);
            expect(
              trap.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
            ).toBe(false);
          });
          expectBorrowedClosed(fixture);
          expect(trap.snapshot()).toMatchObject({
            liveRows: size,
            acquisitions: size,
          });
          expect(trap.snapshot().liveSerializedBytes).toBeGreaterThan(
            size * 2048,
          );
        } finally {
          for (const row of retained) trap.release(row);
          retained.length = 0;
        }
        expect(trap.snapshot().liveRows).toBe(0);
        expect(trap.snapshot().liveSerializedBytes).toBe(0);
      });
    }, 120_000);

    it('closes unstarted and simultaneously acquired readers in the same callback scope', async () => {
      await withBorrowedFixture(async (fixture) => {
        await seedBorrowed(fixture, size);
        const readers: Array<Generator<IContent, void, unknown>> = [];
        await fixture.store.withMutationSnapshot(async (snapshot) => {
          readers.push(snapshot[Symbol.iterator]());
          expectBorrowedBoundary(fixture, 0);
          const first = snapshot[Symbol.iterator]();
          const second = snapshot[Symbol.iterator]();
          readers.push(first, second);
          expect(first.next().done).toBe(false);
          expectBorrowedBoundary(fixture, 1);
          expect(second.next().done).toBe(false);
          expectBorrowedBoundary(fixture, 2);
        });
        expectBorrowedClosed(fixture);
        for (const reader of readers) expect(reader.next().done).toBe(true);
        expectBorrowedBoundary(fixture, 0);
      });
    }, 120_000);
  });
}
