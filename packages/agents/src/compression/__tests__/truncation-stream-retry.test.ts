/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';
import { exactTokenizer } from '../../../../core/src/services/history/chronology-rollback-test-helpers.js';
import {
  withSuffixFixture,
  rowIndex,
} from '../../../../core/src/services/history/history-suffix-test-helpers.js';
import {
  TruncationStreamHistory,
  truncationHandler,
  truncationRow,
  collectRows,
} from './truncation-stream-helpers.js';

describe('pinned truncation transient retry', () => {
  it('retries a transient estimator failure without an eager strategy fallback', async () => {
    await withSuffixFixture(
      512,
      async (history, reader) => {
        const handler = truncationHandler(history);
        history.syncTotalTokens(512);
        await history.waitForTokenUpdates();
        let fail = true;
        history.setTokenizerFactory(
          exactTokenizer(() => {
            if (!fail) return;
            fail = false;
            throw Object.assign(
              new Error('temporary tokenizer transport failure'),
              { status: 503 },
            );
          }),
        );
        expect(await handler.performCompression('transient')).toBe(
          PerformCompressionResult.COMPRESSED,
        );
        expect((await collectRows(history)).map(rowIndex)).toStrictEqual(
          Array.from({ length: 29 }, (_, index) => 483 + index),
        );
        expect(reader.snapshot().liveRows).toBe(0);
      },
      64,
      truncationRow,
      undefined,
      (options) => new TruncationStreamHistory(options),
    );
  });
});
