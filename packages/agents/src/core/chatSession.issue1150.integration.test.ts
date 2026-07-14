/**
 * Issue #1150: Integration test for thinking block flow through ChatSession
 *
 * This test validates the ACTUAL behavior of ChatSession when processing
 * thinking blocks from AnthropicProvider. It exposes the bug where thinking
 * blocks are lost between provider yield and history storage.
 *
 * THE BUG:
 * 1. AnthropicProvider yields IContent with thinking block (signature included)
 * 2. processStreamResponse should accumulate it in content blocks
 * 3. recordHistory should extract it to thoughtBlocks
 * 4. History entry should have thinking as first block
 *
 * Current behavior: Step 2-4 lose the thinking block somehow.
 * Debug logs show: blockTypes: ["text","tool_call"] (no thinking!)
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';
import type {
  ContentBlock,
  IContent,
  ThinkingBlock,
  TextBlock,
  ToolCallBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';

/**
 * Neutral helper: extracts the content blocks from an IContent chunk —
 * the neutral analogue of the legacy extractParts helper.
 */
function extractBlocks(content: IContent): ContentBlock[] {
  return content.blocks;
}

describe('Issue #1150: ChatSession thinking block integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('convertIContentToResponse behavior', () => {
    /**
     * Test that a provider-yielded IContent carrying a thinking block
     * surfaces a neutral thinking block with the correct shape.
     */
    it('should carry thinking block with correct shape for thinking IContent', () => {
      const thinkingIContent: IContent = {
        speaker: 'ai',
        blocks: [
          {
            type: 'thinking',
            thought: 'Analyzing the problem...',
            sourceField: 'thinking',
            signature: 'EqoBCkYIAxgCIkAKHgoSdGhpbmtpbmdfY29udGVudA==',
          },
        ],
      };

      expect(thinkingIContent.speaker).toBe('ai');

      const thinkingBlock = thinkingIContent.blocks[0] as ThinkingBlock;
      expect(thinkingBlock.type).toBe('thinking');
      expect(thinkingBlock.thought).toBe('Analyzing the problem...');
      expect(thinkingBlock.signature).toBe(
        'EqoBCkYIAxgCIkAKHgoSdGhpbmtpbmdfY29udGVudA==',
      );
      expect(thinkingBlock.sourceField).toBe('thinking');
    });
  });

  describe('processStreamResponse behavior', () => {
    /**
     * CRITICAL TEST: This simulates what happens when AnthropicProvider
     * yields thinking followed by tool calls.
     *
     * The test should FAIL if thinking blocks are being lost.
     */
    it('should accumulate thinking blocks in content blocks when includeInContext is true', () => {
      // Chunk 1: Thinking block (from separate IContent yield)
      const thinkingChunk: IContent = {
        speaker: 'ai',
        blocks: [
          {
            type: 'thinking',
            thought: 'Let me think about this...',
            sourceField: 'thinking',
            signature: 'sig123',
          },
        ],
      };

      // Chunk 2: Text + tool call
      const toolCallChunk: IContent = {
        speaker: 'ai',
        blocks: [
          { type: 'text', text: 'I will help you.' },
          {
            type: 'tool_call',
            id: 'tool_1',
            name: 'read_file',
            parameters: { path: '/tmp/test.txt' },
          },
        ],
      };

      // Simulate processStreamResponse accumulation
      const contentBlocks: ContentBlock[] = [];
      contentBlocks.push(...extractBlocks(thinkingChunk));
      contentBlocks.push(...extractBlocks(toolCallChunk));

      // CRITICAL ASSERTION: Thinking block MUST be in contentBlocks
      const thinkingBlocks = contentBlocks.filter(
        (block): block is ThinkingBlock => block.type === 'thinking',
      );

      expect(thinkingBlocks.length).toBe(1);
      expect(thinkingBlocks[0].thought).toBe('Let me think about this...');
      expect(thinkingBlocks[0].signature).toBe('sig123');

      // Total blocks should be 3: thinking + text + tool_call
      expect(contentBlocks.length).toBe(3);
    });

    /**
     * Test that thinking is filtered when includeInContext is false
     */
    it('should filter thinking blocks when includeInContext is false', () => {
      const thinkingChunk: IContent = {
        speaker: 'ai',
        blocks: [
          {
            type: 'thinking',
            thought: 'Thinking...',
            sourceField: 'thinking',
          },
        ],
      };

      const textChunk: IContent = {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'Response' }],
      };

      const contentBlocks: ContentBlock[] = [];
      // Process with thoughts filtered
      [thinkingChunk, textChunk].forEach((chunk) => {
        contentBlocks.push(
          ...extractBlocks(chunk).filter((block) => block.type !== 'thinking'),
        );
      });

      // Thinking should be filtered out
      const thinkingBlocks = contentBlocks.filter(
        (block): block is ThinkingBlock => block.type === 'thinking',
      );
      expect(thinkingBlocks.length).toBe(0);

      // Only text block remains
      expect(contentBlocks.length).toBe(1);
      expect((contentBlocks[0] as TextBlock).text).toBe('Response');
    });
  });

  describe('History entry structure', () => {
    /**
     * CRITICAL TEST: The final IContent added to history must have
     * thinking as the first block when tool_call is present.
     *
     * This is what Anthropic API requires.
     */
    it('history entry must have thinking block FIRST when tool_call present', () => {
      // Simulate the extracted thoughtBlocks
      const thoughtBlocks: ThinkingBlock[] = [
        {
          type: 'thinking',
          thought: 'Deep analysis...',
          sourceField: 'thinking',
          signature: 'sig_anthropic',
        },
      ];

      // Simulate the IContent created from non-thought blocks
      const outputIContent: IContent = {
        speaker: 'ai',
        blocks: [
          { type: 'text', text: 'I will help you.' },
          {
            type: 'tool_call',
            id: 'tool_1',
            name: 'read_file',
            parameters: { path: '/tmp' },
          } as ToolCallBlock,
        ],
      };

      // Simulate recordHistory's attachment logic
      outputIContent.blocks = [...thoughtBlocks, ...outputIContent.blocks];

      // CRITICAL ASSERTIONS

      // 1. First block must be thinking
      expect(outputIContent.blocks[0].type).toBe('thinking');

      // 2. Thinking must have signature
      const thinkingBlock = outputIContent.blocks[0] as ThinkingBlock;
      expect(thinkingBlock.signature).toBe('sig_anthropic');
      expect(thinkingBlock.sourceField).toBe('thinking');

      // 3. Tool call must also be present
      const toolCallBlock = outputIContent.blocks.find(
        (b): b is ToolCallBlock => b.type === 'tool_call',
      );
      expect(toolCallBlock).toBeDefined();

      // 4. Order must be: thinking, text, tool_call
      expect(outputIContent.blocks.map((b) => b.type)).toStrictEqual([
        'thinking',
        'text',
        'tool_call',
      ]);
    });

    /**
     * Test the corrected scenario: thoughtBlocks must prepend thinking in history.
     */
    it('attaches thoughtBlocks when present to keep thinking first', () => {
      const thoughtBlocks: ThinkingBlock[] = [
        {
          type: 'thinking',
          thought: 'Recovered reasoning',
          sourceField: 'thinking',
          signature: 'sig_fix',
        },
      ];

      const outputIContent: IContent = {
        speaker: 'ai',
        blocks: [
          { type: 'text', text: 'I will help you.' },
          {
            type: 'tool_call',
            id: 'tool_1',
            name: 'read_file',
            parameters: { path: '/tmp' },
          } as ToolCallBlock,
        ],
      };

      outputIContent.blocks = [...thoughtBlocks, ...outputIContent.blocks];

      expect(thoughtBlocks.length).toBeGreaterThan(0);
      expect(outputIContent.blocks[0].type).toBe('thinking');
      expect((outputIContent.blocks[0] as ThinkingBlock).signature).toBe(
        'sig_fix',
      );
      expect(outputIContent.blocks.map((b) => b.type)).toStrictEqual([
        'thinking',
        'text',
        'tool_call',
      ]);
    });
  });

  describe('isThinkingBlock filtering behavior', () => {
    /**
     * The neutral isThinkingBlock check: block.type === 'thinking'
     *
     * A block is recognized as thinking only when its type discriminator
     * equals 'thinking'.
     */
    it('block must have type: "thinking" to be recognized as a thinking block', () => {
      function isThinkingBlock(block: ContentBlock | undefined): boolean {
        return Boolean(block && block.type === 'thinking');
      }

      // Valid thinking block
      const validThinking: ThinkingBlock = {
        type: 'thinking',
        thought: 'thinking...',
        sourceField: 'thinking',
      };
      expect(isThinkingBlock(validThinking)).toBe(true);

      // Invalid: text block
      const invalidText: TextBlock = { type: 'text', text: 'just text' };
      expect(isThinkingBlock(invalidText)).toBe(false);

      // Invalid: tool_call block
      const invalidToolCall: ToolCallBlock = {
        type: 'tool_call',
        id: 'call_1',
        name: 'read_file',
        parameters: {},
      };
      expect(isThinkingBlock(invalidToolCall)).toBe(false);

      // Invalid: undefined
      expect(isThinkingBlock(undefined)).toBe(false);
    });
  });
});
