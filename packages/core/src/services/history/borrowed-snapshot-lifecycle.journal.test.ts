/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  nativeBorrowedRows,
  withNativeBorrowedFixture,
} from './__tests__/support/native-borrowed-fixture.js';
import { borrowedRow, rowDigest } from './borrowed-snapshot-test-helpers.js';
import { detachedDigest } from './detached-rollback-test-helpers.js';
import { rejectedValue } from './chronology-rollback-test-helpers.js';
import type { IContent } from './IContent.js';

describe('native borrowed callback and cleanup failures', () => {
  it('preserves both errors, releases every reader and balances decoded accounting', async () => {
    await withNativeBorrowedFixture(512, 2048, async (history, owners) => {
      const primary = new Error('borrowed callback failed');
      const cleanup = new Error('borrowed release failed');
      const failure = await rejectedValue(
        history.readRows(async (view) => {
          await view.rows().next();
          await view.rows().next();
          expect(owners.snapshot().liveRows).toBe(2);
          owners.releaseFailure = cleanup;
          throw primary;
        }),
      );
      expect(failure).toBeInstanceOf(AggregateError);
      if (!(failure instanceof AggregateError)) throw failure;
      expect(failure.errors[0]).toBe(primary);
      const release = failure.errors[1];
      expect(release).toBeInstanceOf(AggregateError);
      if (!(release instanceof AggregateError)) throw release;
      expect(release.errors).toStrictEqual([cleanup]);
      expect(owners.snapshot().liveRows).toBe(0);
      await history.readRows(async (view) => {
        expect((await view.rows().next()).done).toBe(false);
      });
    });
  }, 120_000);
});

describe('native borrowed row facts cancellation', () => {
  it('rejects native row facts with the original in-scope abort reason', async () => {
    await withNativeBorrowedFixture(512, 2048, async (history) => {
      const controller = new AbortController();
      const primary = new Error('aborted row facts');
      expect(
        await rejectedValue(
          history.readRows(async (view) => {
            controller.abort(primary);
            await view.chronologySeqAt(0);
          }, controller.signal),
        ),
      ).toBe(primary);
    });
  }, 120_000);
});

for (const [size, bytes] of [
  [512, 2048],
  [8192, 2048],
  [1, 9 * 1024 * 1024],
]) {
  describe(`native borrowed snapshot lifecycle ${size}/${bytes}`, () => {
    it('preserves every complete value and closes on a for-await callback exception', async () => {
      await withNativeBorrowedFixture(size, bytes, async (history, owners) => {
        const expected = await detachedDigest(nativeBorrowedRows(size, bytes));
        const primary = new Error('for-await callback');
        expect(
          await rejectedValue(
            history.readRows(async (view) => {
              expect(view.length).toBe(size);
              expect(await detachedDigest(view.rows())).toStrictEqual(expected);
              for await (const row of view.rows()) {
                expect(rowDigest(row)).toBe(rowDigest(borrowedRow(0, bytes)));
                expect(owners.snapshot().liveRows).toBe(1);
                throw primary;
              }
            }),
          ),
        ).toBe(primary);
        expect(owners.snapshot().liveRows).toBe(0);
        expect(await detachedDigest(history.streamRawHistory())).toStrictEqual(
          expected,
        );
      });
    }, 120_000);

    it('closes an abandoned acquired reader when the callback throws or stops', async () => {
      await withNativeBorrowedFixture(size, bytes, async (history, owners) => {
        const readers: Array<AsyncGenerator<IContent, void, unknown>> = [];
        const primary = new Error('abandoned callback');
        expect(
          await rejectedValue(
            history.readRows(async (view) => {
              const reader = view.rows();
              readers.push(reader);
              expect((await reader.next()).done).toBe(false);
              expect(owners.snapshot().liveRows).toBe(1);
              throw primary;
            }),
          ),
        ).toBe(primary);
        expect(owners.snapshot().liveRows).toBe(0);
        expect(
          await history.readRows(async (view) => {
            const reader = view.rows();
            readers.push(reader);
            expect((await reader.next()).done).toBe(false);
            expect(owners.snapshot().liveRows).toBe(1);
            return 'stopped';
          }),
        ).toBe('stopped');
        expect(owners.snapshot().liveRows).toBe(0);
        for (const reader of readers) {
          expect((await reader.return()).done).toBe(true);
          expect((await reader.next()).done).toBe(true);
        }
      });
    }, 120_000);

    it('releases a nested failed reader while preserving only the outer acquired row', async () => {
      await withNativeBorrowedFixture(size, bytes, async (history, owners) => {
        const primary = new Error('nested callback');
        expect(
          await rejectedValue(
            history.readRows(async (outer) => {
              expect((await outer.rows().next()).done).toBe(false);
              expect(owners.snapshot().liveRows).toBe(1);
              expect(
                await rejectedValue(
                  history.readRows(async (inner) => {
                    expect((await inner.rows().next()).done).toBe(false);
                    expect(owners.snapshot().liveRows).toBe(2);
                    throw primary;
                  }),
                ),
              ).toBe(primary);
              expect(owners.snapshot().liveRows).toBe(1);
              throw primary;
            }),
          ),
        ).toBe(primary);
      });
    }, 120_000);

    it('preserves abort identity and closes the suspended reader', async () => {
      await withNativeBorrowedFixture(size, bytes, async (history, owners) => {
        const controller = new AbortController();
        const primary = new Error('snapshot aborted');
        expect(
          await rejectedValue(
            history.readRows(async (view) => {
              const reader = view.rows();
              expect((await reader.next()).done).toBe(false);
              expect(owners.snapshot().liveRows).toBe(1);
              controller.abort(primary);
              await reader.next();
            }, controller.signal),
          ),
        ).toBe(primary);
      });
    }, 120_000);

    it('permits reader close after throw without releasing a row twice', async () => {
      await withNativeBorrowedFixture(size, bytes, async (history, owners) => {
        const primary = new Error('reader failure');
        expect(
          await rejectedValue(
            history.readRows(async (view) => {
              const reader = view.rows();
              expect((await reader.next()).done).toBe(false);
              expect(owners.snapshot().liveRows).toBe(1);
              expect(
                await rejectedValue(
                  (async () => {
                    await reader.throw(primary);
                  })(),
                ),
              ).toBe(primary);
              expect(owners.snapshot().liveRows).toBe(0);
              expect((await reader.return()).done).toBe(true);
              throw primary;
            }),
          ),
        ).toBe(primary);
      });
    }, 120_000);

    it('releases failed owner admission and permits a subsequent independent reader', async () => {
      await withNativeBorrowedFixture(size, bytes, async (history, owners) => {
        const primary = new Error('owner admission');
        expect(
          await rejectedValue(
            history.readRows(async (view) => {
              owners.failure = primary;
              await view.rows().next();
            }),
          ),
        ).toBe(primary);
        expect(owners.snapshot().liveRows).toBe(0);
        await history.readRows(async (view) => {
          expect((await view.rows().next()).done).toBe(false);
          expect(owners.snapshot().liveRows).toBe(1);
        });
      });
    }, 120_000);
  });
}
