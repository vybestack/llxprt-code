/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Core-owned reasoning helpers used by compression.
 *
 * Provider-specific reasoning parsing remains in the providers package. Core
 * keeps only generic thinking-block accounting helpers needed by compression.
 *
 * @plan:PLAN-20260603-ISSUE1584.P11
 * @requirement:REQ-DEP-001
 * @requirement:REQ-SHIM-001
 */

import type {
  IContent,
  ThinkingBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';

export function extractThinkingBlocks(content: IContent): ThinkingBlock[] {
  const result: ThinkingBlock[] = [];
  for (const block of content.blocks) {
    if (block.type === 'thinking') {
      result.push(block);
    }
  }
  return result;
}

export function estimateThinkingTokens(blocks: ThinkingBlock[]): number {
  let total = 0;
  for (const block of blocks) {
    total += Math.ceil(block.thought.length / 4);
  }
  return total;
}
