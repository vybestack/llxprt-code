/**
 * TDD tests for reasoning utility functions.
 * These tests are written first and should fail until implementation in P08.
 *
 * @plan PLAN-20251202-THINKING.P07
 * @requirement REQ-THINK-002.1, REQ-THINK-002.2, REQ-THINK-002.3, REQ-THINK-002.4
 */

import { describe, it, expect } from 'vitest';
import type {
  IContent,
  ThinkingBlock,
  TextBlock,
  ContentBlock,
} from '../../services/history/IContent.js';
import {
  extractThinkingBlocks,
  filterThinkingForContext,
  thinkingToReasoningField,
  estimateThinkingTokens,
  removeThinkingFromContent,
} from './reasoningUtils.js';

// Test Fixtures
function createThinkingBlock(
  thought: string,
  sourceField?: 'reasoning_content' | 'thinking' | 'thought',
): ThinkingBlock {
  return {
    type: 'thinking',
    thought,
    sourceField,
  };
}

function createTextBlock(text: string): TextBlock {
  return {
    type: 'text',
    text,
  };
}

function createAiContent(blocks: ContentBlock[]): IContent {
  return {
    speaker: 'ai',
    blocks,
  };
}

describe('extractThinkingBlocks', () => {
  /**
   * @plan PLAN-20251202-THINKING.P07
   * @requirement REQ-THINK-002.1
   */
  it('should extract thinking blocks from mixed content', () => {
    const content = createAiContent([
      createTextBlock('Hello'),
      createThinkingBlock('First thought'),
      createTextBlock('World'),
      createThinkingBlock('Second thought', 'reasoning_content'),
    ]);

    const result = extractThinkingBlocks(content);

    expect(result).toHaveLength(2);
    expect(result[0].thought).toBe('First thought');
    expect(result[1].thought).toBe('Second thought');
    expect(result[1].sourceField).toBe('reasoning_content');
  });

  /**
   * @plan PLAN-20251202-THINKING.P07
   * @requirement REQ-THINK-002.1
   */
  it('should return empty array when no thinking blocks present', () => {
    const content = createAiContent([
      createTextBlock('Hello'),
      createTextBlock('World'),
    ]);

    const result = extractThinkingBlocks(content);

    expect(result).toEqual([]);
  });

  /**
   * @plan PLAN-20251202-THINKING.P07
   * @requirement REQ-THINK-002.1
   */
  it('should preserve sourceField from thinking blocks', () => {
    const content = createAiContent([
      createThinkingBlock('Thought 1', 'thinking'),
      createThinkingBlock('Thought 2', 'reasoning_content'),
      createThinkingBlock('Thought 3', 'thought'),
    ]);

    const result = extractThinkingBlocks(content);

    expect(result[0].sourceField).toBe('thinking');
    expect(result[1].sourceField).toBe('reasoning_content');
    expect(result[2].sourceField).toBe('thought');
  });

  /**
   * @plan PLAN-20251202-THINKING.P07
   * @requirement REQ-THINK-002.1
   */
  it('should handle content with only thinking blocks', () => {
    const content = createAiContent([createThinkingBlock('Only thought')]);

    const result = extractThinkingBlocks(content);

    expect(result).toHaveLength(1);
    expect(result[0].thought).toBe('Only thought');
  });
});

describe('filterThinkingForContext', () => {
  /**
   * @plan PLAN-20251202-THINKING.P07
   * @requirement REQ-THINK-002.2
   */
  it('should keep all content when policy is "none"', () => {
    const contents: IContent[] = [
      createAiContent([createThinkingBlock('Think'), createTextBlock('Text')]),
      createAiContent([createTextBlock('More text')]),
    ];

    const result = filterThinkingForContext(contents, 'none');

    expect(result).toHaveLength(2);
    expect(result[0].blocks).toHaveLength(2);
    expect(result[1].blocks).toHaveLength(1);
  });

  /**
   * @plan PLAN-20251202-THINKING.P07
   * @requirement REQ-THINK-002.2
   */
  it('should strip all thinking blocks when policy is "all"', () => {
    const contents: IContent[] = [
      createAiContent([
        createThinkingBlock('Think 1'),
        createTextBlock('Text 1'),
      ]),
      createAiContent([
        createThinkingBlock('Think 2'),
        createTextBlock('Text 2'),
      ]),
    ];

    const result = filterThinkingForContext(contents, 'all');

    expect(result).toHaveLength(2);
    result.forEach((content) => {
      content.blocks.forEach((block) => {
        expect(block.type).not.toBe('thinking');
      });
    });
  });

  /**
   * @plan PLAN-20251202-THINKING.P07
   * @requirement REQ-THINK-002.2
   */
  it('should strip all but last thinking when policy is "allButLast"', () => {
    const contents: IContent[] = [
      createAiContent([
        createThinkingBlock('Think 1'),
        createTextBlock('Text 1'),
      ]),
      createAiContent([
        createThinkingBlock('Think 2'),
        createTextBlock('Text 2'),
      ]),
      createAiContent([
        createThinkingBlock('Think 3'),
        createTextBlock('Text 3'),
      ]),
    ];

    const result = filterThinkingForContext(contents, 'allButLast');

    expect(result).toHaveLength(3);

    // First two should have no thinking
    expect(result[0].blocks.every((b) => b.type !== 'thinking')).toBe(true);
    expect(result[1].blocks.every((b) => b.type !== 'thinking')).toBe(true);

    // Last should still have thinking
    const hasThinking = result[2].blocks.some((b) => b.type === 'thinking');
    expect(hasThinking).toBe(true);
  });

  /**
   * @plan PLAN-20251202-THINKING.P07
   * @requirement REQ-THINK-002.2
   */
  it('should handle empty contents array', () => {
    const result = filterThinkingForContext([], 'all');
    expect(result).toEqual([]);
  });

  /**
   * @plan PLAN-20251202-THINKING.P07
   * @requirement REQ-THINK-002.2
   */
  it('should handle single content with allButLast policy', () => {
    const contents: IContent[] = [
      createAiContent([
        createThinkingBlock('Only think'),
        createTextBlock('Text'),
      ]),
    ];

    const result = filterThinkingForContext(contents, 'allButLast');

    expect(result).toHaveLength(1);
    const hasThinking = result[0].blocks.some((b) => b.type === 'thinking');
    expect(hasThinking).toBe(true);
  });

  /**
   * @plan PLAN-20251202-THINKING.P07
   * @requirement REQ-THINK-002.2
   */
  it('should not mutate original content array', () => {
    const contents: IContent[] = [
      createAiContent([createThinkingBlock('Think'), createTextBlock('Text')]),
    ];
    const originalBlockCount = contents[0].blocks.length;

    filterThinkingForContext(contents, 'all');

    expect(contents[0].blocks).toHaveLength(originalBlockCount);
  });
});

describe('thinkingToReasoningField', () => {
  /**
   * @plan PLAN-20251202-THINKING.P07
   * @requirement REQ-THINK-002.3
   */
  it('should return undefined for empty blocks array', () => {
    const result = thinkingToReasoningField([]);
    expect(result).toBeUndefined();
  });

  /**
   * @plan PLAN-20251202-THINKING.P07
   * @requirement REQ-THINK-002.3
   */
  it('should convert single thinking block to string', () => {
    const blocks = [createThinkingBlock('Single thought')];

    const result = thinkingToReasoningField(blocks);

    expect(result).toBe('Single thought');
  });

  /**
   * @plan PLAN-20251202-THINKING.P07
   * @requirement REQ-THINK-002.3
   */
  it('should concatenate multiple thinking blocks with newlines', () => {
    const blocks = [
      createThinkingBlock('First thought'),
      createThinkingBlock('Second thought'),
      createThinkingBlock('Third thought'),
    ];

    const result = thinkingToReasoningField(blocks);

    expect(result).toBe('First thought\nSecond thought\nThird thought');
  });

  /**
   * @plan PLAN-20251202-THINKING.P07
   * @requirement REQ-THINK-002.3
   */
  it('should handle blocks with empty thoughts', () => {
    const blocks = [
      createThinkingBlock(''),
      createThinkingBlock('Valid thought'),
      createThinkingBlock(''),
    ];

    const result = thinkingToReasoningField(blocks);

    expect(result).toBe('\nValid thought\n');
  });

  /**
   * @plan PLAN-20251202-THINKING.P07
   * @requirement REQ-THINK-002.3
   */
  it('should preserve multiline thoughts', () => {
    const blocks = [
      createThinkingBlock('Line 1\nLine 2'),
      createThinkingBlock('Line 3'),
    ];

    const result = thinkingToReasoningField(blocks);

    expect(result).toBe('Line 1\nLine 2\nLine 3');
  });
});

describe('estimateThinkingTokens', () => {
  /**
   * @plan PLAN-20251202-THINKING.P07
   * @requirement REQ-THINK-002.4
   */
  it('should return 0 for empty blocks array', () => {
    const result = estimateThinkingTokens([]);
    expect(result).toBe(0);
  });

  /**
   * @plan PLAN-20251202-THINKING.P07
   * @requirement REQ-THINK-002.4
   */
  it('should estimate tokens proportional to content length', () => {
    const shortBlock = createThinkingBlock('Short');
    const longBlock = createThinkingBlock(
      'This is a much longer thinking block with many more words',
    );

    const shortTokens = estimateThinkingTokens([shortBlock]);
    const longTokens = estimateThinkingTokens([longBlock]);

    expect(longTokens).toBeGreaterThan(shortTokens);
  });

  /**
   * @plan PLAN-20251202-THINKING.P07
   * @requirement REQ-THINK-002.4
   */
  it('should sum tokens across multiple blocks', () => {
    const block1 = createThinkingBlock('First thought');
    const block2 = createThinkingBlock('Second thought');

    const token1 = estimateThinkingTokens([block1]);
    const token2 = estimateThinkingTokens([block2]);
    const totalTokens = estimateThinkingTokens([block1, block2]);

    expect(totalTokens).toBe(token1 + token2);
  });

  /**
   * @plan PLAN-20251202-THINKING.P07
   * @requirement REQ-THINK-002.4
   */
  it('should use reasonable approximation (roughly 4 chars per token)', () => {
    // Assuming ~4 characters per token as a rough estimate
    const thought = 'a'.repeat(400); // 400 characters
    const block = createThinkingBlock(thought);

    const tokens = estimateThinkingTokens([block]);

    // Should be around 100 tokens (400/4), allowing for some variance
    expect(tokens).toBeGreaterThan(50);
    expect(tokens).toBeLessThan(200);
  });

  /**
   * @plan PLAN-20251202-THINKING.P07
   * @requirement REQ-THINK-002.4
   */
  it('should handle blocks with whitespace', () => {
    const block = createThinkingBlock('   spaces   ');

    const tokens = estimateThinkingTokens([block]);

    expect(tokens).toBeGreaterThan(0);
  });
});

describe('removeThinkingFromContent', () => {
  /**
   * @plan PLAN-20251202-THINKING.P07
   * @requirement REQ-THINK-002.5
   */
  it('should remove thinking blocks from content', () => {
    const content = createAiContent([
      createThinkingBlock('Think'),
      createTextBlock('Text'),
      createThinkingBlock('More think'),
    ]);

    const result = removeThinkingFromContent(content);

    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0].type).toBe('text');
    expect((result.blocks[0] as TextBlock).text).toBe('Text');
  });

  /**
   * @plan PLAN-20251202-THINKING.P07
   * @requirement REQ-THINK-002.5
   */
  it('should preserve non-thinking blocks', () => {
    const content = createAiContent([
      createTextBlock('Text 1'),
      createThinkingBlock('Think'),
      createTextBlock('Text 2'),
    ]);

    const result = removeThinkingFromContent(content);

    expect(result.blocks).toHaveLength(2);
    expect((result.blocks[0] as TextBlock).text).toBe('Text 1');
    expect((result.blocks[1] as TextBlock).text).toBe('Text 2');
  });

  /**
   * @plan PLAN-20251202-THINKING.P07
   * @requirement REQ-THINK-002.5
   */
  it('should return content unchanged if no thinking blocks', () => {
    const content = createAiContent([
      createTextBlock('Text 1'),
      createTextBlock('Text 2'),
    ]);

    const result = removeThinkingFromContent(content);

    expect(result.blocks).toHaveLength(2);
    expect(result.blocks).toEqual(content.blocks);
  });

  /**
   * @plan PLAN-20251202-THINKING.P07
   * @requirement REQ-THINK-002.5
   */
  it('should not mutate original content', () => {
    const content = createAiContent([
      createThinkingBlock('Think'),
      createTextBlock('Text'),
    ]);
    const originalBlockCount = content.blocks.length;

    removeThinkingFromContent(content);

    expect(content.blocks).toHaveLength(originalBlockCount);
  });

  /**
   * @plan PLAN-20251202-THINKING.P07
   * @requirement REQ-THINK-002.5
   */
  it('should preserve content metadata', () => {
    const content: IContent = {
      speaker: 'ai',
      blocks: [createThinkingBlock('Think'), createTextBlock('Text')],
      metadata: {
        model: 'test-model',
        timestamp: 12345,
      },
    };

    const result = removeThinkingFromContent(content);

    expect(result.metadata).toEqual(content.metadata);
    expect(result.speaker).toBe(content.speaker);
  });

  /**
   * @plan PLAN-20251202-THINKING.P07
   * @requirement REQ-THINK-002.5
   */
  it('should handle content with only thinking blocks', () => {
    const content = createAiContent([
      createThinkingBlock('Think 1'),
      createThinkingBlock('Think 2'),
    ]);

    const result = removeThinkingFromContent(content);

    expect(result.blocks).toHaveLength(0);
  });
});
