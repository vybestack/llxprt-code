/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';
import { withSuffixFixture } from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import {
  curatedFixtureRow,
  fixtureIncluded,
} from '../../../../core/src/services/history/curated-stream-test-helpers.js';
import {
  AttemptHistory,
  attemptHandler,
} from './compression-attempt-stream-helpers.js';

function* expectedRows(size: number): Generator<IContent, void, unknown> {
  for (let index = 0; index < size; index++) {
    if (fixtureIncluded(index)) yield curatedFixtureRow(index);
  }
}

describe('compression hook token estimation', () => {
  for (const size of [512, 8192]) {
    it(`estimates the borrowed ${size}-row cursor without requiring array collection`, async () => {
      await withSuffixFixture(
        size,
        async (service, ownership) => {
          const expected = await service.estimateTokensForContents(
            expectedRows(size),
          );
          let tokens: number | undefined;
          const handler = attemptHandler(service, async (context) => {
            tokens = await context.estimateTokens(context.history);
          });
          expect(await handler.performCompression('estimation')).toBe(
            PerformCompressionResult.NOOP,
          );
          expect(tokens).toBe(expected);
          expect(ownership.snapshot().liveRows).toBe(0);
        },
        0,
        curatedFixtureRow,
        undefined,
        (options) => new AttemptHistory(options),
      );
    }, 120_000);
  }
});
