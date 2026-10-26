/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { getScratchRoot } from '@vybestack/llxprt-code-core/storage/scratch-root.js';
import {
  invalidateResponsesStatefulChain,
  type ContentBlock,
  type IContent,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { truncateToolResponsesInOnePass } from '../toolResponseOnePass.js';
import {
  createTruncationStub,
  rankToolResponses,
} from '../toolResultTruncator.js';
import { withNativeFallbackFixture } from './support/native-fallback-fixture.js';
import { operationFileCreates } from './support/operation-file-creates.js';
import { collectRows } from './truncation-stream-helpers.js';
import { toolRankingRow } from './tool-truncation-stream-helpers.js';
import { compressionValueDigest } from './compression-value-fixture.js';

function score(block: ContentBlock): Promise<number> {
  if (block.type !== 'tool_response') return Promise.resolve(0);
  if (block.providerMetadata?.contextTruncated === true)
    return Promise.resolve(100);
  const result = block.result;
  if (
    typeof result !== 'object' ||
    result === null ||
    !('index' in result) ||
    typeof result.index !== 'number'
  )
    throw new Error('Invalid ranking fixture');
  return Promise.resolve(1000 + (result.index % 7) * 100);
}
function freeze(value: unknown): void {
  if (typeof value !== 'object' || value === null) return;
  Object.freeze(value);
  for (const child of Object.values(value)) freeze(child);
}
async function total(
  rows: AsyncIterable<IContent> | readonly IContent[],
): Promise<number> {
  let tokens = 0;
  for await (const row of rows)
    for (const block of row.blocks) tokens += await score(block);
  return tokens;
}
async function arrayOracle(
  input: readonly IContent[],
  pending: readonly IContent[],
  limit: number,
): Promise<{
  history: readonly IContent[];
  pending: IContent[];
  count: number;
  tokens: number;
  first: number;
}> {
  const working = structuredClone([...input, ...pending]);
  const ranked = await rankToolResponses(working, score);
  let tokens = await total(working);
  let count = 0;
  let firstHistory = Infinity;
  for (const candidate of ranked) {
    if (tokens <= limit && count > 0) break;
    const stub = createTruncationStub(
      candidate.block,
      candidate.estimatedTokens,
    );
    working[candidate.entryIndex].blocks[candidate.blockIndex] = stub;
    tokens -= candidate.estimatedTokens - (await score(stub));
    count++;
    if (candidate.entryIndex < input.length)
      firstHistory = Math.min(firstHistory, candidate.entryIndex);
  }
  let history: readonly IContent[] = working.slice(0, input.length);
  if (
    history.some(
      (row, ordinal) =>
        ordinal >= firstHistory &&
        row.speaker === 'ai' &&
        row.metadata?.responsesStored === true,
    )
  )
    history = invalidateResponsesStatefulChain(history);
  return {
    history,
    pending: working.slice(input.length),
    count,
    tokens,
    first: ranked[0].entryIndex,
  };
}

describe('native ranking equals the old array optimizer', () => {
  it.each([3, 64, 65, 5000])(
    'preserves exact history, pending, tokens and mirrored values at %i rows without operation files',
    async (size) => {
      await withNativeFallbackFixture(
        async ({ history, seed, durable, owners }) => {
          await seed(
            (function* () {
              for (let index = 0; index < size; index++) {
                const row = toolRankingRow(index, 64);
                yield {
                  ...row,
                  metadata: {
                    ...row.metadata,
                    chronology: {
                      seq: size - index,
                      userTurn: 1,
                      step: index,
                      recordedAt: 0,
                    },
                  },
                };
              }
            })(),
          );
          const baseline = await collectRows(history);
          const pending = [
            toolRankingRow(size, 64),
            toolRankingRow(size + 1, 64),
          ];
          freeze(baseline);
          freeze(pending);
          const frozenBytes = JSON.stringify({ baseline, pending });
          const limit = Math.floor(
            (await total([...baseline, ...pending])) * 0.78,
          );
          const expected = await arrayOracle(baseline, pending, limit);
          getScratchRoot();
          const files = await operationFileCreates(async () => {
            const result = await truncateToolResponsesInOnePass(
              {
                historyService: history,
                rankingRevision: 'native-array-parity:1',
                logger: new DebugLogger('test:native-array-parity'),
                pendingContents: pending,
                estimateBlockTokensAsync: score,
                computeProjected: async (working) =>
                  (await total(history.streamRawHistory())) +
                  (await total(working)),
                getRuntimeModel: () => 'native-array-parity',
              },
              limit,
            );
            expect(result).toStrictEqual({
              replacedCount: expected.count,
              projected: expected.tokens,
              success: true,
              transformedPending: expected.pending,
            });
          }, true);
          expect(await collectRows(history)).toStrictEqual([
            ...expected.history,
          ]);
          expect(files).toStrictEqual({ directories: [], files: [] });
          expect(JSON.stringify({ baseline, pending })).toBe(frozenBytes);
          expect(await durable()).toStrictEqual(
            await compressionValueDigest(history.streamRawHistory()),
          );
          expect(
            owners.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
          ).toBe(true);
          expect(owners.snapshot().liveRows).toBe(0);
          process.stdout.write(
            `NATIVE_TOOL_PARITY ${JSON.stringify({ size, count: expected.count, tokens: expected.tokens, first: expected.first })}\n`,
          );
        },
      );
    },
    180_000,
  );
});
