/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';
import { RowOwnership } from '@vybestack/llxprt-code-core/recording/rowOwnership.js';
import { describe, expect, it } from 'bun:test';
import { withCoreSuffixFixture } from '../../../../core/src/services/history/__tests__/support/core-suffix-fixture-test-helpers.js';
import { mediaParticipant } from '../../../../core/src/services/history/chronology-rollback-test-helpers.js';
import {
  HighdensityDiskHistory,
  highdensityOracle,
  highdensityRow,
  highdensitySetup,
} from './highdensity-disk-helpers.js';
import { nativePublication } from './support/native-publication-owners.js';
import { collectRows } from './truncation-stream-helpers.js';

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
  return withCoreSuffixFixture(
    size,
    async (history, source) => {
      const expected = await highdensityOracle(history, size);
      const { handler, transport } = highdensitySetup(history);
      const ready = deferred();
      const gate = deferred();
      const primary = new Error('paused high-density publication');
      let traversed = 0;
      let published = 0;
      let rejecting = true;
      await history.registerMediaOwner(
        mediaParticipant((input) => {
          if (!rejecting) return { publish: () => {}, rollback: () => {} };
          expect(Array.isArray(input.previous)).toBe(false);
          expect(Array.isArray(input.next)).toBe(false);
          for (const row of input.previous)
            expect(row).toStrictEqual(highdensityRow(traversed++));
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
      await Promise.race([
        ready.promise,
        operation.then((failure) => {
          throw failure ?? new Error('Publication ended before pause');
        }),
      ]);
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
      expect(published).toBe(expected.length);
      expect(transaction.snapshot().liveRows + source.snapshot().liveRows).toBe(
        0,
      );
      expect(await collectRows(history)).toStrictEqual(
        Array.from({ length: size }, (_, index) => highdensityRow(index)),
      );
      expect(history.getCacheAnchorSeq()).toBe(1);
      rejecting = false;
      expect(await handler.performCompression('owner-retry')).toBe(
        PerformCompressionResult.COMPRESSED,
      );
      expect(transport.requests).toHaveLength(0);
      return live.liveRows;
    },
    2048,
    highdensityRow,
    transaction,
    (options) => new HighdensityDiskHistory(options),
  );
}
describe('old invoked high-density publication owners', () => {
  it.each([512, 8192])(
    'pauses the real %i-row transaction with bounded owners and restores all membership after failure',
    async (size) => {
      expect(await publication(size)).toBeGreaterThan(0);
    },
    180_000,
  );
});

describe('native invoked high-density publication owners', () => {
  it.each([512, 8192])(
    'reserves media while publishing %i rows, restores persisted membership on failure and retries with bounded owners',
    async (size) => {
      expect(await nativePublication(size)).toBeUndefined();
    },
    180_000,
  );
  it('rejects an explicitly retained 8192-row prior version at the unchanged owner bounds', async () => {
    expect(await nativePublication(8192, true)).toBeUndefined();
  }, 180_000);
});
