/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { CompressionHandler } from '../CompressionHandler.js';
import { buildRuntimeContext } from '../../core/__tests__/chatSession-density-helpers.js';
import { withSuffixFixture } from '../../../../core/src/services/history/history-suffix-test-helpers.js';
import { providerFixtureRow } from '../../../../core/src/services/history/provider-curated-test-helpers.js';
import { exactTokenizer } from '../../../../core/src/services/history/chronology-rollback-test-helpers.js';
import { collectRows } from './truncation-stream-helpers.js';
import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';

async function highDensityRegression(size: number): Promise<number> {
  return withSuffixFixture(
    size,
    async (history) => {
      history.setTokenizerFactory(exactTokenizer());
      const runtime = buildRuntimeContext(history, {
        compressionStrategy: 'high-density',
        contextLimit: size * 10000,
      });
      const handler = new CompressionHandler(
        runtime,
        history,
        {},
        () => {
          throw new Error('High-density compression must not call an LLM');
        },
        async () => {},
      );
      expect(await handler.performCompression('density-scale')).toBe(
        PerformCompressionResult.COMPRESSED,
      );
      const rows = await collectRows(history);
      const firstResponse = rows
        .flatMap((row) => row.blocks)
        .find((block) => block.type === 'tool_response');
      expect(
        firstResponse?.type === 'tool_response' &&
          typeof firstResponse.result === 'string',
      ).toBe(true);
      expect(
        firstResponse?.type === 'tool_response' && String(firstResponse.result),
      ).toContain('success');
      const last = rows[rows.length - 1];
      expect(last.blocks).toStrictEqual(providerFixtureRow(size - 1).blocks);
      expect(rows.length).toBeLessThan(size);
      expect(history.getCacheAnchorSeq()).toBe(0);
      return rows.length;
    },
    2048,
    providerFixtureRow,
  );
}

describe('unmigrated high-density large-journal behavior', () => {
  it.each([512, 8192])(
    'summarizes old tool results and preserves the recent tail across %i actual rows',
    async (size) => {
      expect(await highDensityRegression(size)).toBeLessThan(size);
    },
    120_000,
  );
});
