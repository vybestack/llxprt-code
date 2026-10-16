/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { createHash } from 'node:crypto';
import { describe, it, expect } from 'bun:test';
import { withRollbackFixture } from '../../../../core/src/services/history/chronology-rollback-test-helpers.js';
import {
  invalidateResponsesStatefulChainForRetainedRewrite,
  type ContentBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  truncateLargestToolResponses,
  rankToolResponses,
  createTruncationStub,
} from '../toolResultTruncator.js';
import {
  toolRankingRow,
  toolDeps,
  digestRows,
  expectedToolDigest,
} from './tool-truncation-stream-helpers.js';

async function preferAssistantResponses(block: ContentBlock): Promise<number> {
  if (block.type !== 'tool_response') return 100;
  if (typeof block.result !== 'object' || block.result === null) return 100;
  if (!('index' in block.result) || typeof block.result.index !== 'number')
    return 100;
  return block.result.index % 2 === 0 ? 200 : 100;
}

async function retryDigest(size: number): Promise<string> {
  const original = Array.from({ length: size }, (_, index) =>
    toolRankingRow(index),
  );
  const [candidate] = await rankToolResponses(
    original,
    preferAssistantResponses,
  );
  const rewritten = original.map((row, index) =>
    index !== candidate.entryIndex
      ? row
      : {
          ...row,
          blocks: row.blocks.map((block, blockIndex) =>
            blockIndex === candidate.blockIndex
              ? createTruncationStub(candidate.block, candidate.estimatedTokens)
              : block,
          ),
        },
  );
  const expected = invalidateResponsesStatefulChainForRetainedRewrite(
    rewritten,
    candidate.entryIndex,
  );
  const hash = createHash('sha256');
  for (const row of expected) hash.update(JSON.stringify(row) + '\n');
  return hash.digest('hex');
}

describe('ranked tool replacement transaction', () => {
  it.each([512, 8192])(
    'restores exact %i-row history and cache anchor after partial admission then permits retry',
    async (size) => {
      await withRollbackFixture(async (history, recorder) => {
        await history.addBatch(
          Array.from({ length: size }, (_, index) => toolRankingRow(index)),
        );
        await recorder.flush();
        history.setCacheAnchorSeq(1);
        recorder.failAdmissionAfter(2);
        const deps = {
          ...toolDeps(history, async () => 0),
          estimateBlockTokensAsync: preferAssistantResponses,
        };
        await expect(truncateLargestToolResponses(deps, 100)).rejects.toThrow(
          'injected journal admission failure',
        );
        expect(await digestRows(history.streamRawHistory())).toBe(
          expectedToolDigest(size, 0),
        );
        expect(history.getCacheAnchorSeq()).toBe(1);
        const retry = await truncateLargestToolResponses(deps, 100);
        expect(retry).toStrictEqual({
          replacedCount: 1,
          projected: 0,
          success: true,
        });
        expect(await digestRows(history.streamRawHistory())).toBe(
          await retryDigest(size),
        );
      });
    },
    120000,
  );
});
