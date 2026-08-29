/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Reasoning-aware effective token accounting, extracted from
 * CompressionHandler. Thinking blocks that will be stripped before the request
 * reaches the provider must not count against the context budget.
 *
 * @plan PLAN-20251202-THINKING.P15
 * @requirement REQ-THINK-005.1, REQ-THINK-005.2
 */

import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { AgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import {
  extractThinkingBlocks,
  estimateThinkingTokens,
} from './reasoningUtils.js';

/**
 * Calculate the effective token count for the committed history, discounting
 * thinking blocks that the active reasoning settings will strip before the
 * request is sent.
 */
export function computeEffectiveTokenCount(
  historyService: HistoryService,
  runtimeContext: AgentRuntimeContext,
): number {
  const includeInContext =
    runtimeContext.ephemerals.reasoning.includeInContext();
  const stripPolicy = runtimeContext.ephemerals.reasoning.stripFromContext();

  // If reasoning IS included in context, all tokens count.
  if (includeInContext) {
    return historyService.getTotalTokens();
  }

  const allContents = historyService.getCurated();
  const rawTokens = historyService.getTotalTokens();

  let thinkingTokensToStrip = 0;

  if (stripPolicy === 'allButLast') {
    let lastIndexWithThinking = -1;
    for (let i = allContents.length - 1; i >= 0; i--) {
      if (extractThinkingBlocks(allContents[i]).length > 0) {
        lastIndexWithThinking = i;
        break;
      }
    }

    for (let i = 0; i < allContents.length; i++) {
      if (i !== lastIndexWithThinking) {
        thinkingTokensToStrip += estimateThinkingTokens(
          extractThinkingBlocks(allContents[i]),
        );
      }
    }
  } else {
    // stripPolicy === 'all' explicitly strips all thinking; stripPolicy ===
    // 'none' also removes all thinking from the effective count when
    // includeInContext=false.
    for (const content of allContents) {
      thinkingTokensToStrip += estimateThinkingTokens(
        extractThinkingBlocks(content),
      );
    }
  }

  return Math.max(0, rawTokens - thinkingTokensToStrip);
}
