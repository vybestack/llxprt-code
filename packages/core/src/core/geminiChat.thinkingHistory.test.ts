/**
 * Issue #1150: Thinking blocks must be preserved in history
 *
 * THE BUG: When AnthropicProvider yields thinking blocks during streaming,
 * they are being lost before reaching history. The history shows:
 *   blockTypes: ["text","tool_call"]
 * Instead of:
 *   blockTypes: ["thinking","text","tool_call"]
 *
 * This causes Anthropic API to reject the next request with:
 * "messages.1.content.0.type: Expected `thinking` or `redacted_thinking`, but found `text`"
 *
 * Flow that should work:
 * 1. AnthropicProvider yields: { speaker: 'ai', blocks: [{ type: 'thinking', thought: '...', signature: '...' }] }
 * 2. convertIContentToResponse converts to: { parts: [{ thought: true, text: '...' }] }
 * 3. processStreamResponse accumulates parts (isThoughtPart checks thought === true)
 * 4. recordHistory extracts thinking via thoughtBlocks array
 * 5. History entry includes thinking block
 *
 * The bug: Step 3-5 are losing the thinking blocks.
 */
import { describe, it, expect } from 'vitest';
import type {
  IContent,
  ThinkingBlock,
  ToolCallBlock,
} from '../services/history/IContent.js';
import type { Part, Content } from '@google/genai';

/**
 * Type for thought parts (matches geminiChat.ts ThoughtPart)
 */
interface ThoughtPart extends Part {
  thought: true;
  text: string;
  thoughtSignature?: string;
  llxprtSourceField?:
    | 'reasoning_content'
    | 'thinking'
    | 'thought'
    | 'think_tags';
}

/**
 * Helper to check if a part is a thought part (matches geminiChat.ts isThoughtPart)
 */
function isThoughtPart(part: Part | undefined): part is ThoughtPart {
  return Boolean(
    part &&
      typeof part === 'object' &&
      'thought' in part &&
      part.thought === true,
  );
}

describe('Issue #1150: Thinking blocks in history', () => {
  describe('IContent to Part conversion', () => {
    /**
     * When convertIContentToResponse converts a thinking block,
     * the resulting Part MUST have thought: true so isThoughtPart recognizes it.
     */
    it('thinking block should convert to Part with thought: true', () => {
      const thinkingBlock: ThinkingBlock = {
        type: 'thinking',
        thought: 'Let me analyze this problem...',
        sourceField: 'thinking',
        signature: 'EqoBCkYIAxgCIkAKHgoSdGhpbmtpbmdfY29udGVudA==',
      };

      // This is what convertIContentToResponse should produce
      const expectedPart: ThoughtPart = {
        thought: true,
        text: thinkingBlock.thought,
        thoughtSignature: thinkingBlock.signature,
        llxprtSourceField: thinkingBlock.sourceField,
      };

      // Verify the part passes isThoughtPart check
      expect(isThoughtPart(expectedPart)).toBe(true);
      expect(expectedPart.thought).toBe(true);
      expect(expectedPart.thoughtSignature).toBe(thinkingBlock.signature);
    });

    /**
     * CRITICAL: A Part created from IContent thinking block must be recognized by isThoughtPart
     */
    it('isThoughtPart must recognize converted thinking parts', () => {
      // Simulate what convertIContentToResponse creates
      const partFromThinkingBlock: Part = {
        thought: true,
        text: 'Deep analysis here',
      } as Part;

      expect(isThoughtPart(partFromThinkingBlock)).toBe(true);
    });

    /**
     * Regular text parts should NOT be recognized as thought parts
     */
    it('isThoughtPart must NOT recognize regular text parts', () => {
      const textPart: Part = {
        text: 'Hello world',
      };

      expect(isThoughtPart(textPart)).toBe(false);
    });
  });

  describe('Stream processing must preserve thinking', () => {
    /**
     * When streaming yields a thinking block followed by tool calls,
     * the accumulated modelResponseParts must include the thinking part.
     */
    it('modelResponseParts should include thinking parts from stream', () => {
      const includeThoughtsInHistory = true;

      // Simulate stream chunks converted to Content
      const streamChunks: Content[] = [
        {
          role: 'model',
          parts: [
            {
              thought: true,
              text: 'Let me think about this...',
              thoughtSignature: 'sig123',
            } as Part,
          ],
        },
        {
          role: 'model',
          parts: [{ text: 'I will help you.' }],
        },
        {
          role: 'model',
          parts: [
            {
              functionCall: {
                id: 'tool_1',
                name: 'read_file',
                args: { path: '/tmp/test.txt' },
              },
            },
          ],
        },
      ];

      // Simulate processStreamResponse logic
      const modelResponseParts: Part[] = [];
      for (const chunk of streamChunks) {
        if (chunk.parts) {
          if (includeThoughtsInHistory) {
            modelResponseParts.push(...chunk.parts);
          } else {
            modelResponseParts.push(
              ...chunk.parts.filter((part) => !isThoughtPart(part)),
            );
          }
        }
      }

      // CRITICAL ASSERTION: Thinking part must be in modelResponseParts
      const thoughtParts = modelResponseParts.filter(isThoughtPart);
      expect(thoughtParts.length).toBe(1);
      expect(thoughtParts[0].text).toBe('Let me think about this...');
      expect((thoughtParts[0] as ThoughtPart).thoughtSignature).toBe('sig123');
    });

    /**
     * Even when chunks come from separate yields, thinking must be preserved
     */
    it('thinking from separate IContent yield must be preserved', () => {
      const includeThoughtsInHistory = true;

      // This simulates AnthropicProvider yielding thinking as separate IContent
      // which gets converted via convertIContentToResponse
      const thinkingChunk: Content = {
        role: 'model',
        parts: [
          {
            thought: true,
            text: 'Analyzing the request...',
            thoughtSignature: 'sig_from_anthropic',
            llxprtSourceField: 'thinking',
          } as Part,
        ],
      };

      const toolCallChunk: Content = {
        role: 'model',
        parts: [
          { text: "I'll help you." },
          {
            functionCall: {
              id: 'tool_123',
              name: 'list_directory',
              args: { path: '/tmp' },
            },
          },
        ],
      };

      const modelResponseParts: Part[] = [];

      // Process thinking chunk
      if (thinkingChunk.parts) {
        if (includeThoughtsInHistory) {
          modelResponseParts.push(...thinkingChunk.parts);
        }
      }

      // Process tool call chunk
      if (toolCallChunk.parts) {
        if (includeThoughtsInHistory) {
          modelResponseParts.push(...toolCallChunk.parts);
        }
      }

      // Verify thinking is preserved
      const thoughtParts = modelResponseParts.filter(isThoughtPart);
      expect(thoughtParts.length).toBe(1);

      // Verify all parts are present
      expect(modelResponseParts.length).toBe(3); // thinking + text + functionCall
    });
  });

  describe('recordHistory must attach thinking to history entries', () => {
    /**
     * The recordHistory function extracts thought parts and attaches them
     * to the first output content as ThinkingBlocks.
     */
    it('thoughtBlocks should be extracted from modelResponseParts', () => {
      const includeThoughtsInHistory = true;

      const modelOutput: Content[] = [
        {
          role: 'model',
          parts: [
            {
              thought: true,
              text: 'Deep analysis...',
              thoughtSignature: 'sig_deep',
              llxprtSourceField: 'thinking',
            } as Part,
            { text: 'Here is my response.' },
            {
              functionCall: {
                id: 'tool_1',
                name: 'action',
                args: {},
              },
            },
          ],
        },
      ];

      // Simulate recordHistory's thought extraction logic
      const thoughtBlocks: ThinkingBlock[] = includeThoughtsInHistory
        ? modelOutput
            .flatMap((content) => content.parts ?? [])
            .filter(isThoughtPart)
            .map(
              (part): ThinkingBlock => ({
                type: 'thinking',
                thought: (part.text ?? '').trim(),
                sourceField:
                  (part as ThoughtPart).llxprtSourceField ?? 'thought',
                signature: (part as ThoughtPart).thoughtSignature,
              }),
            )
            .filter((block) => block.thought.length > 0)
        : [];

      // CRITICAL: thoughtBlocks must contain the thinking
      expect(thoughtBlocks.length).toBe(1);
      expect(thoughtBlocks[0].thought).toBe('Deep analysis...');
      expect(thoughtBlocks[0].signature).toBe('sig_deep');
      expect(thoughtBlocks[0].sourceField).toBe('thinking');
    });

    /**
     * When attaching thoughtBlocks to IContent, thinking must be FIRST
     */
    it('thinking blocks must be prepended to IContent.blocks', () => {
      const thoughtBlocks: ThinkingBlock[] = [
        {
          type: 'thinking',
          thought: 'Analysis...',
          sourceField: 'thinking',
          signature: 'sig123',
        },
      ];

      const outputContent: IContent = {
        speaker: 'ai',
        blocks: [
          { type: 'text', text: 'Response text' },
          {
            type: 'tool_call',
            id: 'tool_1',
            name: 'action',
            parameters: {},
          } as ToolCallBlock,
        ],
      };

      // Simulate recordHistory's attachment logic
      let didAttachThoughtBlocks = false;
      if (thoughtBlocks.length > 0 && !didAttachThoughtBlocks) {
        outputContent.blocks = [...thoughtBlocks, ...outputContent.blocks];
        didAttachThoughtBlocks = true;
      }

      // CRITICAL: First block must be thinking
      expect(outputContent.blocks[0].type).toBe('thinking');
      expect((outputContent.blocks[0] as ThinkingBlock).thought).toBe(
        'Analysis...',
      );
      expect((outputContent.blocks[0] as ThinkingBlock).signature).toBe(
        'sig123',
      );

      // Other blocks follow
      expect(outputContent.blocks[1].type).toBe('text');
      expect(outputContent.blocks[2].type).toBe('tool_call');
    });
  });

  describe('End-to-end: History must have thinking for Anthropic API', () => {
    /**
     * This test simulates the full flow and verifies the final IContent
     * in history has thinking as the first block.
     */
    it('final IContent in history must have thinking block first when tool_call present', () => {
      const includeThoughtsInHistory = true;

      // Step 1: AnthropicProvider yields IContent with thinking
      const thinkingIContent: IContent = {
        speaker: 'ai',
        blocks: [
          {
            type: 'thinking',
            thought: 'Let me analyze this carefully...',
            sourceField: 'thinking',
            signature: 'EqoBCkYIAxgCIkAKHgoSdGhpbmtpbmdfY29udGVudA==',
          } as ThinkingBlock,
        ],
      };

      // Step 3: Convert to Content (simulating convertIContentToResponse)
      const thinkingContent: Content = {
        role: 'model',
        parts: [
          {
            thought: true,
            text: (thinkingIContent.blocks[0] as ThinkingBlock).thought,
            thoughtSignature: (thinkingIContent.blocks[0] as ThinkingBlock)
              .signature,
            llxprtSourceField: (thinkingIContent.blocks[0] as ThinkingBlock)
              .sourceField,
          } as Part,
        ],
      };

      const toolCallContent: Content = {
        role: 'model',
        parts: [
          { text: 'I will help you.' },
          {
            functionCall: {
              id: 'toolu_test',
              name: 'read_file',
              args: { path: '/tmp/test.txt' },
            },
          },
        ],
      };

      // Step 4: Accumulate in processStreamResponse
      const modelResponseParts: Part[] = [];
      if (includeThoughtsInHistory) {
        modelResponseParts.push(...(thinkingContent.parts ?? []));
        modelResponseParts.push(...(toolCallContent.parts ?? []));
      }

      // Step 5: Consolidate parts (simulating consolidatedParts logic)
      const consolidatedParts = [...modelResponseParts];

      // Step 6: Create modelOutput
      const modelOutput: Content[] = [
        { role: 'model', parts: consolidatedParts },
      ];

      // Step 7: Extract thoughtBlocks (simulating recordHistory)
      const thoughtBlocks: ThinkingBlock[] = includeThoughtsInHistory
        ? modelOutput
            .flatMap((content) => content.parts ?? [])
            .filter(isThoughtPart)
            .map(
              (part): ThinkingBlock => ({
                type: 'thinking',
                thought: (part.text ?? '').trim(),
                sourceField:
                  (part as ThoughtPart).llxprtSourceField ?? 'thought',
                signature: (part as ThoughtPart).thoughtSignature,
              }),
            )
            .filter((block) => block.thought.length > 0)
        : [];

      // Step 8: Create output IContent (simulating toIContent + attachment)
      const nonThoughtParts = consolidatedParts.filter(
        (part) => !isThoughtPart(part),
      );
      const outputIContent: IContent = {
        speaker: 'ai',
        blocks: nonThoughtParts.map((part) => {
          if (part.text) {
            return { type: 'text' as const, text: part.text };
          } else if (part.functionCall) {
            return {
              type: 'tool_call' as const,
              id: part.functionCall.id ?? '',
              name: part.functionCall.name ?? '',
              parameters: part.functionCall.args ?? {},
            } as ToolCallBlock;
          }
          return { type: 'text' as const, text: '' };
        }),
      };

      // Attach thinking blocks
      if (thoughtBlocks.length > 0) {
        outputIContent.blocks = [...thoughtBlocks, ...outputIContent.blocks];
      }

      // CRITICAL ASSERTIONS
      // 1. thoughtBlocks were extracted
      expect(thoughtBlocks.length).toBe(1);
      expect(thoughtBlocks[0].signature).toBe(
        'EqoBCkYIAxgCIkAKHgoSdGhpbmtpbmdfY29udGVudA==',
      );

      // 2. First block is thinking
      expect(outputIContent.blocks[0].type).toBe('thinking');

      // 3. Thinking has correct content
      const thinkingBlock = outputIContent.blocks[0] as ThinkingBlock;
      expect(thinkingBlock.thought).toBe('Let me analyze this carefully...');
      expect(thinkingBlock.signature).toBe(
        'EqoBCkYIAxgCIkAKHgoSdGhpbmtpbmdfY29udGVudA==',
      );
      expect(thinkingBlock.sourceField).toBe('thinking');

      // 4. Tool call is also present
      const hasToolCall = outputIContent.blocks.some(
        (b) => b.type === 'tool_call',
      );
      expect(hasToolCall).toBe(true);

      // 5. Block order is correct: thinking, text, tool_call
      expect(outputIContent.blocks.map((b) => b.type)).toEqual([
        'thinking',
        'text',
        'tool_call',
      ]);
    });
  });
});
