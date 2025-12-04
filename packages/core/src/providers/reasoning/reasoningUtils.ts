/**
 * Utility functions for handling reasoning/thinking content across providers.
 *
 * @plan PLAN-20251202-THINKING.P06
 * @requirement REQ-THINK-002
 */

import type {
  IContent,
  ThinkingBlock,
} from '../../services/history/IContent.js';

/** Policy for stripping thinking blocks from context */
export type StripPolicy = 'all' | 'allButLast' | 'none';

/**
 * Extract all ThinkingBlock instances from an IContent.
 *
 * @plan PLAN-20251202-THINKING.P08
 * @requirement REQ-THINK-002.1
 */
export function extractThinkingBlocks(content: IContent): ThinkingBlock[] {
  const result: ThinkingBlock[] = [];
  for (const block of content.blocks) {
    if (block.type === 'thinking') {
      result.push(block as ThinkingBlock);
    }
  }
  return result;
}

/**
 * Filter thinking blocks from contents based on strip policy.
 *
 * @plan PLAN-20251202-THINKING.P08
 * @requirement REQ-THINK-002.2
 */
export function filterThinkingForContext(
  contents: IContent[],
  policy: StripPolicy,
): IContent[] {
  if (policy === 'none') {
    return contents;
  }

  if (policy === 'all') {
    return contents.map(removeThinkingFromContent);
  }

  // policy === 'allButLast'
  // Find the last content that has thinking blocks
  let lastWithThinkingIndex = -1;
  for (let i = contents.length - 1; i >= 0; i--) {
    if (contents[i].blocks.some((b) => b.type === 'thinking')) {
      lastWithThinkingIndex = i;
      break;
    }
  }

  if (lastWithThinkingIndex === -1) {
    // No content has thinking blocks
    return contents;
  }

  return contents.map((content, index) => {
    if (index === lastWithThinkingIndex) {
      return content; // Keep thinking in the last one
    }
    return removeThinkingFromContent(content);
  });
}

/**
 * Convert ThinkingBlocks to a single reasoning_content string.
 *
 * @plan PLAN-20251202-THINKING.P08
 * @requirement REQ-THINK-002.3
 */
export function thinkingToReasoningField(
  blocks: ThinkingBlock[],
): string | undefined {
  if (blocks.length === 0) {
    return undefined;
  }
  return blocks.map((b) => b.thought).join('\n');
}

/**
 * Estimate token count for thinking blocks.
 *
 * @plan PLAN-20251202-THINKING.P08
 * @requirement REQ-THINK-002.4
 */
export function estimateThinkingTokens(blocks: ThinkingBlock[]): number {
  let total = 0;
  for (const block of blocks) {
    // Simple estimation: ~4 characters per token
    total += Math.ceil(block.thought.length / 4);
  }
  return total;
}

/**
 * Helper: Remove thinking blocks from a single IContent.
 *
 * @plan PLAN-20251202-THINKING.P08
 */
export function removeThinkingFromContent(content: IContent): IContent {
  return {
    ...content,
    blocks: content.blocks.filter((block) => block.type !== 'thinking'),
  };
}
