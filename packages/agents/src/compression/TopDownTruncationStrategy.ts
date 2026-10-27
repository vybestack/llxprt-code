/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260211-COMPRESSION.P08
 * @plan PLAN-20260211-HIGHDENSITY.P03
 * @plan PLAN-20260211-HIGHDENSITY.P05
 * @requirement REQ-CS-003.1, REQ-CS-003.2, REQ-CS-003.3
 * @requirement REQ-CS-003.4, REQ-CS-003.5
 * @requirement REQ-HD-001.3
 * @pseudocode strategy-interface.md lines 80-84
 *
 * Top-down truncation compression strategy: removes the oldest messages
 * from the conversation history until the estimated token count drops
 * below a target threshold. Never calls the LLM. Returns only the
 * surviving messages (no synthetic summary or acknowledgment).
 */

import type {
  StrategyCompressionResult,
  CompressionStrategy,
  StructuralNoopReason,
  StrategyTrigger,
} from '@vybestack/llxprt-code-core/core/compression/types.js';
import type { CompressionIndexedRows as HistoryIndexedRows } from '@vybestack/llxprt-code-core/services/history/compressionInput.js';
import type { CompressionAttemptContext } from './compressionContextBuilder.js';
import { adjustDiskToolBoundary } from './truncationDiskBoundary.js';
import { compressionTokenSelection } from '@vybestack/llxprt-code-core/services/history/compression-token-selection.js';

export interface DiskTruncationContext
  extends Omit<CompressionAttemptContext, 'history'> {
  readonly history: HistoryIndexedRows;
}

export type DiskTruncationResult =
  | Extract<StrategyCompressionResult, { kind: 'noop' }>
  | {
      readonly kind: 'applied';
      readonly start: number;
      readonly metadata: StrategyCompressionResult['metadata'];
    };

export class TopDownTruncationStrategy implements CompressionStrategy {
  readonly name = 'top-down-truncation' as const;
  readonly requiresLLM = false;
  /** @plan PLAN-20260211-HIGHDENSITY.P03 @requirement REQ-HD-001.3 */
  readonly trigger: StrategyTrigger = {
    mode: 'threshold',
    defaultThreshold: 0.85,
  };

  async compressDisk(
    context: DiskTruncationContext,
  ): Promise<DiskTruncationResult> {
    const { history, currentTokenCount, targetTokenCount } = context;
    if (history.length === 0) return this.structuralNoop(0, 'empty-history');
    const target =
      targetTokenCount ??
      context.runtimeContext.ephemerals.compressionThreshold() *
        context.runtimeContext.ephemerals.contextLimit() *
        0.6;
    if (currentTokenCount <= target)
      return this.structuralNoop(history.length, 'already-under-target');
    const minKeep = Math.min(2, history.length);
    let tokens = await context.estimateTokens(history);
    let start = 0;
    // HistoryService estimates a sum of per-row costs, independent of membership.
    while (start < history.length - minKeep) {
      tokens -= await context.estimateTokens(
        compressionTokenSelection(history, start, start + 1),
      );
      start++;
      if (targetTokenCount !== undefined ? tokens <= target : tokens < target)
        break;
    }
    start = Math.min(
      await adjustDiskToolBoundary(history, start),
      history.length - minKeep,
    );
    return {
      kind: 'applied',
      start,
      metadata: {
        originalMessageCount: history.length,
        compressedMessageCount: history.length - start,
        strategyUsed: this.name,
        llmCallMade: false,
      },
    };
  }

  private structuralNoop(
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
}
