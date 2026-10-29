/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { withNativeDetachedFixture } from './__tests__/support/detached-contract-fixture.js';
import { mergeRow } from './__tests__/support/history-merge-test-helpers.js';
import {
  rollbackRow,
  rowsOf,
  withRollbackFixture,
} from './chronology-rollback-test-helpers.js';

function lastRowOf<T>(rows: readonly T[]): T | undefined {
  return rows[rows.length - 1];
}

describe('history merge chronology stamping', () => {
  it('stamps unmarked source rows in append order and reconciles the next new marker', async () => {
    await withNativeDetachedFixture(async ({ history: source, session }) => {
      await session.append(
        Array.from({ length: 3 }, (_, index) => rollbackRow(index)),
      );
      await withRollbackFixture(async (target) => {
        const baseline = mergeRow(30);
        target.add(baseline);
        await target.waitForCommit();
        const started = Date.now();
        await target.merge(source);
        const ended = Date.now();
        const rows = await rowsOf(target);
        expect(rows.map((row) => row.metadata?.chronology?.seq)).toStrictEqual([
          31, 32, 33, 34,
        ]);
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
        await target.waitForCommit();
        expect(
          lastRowOf(await rowsOf(target))?.metadata?.chronology,
        ).toMatchObject({
          seq: 35,
          userTurn: 13,
          step: 1,
        });
        expect((await rowsOf(source)).map((row) => row.metadata)).toStrictEqual(
          [undefined, undefined, undefined],
        );
      });
    });
  });
});
