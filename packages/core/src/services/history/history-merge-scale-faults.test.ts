/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { withCoreSuffixFixture } from './core-suffix-fixture-test-helpers.js';
import {
  withRollbackFixture,
  rowsOf,
  durableRowsOf,
  rejectedValue,
  rollbackRow,
} from './chronology-rollback-test-helpers.js';
import { mergeRow, MergeRowHistory } from './history-merge-test-helpers.js';

describe('history merge scale partial admission', () => {
  for (const size of [512, 8192]) {
    it(`compensates a partial append from ${size} mixed input rows before replaying queued work`, async () => {
      await withCoreSuffixFixture(
        size,
        async (source) => {
          await withRollbackFixture(async (target, recorder) => {
            const baseline = mergeRow(20000);
            target.add(baseline);
            await target.waitForCommit();
            await target.waitForTokenUpdates();
            const beforeTokens = target.getTotalTokens();
            recorder.failAdmissionAfter(17);
            const merge = target.merge(source);
            const following = mergeRow(30000);
            target.add(following);
            expect(await rejectedValue(merge)).toBe(recorder.failure);
            expect(await rowsOf(target)).toStrictEqual([baseline, following]);
            await target.waitForTokenUpdates();
            expect(target.getTotalTokens()).toBe(beforeTokens * 2);
            await target.waitForCommit();
            expect(await durableRowsOf(recorder)).toStrictEqual([
              baseline,
              following,
            ]);
            let sourceCount = 0;
            for await (const row of source.streamRawHistory()) {
              expect(row).toStrictEqual(mergeRow(sourceCount));
              sourceCount++;
            }
            expect(sourceCount).toBe(size);
          });
        },
        2048,
        mergeRow,
        undefined,
        (options) => new MergeRowHistory(options),
      );
    }, 600_000);
  }
});

describe('history merge chronology stamping', () => {
  it('stamps unmarked source rows in append order and reconciles the next new marker', async () => {
    await withCoreSuffixFixture(
      3,
      async (source) => {
        await withRollbackFixture(async (target) => {
          const baseline = mergeRow(30);
          target.add(baseline);
          const started = Date.now();
          await target.merge(source);
          const ended = Date.now();
          const rows = await rowsOf(target);
          expect(
            rows.map((row) => row.metadata?.chronology?.seq),
          ).toStrictEqual([31, 32, 33, 34]);
          expect(rows.slice(1).map((row) => row.blocks)).toStrictEqual(
            Array.from(
              { length: 3 },
              (_unused, index) => rollbackRow(index).blocks,
            ),
          );
          for (const row of rows.slice(1)) {
            expect(row.metadata?.chronology?.recordedAt).toBeGreaterThanOrEqual(
              started,
            );
            expect(row.metadata?.chronology?.recordedAt).toBeLessThanOrEqual(
              ended,
            );
          }
          const fresh = rollbackRow(3);
          target.add(fresh);
          expect(fresh.metadata?.chronology).toMatchObject({
            seq: 35,
            userTurn: 13,
            step: 1,
          });
          expect(
            (await rowsOf(source)).map((row) => row.metadata),
          ).toStrictEqual([undefined, undefined, undefined]);
        });
      },
      0,
      rollbackRow,
    );
  });
});
