/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from '../../../packages/core/src/services/history/IContent.js';
import type { StrategyCompressionResult } from '../../../packages/core/src/core/compression/types.js';
import type { CompressionAttemptContext } from '../../../packages/agents/src/compression/compressionContextBuilder.js';
import { adjustForToolCallBoundary } from '../../../packages/agents/src/compression/utils.js';

type OracleContext = Pick<
  CompressionAttemptContext,
  'runtimeContext' | 'currentTokenCount' | 'targetTokenCount'
> & {
  readonly history: readonly IContent[];
  estimateTokens(rows: readonly IContent[]): Promise<number>;
};

/** Independent eager reference retained only to compare native transport bytes. */
export class TruncationArrayOracle {
  async compress(context: OracleContext): Promise<StrategyCompressionResult> {
    const { history, runtimeContext, currentTokenCount, targetTokenCount } =
      context;
    const target =
      targetTokenCount ??
      runtimeContext.ephemerals.compressionThreshold() *
        runtimeContext.ephemerals.contextLimit() *
        0.6;
    if (history.length === 0 || currentTokenCount <= target) {
      return {
        kind: 'noop',
        reason: history.length === 0 ? 'empty-history' : 'already-under-target',
        metadata: {
          originalMessageCount: history.length,
          compressedMessageCount: history.length,
          strategyUsed: 'top-down-truncation',
          llmCallMade: false,
        },
      };
    }
    const minKeep = Math.min(2, history.length);
    let removeCount = 0;
    for (let index = 1; index <= history.length - minKeep; index++) {
      removeCount = index;
      const tokens = await context.estimateTokens(history.slice(index));
      if (targetTokenCount !== undefined ? tokens <= target : tokens < target)
        break;
    }
    const rows = [...history];
    const start = Math.min(
      adjustForToolCallBoundary(rows, removeCount),
      rows.length - minKeep,
    );
    const newHistory = rows.slice(start);
    return {
      kind: 'applied',
      newHistory,
      metadata: {
        originalMessageCount: rows.length,
        compressedMessageCount: newHistory.length,
        strategyUsed: 'top-down-truncation',
        llmCallMade: false,
      },
    };
  }
}
