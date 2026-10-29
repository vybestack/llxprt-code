/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { RowOwnership } from '@vybestack/llxprt-code-core/recording/rowOwnership.js';
import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';
import {
  suffixRow,
  withSuffixFixture,
} from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import {
  AttemptHistory,
  attemptHandler,
} from './compression-attempt-stream-helpers.js';

const cases = [512].flatMap((size) =>
  [false, true].map((copy) => ({ size, copy })),
);

describe('compression hook retaining controls', () => {
  it.each(cases)(
    'rejects retention of all $size complete hook rows copy=$copy',
    async ({ size, copy }) => {
      await withSuffixFixture(
        size,
        async (history, readers) => {
          const retained: IContent[] = [];
          const ownership = new RowOwnership();
          const actual = createHash('sha256');
          const expected = createHash('sha256');
          for (let index = 0; index < size; index++)
            expected.update(JSON.stringify(suffixRow(index, 32 * 1024)));
          const handler = attemptHandler(history, async (context) => {
            for await (const row of context.history) {
              const held = copy ? structuredClone(row) : row;
              retained.push(held);
              ownership.retain(held);
              actual.update(JSON.stringify(held));
            }
          });
          try {
            expect(
              await handler.performCompression('hook-retaining-control'),
            ).toBe(PerformCompressionResult.NOOP);
            expect(actual.digest('hex')).toBe(expected.digest('hex'));
            expect(ownership.snapshot().liveRows).toBe(size);
            expect(ownership.snapshot().liveSerializedBytes).toBeGreaterThan(
              8 * 1024 * 1024,
            );
            expect(
              ownership.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
            ).toBe(process.env.COMPRESSION_ATTEMPT_RETAINING_TRAP === '1');
          } finally {
            for (const row of retained) ownership.release(row);
            retained.length = 0;
          }
          expect(ownership.snapshot().liveRows).toBe(0);
          expect(ownership.snapshot().liveSerializedBytes).toBe(0);
          expect(readers.snapshot().liveRows).toBe(0);
          expect(readers.snapshot().peakRows).toBeLessThanOrEqual(440);
          expect(readers.snapshot().peakSerializedBytes).toBeLessThanOrEqual(
            8 * 1024 * 1024,
          );
        },
        32 * 1024,
        suffixRow,
        undefined,
        (options) => new AttemptHistory(options),
      );
    },
    120_000,
  );
});
