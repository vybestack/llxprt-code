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

import type { IContent } from '../../services/history/IContent.js';
import type {
  CompressionContext,
  CompressionResult,
  CompressionStrategy,
  StrategyTrigger,
} from './types.js';
import { adjustForToolCallBoundary } from './utils.js';

export class TopDownTruncationStrategy implements CompressionStrategy {
  readonly name = 'top-down-truncation' as const;
  readonly requiresLLM = false;
  /** @plan PLAN-20260211-HIGHDENSITY.P03 @requirement REQ-HD-001.3 */
  readonly trigger: StrategyTrigger = {
    mode: 'threshold',
    defaultThreshold: 0.85,
  };

  async compress(context: CompressionContext): Promise<CompressionResult> {
    const { history, runtimeContext, estimateTokens, currentTokenCount } =
      context;
    const originalCount = history.length;

    if (originalCount === 0) {
      return {
        newHistory: [],
        metadata: {
          originalMessageCount: 0,
          compressedMessageCount: 0,
          strategyUsed: 'top-down-truncation',
          llmCallMade: false,
        },
      };
    }

    const compressionThreshold =
      runtimeContext.ephemerals.compressionThreshold();
    const contextLimit = runtimeContext.ephemerals.contextLimit();
    const target = compressionThreshold * contextLimit * 0.6;

    if (currentTokenCount <= target) {
      return {
        newHistory: [...history],
        metadata: {
          originalMessageCount: originalCount,
          compressedMessageCount: originalCount,
          strategyUsed: 'top-down-truncation',
          llmCallMade: false,
        },
      };
    }

    const minKeep = Math.min(2, originalCount);

    // Remove messages from start (oldest first) until under target
    let removeCount = 0;
    for (let i = 1; i <= originalCount - minKeep; i++) {
      const remaining = history.slice(i);
      const tokens = await estimateTokens(remaining);
      if (tokens < target) {
        removeCount = i;
        break;
      }
      removeCount = i;
    }

    // Ensure we keep at least minKeep messages
    removeCount = Math.min(removeCount, originalCount - minKeep);

    // Adjust boundary to avoid orphaning tool call/response pairs
    const mutableHistory = [...history] as IContent[];
    const adjustedIndex = adjustForToolCallBoundary(
      mutableHistory,
      removeCount,
    );

    // Clamp: never remove more than originalCount - minKeep
    const finalRemoveCount = Math.min(adjustedIndex, originalCount - minKeep);

    const newHistory = mutableHistory.slice(finalRemoveCount);

    return {
      newHistory,
      metadata: {
        originalMessageCount: originalCount,
        compressedMessageCount: newHistory.length,
        strategyUsed: 'top-down-truncation',
        llmCallMade: false,
      },
    };
  }
}
