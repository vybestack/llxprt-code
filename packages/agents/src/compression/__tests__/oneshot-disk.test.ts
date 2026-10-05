/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';
import { withSuffixFixture } from '../../../../core/src/services/history/history-suffix-test-helpers.js';
import {
  oneshotSetup,
  oneshotOracle,
  oneshotRow,
  OneshotDiskHistory,
} from './oneshot-disk-helpers.js';
import { collectRows } from './truncation-stream-helpers.js';

async function parity(size: number): Promise<number> {
  return withSuffixFixture(
    size,
    async (history) => {
      const expected = await oneshotOracle(history, size);
      const { handler, transport } = oneshotSetup(history);
      expect(await handler.performCompression('disk')).toBe(
        PerformCompressionResult.COMPRESSED,
      );
      const rows = await collectRows(history);
      // Fresh summary/continuation chronology is allocated by the real transaction.
      expect(
        rows.map((row) =>
          row.metadata?.synthetic === true
            ? {
                ...row,
                metadata: {
                  ...row.metadata,
                  chronology: undefined,
                  model: undefined,
                },
              }
            : row,
        ),
      ).toStrictEqual(
        expected.rows.map((row) =>
          row.metadata?.synthetic === true
            ? {
                ...row,
                metadata: {
                  ...row.metadata,
                  chronology: undefined,
                  model: undefined,
                },
              }
            : row,
        ),
      );
      expect(transport.requests).toStrictEqual(expected.requests);
      const count = rows.length;
      expect(history.getCacheAnchorSeq()).toBe(
        expected.rows[expected.top - 1]?.metadata?.chronology?.seq ?? 0,
      );
      return count;
    },
    2048,
    oneshotRow,
    undefined,
    (options) => new OneshotDiskHistory(options),
  );
}

describe('invoked disk one-shot', () => {
  it.each([512, 8192])(
    'preserves exact split, summary request and rejoin for %i mixed rows',
    async (size) => {
      expect(await parity(size)).toBeGreaterThan(0);
    },
    180_000,
  );
});
