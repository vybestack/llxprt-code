/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { RuntimeTokenizerFactory } from '../../packages/core/src/runtime/contracts/RuntimeTokenizerFactory.js';
import type { HistoryService } from '../../packages/core/src/services/history/HistoryService.js';
import type {
  ContentBlock,
  IContent,
} from '../../packages/core/src/services/history/IContent.js';
import { exactTokenizer } from '../../packages/core/src/services/history/chronology-rollback-test-helpers.js';
import { providerPendingFixture } from '../../packages/core/src/services/history/__tests__/support/provider-curated-test-helpers.js';

/*
 * The last-resort tool-response pass ranks tool responses by their real token
 * weight and replaces nothing unless replacing them can reach the limit. A
 * fixture that fakes an over-limit request must therefore make the pending
 * "far-call" response weigh what the estimator charges for it.
 */

const HEAVY_BLOCK_CHARACTERS = 10_000;

/**
 * Ordinary fixture blocks count one token, as under exactTokenizer. A block
 * over the heavy threshold counts by length.
 */
export function weightedTokenizer(): RuntimeTokenizerFactory {
  const exact = exactTokenizer();
  return {
    ...exact,
    getTokenizer: (...args) => ({
      ...exact.getTokenizer(...args),
      countTokens: async (text: string): Promise<number> =>
        text.length > HEAVY_BLOCK_CHARACTERS ? Math.ceil(text.length / 4) : 1,
    }),
  };
}

/** The provider pending fixture with a far response large enough to matter. */
export function heavyPendingFixture(): IContent[] {
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
          result: {
            far: 'answered after all history segments '.repeat(5000),
          },
        },
      ],
    },
    ...rest,
  ];
}

export function toolBlockTokens(
  history: HistoryService,
  block: ContentBlock,
): Promise<number> {
  return history.estimateTokensForContents([
    { speaker: 'tool', blocks: [block] },
  ]);
}

/** Tokens the far response still weighs in `rows`; zero once it is stubbed. */
export async function untrimmedFarCallTokens(
  history: HistoryService,
  rows: IContent[],
): Promise<number> {
  let tokens = 0;
  for (const row of rows)
    for (const block of row.blocks)
      if (
        block.type === 'tool_response' &&
        block.callId === 'far-call' &&
        block.providerMetadata?.contextTruncated !== true
      )
        tokens += await toolBlockTokens(history, block);
  return tokens;
}
