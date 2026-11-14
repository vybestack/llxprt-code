/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
/**
 * Independent in-memory reference for top-down truncation. Production
 * truncates through TopDownTruncationStrategy.compressDisk; byte-equivalence
 * tests compare the disk route against this array implementation.
 */
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type {
  CompressionContext,
  StrategyCompressionResult,
  StructuralNoopReason,
} from '@vybestack/llxprt-code-core/core/compression/types.js';
import { adjustForToolCallBoundary } from '../../utils.js';

function structuralNoop(
  originalCount: number,
  reason: StructuralNoopReason,
): Extract<StrategyCompressionResult, { kind: 'noop' }> {
  return {
    kind: 'noop',
    reason,
    metadata: {
      originalMessageCount: originalCount,
      compressedMessageCount: originalCount,
      strategyUsed: 'top-down-truncation',
      llmCallMade: false,
    },
  };
}

export async function compressTopDownArray(
  context: CompressionContext,
): Promise<StrategyCompressionResult> {
  const {
    history,
    runtimeContext,
    estimateTokens,
    currentTokenCount,
    targetTokenCount,
  } = context;
  const originalCount = history.length;

  if (originalCount === 0) {
    return structuralNoop(0, 'empty-history');
  }

  const compressionThreshold = runtimeContext.ephemerals.compressionThreshold();
  const contextLimit = runtimeContext.ephemerals.contextLimit();
  // Hard-limit enforcement supplies the real target because it is the only
  // layer that knows the finalized envelope's deficit; the ephemeral target
  // below only sees committed history (issue #3406).
  const target = targetTokenCount ?? compressionThreshold * contextLimit * 0.6;
  // An explicit target is a maximum, so landing exactly on it is done —
  // matching the `<=` no-op guard below. The threshold-derived fallback
  // keeps its historical strict comparison.
  const isSatisfied = (tokens: number): boolean =>
    targetTokenCount !== undefined ? tokens <= target : tokens < target;

  if (currentTokenCount <= target) {
    return structuralNoop(originalCount, 'already-under-target');
  }

  const minKeep = Math.min(2, originalCount);

  // Remove messages from start (oldest first) until under target
  let removeCount = 0;
  for (let i = 1; i <= originalCount - minKeep; i++) {
    const remaining = history.slice(i);
    const tokens = await estimateTokens(remaining);
    if (isSatisfied(tokens)) {
      removeCount = i;
      break;
    }
    removeCount = i;
  }

  // Ensure we keep at least minKeep messages
  removeCount = Math.min(removeCount, originalCount - minKeep);

  // Adjust boundary to avoid orphaning tool call/response pairs
  const mutableHistory = [...history] as IContent[];
  const adjustedIndex = adjustForToolCallBoundary(mutableHistory, removeCount);

  // Clamp: never remove more than originalCount - minKeep
  const finalRemoveCount = Math.min(adjustedIndex, originalCount - minKeep);

  const newHistory = mutableHistory.slice(finalRemoveCount);

  return {
    kind: 'applied',
    newHistory,
    metadata: {
      originalMessageCount: originalCount,
      compressedMessageCount: newHistory.length,
      strategyUsed: 'top-down-truncation',
      llmCallMade: false,
    },
  };
}
