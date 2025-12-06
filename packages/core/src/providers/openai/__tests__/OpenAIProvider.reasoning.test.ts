/**
 * Tests for OpenAI provider reasoning/thinking support.
 *
 * @plan PLAN-20251202-THINKING.P10
 * @requirement REQ-THINK-003
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { OpenAIProvider } from '../OpenAIProvider';
import type {
  ThinkingBlock,
  IContent,
} from '../../../services/history/IContent';
import type { NormalizedGenerateChatOptions } from '../../BaseProvider';
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
          ) => ThinkingBlock | null;
        }
      ).parseStreamingReasoningDelta(delta);

      expect(result).not.toBeNull();
      expect(result).toMatchObject({
        type: 'thinking',
        thought: 'Let me think about this problem...',
        sourceField: 'reasoning_content',
      });
    });

    it('should return null when reasoning_content is absent', () => {
      const delta: OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta = {
        content: 'Regular content',
      };

      const result = (
        provider as unknown as {
          parseStreamingReasoningDelta: (
            delta: OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta,
          ) => ThinkingBlock | null;
        }
      ).parseStreamingReasoningDelta(delta);

      expect(result).toBeNull();
    });

    it('should return null when reasoning_content is empty string', () => {
      const delta: OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta = {
        reasoning_content: '',
      };

      const result = (
        provider as unknown as {
          parseStreamingReasoningDelta: (
            delta: OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta,
          ) => ThinkingBlock | null;
        }
      ).parseStreamingReasoningDelta(delta);

      expect(result).toBeNull();
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
          ) => ThinkingBlock | null;
        }
      ).parseStreamingReasoningDelta(delta);

      expect(result).not.toBeNull();
      expect(result).toMatchObject({
        type: 'thinking',
        thought: 'Thinking...',
        sourceField: 'reasoning_content',
      });
    });

    it('should set sourceField to reasoning_content', () => {
      const delta: OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta = {
        reasoning_content: 'Analysis',
      };

      const result = (
        provider as unknown as {
          parseStreamingReasoningDelta: (
            delta: OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta,
          ) => ThinkingBlock | null;
        }
      ).parseStreamingReasoningDelta(delta);

      expect(result).not.toBeNull();
      // Type assertion after verification
      expect(result!.sourceField).toBe('reasoning_content');
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
          ) => ThinkingBlock | null;
        }
      ).parseNonStreamingReasoning(message);

      expect(result).not.toBeNull();
      expect(result).toMatchObject({
        type: 'thinking',
        thought: 'Let me analyze this thoroughly...',
        sourceField: 'reasoning_content',
      });
    });

    it('should return null when reasoning_content is absent', () => {
      const message: OpenAI.Chat.Completions.ChatCompletionMessage = {
        role: 'assistant',
        content: 'Answer',
      };

      const result = (
        provider as unknown as {
          parseNonStreamingReasoning: (
            message: OpenAI.Chat.Completions.ChatCompletionMessage,
          ) => ThinkingBlock | null;
        }
      ).parseNonStreamingReasoning(message);

      expect(result).toBeNull();
    });

    it('should return null when reasoning_content is empty string', () => {
      const message: OpenAI.Chat.Completions.ChatCompletionMessage = {
        role: 'assistant',
        content: 'Answer',
        reasoning_content: '',
      };

      const result = (
        provider as unknown as {
          parseNonStreamingReasoning: (
            message: OpenAI.Chat.Completions.ChatCompletionMessage,
          ) => ThinkingBlock | null;
        }
      ).parseNonStreamingReasoning(message);

      expect(result).toBeNull();
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
          ) => ThinkingBlock | null;
        }
      ).parseNonStreamingReasoning(message);

      expect(result).not.toBeNull();
      expect(result).toMatchObject({
        type: 'thinking',
        thought: 'Need to use a tool...',
        sourceField: 'reasoning_content',
      });
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
          ) => ThinkingBlock | null;
        }
      ).parseNonStreamingReasoning(message);

      expect(result).not.toBeNull();
      // Type assertion after verification
      expect(result!.sourceField).toBe('reasoning_content');
    });
  });

  describe('graceful handling @requirement:REQ-THINK-003.4', () => {
    it('should handle null delta gracefully (streaming)', () => {
      const result = (
        provider as unknown as {
          parseStreamingReasoningDelta: (
            delta: OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta | null,
          ) => ThinkingBlock | null;
        }
      ).parseStreamingReasoningDelta(
        null as unknown as OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta,
      );

      expect(result).toBeNull();
    });

    it('should handle undefined delta gracefully (streaming)', () => {
      const result = (
        provider as unknown as {
          parseStreamingReasoningDelta: (
            delta:
              | OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta
              | undefined,
          ) => ThinkingBlock | null;
        }
      ).parseStreamingReasoningDelta(
        undefined as unknown as OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta,
      );

      expect(result).toBeNull();
    });

    it('should handle null message gracefully (non-streaming)', () => {
      const result = (
        provider as unknown as {
          parseNonStreamingReasoning: (
            message: OpenAI.Chat.Completions.ChatCompletionMessage | null,
          ) => ThinkingBlock | null;
        }
      ).parseNonStreamingReasoning(
        null as unknown as OpenAI.Chat.Completions.ChatCompletionMessage,
      );

      expect(result).toBeNull();
    });

    it('should handle undefined message gracefully (non-streaming)', () => {
      const result = (
        provider as unknown as {
          parseNonStreamingReasoning: (
            message: OpenAI.Chat.Completions.ChatCompletionMessage | undefined,
          ) => ThinkingBlock | null;
        }
      ).parseNonStreamingReasoning(
        undefined as unknown as OpenAI.Chat.Completions.ChatCompletionMessage,
      );

      expect(result).toBeNull();
    });

    it('should handle empty delta object (streaming)', () => {
      const delta: OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta =
        {};

      const result = (
        provider as unknown as {
          parseStreamingReasoningDelta: (
            delta: OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta,
          ) => ThinkingBlock | null;
        }
      ).parseStreamingReasoningDelta(delta);

      expect(result).toBeNull();
    });

    it('should handle minimal message object (non-streaming)', () => {
      const message: OpenAI.Chat.Completions.ChatCompletionMessage = {
        role: 'assistant',
      };

      const result = (
        provider as unknown as {
          parseNonStreamingReasoning: (
            message: OpenAI.Chat.Completions.ChatCompletionMessage,
          ) => ThinkingBlock | null;
        }
      ).parseNonStreamingReasoning(message);

      expect(result).toBeNull();
    });

    it('should handle whitespace-only reasoning_content (streaming)', () => {
      const delta: OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta = {
        reasoning_content: '   \n\t  ',
      };

      const result = (
        provider as unknown as {
          parseStreamingReasoningDelta: (
            delta: OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta,
          ) => ThinkingBlock | null;
        }
      ).parseStreamingReasoningDelta(delta);

      // Whitespace-only should be treated as empty and return null
      expect(result).toBeNull();
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
          ) => ThinkingBlock | null;
        }
      ).parseNonStreamingReasoning(message);

      // Whitespace-only should be treated as empty and return null
      expect(result).toBeNull();
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
      // Empty thinking should result in no reasoning_content or empty reasoning_content
      const hasReasoningContent = 'reasoning_content' in result[0];
      // Verify that if reasoning_content exists, it's empty
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
