/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import {
  invalidateResponsesStatefulChain,
  type IContent,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  createTruncationStub,
  rankToolResponses,
  type ToolResultTruncatorDeps,
} from '../toolResultTruncator.js';
import { toolRankingRow } from './tool-truncation-stream-helpers.js';

export const PENDING_BUDGET = 17 + 257;
export function lengthTokenizer(history: HistoryService): void {
  history.setTokenizerFactory({
    getTokenizer: () => ({
      fallbackPolicy: 'deny',
      countTokens: (text: string) => text.length,
    }),
  });
}
export function pendingTokenDeps(
  history: HistoryService,
  resetBaseline: () => void = () => {},
): ToolResultTruncatorDeps {
  return {
    historyService: history,
    logger: new DebugLogger('test:pending-token-native'),
    estimateBlockTokensAsync: (block) =>
      history.estimateTokensForContents(
        [{ speaker: 'tool', blocks: [block] }],
        'pending-token-native',
      ),
    computeProjected: () => history.getTotalTokens() + PENDING_BUDGET,
    resetBaseline,
    getRuntimeModel: () => 'pending-token-native',
  };
}
export function pendingRankRow(index: number, size: number): IContent {
  return toolRankingRow(index, index >= size - 3 ? 4096 : 16);
}
export function freezeRows(rows: readonly IContent[]): void {
  function freeze(value: unknown): void {
    if (typeof value !== 'object' || value === null) return;
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  freeze(rows);
}
export async function pendingArrayOracle(
  input: readonly IContent[],
  history: HistoryService,
  limit: number,
): Promise<{
  rows: readonly IContent[];
  replacedCount: number;
  projected: number;
  success: boolean;
}> {
  let rows: readonly IContent[] = input.filter(
    (row) => row.speaker !== 'ai' || row.blocks.length !== 0,
  );
  const ranked = await rankToolResponses(
    rows,
    pendingTokenDeps(history).estimateBlockTokensAsync,
  );
  let replacedCount = 0;
  let projected =
    (await history.estimateTokensForContents(rows, 'pending-token-native')) +
    PENDING_BUDGET;
  for (const candidate of ranked) {
    const invalidates = rows.some(
      (row, ordinal) =>
        ordinal >= candidate.entryIndex &&
        row.speaker === 'ai' &&
        row.metadata?.responsesStored === true,
    );
    rows = rows.map((row, ordinal) =>
      ordinal !== candidate.entryIndex
        ? row
        : {
            ...row,
            blocks: row.blocks.map((block, index) =>
              index === candidate.blockIndex
                ? createTruncationStub(
                    candidate.block,
                    candidate.estimatedTokens,
                  )
                : block,
            ),
          },
    );
    if (invalidates) rows = invalidateResponsesStatefulChain(rows);
    replacedCount++;
    projected =
      (await history.estimateTokensForContents(rows, 'pending-token-native')) +
      PENDING_BUDGET;
    if (projected <= limit)
      return { rows, replacedCount, projected, success: true };
  }
  return { rows, replacedCount, projected, success: false };
}
