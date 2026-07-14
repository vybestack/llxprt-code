/**
 * @issue #1837
 * Behavioral tests for stopReason propagation in OpenAI streaming and non-streaming responses.
 *
 * The OpenAI provider must set stopReason in IContent metadata so that
 * toModelStreamChunk() can map it to finishReason, which turn.ts uses to
 * yield the Finished event that ends a turn.
 *
 * Migrated in P13 from the deleted convertIContentToResponse to the neutral
 * toModelStreamChunk path (@plan:PLAN-20260707-AGENTNEUTRAL.P13).
 */
import { describe, it, expect } from 'vitest';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { toModelStreamChunk } from '@vybestack/llxprt-code-core/llm-types/index.js';

describe('Issue #1837: OpenAI provider stopReason propagation', () => {
  describe('Streaming: Anthropic-native stopReason mapped to canonical finishReason', () => {
    it('should propagate stop (mapped to end_turn) through to finishReason stop', () => {
      const icontent: IContent = {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'Hello world' }],
        metadata: {
          usage: {
            promptTokens: 10,
            completionTokens: 5,
            totalTokens: 15,
          },
          stopReason: 'end_turn',
        },
      };

      const chunk = toModelStreamChunk(icontent);
      expect(chunk.finishReason).toBe('stop');
    });

    it('should propagate length (mapped to max_tokens) through to finishReason max_tokens', () => {
      const icontent: IContent = {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'Truncated response...' }],
        metadata: {
          usage: {
            promptTokens: 10,
            completionTokens: 100,
            totalTokens: 110,
          },
          stopReason: 'max_tokens',
        },
      };

      const chunk = toModelStreamChunk(icontent);
      expect(chunk.finishReason).toBe('max_tokens');
    });

    it('should propagate tool_calls (mapped to tool_use) through to finishReason tool_calls', () => {
      const icontent: IContent = {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'call_123',
            name: 'read_file',
            parameters: { path: '/tmp/test.txt' },
          },
        ],
        metadata: {
          usage: {
            promptTokens: 10,
            completionTokens: 20,
            totalTokens: 30,
          },
          stopReason: 'tool_use',
        },
      };

      const chunk = toModelStreamChunk(icontent);
      expect(chunk.finishReason).toBe('tool_calls');
    });

    it('should propagate end_turn stopReason through to finishReason stop (no usage)', () => {
      const icontent: IContent = {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'Filtered content' }],
        metadata: {
          stopReason: 'end_turn',
        },
      };

      const chunk = toModelStreamChunk(icontent);
      expect(chunk.finishReason).toBe('stop');
    });
  });

  describe('Non-streaming: stopReason from finish_reason', () => {
    it('should include stopReason in metadata for non-streaming stop response', () => {
      const icontent: IContent = {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'Complete response' }],
        metadata: {
          usage: {
            promptTokens: 5,
            completionTokens: 10,
            totalTokens: 15,
          },
          stopReason: 'end_turn',
        },
      };

      const chunk = toModelStreamChunk(icontent);
      expect(chunk.finishReason).toBe('stop');
      expect(chunk.usage?.totalTokens).toBe(15);
    });

    it('should set finishReason for length-truncated non-streaming response', () => {
      const icontent: IContent = {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'Truncated' }],
        metadata: {
          stopReason: 'max_tokens',
        },
      };

      const chunk = toModelStreamChunk(icontent);
      expect(chunk.finishReason).toBe('max_tokens');
    });
  });

  describe('Thinking + text: stopReason still propagates', () => {
    it('should propagate stopReason when response has thinking blocks', () => {
      const icontent: IContent = {
        speaker: 'ai',
        blocks: [
          {
            type: 'thinking',
            thought: 'Let me think about this...',
            sourceField: 'reasoning_content',
            isHidden: false,
          },
          { type: 'text', text: 'Here is my answer.' },
        ],
        metadata: {
          usage: {
            promptTokens: 50,
            completionTokens: 100,
            totalTokens: 150,
          },
          stopReason: 'end_turn',
        },
      };

      const chunk = toModelStreamChunk(icontent);
      expect(chunk.finishReason).toBe('stop');
      // Text blocks are carried through content.blocks
      const textBlocks = chunk.content.blocks.filter((b) => b.type === 'text');
      expect(textBlocks).toHaveLength(1);
      expect((textBlocks[0] as { text: string }).text).toBe(
        'Here is my answer.',
      );
    });

    it('should propagate stopReason for thinking-only response', () => {
      const icontent: IContent = {
        speaker: 'ai',
        blocks: [
          {
            type: 'thinking',
            thought: 'Deep reasoning here...',
            sourceField: 'reasoning_content',
            isHidden: false,
          },
        ],
        metadata: {
          stopReason: 'end_turn',
        },
      };

      const chunk = toModelStreamChunk(icontent);
      expect(chunk.finishReason).toBe('stop');
    });
  });

  describe('Edge cases', () => {
    it('should not set finishReason when no stopReason in metadata', () => {
      const icontent: IContent = {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'No stop reason' }],
        metadata: {
          usage: {
            promptTokens: 5,
            completionTokens: 5,
            totalTokens: 10,
          },
        },
      };

      const chunk = toModelStreamChunk(icontent);
      expect(chunk.finishReason).toBeUndefined();
    });

    it('should not set finishReason when metadata is empty', () => {
      const icontent: IContent = {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'Empty metadata' }],
        metadata: {},
      };

      const chunk = toModelStreamChunk(icontent);
      expect(chunk.finishReason).toBeUndefined();
    });

    it('should not set finishReason when metadata is undefined', () => {
      const icontent: IContent = {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'No metadata at all' }],
      };

      const chunk = toModelStreamChunk(icontent);
      expect(chunk.finishReason).toBeUndefined();
    });
  });

  describe('OpenAI native finish_reason values in toModelStreamChunk', () => {
    it('should map raw "stop" finish_reason to stop', () => {
      const icontent: IContent = {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'Done' }],
        metadata: { stopReason: 'stop' },
      };

      const chunk = toModelStreamChunk(icontent);
      expect(chunk.finishReason).toBe('stop');
    });

    it('should map raw "length" finish_reason to max_tokens', () => {
      const icontent: IContent = {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'Too long' }],
        metadata: { stopReason: 'length' },
      };

      const chunk = toModelStreamChunk(icontent);
      expect(chunk.finishReason).toBe('max_tokens');
    });

    it('should map raw "tool_calls" finish_reason to tool_calls', () => {
      const icontent: IContent = {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'call_abc',
            name: 'some_tool',
            parameters: {},
          },
        ],
        metadata: { stopReason: 'tool_calls' },
      };

      const chunk = toModelStreamChunk(icontent);
      expect(chunk.finishReason).toBe('tool_calls');
    });

    it('should map raw "content_filter" finish_reason to safety', () => {
      const icontent: IContent = {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'Filtered' }],
        metadata: { stopReason: 'content_filter' },
      };

      const chunk = toModelStreamChunk(icontent);
      expect(chunk.finishReason).toBe('safety');
    });
  });
});
