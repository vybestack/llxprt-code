/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { withSuffixFixture } from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import {
  oneshotRow,
  oneshotSetup,
  oneshotOracle,
  OneshotDiskHistory,
} from './oneshot-disk-helpers.js';
import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';
import { collectRows } from './truncation-stream-helpers.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';

function largeRow(index: number, bytes: number): IContent {
  if (index === 200)
    return {
      ...oneshotRow(index, bytes),
      speaker: 'human',
      blocks: [
        { type: 'text', text: 'large-request:' + 'x'.repeat(9 * 1024 * 1024) },
      ],
    };
  return oneshotRow(index, bytes);
}
async function largeRequest(): Promise<number> {
  return withSuffixFixture(
    512,
    async (history) => {
      const oracle = await oneshotOracle(history, 512, 64, largeRow);
      const { handler, transport } = oneshotSetup(history);
      expect(await handler.performCompression('large-request')).toBe(
        PerformCompressionResult.COMPRESSED,
      );
      expect(transport.requests).toStrictEqual(oracle.requests);
      expect(transport.requests[0].length).toBeGreaterThan(9 * 1024 * 1024);
      const rows = await collectRows(history);
      expect(
        rows.filter(
          (row) => row.metadata?.reason === 'compression-state-snapshot',
        ),
      ).toHaveLength(1);
      return rows.length;
    },
    64,
    largeRow,
    undefined,
    (options) => new OneshotDiskHistory(options),
  );
}
describe('one-shot large summary input', () => {
  it('accepts a valid nine-MiB middle row and sends its complete legacy summary request', async () => {
    expect(await largeRequest()).toBeGreaterThan(0);
  }, 180_000);
});
