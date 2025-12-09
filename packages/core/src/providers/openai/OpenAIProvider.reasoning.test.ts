/**
 * Tests for OpenAI provider reasoning/thinking support.
 *
 * @plan PLAN-20251202-THINKING.P10
 * @requirement REQ-THINK-003
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { OpenAIProvider } from './OpenAIProvider.js';
import type {
  ThinkingBlock,
  ToolCallBlock,
  IContent,
} from '../../services/history/IContent.js';
import type { NormalizedGenerateChatOptions } from '../BaseProvider.js';
import type OpenAI from 'openai';

describe('OpenAIProvider reasoning parsing @plan:PLAN-20251202-THINKING.P10', () => {
  let provider: OpenAIProvider;

  beforeEach(() => {
    // Minimal provider setup - no OAuth, basic config
    provider = new OpenAIProvider('test-api-key', 'https://api.openai.com/v1');
  });

  describe('parseStreamingReasoningDelta @requirement:REQ-THINK-003.1', () => {
    it('should return ThinkingBlock when reasoning_content is present in delta', () => {
      const delta: OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta = {
        reasoning_content: 'Let me think about this problem...',
      };

      // Call the private method via type assertion
      const result = (
        provider as unknown as {
          parseStreamingReasoningDelta: (
            delta: OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta,
          ) => { thinking: ThinkingBlock | null; toolCalls: ToolCallBlock[] };
        }
      ).parseStreamingReasoningDelta(delta);

      expect(result).not.toBeNull();
      expect(result.thinking).not.toBeNull();
      expect(result.thinking).toMatchObject({
        type: 'thinking',
        thought: 'Let me think about this problem...',
        sourceField: 'reasoning_content',
      });
      expect(result.toolCalls).toHaveLength(0);
    });

    it('should return null thinking when reasoning_content is absent', () => {
      const delta: OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta = {
        content: 'Regular content',
      };

      const result = (
        provider as unknown as {
          parseStreamingReasoningDelta: (
            delta: OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta,
          ) => { thinking: ThinkingBlock | null; toolCalls: ToolCallBlock[] };
        }
      ).parseStreamingReasoningDelta(delta);

      expect(result.thinking).toBeNull();
      expect(result.toolCalls).toHaveLength(0);
    });

    it('should return null thinking when reasoning_content is empty string', () => {
      const delta: OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta = {
        reasoning_content: '',
      };

      const result = (
        provider as unknown as {
          parseStreamingReasoningDelta: (
            delta: OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta,
          ) => { thinking: ThinkingBlock | null; toolCalls: ToolCallBlock[] };
        }
      ).parseStreamingReasoningDelta(delta);

      expect(result.thinking).toBeNull();
      expect(result.toolCalls).toHaveLength(0);
    });

    it('should handle delta with both reasoning_content and content', () => {
      const delta: OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta = {
        reasoning_content: 'Thinking...',
        content: 'Response',
      };

      const result = (
        provider as unknown as {
          parseStreamingReasoningDelta: (
            delta: OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta,
          ) => { thinking: ThinkingBlock | null; toolCalls: ToolCallBlock[] };
        }
      ).parseStreamingReasoningDelta(delta);

      expect(result).not.toBeNull();
      expect(result.thinking).not.toBeNull();
      expect(result.thinking).toMatchObject({
        type: 'thinking',
        thought: 'Thinking...',
        sourceField: 'reasoning_content',
      });
      expect(result.toolCalls).toHaveLength(0);
    });

    it('should set sourceField to reasoning_content', () => {
      const delta: OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta = {
        reasoning_content: 'Analysis',
      };

      const result = (
        provider as unknown as {
          parseStreamingReasoningDelta: (
            delta: OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta,
          ) => { thinking: ThinkingBlock | null; toolCalls: ToolCallBlock[] };
        }
      ).parseStreamingReasoningDelta(delta);

      expect(result).not.toBeNull();
      expect(result.thinking).not.toBeNull();
      // Type assertion after verification
      expect(result.thinking!.sourceField).toBe('reasoning_content');
    });
  });

  describe('parseNonStreamingReasoning @requirement:REQ-THINK-003.2', () => {
    it('should return ThinkingBlock when reasoning_content is present in message', () => {
      const message: OpenAI.Chat.Completions.ChatCompletionMessage = {
        role: 'assistant',
        content: 'Answer',
        reasoning_content: 'Let me analyze this thoroughly...',
      };

      const result = (
        provider as unknown as {
          parseNonStreamingReasoning: (
            message: OpenAI.Chat.Completions.ChatCompletionMessage,
          ) => { thinking: ThinkingBlock | null; toolCalls: ToolCallBlock[] };
        }
      ).parseNonStreamingReasoning(message);

      expect(result).not.toBeNull();
      expect(result.thinking).not.toBeNull();
      expect(result.thinking).toMatchObject({
        type: 'thinking',
        thought: 'Let me analyze this thoroughly...',
        sourceField: 'reasoning_content',
      });
      expect(result.toolCalls).toHaveLength(0);
    });

    it('should return null thinking when reasoning_content is absent', () => {
      const message: OpenAI.Chat.Completions.ChatCompletionMessage = {
        role: 'assistant',
        content: 'Answer',
      };

      const result = (
        provider as unknown as {
          parseNonStreamingReasoning: (
            message: OpenAI.Chat.Completions.ChatCompletionMessage,
          ) => { thinking: ThinkingBlock | null; toolCalls: ToolCallBlock[] };
        }
      ).parseNonStreamingReasoning(message);

      expect(result.thinking).toBeNull();
      expect(result.toolCalls).toHaveLength(0);
    });

    it('should return null thinking when reasoning_content is empty string', () => {
      const message: OpenAI.Chat.Completions.ChatCompletionMessage = {
        role: 'assistant',
        content: 'Answer',
        reasoning_content: '',
      };

      const result = (
        provider as unknown as {
          parseNonStreamingReasoning: (
            message: OpenAI.Chat.Completions.ChatCompletionMessage,
          ) => { thinking: ThinkingBlock | null; toolCalls: ToolCallBlock[] };
        }
      ).parseNonStreamingReasoning(message);

      expect(result.thinking).toBeNull();
      expect(result.toolCalls).toHaveLength(0);
    });

    it('should handle message with tool_calls and reasoning_content', () => {
      const message: OpenAI.Chat.Completions.ChatCompletionMessage = {
        role: 'assistant',
        content: null,
        reasoning_content: 'Need to use a tool...',
        tool_calls: [
          {
            id: 'call_123',
            type: 'function',
            function: {
              name: 'test_tool',
              arguments: '{}',
            },
          },
        ],
      };

      const result = (
        provider as unknown as {
          parseNonStreamingReasoning: (
            message: OpenAI.Chat.Completions.ChatCompletionMessage,
          ) => { thinking: ThinkingBlock | null; toolCalls: ToolCallBlock[] };
        }
      ).parseNonStreamingReasoning(message);

      expect(result).not.toBeNull();
      expect(result.thinking).not.toBeNull();
      expect(result.thinking).toMatchObject({
        type: 'thinking',
        thought: 'Need to use a tool...',
        sourceField: 'reasoning_content',
      });
      expect(result.toolCalls).toHaveLength(0);
    });

    it('should set sourceField to reasoning_content', () => {
      const message: OpenAI.Chat.Completions.ChatCompletionMessage = {
        role: 'assistant',
        content: 'Response',
        reasoning_content: 'Reasoning',
      };

      const result = (
        provider as unknown as {
          parseNonStreamingReasoning: (
            message: OpenAI.Chat.Completions.ChatCompletionMessage,
          ) => { thinking: ThinkingBlock | null; toolCalls: ToolCallBlock[] };
        }
      ).parseNonStreamingReasoning(message);

      expect(result).not.toBeNull();
      expect(result.thinking).not.toBeNull();
      // Type assertion after verification
      expect(result.thinking!.sourceField).toBe('reasoning_content');
    });
  });

  describe('graceful handling @requirement:REQ-THINK-003.4', () => {
    it('should handle null delta gracefully (streaming)', () => {
      const result = (
        provider as unknown as {
          parseStreamingReasoningDelta: (
            delta: OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta | null,
          ) => { thinking: ThinkingBlock | null; toolCalls: ToolCallBlock[] };
        }
      ).parseStreamingReasoningDelta(
        null as unknown as OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta,
      );

      expect(result.thinking).toBeNull();
      expect(result.toolCalls).toHaveLength(0);
    });

    it('should handle undefined delta gracefully (streaming)', () => {
      const result = (
        provider as unknown as {
          parseStreamingReasoningDelta: (
            delta:
              | OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta
              | undefined,
          ) => { thinking: ThinkingBlock | null; toolCalls: ToolCallBlock[] };
        }
      ).parseStreamingReasoningDelta(
        undefined as unknown as OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta,
      );

      expect(result.thinking).toBeNull();
      expect(result.toolCalls).toHaveLength(0);
    });

    it('should handle null message gracefully (non-streaming)', () => {
      const result = (
        provider as unknown as {
          parseNonStreamingReasoning: (
            message: OpenAI.Chat.Completions.ChatCompletionMessage | null,
          ) => { thinking: ThinkingBlock | null; toolCalls: ToolCallBlock[] };
        }
      ).parseNonStreamingReasoning(
        null as unknown as OpenAI.Chat.Completions.ChatCompletionMessage,
      );

      expect(result.thinking).toBeNull();
      expect(result.toolCalls).toHaveLength(0);
    });

    it('should handle undefined message gracefully (non-streaming)', () => {
      const result = (
        provider as unknown as {
          parseNonStreamingReasoning: (
            message: OpenAI.Chat.Completions.ChatCompletionMessage | undefined,
          ) => { thinking: ThinkingBlock | null; toolCalls: ToolCallBlock[] };
        }
      ).parseNonStreamingReasoning(
        undefined as unknown as OpenAI.Chat.Completions.ChatCompletionMessage,
      );

      expect(result.thinking).toBeNull();
      expect(result.toolCalls).toHaveLength(0);
    });

    it('should handle empty delta object (streaming)', () => {
      const delta: OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta =
        {};

      const result = (
        provider as unknown as {
          parseStreamingReasoningDelta: (
            delta: OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta,
          ) => { thinking: ThinkingBlock | null; toolCalls: ToolCallBlock[] };
        }
      ).parseStreamingReasoningDelta(delta);

      expect(result.thinking).toBeNull();
      expect(result.toolCalls).toHaveLength(0);
    });

    it('should handle minimal message object (non-streaming)', () => {
      const message: OpenAI.Chat.Completions.ChatCompletionMessage = {
        role: 'assistant',
      };

      const result = (
        provider as unknown as {
          parseNonStreamingReasoning: (
            message: OpenAI.Chat.Completions.ChatCompletionMessage,
          ) => { thinking: ThinkingBlock | null; toolCalls: ToolCallBlock[] };
        }
      ).parseNonStreamingReasoning(message);

      expect(result.thinking).toBeNull();
      expect(result.toolCalls).toHaveLength(0);
    });

    it('should preserve whitespace-only reasoning_content (streaming) for proper formatting', () => {
      // For streaming, whitespace-only chunks must be preserved to maintain
      // proper spacing between tokens (fixes issue #721)
      const delta: OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta = {
        reasoning_content: '   \n\t  ',
      };

      const result = (
        provider as unknown as {
          parseStreamingReasoningDelta: (
            delta: OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta,
          ) => { thinking: ThinkingBlock | null; toolCalls: ToolCallBlock[] };
        }
      ).parseStreamingReasoningDelta(delta);

      // Whitespace should be preserved for proper formatting during accumulation
      expect(result).not.toBeNull();
      expect(result.thinking).not.toBeNull();
      expect(result.thinking?.thought).toBe('   \n\t  ');
      expect(result.toolCalls).toHaveLength(0);
    });

    it('should handle whitespace-only reasoning_content (non-streaming)', () => {
      const message: OpenAI.Chat.Completions.ChatCompletionMessage = {
        role: 'assistant',
        content: 'Answer',
        reasoning_content: '   \n\t  ',
      };

      const result = (
        provider as unknown as {
          parseNonStreamingReasoning: (
            message: OpenAI.Chat.Completions.ChatCompletionMessage,
          ) => { thinking: ThinkingBlock | null; toolCalls: ToolCallBlock[] };
        }
      ).parseNonStreamingReasoning(message);

      // Whitespace-only should be treated as empty and return null
      expect(result.thinking).toBeNull();
      expect(result.toolCalls).toHaveLength(0);
    });
  });
});

/**
 * Tests for message building with reasoning content
 *
 * @plan PLAN-20251202-THINKING.P13
 * @requirement REQ-THINK-004
 */
describe('OpenAIProvider buildMessagesWithReasoning @plan:PLAN-20251202-THINKING.P13', () => {
  let provider: OpenAIProvider;

  beforeEach(() => {
    // Minimal provider setup
    provider = new OpenAIProvider('test-api-key', 'https://api.openai.com/v1');
  });

  /**
   * Helper to create mock options with settings
   */
  const createMockOptions = (
    settingsMap: Record<string, unknown>,
  ): NormalizedGenerateChatOptions =>
    ({
      settings: {
        get: (key: string) => settingsMap[key],
      },
      invocation: {
        requestId: 'test-request',
        timestamp: Date.now(),
      },
      resolved: {
        model: 'gpt-4o',
        authToken: { token: 'test-token', type: 'api-key' },
      },
      metadata: {},
    }) as unknown as NormalizedGenerateChatOptions;

  /**
   * Helper to create IContent with thinking block
   */
  const createAiContentWithThinking = (
    thinking: string,
    text: string,
  ): IContent => ({
    speaker: 'ai',
    blocks: [
      {
        type: 'thinking',
        thought: thinking,
        sourceField: 'reasoning_content',
      } as ThinkingBlock,
      {
        type: 'text',
        text,
      },
    ],
  });

  /**
   * Helper to create IContent with only text (no thinking)
   */
  const createAiContentWithoutThinking = (text: string): IContent => ({
    speaker: 'ai',
    blocks: [
      {
        type: 'text',
        text,
      },
    ],
  });

  /**
   * Helper to create IContent with multiple thinking blocks
   */
  const createAiContentWithMultipleThinking = (
    thinkings: string[],
    text: string,
  ): IContent => ({
    speaker: 'ai',
    blocks: [
      ...thinkings.map(
        (thought) =>
          ({
            type: 'thinking',
            thought,
            sourceField: 'reasoning_content',
          }) as ThinkingBlock,
      ),
      {
        type: 'text',
        text,
      },
    ],
  });

  describe('REQ-THINK-004.1: reads reasoning.includeInContext from settings', () => {
    it('should read includeInContext setting when true', () => {
      const contents = [createAiContentWithThinking('Thinking...', 'Answer')];
      const options = createMockOptions({
        'reasoning.includeInContext': true,
        'reasoning.stripFromContext': 'none',
      });

      const result = (
        provider as unknown as {
          buildMessagesWithReasoning: (
            contents: IContent[],
            options: NormalizedGenerateChatOptions,
          ) => OpenAI.Chat.ChatCompletionMessageParam[];
        }
      ).buildMessagesWithReasoning(contents, options);

      // Should include reasoning_content field
      expect(result).toHaveLength(1);
      expect(result[0]).toHaveProperty('reasoning_content');
    });

    it('should read includeInContext setting when false', () => {
      const contents = [createAiContentWithThinking('Thinking...', 'Answer')];
      const options = createMockOptions({
        'reasoning.includeInContext': false,
        'reasoning.stripFromContext': 'none',
      });

      const result = (
        provider as unknown as {
          buildMessagesWithReasoning: (
            contents: IContent[],
            options: NormalizedGenerateChatOptions,
          ) => OpenAI.Chat.ChatCompletionMessageParam[];
        }
      ).buildMessagesWithReasoning(contents, options);

      // Should not include reasoning_content field
      expect(result).toHaveLength(1);
      expect(result[0]).not.toHaveProperty('reasoning_content');
    });
  });

  describe('REQ-THINK-004.2: reads reasoning.stripFromContext from settings', () => {
    it('should read stripFromContext setting with "none" value', () => {
      const contents = [
        createAiContentWithThinking('Thinking 1', 'Answer 1'),
        createAiContentWithThinking('Thinking 2', 'Answer 2'),
      ];
      const options = createMockOptions({
        'reasoning.includeInContext': true,
        'reasoning.stripFromContext': 'none',
      });

      const result = (
        provider as unknown as {
          buildMessagesWithReasoning: (
            contents: IContent[],
            options: NormalizedGenerateChatOptions,
          ) => OpenAI.Chat.ChatCompletionMessageParam[];
        }
      ).buildMessagesWithReasoning(contents, options);

      // Should include reasoning_content for all messages
      expect(result).toHaveLength(2);
      expect(result[0]).toHaveProperty('reasoning_content', 'Thinking 1');
      expect(result[1]).toHaveProperty('reasoning_content', 'Thinking 2');
    });

    it('should read stripFromContext setting with "all" value', () => {
      const contents = [
        createAiContentWithThinking('Thinking 1', 'Answer 1'),
        createAiContentWithThinking('Thinking 2', 'Answer 2'),
      ];
      const options = createMockOptions({
        'reasoning.includeInContext': true,
        'reasoning.stripFromContext': 'all',
      });

      const result = (
        provider as unknown as {
          buildMessagesWithReasoning: (
            contents: IContent[],
            options: NormalizedGenerateChatOptions,
          ) => OpenAI.Chat.ChatCompletionMessageParam[];
        }
      ).buildMessagesWithReasoning(contents, options);

      // Should not include reasoning_content for any messages
      expect(result).toHaveLength(2);
      expect(result[0]).not.toHaveProperty('reasoning_content');
      expect(result[1]).not.toHaveProperty('reasoning_content');
    });

    it('should read stripFromContext setting with "allButLast" value', () => {
      const contents = [
        createAiContentWithThinking('Thinking 1', 'Answer 1'),
        createAiContentWithThinking('Thinking 2', 'Answer 2'),
      ];
      const options = createMockOptions({
        'reasoning.includeInContext': true,
        'reasoning.stripFromContext': 'allButLast',
      });

      const result = (
        provider as unknown as {
          buildMessagesWithReasoning: (
            contents: IContent[],
            options: NormalizedGenerateChatOptions,
          ) => OpenAI.Chat.ChatCompletionMessageParam[];
        }
      ).buildMessagesWithReasoning(contents, options);

      // Should not include reasoning_content for first, but include for last
      expect(result).toHaveLength(2);
      expect(result[0]).not.toHaveProperty('reasoning_content');
      expect(result[1]).toHaveProperty('reasoning_content', 'Thinking 2');
    });
  });

  describe('REQ-THINK-004.3: includes reasoning_content when includeInContext=true', () => {
    it('should include reasoning_content when includeInContext=true', () => {
      const contents = [createAiContentWithThinking('Thinking...', 'Answer')];
      const options = createMockOptions({
        'reasoning.includeInContext': true,
        'reasoning.stripFromContext': 'none',
      });

      const result = (
        provider as unknown as {
          buildMessagesWithReasoning: (
            contents: IContent[],
            options: NormalizedGenerateChatOptions,
          ) => OpenAI.Chat.ChatCompletionMessageParam[];
        }
      ).buildMessagesWithReasoning(contents, options);

      expect(result).toHaveLength(1);
      expect(result[0]).toHaveProperty('reasoning_content', 'Thinking...');
      expect(result[0]).toHaveProperty('content', 'Answer');
    });

    it('should include reasoning_content for multiple messages', () => {
      const contents = [
        createAiContentWithThinking('Thinking 1', 'Answer 1'),
        createAiContentWithThinking('Thinking 2', 'Answer 2'),
        createAiContentWithThinking('Thinking 3', 'Answer 3'),
      ];
      const options = createMockOptions({
        'reasoning.includeInContext': true,
        'reasoning.stripFromContext': 'none',
      });

      const result = (
        provider as unknown as {
          buildMessagesWithReasoning: (
            contents: IContent[],
            options: NormalizedGenerateChatOptions,
          ) => OpenAI.Chat.ChatCompletionMessageParam[];
        }
      ).buildMessagesWithReasoning(contents, options);

      expect(result).toHaveLength(3);
      expect(result[0]).toHaveProperty('reasoning_content', 'Thinking 1');
      expect(result[1]).toHaveProperty('reasoning_content', 'Thinking 2');
      expect(result[2]).toHaveProperty('reasoning_content', 'Thinking 3');
    });
  });

  describe('REQ-THINK-004.4: excludes reasoning_content when includeInContext=false', () => {
    it('should exclude reasoning_content when includeInContext=false', () => {
      const contents = [createAiContentWithThinking('Thinking...', 'Answer')];
      const options = createMockOptions({
        'reasoning.includeInContext': false,
        'reasoning.stripFromContext': 'none',
      });

      const result = (
        provider as unknown as {
          buildMessagesWithReasoning: (
            contents: IContent[],
            options: NormalizedGenerateChatOptions,
          ) => OpenAI.Chat.ChatCompletionMessageParam[];
        }
      ).buildMessagesWithReasoning(contents, options);

      expect(result).toHaveLength(1);
      expect(result[0]).not.toHaveProperty('reasoning_content');
      expect(result[0]).toHaveProperty('content', 'Answer');
    });

    it('should exclude reasoning_content for all messages when false', () => {
      const contents = [
        createAiContentWithThinking('Thinking 1', 'Answer 1'),
        createAiContentWithThinking('Thinking 2', 'Answer 2'),
      ];
      const options = createMockOptions({
        'reasoning.includeInContext': false,
        'reasoning.stripFromContext': 'none',
      });

      const result = (
        provider as unknown as {
          buildMessagesWithReasoning: (
            contents: IContent[],
            options: NormalizedGenerateChatOptions,
          ) => OpenAI.Chat.ChatCompletionMessageParam[];
        }
      ).buildMessagesWithReasoning(contents, options);

      expect(result).toHaveLength(2);
      expect(result[0]).not.toHaveProperty('reasoning_content');
      expect(result[1]).not.toHaveProperty('reasoning_content');
    });
  });

  describe('REQ-THINK-004.5: applies strip policy (all, allButLast, none)', () => {
    it('should strip all reasoning_content when policy is "all"', () => {
      const contents = [
        createAiContentWithThinking('Thinking 1', 'Answer 1'),
        createAiContentWithThinking('Thinking 2', 'Answer 2'),
        createAiContentWithThinking('Thinking 3', 'Answer 3'),
      ];
      const options = createMockOptions({
        'reasoning.includeInContext': true,
        'reasoning.stripFromContext': 'all',
      });

      const result = (
        provider as unknown as {
          buildMessagesWithReasoning: (
            contents: IContent[],
            options: NormalizedGenerateChatOptions,
          ) => OpenAI.Chat.ChatCompletionMessageParam[];
        }
      ).buildMessagesWithReasoning(contents, options);

      expect(result).toHaveLength(3);
      result.forEach((msg) => {
        expect(msg).not.toHaveProperty('reasoning_content');
      });
    });

    it('should strip all but last reasoning_content when policy is "allButLast"', () => {
      const contents = [
        createAiContentWithThinking('Thinking 1', 'Answer 1'),
        createAiContentWithThinking('Thinking 2', 'Answer 2'),
        createAiContentWithThinking('Thinking 3', 'Answer 3'),
      ];
      const options = createMockOptions({
        'reasoning.includeInContext': true,
        'reasoning.stripFromContext': 'allButLast',
      });

      const result = (
        provider as unknown as {
          buildMessagesWithReasoning: (
            contents: IContent[],
            options: NormalizedGenerateChatOptions,
          ) => OpenAI.Chat.ChatCompletionMessageParam[];
        }
      ).buildMessagesWithReasoning(contents, options);

      expect(result).toHaveLength(3);
      expect(result[0]).not.toHaveProperty('reasoning_content');
      expect(result[1]).not.toHaveProperty('reasoning_content');
      expect(result[2]).toHaveProperty('reasoning_content', 'Thinking 3');
    });

    it('should keep all reasoning_content when policy is "none"', () => {
      const contents = [
        createAiContentWithThinking('Thinking 1', 'Answer 1'),
        createAiContentWithThinking('Thinking 2', 'Answer 2'),
        createAiContentWithThinking('Thinking 3', 'Answer 3'),
      ];
      const options = createMockOptions({
        'reasoning.includeInContext': true,
        'reasoning.stripFromContext': 'none',
      });

      const result = (
        provider as unknown as {
          buildMessagesWithReasoning: (
            contents: IContent[],
            options: NormalizedGenerateChatOptions,
          ) => OpenAI.Chat.ChatCompletionMessageParam[];
        }
      ).buildMessagesWithReasoning(contents, options);

      expect(result).toHaveLength(3);
      expect(result[0]).toHaveProperty('reasoning_content', 'Thinking 1');
      expect(result[1]).toHaveProperty('reasoning_content', 'Thinking 2');
      expect(result[2]).toHaveProperty('reasoning_content', 'Thinking 3');
    });

    it('should handle allButLast with single message (keeps reasoning)', () => {
      const contents = [createAiContentWithThinking('Thinking', 'Answer')];
      const options = createMockOptions({
        'reasoning.includeInContext': true,
        'reasoning.stripFromContext': 'allButLast',
      });

      const result = (
        provider as unknown as {
          buildMessagesWithReasoning: (
            contents: IContent[],
            options: NormalizedGenerateChatOptions,
          ) => OpenAI.Chat.ChatCompletionMessageParam[];
        }
      ).buildMessagesWithReasoning(contents, options);

      expect(result).toHaveLength(1);
      expect(result[0]).toHaveProperty('reasoning_content', 'Thinking');
    });
  });

  describe('edge cases', () => {
    it('should handle empty content array', () => {
      const contents: IContent[] = [];
      const options = createMockOptions({
        'reasoning.includeInContext': true,
        'reasoning.stripFromContext': 'none',
      });

      const result = (
        provider as unknown as {
          buildMessagesWithReasoning: (
            contents: IContent[],
            options: NormalizedGenerateChatOptions,
          ) => OpenAI.Chat.ChatCompletionMessageParam[];
        }
      ).buildMessagesWithReasoning(contents, options);

      expect(result).toHaveLength(0);
    });

    it('should handle content without thinking blocks', () => {
      const contents = [
        createAiContentWithoutThinking('Answer 1'),
        createAiContentWithoutThinking('Answer 2'),
      ];
      const options = createMockOptions({
        'reasoning.includeInContext': true,
        'reasoning.stripFromContext': 'none',
      });

      const result = (
        provider as unknown as {
          buildMessagesWithReasoning: (
            contents: IContent[],
            options: NormalizedGenerateChatOptions,
          ) => OpenAI.Chat.ChatCompletionMessageParam[];
        }
      ).buildMessagesWithReasoning(contents, options);

      expect(result).toHaveLength(2);
      expect(result[0]).not.toHaveProperty('reasoning_content');
      expect(result[1]).not.toHaveProperty('reasoning_content');
    });

    it('should handle content with multiple thinking blocks', () => {
      const contents = [
        createAiContentWithMultipleThinking(
          ['Thinking 1', 'Thinking 2', 'Thinking 3'],
          'Answer',
        ),
      ];
      const options = createMockOptions({
        'reasoning.includeInContext': true,
        'reasoning.stripFromContext': 'none',
      });

      const result = (
        provider as unknown as {
          buildMessagesWithReasoning: (
            contents: IContent[],
            options: NormalizedGenerateChatOptions,
          ) => OpenAI.Chat.ChatCompletionMessageParam[];
        }
      ).buildMessagesWithReasoning(contents, options);

      expect(result).toHaveLength(1);
      // Should concatenate all thinking blocks
      expect(result[0]).toHaveProperty('reasoning_content');
      const reasoning = (result[0] as { reasoning_content?: string })
        .reasoning_content;
      expect(reasoning).toContain('Thinking 1');
      expect(reasoning).toContain('Thinking 2');
      expect(reasoning).toContain('Thinking 3');
    });

    it('should handle mixed content with and without thinking', () => {
      const contents = [
        createAiContentWithThinking('Thinking', 'Answer 1'),
        createAiContentWithoutThinking('Answer 2'),
        createAiContentWithThinking('More thinking', 'Answer 3'),
      ];
      const options = createMockOptions({
        'reasoning.includeInContext': true,
        'reasoning.stripFromContext': 'none',
      });

      const result = (
        provider as unknown as {
          buildMessagesWithReasoning: (
            contents: IContent[],
            options: NormalizedGenerateChatOptions,
          ) => OpenAI.Chat.ChatCompletionMessageParam[];
        }
      ).buildMessagesWithReasoning(contents, options);

      expect(result).toHaveLength(3);
      expect(result[0]).toHaveProperty('reasoning_content', 'Thinking');
      expect(result[1]).not.toHaveProperty('reasoning_content');
      expect(result[2]).toHaveProperty('reasoning_content', 'More thinking');
    });

    it('should handle empty thinking blocks', () => {
      const contents: IContent[] = [
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'thinking',
              thought: '',
              sourceField: 'reasoning_content',
            } as ThinkingBlock,
            {
              type: 'text',
              text: 'Answer',
            },
          ],
        },
      ];
      const options = createMockOptions({
        'reasoning.includeInContext': true,
        'reasoning.stripFromContext': 'none',
      });

      const result = (
        provider as unknown as {
          buildMessagesWithReasoning: (
            contents: IContent[],
            options: NormalizedGenerateChatOptions,
          ) => OpenAI.Chat.ChatCompletionMessageParam[];
        }
      ).buildMessagesWithReasoning(contents, options);

      expect(result).toHaveLength(1);
      const hasReasoningContent = 'reasoning_content' in result[0];
      expect(hasReasoningContent).toBe(true);
      expect(
        (result[0] as { reasoning_content?: string }).reasoning_content,
      ).toBe('');
    });

    it('should handle undefined settings (use defaults)', () => {
      const contents = [createAiContentWithThinking('Thinking', 'Answer')];
      const options = createMockOptions({
        // No reasoning settings provided
      });

      const result = (
        provider as unknown as {
          buildMessagesWithReasoning: (
            contents: IContent[],
            options: NormalizedGenerateChatOptions,
          ) => OpenAI.Chat.ChatCompletionMessageParam[];
        }
      ).buildMessagesWithReasoning(contents, options);

      // Should handle gracefully with defaults
      expect(result).toHaveLength(1);
    });

    it('should override includeInContext when stripFromContext is "all"', () => {
      const contents = [
        createAiContentWithThinking('Thinking 1', 'Answer 1'),
        createAiContentWithThinking('Thinking 2', 'Answer 2'),
      ];
      const options = createMockOptions({
        'reasoning.includeInContext': true,
        'reasoning.stripFromContext': 'all',
      });

      const result = (
        provider as unknown as {
          buildMessagesWithReasoning: (
            contents: IContent[],
            options: NormalizedGenerateChatOptions,
          ) => OpenAI.Chat.ChatCompletionMessageParam[];
        }
      ).buildMessagesWithReasoning(contents, options);

      // Even though includeInContext is true, "all" should strip everything
      expect(result).toHaveLength(2);
      expect(result[0]).not.toHaveProperty('reasoning_content');
      expect(result[1]).not.toHaveProperty('reasoning_content');
    });
  });
});

/**
 * Tests for Kimi K2 tool calls embedded in reasoning_content
 *
 * @issue #749
 * @plan PLAN-20251209-KIMI-REASONING-TOOLS
 * @requirement REQ-KIMI-REASONING-001
 */
describe('OpenAIProvider Kimi tool calls in reasoning_content @issue:749', () => {
  let provider: OpenAIProvider;

  beforeEach(() => {
    provider = new OpenAIProvider('test-api-key', 'https://api.openai.com/v1');
  });

  describe('parseStreamingReasoningDelta with embedded Kimi tool calls @requirement:REQ-KIMI-REASONING-001.1', () => {
    it('should extract tool calls from reasoning_content and return clean thinking', () => {
      const delta: OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta = {
        reasoning_content: `Let me search for this.
<|tool_calls_section_begin|>
<|tool_call_begin|>functions.grep:call_123<|tool_call_argument_begin|>{"pattern": "test"}<|tool_call_end|>
<|tool_calls_section_end|>
That should find it.`,
      };

      const result = (
        provider as unknown as {
          parseStreamingReasoningDelta: (
            delta: OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta,
          ) => { thinking: ThinkingBlock | null; toolCalls: ToolCallBlock[] };
        }
      ).parseStreamingReasoningDelta(delta);

      expect(result).not.toBeNull();
      expect(result.thinking).not.toBeNull();
      expect(result.thinking?.thought).toBe(
        'Let me search for this.\n\nThat should find it.',
      );
      expect(result.thinking?.sourceField).toBe('reasoning_content');
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0]).toMatchObject({
        type: 'tool_call',
        name: 'grep',
        parameters: { pattern: 'test' },
      });
    });

    it('should handle reasoning_content with only tool calls (no thinking text)', () => {
      const delta: OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta = {
        reasoning_content: `<|tool_calls_section_begin|>
<|tool_call_begin|>functions.read:call_456<|tool_call_argument_begin|>{"file_path": "/test.ts"}<|tool_call_end|>
<|tool_calls_section_end|>`,
      };

      const result = (
        provider as unknown as {
          parseStreamingReasoningDelta: (
            delta: OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta,
          ) => { thinking: ThinkingBlock | null; toolCalls: ToolCallBlock[] };
        }
      ).parseStreamingReasoningDelta(delta);

      expect(result).not.toBeNull();
      expect(result.thinking).toBeNull(); // No thinking text, just tool calls
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0]).toMatchObject({
        type: 'tool_call',
        name: 'read',
        parameters: { file_path: '/test.ts' },
      });
    });

    it('should handle multiple tool calls in reasoning_content with thinking before and after', () => {
      const delta: OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta = {
        reasoning_content: `First, I need to search.
<|tool_calls_section_begin|>
<|tool_call_begin|>functions.grep:call_1<|tool_call_argument_begin|>{"pattern": "error"}<|tool_call_end|>
<|tool_call_begin|>functions.grep:call_2<|tool_call_argument_begin|>{"pattern": "warning"}<|tool_call_end|>
<|tool_calls_section_end|>
Now let me read the files.
<|tool_calls_section_begin|>
<|tool_call_begin|>functions.read:call_3<|tool_call_argument_begin|>{"file_path": "/log.txt"}<|tool_call_end|>
<|tool_calls_section_end|>
Done analyzing.`,
      };

      const result = (
        provider as unknown as {
          parseStreamingReasoningDelta: (
            delta: OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta,
          ) => { thinking: ThinkingBlock | null; toolCalls: ToolCallBlock[] };
        }
      ).parseStreamingReasoningDelta(delta);

      expect(result).not.toBeNull();
      expect(result.thinking).not.toBeNull();
      expect(result.thinking?.thought).toBe(
        'First, I need to search.\n\nNow let me read the files.\n\nDone analyzing.',
      );
      expect(result.toolCalls).toHaveLength(3);
      expect(result.toolCalls[0].name).toBe('grep');
      expect(result.toolCalls[1].name).toBe('grep');
      expect(result.toolCalls[2].name).toBe('read');
    });

    it('should return empty arrays when reasoning_content has no tool calls', () => {
      const delta: OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta = {
        reasoning_content: 'Just thinking, no tools needed.',
      };

      const result = (
        provider as unknown as {
          parseStreamingReasoningDelta: (
            delta: OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta,
          ) => { thinking: ThinkingBlock | null; toolCalls: ToolCallBlock[] };
        }
      ).parseStreamingReasoningDelta(delta);

      expect(result).not.toBeNull();
      expect(result.thinking).not.toBeNull();
      expect(result.thinking?.thought).toBe('Just thinking, no tools needed.');
      expect(result.toolCalls).toHaveLength(0);
    });

    it('should return null thinking and empty toolCalls when reasoning_content is absent', () => {
      const delta: OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta = {
        content: 'Regular content',
      };

      const result = (
        provider as unknown as {
          parseStreamingReasoningDelta: (
            delta: OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta,
          ) => { thinking: ThinkingBlock | null; toolCalls: ToolCallBlock[] };
        }
      ).parseStreamingReasoningDelta(delta);

      expect(result).not.toBeNull();
      expect(result.thinking).toBeNull();
      expect(result.toolCalls).toHaveLength(0);
    });

    it('should preserve whitespace in thinking text after tool call extraction', () => {
      const delta: OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta = {
        reasoning_content: `  Leading whitespace\n<|tool_calls_section_begin|>
<|tool_call_begin|>functions.test:call_1<|tool_call_argument_begin|>{}<|tool_call_end|>
<|tool_calls_section_end|>
  Trailing whitespace  `,
      };

      const result = (
        provider as unknown as {
          parseStreamingReasoningDelta: (
            delta: OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta,
          ) => { thinking: ThinkingBlock | null; toolCalls: ToolCallBlock[] };
        }
      ).parseStreamingReasoningDelta(delta);

      expect(result.thinking).not.toBeNull();
      expect(result.thinking?.thought).toBe(
        '  Leading whitespace\n\n  Trailing whitespace  ',
      );
      expect(result.toolCalls).toHaveLength(1);
    });

    it('should handle malformed Kimi tokens gracefully', () => {
      const delta: OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta = {
        reasoning_content: `Normal thinking.
<|tool_calls_section_begin|>
<|tool_call_begin|>incomplete_tool_call
<|tool_calls_section_end|>
More thinking.`,
      };

      const result = (
        provider as unknown as {
          parseStreamingReasoningDelta: (
            delta: OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta,
          ) => { thinking: ThinkingBlock | null; toolCalls: ToolCallBlock[] };
        }
      ).parseStreamingReasoningDelta(delta);

      // Should still extract thinking and strip the malformed section
      expect(result.thinking).not.toBeNull();
      expect(result.thinking?.thought).toContain('Normal thinking');
      expect(result.thinking?.thought).toContain('More thinking');
      // No valid tool calls extracted
      expect(result.toolCalls).toHaveLength(0);
    });
  });

  describe('parseNonStreamingReasoning with embedded Kimi tool calls @requirement:REQ-KIMI-REASONING-001.2', () => {
    it('should extract tool calls from reasoning_content and return clean thinking', () => {
      const message: OpenAI.Chat.Completions.ChatCompletionMessage = {
        role: 'assistant',
        content: 'Final answer',
        reasoning_content: `Let me analyze this.
<|tool_calls_section_begin|>
<|tool_call_begin|>functions.bash:call_789<|tool_call_argument_begin|>{"command": "ls"}<|tool_call_end|>
<|tool_calls_section_end|>
Analysis complete.`,
      };

      const result = (
        provider as unknown as {
          parseNonStreamingReasoning: (
            message: OpenAI.Chat.Completions.ChatCompletionMessage,
          ) => { thinking: ThinkingBlock | null; toolCalls: ToolCallBlock[] };
        }
      ).parseNonStreamingReasoning(message);

      expect(result).not.toBeNull();
      expect(result.thinking).not.toBeNull();
      expect(result.thinking?.thought).toBe(
        'Let me analyze this.\n\nAnalysis complete.',
      );
      expect(result.thinking?.sourceField).toBe('reasoning_content');
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0]).toMatchObject({
        type: 'tool_call',
        name: 'bash',
        parameters: { command: 'ls' },
      });
    });

    it('should handle reasoning_content with only tool calls (no thinking text)', () => {
      const message: OpenAI.Chat.Completions.ChatCompletionMessage = {
        role: 'assistant',
        content: null,
        reasoning_content: `<|tool_calls_section_begin|>
<|tool_call_begin|>functions.write:call_999<|tool_call_argument_begin|>{"file_path": "/new.txt", "content": "test"}<|tool_call_end|>
<|tool_calls_section_end|>`,
      };

      const result = (
        provider as unknown as {
          parseNonStreamingReasoning: (
            message: OpenAI.Chat.Completions.ChatCompletionMessage,
          ) => { thinking: ThinkingBlock | null; toolCalls: ToolCallBlock[] };
        }
      ).parseNonStreamingReasoning(message);

      expect(result).not.toBeNull();
      expect(result.thinking).toBeNull(); // Only whitespace left after extraction
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0]).toMatchObject({
        type: 'tool_call',
        name: 'write',
      });
    });

    it('should handle multiple tool calls with complex parameters', () => {
      const message: OpenAI.Chat.Completions.ChatCompletionMessage = {
        role: 'assistant',
        content: 'Done',
        reasoning_content: `Processing multiple operations.
<|tool_calls_section_begin|>
<|tool_call_begin|>functions.edit:call_a1<|tool_call_argument_begin|>{"file_path": "/test.ts", "old_string": "foo", "new_string": "bar"}<|tool_call_end|>
<|tool_call_begin|>functions.glob:call_a2<|tool_call_argument_begin|>{"pattern": "**/*.ts"}<|tool_call_end|>
<|tool_calls_section_end|>
Operations queued.`,
      };

      const result = (
        provider as unknown as {
          parseNonStreamingReasoning: (
            message: OpenAI.Chat.Completions.ChatCompletionMessage,
          ) => { thinking: ThinkingBlock | null; toolCalls: ToolCallBlock[] };
        }
      ).parseNonStreamingReasoning(message);

      expect(result.thinking).not.toBeNull();
      expect(result.thinking?.thought).toBe(
        'Processing multiple operations.\n\nOperations queued.',
      );
      expect(result.toolCalls).toHaveLength(2);
      expect(result.toolCalls[0]).toMatchObject({
        type: 'tool_call',
        name: 'edit',
        parameters: {
          file_path: '/test.ts',
          old_string: 'foo',
          new_string: 'bar',
        },
      });
      expect(result.toolCalls[1]).toMatchObject({
        type: 'tool_call',
        name: 'glob',
        parameters: { pattern: '**/*.ts' },
      });
    });

    it('should return empty arrays when reasoning_content has no tool calls', () => {
      const message: OpenAI.Chat.Completions.ChatCompletionMessage = {
        role: 'assistant',
        content: 'Answer',
        reasoning_content: 'Just pure reasoning here.',
      };

      const result = (
        provider as unknown as {
          parseNonStreamingReasoning: (
            message: OpenAI.Chat.Completions.ChatCompletionMessage,
          ) => { thinking: ThinkingBlock | null; toolCalls: ToolCallBlock[] };
        }
      ).parseNonStreamingReasoning(message);

      expect(result.thinking).not.toBeNull();
      expect(result.thinking?.thought).toBe('Just pure reasoning here.');
      expect(result.toolCalls).toHaveLength(0);
    });

    it('should return null thinking and empty toolCalls when reasoning_content is absent', () => {
      const message: OpenAI.Chat.Completions.ChatCompletionMessage = {
        role: 'assistant',
        content: 'Answer',
      };

      const result = (
        provider as unknown as {
          parseNonStreamingReasoning: (
            message: OpenAI.Chat.Completions.ChatCompletionMessage,
          ) => { thinking: ThinkingBlock | null; toolCalls: ToolCallBlock[] };
        }
      ).parseNonStreamingReasoning(message);

      expect(result).not.toBeNull();
      expect(result.thinking).toBeNull();
      expect(result.toolCalls).toHaveLength(0);
    });

    it('should handle Kimi K2 style call IDs with prefixes', () => {
      const message: OpenAI.Chat.Completions.ChatCompletionMessage = {
        role: 'assistant',
        content: 'Done',
        reasoning_content: `<|tool_calls_section_begin|>
<|tool_call_begin|>call_functionsgrep7:call_prefix_123<|tool_call_argument_begin|>{"pattern": "test"}<|tool_call_end|>
<|tool_calls_section_end|>`,
      };

      const result = (
        provider as unknown as {
          parseNonStreamingReasoning: (
            message: OpenAI.Chat.Completions.ChatCompletionMessage,
          ) => { thinking: ThinkingBlock | null; toolCalls: ToolCallBlock[] };
        }
      ).parseNonStreamingReasoning(message);

      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].name).toBe('grep');
    });

    it('should trim whitespace-only thinking in non-streaming mode', () => {
      const message: OpenAI.Chat.Completions.ChatCompletionMessage = {
        role: 'assistant',
        content: 'Answer',
        reasoning_content: `
<|tool_calls_section_begin|>
<|tool_call_begin|>functions.test:call_1<|tool_call_argument_begin|>{}<|tool_call_end|>
<|tool_calls_section_end|>
   `,
      };

      const result = (
        provider as unknown as {
          parseNonStreamingReasoning: (
            message: OpenAI.Chat.Completions.ChatCompletionMessage,
          ) => { thinking: ThinkingBlock | null; toolCalls: ToolCallBlock[] };
        }
      ).parseNonStreamingReasoning(message);

      // After extracting tool calls, only whitespace remains, should be null
      expect(result.thinking).toBeNull();
      expect(result.toolCalls).toHaveLength(1);
    });
  });
});
