/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import {
  borrowedRow,
  expectBorrowedBoundary,
  expectBorrowedClosed,
  rowDigest,
  seedBorrowed,
  withBorrowedFixture,
} from './borrowed-snapshot-test-helpers.js';
import { rejectedValue } from './chronology-rollback-test-helpers.js';
import type { IContent } from './IContent.js';

for (const [size, bytes] of [
  [512, 2048],
  [8192, 2048],
  [1, 9 * 1024 * 1024],
]) {
  describe(`borrowed snapshot cleanup: ${size} rows, ${bytes} text bytes`, () => {
    it('preserves complete row values and closes on a for-of callback exception', async () => {
      await withBorrowedFixture(async (fixture) => {
        await seedBorrowed(fixture, size, bytes);
        const primary = new Error('for-of callback');
        const actual = createHash('sha256');
        const expected = createHash('sha256');
        for (let index = 0; index < size; index++)
          expected.update(JSON.stringify(borrowedRow(index, bytes)));
        expect(
          await rejectedValue(
            fixture.store.withMutationSnapshot(async (snapshot) => {
              expect(snapshot.length).toBe(size);
              for (const row of snapshot) actual.update(JSON.stringify(row));
              expect(actual.digest('hex')).toBe(expected.digest('hex'));
              for (const row of snapshot) {
                expect(rowDigest(row)).toBe(rowDigest(borrowedRow(0, bytes)));
                expectBorrowedBoundary(fixture, 1);
                throw primary;
              }
            }),
          ),
        ).toBe(primary);
        expectBorrowedClosed(fixture);
      });
    }, 120_000);

    it('closes an acquired reader abandoned by a throwing callback', async () => {
      await withBorrowedFixture(async (fixture) => {
        await seedBorrowed(fixture, size, bytes);
        const readers: Array<Generator<IContent, void, unknown>> = [];
        const primary = new Error('abandoned reader callback');
        expect(
          await rejectedValue(
            fixture.store.withMutationSnapshot(async (snapshot) => {
              const reader = snapshot[Symbol.iterator]();
              readers.push(reader);
              expect(reader.next().done).toBe(false);
              expectBorrowedBoundary(fixture, 1);
              throw primary;
            }),
          ),
        ).toBe(primary);
        expectBorrowedClosed(fixture);
        for (const reader of readers) {
          expect(reader.return().done).toBe(true);
          expect(reader.next().done).toBe(true);
        }
        expectBorrowedBoundary(fixture, 0);
      });
    }, 120_000);
  });

  describe(`nested snapshot and stop: ${size} rows, ${bytes} text bytes`, () => {
    it('releases a nested failed reader while keeping only the outer acquired row', async () => {
      await withBorrowedFixture(async (fixture) => {
        await seedBorrowed(fixture, size, bytes);
        const primary = new Error('nested callback');
        expect(
          await rejectedValue(
            fixture.store.withMutationSnapshot(async (outer) => {
              expect(outer[Symbol.iterator]().next().done).toBe(false);
              expectBorrowedBoundary(fixture, 1);
              expect(
                await rejectedValue(
                  fixture.store.withMutationSnapshot(async (inner) => {
                    expect(inner[Symbol.iterator]().next().done).toBe(false);
                    expectBorrowedBoundary(fixture, 2);
                    throw primary;
                  }),
                ),
              ).toBe(primary);
              expectBorrowedBoundary(fixture, 1);
              throw primary;
            }),
          ),
        ).toBe(primary);
        expectBorrowedClosed(fixture);
      });
    }, 120_000);

    it('closes a acquired reader when its callback stops without returning it', async () => {
      await withBorrowedFixture(async (fixture) => {
        await seedBorrowed(fixture, size, bytes);
        const result = await fixture.store.withMutationSnapshot(
          async (snapshot) => {
            expect(snapshot[Symbol.iterator]().next().done).toBe(false);
            expectBorrowedBoundary(fixture, 1);
            return 'stopped';
          },
        );
        expect(result).toBe('stopped');
        expectBorrowedClosed(fixture);
      });
    }, 120_000);
  });

  describe(`snapshot abort and close: ${size} rows, ${bytes} text bytes`, () => {
    it('preserves abort identity and releases the suspended acquired reader', async () => {
      await withBorrowedFixture(async (fixture) => {
        await seedBorrowed(fixture, size, bytes);
        const controller = new AbortController();
        const primary = new Error('snapshot aborted');
        expect(
          await rejectedValue(
            fixture.store.withMutationSnapshot(async (snapshot) => {
              const reader = snapshot[Symbol.iterator]();
              expect(reader.next().done).toBe(false);
              expectBorrowedBoundary(fixture, 1);
              controller.abort(primary);
              controller.signal.throwIfAborted();
            }, controller.signal),
          ),
        ).toBe(primary);
        expectBorrowedClosed(fixture);
      });
    }, 120_000);

    it('permits reader close after failure without releasing a row twice', async () => {
      await withBorrowedFixture(async (fixture) => {
        await seedBorrowed(fixture, size, bytes);
        const primary = new Error('reader failure before close');
        expect(
          await rejectedValue(
            fixture.store.withMutationSnapshot(async (snapshot) => {
              const reader = snapshot[Symbol.iterator]();
              expect(reader.next().done).toBe(false);
              expectBorrowedBoundary(fixture, 1);
              expect(
                await rejectedValue(
                  Promise.resolve().then(() => {
                    reader.throw(primary);
                  }),
                ),
              ).toBe(primary);
              expectBorrowedBoundary(fixture, 0);
              expect(reader.return().done).toBe(true);
              await snapshot.close();
              expectBorrowedBoundary(fixture, 0);
              expect(() => snapshot.readRow(0)).toThrow(
                'History mutation snapshot is closed',
              );
              expect(() => snapshot[Symbol.iterator]()).toThrow(
                'History mutation snapshot is closed',
              );
              throw primary;
            }),
          ),
        ).toBe(primary);
        expectBorrowedClosed(fixture);
      });
    }, 120_000);
  });
}
