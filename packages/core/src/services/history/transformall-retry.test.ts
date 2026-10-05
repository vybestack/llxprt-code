/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { gcAndSweep } from 'bun:jsc';
import {
  durableRowsOf,
  expectedRange,
  rejectedValue,
  rollbackRow,
  rowsOf,
  withRollbackFixture,
} from './chronology-rollback-test-helpers.js';
import { changedTransformRow } from './row-transform-test-helpers.js';
import { ownerFixtureRow } from './chronology-rollback-owner-helpers.js';

describe('public transform full retry', () => {
  for (const size of [512, 8192]) {
    it(`restores every row after partial admission and retries all ${size} rows`, async () => {
      await withRollbackFixture(async (history, recorder) => {
        const before = Array.from({ length: size }, (_, index) =>
          ownerFixtureRow(index, 2048),
        );
        await history.replaceBatch(before);
        await history.waitForCommit();
        const tokens = 4 * size;
        const range = expectedRange(size);
        recorder.failAdmissionAfter(3);
        let traversed = 0;
        expect(
          await rejectedValue(
            history.transformAll(async (source, sink) => {
              for await (const { row } of source.streamRows()) {
                expect(row).toStrictEqual(before[traversed++]);
                sink.appendDetached(changedTransformRow(row));
              }
            }),
          ),
        ).toBe(recorder.failure);
        expect(traversed).toBe(size);
        expect(await rowsOf(history)).toStrictEqual(before);
        await history.waitForCommit();
        expect(await durableRowsOf(recorder)).toStrictEqual(before);
        const tokensAfterRollback = history.getTotalTokens();
        expect(tokensAfterRollback).toBe(tokens);
        expect(history.getContextRange()).toStrictEqual(range);
        let retraversed = 0;
        await history.transformAll(async (source, sink) => {
          for await (const { row } of source.streamRows()) {
            expect(row).toStrictEqual(before[retraversed++]);
            sink.appendDetached(changedTransformRow(row));
          }
        });
        expect(retraversed).toBe(size);
        await history.waitForCommit();
        const expected = before.map(changedTransformRow);
        expect(await rowsOf(history)).toStrictEqual(expected);
        expect(await durableRowsOf(recorder)).toStrictEqual(expected);
        const tokensAfterCommittedRetry = history.getTotalTokens();
        expect(tokensAfterCommittedRetry).toBe(tokens);
      });
    }, 600_000);
  }
});

describe('public transform pending writer', () => {
  it('pins pending source identities while a writer and a later append are queued', async () => {
    await withRollbackFixture(async (history, recorder, releaseWriter) => {
      const marker = { seq: 1, userTurn: 1, step: 1, recordedAt: 0 };
      const original = { ...rollbackRow(0), metadata: { chronology: marker } };
      await history.addBatch([original]);
      let reached: (() => void) | undefined;
      let release: (() => void) | undefined;
      const ready = new Promise<void>((resolve) => {
        reached = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const failure = new Error('pending transform rollback');
      const operation = rejectedValue(
        history.transformAll(
          async (source, sink) => {
            for await (const entry of source.streamRows()) {
              expect(entry.ownership).toBe('borrowed');
              expect(entry.row).toBe(original);
              sink.appendBorrowed(entry.row);
            }
            reached?.();
            await gate;
          },
          undefined,
          {
            afterPublication: () => {
              original.metadata = {
                ...original.metadata,
                chronology: { seq: 900, userTurn: 1, step: 1, recordedAt: 0 },
              };
              gcAndSweep();
              throw failure;
            },
          },
        ),
      );
      await ready;
      const queued = rollbackRow(1);
      const append = history.addBatch([queued]);
      releaseWriter();
      release?.();
      expect(await operation).toBe(failure);
      await append;
      expect(original.metadata.chronology).toBe(marker);
      expect(queued.metadata?.chronology?.seq).toBe(2);
      expect(await rowsOf(history)).toStrictEqual([original, queued]);
      expect(history.getContextRange()).toStrictEqual(expectedRange(2));
      await history.waitForCommit();
      expect(await durableRowsOf(recorder)).toStrictEqual([original, queued]);
    }, true);
  });
});
