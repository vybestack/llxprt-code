/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, it, expect } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DebugLogger } from '../../packages/core/src/debug/index.js';
import type {
  IContent,
  ContentBlock,
} from '../../packages/core/src/services/history/IContent.js';
import { invalidateResponsesStatefulChainForRetainedRewrite } from '../../packages/core/src/services/history/IContent.js';
import { withSuffixFixture } from '../../packages/core/src/services/history/history-suffix-test-helpers.js';
import { exactTokenizer } from '../../packages/core/src/services/history/chronology-rollback-test-helpers.js';
import { buildCuratedHistory } from '../../packages/core/src/services/history/historyCuration.js';
import { buildProviderContent } from '../../packages/core/src/services/history/historyProviderPipeline.js';
import {
  providerFarFixtureRow,
  providerPendingFixture,
} from '../../packages/core/src/services/history/provider-curated-test-helpers.js';
import { BoundedToolHistory } from '../../packages/agents/src/compression/__tests__/tool-truncation-stream-helpers.js';
import { recomposeFixture } from '../../packages/agents/src/compression/__tests__/provider-curated-recomposition-helpers.js';
import {
  rankToolResponses,
  createTruncationStub,
  truncateOversizedToolResponsesUnified,
} from '../../packages/agents/src/compression/toolResultTruncator.js';
import { captureCuratedBody } from './provider-curated-body-helpers.js';

const logger = new DebugLogger('test:tool-truncation-bytes');
function estimate(block: ContentBlock): Promise<number> {
  return Promise.resolve(
    block.type === 'tool_response' && block.callId === 'far-call' ? 200 : 100,
  );
}
async function oracle(
  size: number,
): Promise<{ raw: IContent[]; pending: IContent[] }> {
  const raw = Array.from({ length: size }, (_, index) =>
    providerFarFixtureRow(index),
  );
  const pending = providerPendingFixture();
  const ranked = await rankToolResponses([...raw, ...pending], estimate);
  const rows = [...raw, ...pending];
  for (const candidate of ranked.slice(0, 2)) {
    const row = rows[candidate.entryIndex];
    const blocks = [...row.blocks];
    blocks[candidate.blockIndex] = createTruncationStub(
      candidate.block,
      candidate.estimatedTokens,
    );
    rows[candidate.entryIndex] = { ...row, blocks };
  }
  const history = invalidateResponsesStatefulChainForRetainedRewrite(
    rows.slice(0, size),
    ranked[1].entryIndex,
  );
  return { raw: history, pending: rows.slice(size) };
}

async function toolBodies(
  size: number,
  provider: string,
  caching: boolean,
): Promise<void> {
  await withSuffixFixture(
    size,
    async (history) => {
      history.setTokenizerFactory(exactTokenizer());
      let projections = 0;
      const result = await truncateOversizedToolResponsesUnified(
        {
          historyService: history,
          logger,
          pendingContents: providerPendingFixture(),
          estimateBlockTokensAsync: estimate,
          computeProjected: async () => (++projections < 2 ? 200 : 0),
          resetBaseline: () => {},
          getRuntimeModel: () => 'test',
        },
        100,
      );
      expect(result).toMatchObject({ replacedCount: 2, success: true });
      const expected = await oracle(size);
      const actualRows = await recomposeFixture(
        history,
        result.transformedPending ?? [],
      );
      const expectedRows = buildProviderContent(
        buildCuratedHistory(logger, expected.raw, false),
        expected.pending,
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
      const output = process.env.TOOL_TRUNCATION_BODY_OUTPUT;
      if (output !== undefined) {
        const name = `tool-${provider}-${size}-${caching}`;
        writeFileSync(join(output, name + '-actual.json'), actual);
        writeFileSync(join(output, name + '-expected.json'), expectedBody);
      }
      expect(actual).toBe(expectedBody);
      if (provider === 'anthropic' && caching)
        expect(actual).toContain('cache_control');
    },
    2048,
    providerFarFixtureRow,
    undefined,
    (options) => new BoundedToolHistory(options),
  );
}

const cases: Array<[number, string, boolean]> = [];
for (const size of [512, 8192])
  for (const provider of ['anthropic', 'openai-responses', 'gemini'])
    for (const caching of [false, true]) cases.push([size, provider, caching]);
describe('BODY BYTES after invoked tool truncation and provider recomposition', () => {
  it.each(cases)(
    'preserves %i-row %s body bytes with caching %s',
    toolBodies,
    120000,
  );
});
