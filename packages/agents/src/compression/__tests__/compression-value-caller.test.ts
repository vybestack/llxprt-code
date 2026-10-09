/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { RowOwnership } from '@vybestack/llxprt-code-core/recording/rowOwnership.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';
import { withSuffixFixture } from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import {
  middleoutRow,
  middleoutSetup,
  SummaryTransport,
  middleoutOracle,
} from './middleout-disk-helpers.js';

import { ValueCompressionHistory } from './compression-value-fixture.js';

function comparableRow(row: IContent): IContent {
  return row.metadata?.synthetic === true
    ? { ...row, metadata: { ...row.metadata, chronology: undefined } }
    : row;
}

describe('invoked compression value publication', () => {
  it.each([512, 8192])(
    'publishes the real %i-row disk compression through values, not borrowed transforms or replaceAll',
    async (size) => {
      const ownership = new RowOwnership();
      await withSuffixFixture(
        size,
        async (history) => {
          const expected = await middleoutOracle(history, size);
          const { handler } = middleoutSetup(history);
          expect(await handler.performCompression('value-caller')).toBe(
            PerformCompressionResult.COMPRESSED,
          );
          let count = 0;
          for await (const row of history.streamRawHistory()) {
            expect(comparableRow(row)).toStrictEqual(
              comparableRow(expected.rows[count++]),
            );
            expect(row.metadata?.chronology?.seq).toBeGreaterThan(0);
          }
          expect(count).toBe(expected.rows.length);
          expect(history.getCacheAnchorSeq()).toBe(
            expected.rows[expected.top - 1]?.metadata?.chronology?.seq ?? 0,
          );
          expect(
            ownership.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
          ).toBe(true);
          expect(ownership.snapshot().liveRows).toBe(0);
        },
        2048,
        middleoutRow,
        ownership,
        (options) => new ValueCompressionHistory(options),
      );
    },
    180_000,
  );
});

describe('invoked compression value fallback publication', () => {
  it.each([512, 8192])(
    'keeps the opted-in %i-row caller on value publication when its provider requires fallback truncation',
    async (size) => {
      await withSuffixFixture(
        size,
        async (history) => {
          const transport = new SummaryTransport();
          transport.empty = true;
          const { handler } = middleoutSetup(history, transport, undefined, {
            compressionStrategy: 'one-shot',
            contextLimit: 100,
            compressionThreshold: 0.5,
          });
          history.syncTotalTokens(size);
          expect(await handler.performCompression('value-fallback')).toBe(
            PerformCompressionResult.COMPRESSED,
          );
          expect(history.getCacheAnchorSeq()).toBe(0);
          let count = 0;
          for await (const _row of history.streamRawHistory()) count++;
          expect(count).toBeGreaterThan(0);
          expect(count).toBeLessThan(size);
        },
        2048,
        middleoutRow,
        undefined,
        (options) => new ValueCompressionHistory(options),
      );
    },
    180_000,
  );
});
