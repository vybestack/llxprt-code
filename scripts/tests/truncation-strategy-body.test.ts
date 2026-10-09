/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { writeBodyFile } from '../../packages/test-utils/src/body-evidence-writer.js';
import { describe, expect, it } from 'bun:test';

import { join } from 'node:path';
import { DebugLogger } from '../../packages/core/src/debug/index.js';
import { withSuffixFixture } from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import { buildCuratedHistory } from '../../packages/core/src/services/history/historyCuration.js';
import { annotateCompressionSpan } from '../../packages/core/src/services/history/historyChronology.js';
import {
  invalidateResponsesStatefulChain,
  type IContent,
} from '../../packages/core/src/services/history/IContent.js';
import { buildProviderContent } from '../../packages/core/src/services/history/historyProviderPipeline.js';
import {
  providerFarFixtureRow,
  providerPendingFixture,
} from '../../packages/core/src/services/history/provider-curated-test-helpers.js';
import {
  truncationHandler,
  TruncationStreamHistory,
} from '../../packages/agents/src/compression/__tests__/truncation-stream-helpers.js';
import { recomposeFixture } from '../../packages/agents/src/compression/__tests__/provider-curated-recomposition-helpers.js';
import { buildRuntimeContext } from '../../packages/agents/src/core/__tests__/chatSession-density-helpers.js';
import { buildCompressionMetadata } from '../../packages/agents/src/compression/compressionContextBuilder.js';
import { TopDownTruncationStrategy } from '../../packages/agents/src/compression/TopDownTruncationStrategy.js';
import { captureCuratedBody } from './provider-curated-body-helpers.js';
import type { HistoryService } from '../../packages/core/src/services/history/HistoryService.js';
import { PerformCompressionResult } from '../../packages/core/src/core/turn.js';

const logger = new DebugLogger('test:disk-strategy-bytes');

async function oracle(
  history: HistoryService,
  size: number,
): Promise<{ rows: IContent[]; total: number }> {
  const raw = Array.from({ length: size }, (_, index) =>
    providerFarFixtureRow(index),
  );
  const rows = buildCuratedHistory(logger, raw, false);
  const suffixTokens = new Map<number, number>();
  let total = 0;
  for (let index = rows.length - 1; index >= 0; index--) {
    total += await history.estimateTokensForContents([rows[index]]);
    suffixTokens.set(rows[index].metadata?.chronology?.seq ?? 0, total);
  }
  const runtime = buildRuntimeContext(history, {
    compressionStrategy: 'top-down-truncation',
    contextLimit: 100,
    compressionThreshold: 0.5,
  });
  const metadata = await buildCompressionMetadata(
    'oracle',
    runtime,
    history,
    async () => {
      throw new Error('No oracle provider');
    },
    undefined,
    undefined,
    logger,
  );
  const result = await new TopDownTruncationStrategy().compress({
    ...metadata,
    history: rows,
    currentTokenCount: total,
    estimateTokens: async (remaining) =>
      suffixTokens.get(remaining[0]?.metadata?.chronology?.seq ?? 0) ?? 0,
  });
  if (result.kind !== 'applied')
    throw new Error('Expected eager test-only truncation candidate');
  const annotated = annotateCompressionSpan(raw, result.newHistory);
  return {
    total,
    rows: invalidateResponsesStatefulChain(
      annotated.map((row) => {
        const metadata = { ...row.metadata };
        delete metadata.cacheAnchor;
        return { ...row, metadata };
      }),
    ),
  };
}

async function bodyPair(
  size: number,
  provider: string,
  caching: boolean,
): Promise<void> {
  await withSuffixFixture(
    size,
    async (history) => {
      const handler = truncationHandler(history);
      const expected = await oracle(history, size);
      history.syncTotalTokens(expected.total);
      await history.waitForTokenUpdates();
      expect(await handler.performCompression('wire')).toBe(
        PerformCompressionResult.COMPRESSED,
      );
      const pending = providerPendingFixture();
      const actualRows = await recomposeFixture(history, pending);
      const expectedRows = buildProviderContent(
        buildCuratedHistory(logger, expected.rows, false),
        pending,
        logger,
      );
      const actual = await captureCuratedBody(
        provider,
        actualRows,
        caching,
        provider === 'openai-responses',
      );
      const expectedBody = await captureCuratedBody(
        provider,
        expectedRows,
        caching,
      );
      const output = process.env.TRUNCATION_STRATEGY_BODY_OUTPUT;
      if (output !== undefined) {
        const name = `strategy-${provider}-${size}-${caching}`;
        await writeBodyFile(join(output, name + '-actual.json'), actual);
        await writeBodyFile(
          join(output, name + '-expected.json'),
          expectedBody,
        );
      }
      expect(actual).toBe(expectedBody);
      expect(actual.length).toBeGreaterThan(0);
    },
    2048,
    providerFarFixtureRow,
    undefined,
    (options) => new TruncationStreamHistory(options),
  );
}

const cases: Array<[number, string, boolean]> = [];
for (const size of [512, 8192])
  for (const provider of ['anthropic', 'openai-responses', 'gemini'])
    for (const caching of [false, true]) cases.push([size, provider, caching]);

describe('BODY BYTES after production pinned disk truncation strategy', () => {
  it.each(cases)(
    'matches independent legacy %i-row %s bodies with caching %s',
    bodyPair,
    120_000,
  );
});
