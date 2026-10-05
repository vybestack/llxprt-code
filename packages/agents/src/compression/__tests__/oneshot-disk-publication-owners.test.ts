/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { RowOwnership } from '@vybestack/llxprt-code-core/recording/rowOwnership.js';
import { withSuffixFixture } from '../../../../core/src/services/history/history-suffix-test-helpers.js';
import { mediaParticipant } from '../../../../core/src/services/history/chronology-rollback-test-helpers.js';
import {
  oneshotSetup,
  oneshotRow,
  OneshotDiskHistory,
  oneshotOracle,
} from './oneshot-disk-helpers.js';
import { collectRows } from './truncation-stream-helpers.js';
import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = (): void => {
    throw new Error('Gate was not initialized');
  };
  const promise = new Promise<void>((release) => {
    resolve = release;
  });
  return { promise, resolve: () => resolve() };
}

async function publication(size: number): Promise<number> {
  const transaction = new RowOwnership();
  return withSuffixFixture(
    size,
    async (history, source) => {
      const expected = await oneshotOracle(history, size);
      const { handler, transport } = oneshotSetup(history);
      const ready = deferred();
      const gate = deferred();
      const primary = new Error('paused one-shot publication');
      let traversed = 0;
      let published = 0;
      let rejecting = true;
      history.registerMediaOwner(
        mediaParticipant((input) => {
          if (!rejecting) return { publish: () => {}, rollback: () => {} };
          expect(Array.isArray(input.previous)).toBe(false);
          expect(Array.isArray(input.next)).toBe(false);
          for (const row of input.previous)
            expect(row).toStrictEqual(oneshotRow(traversed++));
          return {
            rollback: () => {},
            publish: async () => {
              for (const _row of input.next) {
                published++;
                if (published === input.next.length) {
                  ready.resolve();
                  await gate.promise;
                  throw primary;
                }
              }
            },
          };
        }),
      );
      history.setCacheAnchorSeq(1);
      const operation = handler.performCompression('owner-pause').then(
        () => undefined,
        (failure: unknown) => failure,
      );
      await ready.promise;
      const live = transaction.snapshot();
      expect(live.liveRows).toBeGreaterThan(0);
      expect(
        transaction.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
      ).toBe(true);
      expect(
        source.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
      ).toBe(true);
      gate.resolve();
      expect(await operation).toBe(primary);
      expect(traversed).toBe(size);
      expect(published).toBe(expected.rows.length);
      expect(transaction.snapshot().liveRows + source.snapshot().liveRows).toBe(
        0,
      );
      expect(await collectRows(history)).toStrictEqual(
        Array.from({ length: size }, (_, index) => oneshotRow(index)),
      );
      expect(history.getCacheAnchorSeq()).toBe(1);
      rejecting = false;
      expect(await handler.performCompression('owner-retry')).toBe(
        PerformCompressionResult.COMPRESSED,
      );
      expect(transport.requests).toStrictEqual([
        expected.requests[0],
        expected.requests[0],
      ]);
      return live.liveRows;
    },
    2048,
    oneshotRow,
    transaction,
    (options) => new OneshotDiskHistory(options),
  );
}
describe('invoked one-shot publication owners', () => {
  it.each([512, 8192])(
    'pauses the real %i-row transaction with bounded owners and restores all membership after failure',
    async (size) => {
      expect(await publication(size)).toBeGreaterThan(0);
    },
    180_000,
  );
});
