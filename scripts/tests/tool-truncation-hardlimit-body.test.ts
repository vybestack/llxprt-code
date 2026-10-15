/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { writeBodyFile } from '../../packages/test-utils/src/body-evidence-writer.js';
import { describe, it, expect } from 'bun:test';

import { join } from 'node:path';
import { DebugLogger } from '../../packages/core/src/debug/index.js';
import { HistoryService } from '../../packages/core/src/services/history/HistoryService.js';
import type { IContent } from '../../packages/core/src/services/history/IContent.js';
import { withSuffixFixture } from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import type { RuntimeTokenizerFactory } from '../../packages/core/src/runtime/contracts/RuntimeTokenizerFactory.js';
import { exactTokenizer } from '../../packages/core/src/services/history/chronology-rollback-test-helpers.js';
import { buildCuratedHistory } from '../../packages/core/src/services/history/historyCuration.js';
import { buildProviderContent } from '../../packages/core/src/services/history/historyProviderPipeline.js';
import {
  providerFarFixtureRow,
  providerPendingFixture,
} from '../../packages/core/src/services/history/__tests__/support/provider-curated-test-helpers.js';
import { enforceWithHandler } from '../../packages/agents/src/compression/__tests__/support/enforce-with-handler.js';
import { buildRuntimeContext } from '../../packages/agents/src/core/__tests__/chatSession-density-helpers.js';
import { createTruncationStub } from '../../packages/agents/src/compression/toolResultTruncator.js';
import { captureCuratedBody } from './provider-curated-body-gemini.js';

class FallbackCaptureHistory extends HistoryService {
  override replaceToolResponseBlock(): Promise<boolean> {
    throw new Error('eager tool replacement is forbidden');
  }
}
const logger = new DebugLogger('test:tool-hardlimit-bytes');
// Ordinary fixture blocks count one token, as under exactTokenizer. A block
// over the heavy threshold counts by length, so the far response has a real
// weight the last-resort pass can measure and shed.
const HEAVY_BLOCK_CHARACTERS = 10_000;
function weightedTokenizer(): RuntimeTokenizerFactory {
  const exact = exactTokenizer();
  return {
    ...exact,
    getTokenizer: (...args) => {
      const tokenizer = exact.getTokenizer(...args);
      return {
        ...tokenizer,
        countTokens: async (text: string): Promise<number> =>
          text.length > HEAVY_BLOCK_CHARACTERS ? Math.ceil(text.length / 4) : 1,
      };
    },
  };
}
// The last-resort pass ranks tool responses by their real token weight and
// refuses to replace anything unless replacing them can reach the limit, so
// the fixture's far response must weigh what the estimator charges for it.
function heavyPendingFixture(): IContent[] {
  const [response, ...rest] = providerPendingFixture();
  const block = response.blocks[0];
  if (block.type !== 'tool_response')
    throw new Error('Invalid pending fixture');
  return [
    {
      ...response,
      blocks: [
        {
          ...block,
          result: { far: 'answered after all history segments '.repeat(5000) },
        },
      ],
    },
    ...rest,
  ];
}
async function finalizedCount(
  history: HistoryService,
  contents: IContent[],
): Promise<number> {
  let rowTokens = contents.length;
  for (const row of contents)
    for (const block of row.blocks)
      if (
        block.type === 'tool_response' &&
        block.callId === 'far-call' &&
        block.providerMetadata?.contextTruncated !== true
      )
        rowTokens += await history.estimateTokensForContents([
          { speaker: 'tool', blocks: [block] },
        ]);
  return rowTokens;
}
async function hardlimitBodies(
  size: number,
  provider: string,
  caching: boolean,
): Promise<void> {
  await withSuffixFixture(
    size,
    async (history) => {
      history.setTokenizerFactory(weightedTokenizer());
      const pending = heavyPendingFixture();
      const actualRows = await enforceWithHandler({
        history,
        runtimeContext: buildRuntimeContext(history, {
          contextLimit: 30000,
          compressionThreshold: 0.8,
        }),
        generationConfig: { maxOutputTokens: 100 },
        pending,
        promptId: 'hardlimit',
        performCompression: async () => {
          throw new Error('compression provider failed');
        },
        fallbackDeps: { performFallbackCompression: async () => false },
        estimateRows: (rows) => finalizedCount(history, rows),
      });
      const block = pending[0].blocks[0];
      if (block.type !== 'tool_response')
        throw new Error('Invalid pending fixture');
      const farTokens = await history.estimateTokensForContents([
        { speaker: 'tool', blocks: [block] },
      ]);
      const expectedPending = [
        { ...pending[0], blocks: [createTruncationStub(block, farTokens)] },
        pending[1],
      ];
      const raw = Array.from({ length: size }, (_, index) =>
        providerFarFixtureRow(index),
      );
      const expectedRows = buildProviderContent(
        buildCuratedHistory(logger, raw, false),
        expectedPending,
        logger,
      );
      const actual = await captureCuratedBody(
        provider,
        actualRows,
        caching,
        provider === 'openai-responses',
      );
      const expected = await captureCuratedBody(
        provider,
        expectedRows,
        caching,
      );
      const output = process.env.TOOL_TRUNCATION_BODY_OUTPUT;
      if (output !== undefined) {
        const name = `tool-hardlimit-${provider}-${size}-${caching}`;
        await writeBodyFile(join(output, name + '-actual.json'), actual);
        await writeBodyFile(join(output, name + '-expected.json'), expected);
      }
      expect(actual).toBe(expected);
      expect(await finalizedCount(history, actualRows)).toBeLessThan(30000);
      if (provider === 'anthropic' && caching)
        expect(actual).toContain('cache_control');
    },
    2048,
    providerFarFixtureRow,
    undefined,
    (options) => new FallbackCaptureHistory(options),
  );
}
const cases: Array<[number, string, boolean]> = [];
for (const size of [512, 8192])
  for (const provider of ['anthropic', 'openai-responses', 'gemini'])
    for (const caching of [false, true]) cases.push([size, provider, caching]);
describe('BODY BYTES through failed-provider hard-limit tool fallback', () => {
  it.each(cases)(
    'preserves %i-row %s fallback body bytes caching=%s',
    hardlimitBodies,
    120000,
  );
});
