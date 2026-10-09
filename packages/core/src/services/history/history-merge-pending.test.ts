/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  withRollbackFixture,
  rowsOf,
  rejectedValue,
  durableRowsOf,
} from './chronology-rollback-test-helpers.js';
import { mergeRow } from './history-merge-test-helpers.js';
import { withCoreSuffixFixture } from './core-suffix-fixture-test-helpers.js';

describe('history merge pending source identities', () => {
  it('keeps the pending source caller identity and marker on append', async () => {
    await withRollbackFixture(
      async (source, _sourceRecorder, releaseSource) => {
        const marker = {
          seq: 11,
          userTurn: 4,
          step: 1,
          recordedAt: 1700000000010,
        };
        const incoming = mergeRow(10, 2048, marker);
        source.add(incoming);
        await withRollbackFixture(
          async (target, targetRecorder, releaseTarget) => {
            const baseline = mergeRow(0);
            target.add(baseline);
            await target.merge(source);
            const live = await rowsOf(target);
            expect(live).toStrictEqual([baseline, incoming]);
            expect(live[1]).toBe(incoming);
            expect(incoming.metadata?.chronology).toBe(marker);
            releaseTarget();
            await target.waitForCommit();
            expect(await durableRowsOf(targetRecorder)).toStrictEqual([
              baseline,
              incoming,
            ]);
          },
          true,
        );
        releaseSource();
        await source.waitForCommit();
      },
      true,
    );
  });

  it('restores the original pending source marker after an observer mutates it and rejects publication', async () => {
    await withRollbackFixture(
      async (source, _sourceRecorder, releaseSource) => {
        const marker = {
          seq: 11,
          userTurn: 4,
          step: 1,
          recordedAt: 1700000000010,
        };
        const incoming = mergeRow(10, 2048, marker);
        source.add(incoming);
        await withRollbackFixture(async (target) => {
          const primary = new Error('pending merge observer');
          target.once('contentAdded', (row) => {
            row.metadata = {
              ...row.metadata,
              chronology: { seq: 99000, userTurn: 1, step: 1, recordedAt: 0 },
            };
            throw primary;
          });
          expect(await rejectedValue(target.merge(source))).toBe(primary);
          expect(await rowsOf(target)).toStrictEqual([]);
          expect((await rowsOf(source))[0]).toBe(incoming);
          expect(incoming.metadata?.chronology).toBe(marker);
        });
        releaseSource();
        await source.waitForCommit();
      },
      true,
    );
  });
});

describe('history merge source membership pinning', () => {
  for (const size of [512, 8192]) {
    it(`preserves pinned ${size} source rows across source clear and replacement`, async () => {
      await withCoreSuffixFixture(
        size,
        async (source) => {
          await withRollbackFixture(async (target) => {
            const observed: number[] = [];
            target.on('contentAdded', (row) =>
              observed.push(row.metadata?.chronology?.seq ?? -1),
            );
            target.once('contentAdded', () => {
              source.clear();
              source.add(mergeRow(30000));
            });
            await target.merge(source);
            expect(observed).toStrictEqual(
              Array.from({ length: size }, (_unused, index) => index + 1),
            );
            const rows = await rowsOf(target);
            expect(rows).toStrictEqual(
              Array.from({ length: size }, (_unused, index) =>
                mergeRow(index, 0),
              ),
            );
            expect(await rowsOf(source)).toStrictEqual([mergeRow(30000)]);
          });
        },
        0,
        mergeRow,
      );
    }, 600_000);
  }
});
