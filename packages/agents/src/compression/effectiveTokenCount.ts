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

import {
  extractThinkingBlocks,
  estimateThinkingTokens,
} from './reasoningUtils.js';

/**
 * Calculate the effective token count for the committed history, discounting
 * thinking blocks that the active reasoning settings will strip before the
 * request is sent.
 */
/**
 * The reasoning settings that decide whether thinking blocks reach the
 * provider, and therefore whether their tokens count against the budget.
 */
export interface ReasoningHistoryPolicy {
  includeInContext(): boolean;
  stripFromContext(): 'all' | 'allButLast' | 'none';
}

export async function computeEffectiveTokenCount(
  historyService: HistoryService,
  policy: ReasoningHistoryPolicy,
): Promise<number> {
  const includeInContext = policy.includeInContext();
  const stripPolicy = policy.stripFromContext();

  // If reasoning IS included in context, all tokens count.
  if (includeInContext) {
    return historyService.getTotalTokens();
  }

  const rawTokens = historyService.getTotalTokens();
  let thinkingTokens = 0;
  let lastThinkingTokens = 0;
  for await (const content of historyService.streamCuratedHistory()) {
    const blocks = extractThinkingBlocks(content);
    const tokens = estimateThinkingTokens(blocks);
    thinkingTokens += tokens;
    if (blocks.length > 0) lastThinkingTokens = tokens;
  }
  const thinkingTokensToStrip =
    stripPolicy === 'allButLast'
      ? thinkingTokens - lastThinkingTokens
      : thinkingTokens;
  return Math.max(0, rawTokens - thinkingTokensToStrip);
}
