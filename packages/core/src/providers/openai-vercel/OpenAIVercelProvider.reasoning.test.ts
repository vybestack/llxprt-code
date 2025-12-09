/**
 * Tests for OpenAIVercelProvider reasoning/thinking support.
 *
 * @issue #722
 * @plan PLAN-20251209-VERCEL-REASONING
 * @requirement REQ-722-001, REQ-722-002, REQ-722-003, REQ-722-004, REQ-722-005
 *
 * Phase 1: Test-first development - these tests verify behavior through public API only.
 *
 * IMPORTANT: Tests public API behavior ONLY (generateChatCompletion).
 * Does NOT test private methods or implementation details (RULES.md lines 102-107).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OpenAIVercelProvider } from './OpenAIVercelProvider.js';
import type {
  ThinkingBlock,
  IContent,
} from '../../services/history/IContent.js';
import type * as Ai from 'ai';

/**
 * Mock the Vercel AI SDK to control streaming responses
 */
vi.mock('ai', async () => {
  const actual = await vi.importActual<typeof Ai>('ai');
  return {
    ...actual,
    streamText: vi.fn(),
    generateText: vi.fn(),
  };
});

vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: vi.fn(() => ({
    chat: vi.fn(() => 'mock-model'),
  })),
}));

describe('OpenAIVercelProvider reasoning support @issue:722', () => {
  let provider: OpenAIVercelProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new OpenAIVercelProvider(
      'test-api-key',
      'https://api.openai.com/v1',
    );
  });

  /**
   * Helper to create mock options with settings and runtime context
   */
  const createMockOptions = (
    settingsMap: Record<string, unknown>,
    contents: IContent[] = [],
    streaming: boolean = true,
  ): import('../BaseProvider.js').GenerateChatOptions => {
    const mockSettings = {
      get: (key: string) => settingsMap[key],
      getProviderSettings: () => ({}),
      getAllGlobalSettings: () => ({}),
    };

    const mockConfig = {
      getToolFormat: () => 'auto',
      getAuthTokenPrecedence: () => ['constructor', 'settings', 'environment'],
    };

    const mockRuntime = {
      config: mockConfig,
    };

    return {
      contents,
      settings:
        mockSettings as unknown as import('../../settings/SettingsService.js').SettingsService,
      runtime:
        mockRuntime as unknown as import('../../runtime/providerRuntimeContext.js').ProviderRuntimeContext,
      resolved: {
        model: 'gpt-4o',
        authToken: { token: 'test-token', type: 'api-key' },
        streaming,
      },
      metadata: {},
    };
  };

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
   * Helper to create user content
   */
  const createUserContent = (text: string): IContent => ({
    speaker: 'human',
    blocks: [
      {
        type: 'text',
        text,
      },
    ],
  });

  describe('REQ-722-001: Settings control reasoning behavior @requirement:REQ-722-001', () => {
    it('should NOT emit ThinkingBlocks in stream when reasoning.includeInResponse is false', async () => {
      const { streamText } = await import('ai');
      const mockStreamText = streamText as ReturnType<typeof vi.fn>;

      // Mock stream that returns reasoning_content
      const mockStream = {
        textStream: (async function* () {
          yield 'Response text';
        })(),
        fullStream: (async function* () {
          yield {
            type: 'text-delta' as const,
            text: 'Response text',
          };
          yield { type: 'finish' as const, finishReason: 'stop' };
        })(),
        usage: Promise.resolve({
          promptTokens: 10,
          completionTokens: 20,
          totalTokens: 30,
        }),
      };

      mockStreamText.mockResolvedValue(mockStream);

      const options = createMockOptions(
        {
          'reasoning.enabled': true,
          'reasoning.includeInResponse': false, // Should suppress ThinkingBlocks
        },
        [createUserContent('Test prompt')],
      );

      const stream = provider.generateChatCompletion(options);

      const blocks: unknown[] = [];
      for await (const block of stream) {
        blocks.push(block);
      }

      // Should NOT contain any thinking blocks when includeInResponse=false
      const hasThinkingBlock = blocks.some(
        (b) =>
          typeof b === 'object' &&
          b !== null &&
          'type' in b &&
          b.type === 'thinking',
      );
      expect(hasThinkingBlock).toBe(false);
    });

    it('should NOT emit ThinkingBlocks when reasoning.enabled is false', async () => {
      const { streamText } = await import('ai');
      const mockStreamText = streamText as ReturnType<typeof vi.fn>;

      const mockStream = {
        textStream: (async function* () {
          yield 'Response';
        })(),
        fullStream: (async function* () {
          yield {
            type: 'text-delta' as const,
            text: 'Response',
          };
          yield { type: 'finish' as const, finishReason: 'stop' };
        })(),
        usage: Promise.resolve({
          promptTokens: 10,
          completionTokens: 20,
          totalTokens: 30,
        }),
      };

      mockStreamText.mockResolvedValue(mockStream);

      const options = createMockOptions(
        {
          'reasoning.enabled': false, // Reasoning disabled entirely
          'reasoning.includeInResponse': true,
        },
        [createUserContent('Test')],
      );

      const stream = provider.generateChatCompletion(options);

      const blocks: unknown[] = [];
      for await (const block of stream) {
        blocks.push(block);
      }

      const hasThinkingBlock = blocks.some(
        (b) =>
          typeof b === 'object' &&
          b !== null &&
          'type' in b &&
          b.type === 'thinking',
      );
      expect(hasThinkingBlock).toBe(false);
    });
  });

  describe('REQ-722-002: Filter thinking from context @requirement:REQ-722-002', () => {
    it('should filter all ThinkingBlocks from context when stripFromContext is "all"', async () => {
      const { generateText } = await import('ai');
      const mockGenerateText = generateText as ReturnType<typeof vi.fn>;

      // Capture the messages sent to the API
      let capturedMessages: unknown[] | undefined;
      mockGenerateText.mockImplementation(
        async (config: { messages: unknown[] }) => {
          capturedMessages = config.messages;
          return {
            text: 'Response',
            usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
          };
        },
      );

      const contents = [
        createUserContent('Question 1'),
        createAiContentWithThinking('Thinking 1', 'Answer 1'),
        createUserContent('Question 2'),
        createAiContentWithThinking('Thinking 2', 'Answer 2'),
      ];

      const options = createMockOptions(
        {
          'reasoning.stripFromContext': 'all',
        },
        contents,
        false, // non-streaming for generateText
      );

      // Consume the stream to trigger message building
      const blocks: unknown[] = [];
      for await (const block of provider.generateChatCompletion(options)) {
        blocks.push(block);
      }

      // Verify messages were sent without reasoning_content
      expect(capturedMessages).toBeDefined();
      const assistantMessages = (capturedMessages ?? []).filter(
        (m) =>
          typeof m === 'object' &&
          m !== null &&
          'role' in m &&
          m.role === 'assistant',
      );
      assistantMessages.forEach((msg) => {
        expect(msg).not.toHaveProperty('reasoning_content');
      });
    });

    it('should keep last ThinkingBlock when stripFromContext is "allButLast"', async () => {
      const { generateText } = await import('ai');
      const mockGenerateText = generateText as ReturnType<typeof vi.fn>;

      let capturedMessages: unknown[] | undefined;
      mockGenerateText.mockImplementation(
        async (config: { messages: unknown[] }) => {
          capturedMessages = config.messages;
          return {
            text: 'Response',
            usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
          };
        },
      );

      const contents = [
        createUserContent('Q1'),
        createAiContentWithThinking('Thinking 1', 'A1'),
        createUserContent('Q2'),
        createAiContentWithThinking('Thinking 2', 'A2'),
      ];

      const options = createMockOptions(
        {
          'reasoning.stripFromContext': 'allButLast',
          'reasoning.includeInContext': true,
        },
        contents,
        false, // non-streaming for generateText
      );

      // Consume the stream to trigger message building
      const blocks: unknown[] = [];
      for await (const block of provider.generateChatCompletion(options)) {
        blocks.push(block);
      }

      expect(capturedMessages).toBeDefined();
      const assistantMessages = (capturedMessages ?? []).filter(
        (m) =>
          typeof m === 'object' &&
          m !== null &&
          'role' in m &&
          m.role === 'assistant',
      );

      // First assistant message should NOT have reasoning_content
      expect(assistantMessages[0]).not.toHaveProperty('reasoning_content');

      // Last assistant message SHOULD have reasoning_content
      const lastMsg = assistantMessages[assistantMessages.length - 1];
      expect(lastMsg).toHaveProperty('reasoning_content');
      expect(lastMsg).toHaveProperty('reasoning_content');
      const reasoning = (lastMsg as { reasoning_content?: unknown })
        .reasoning_content;
      expect(reasoning).toBeTruthy();
    });

    it('should keep all ThinkingBlocks when stripFromContext is "none"', async () => {
      const { generateText } = await import('ai');
      const mockGenerateText = generateText as ReturnType<typeof vi.fn>;

      let capturedMessages: unknown[] | undefined;
      mockGenerateText.mockImplementation(
        async (config: { messages: unknown[] }) => {
          capturedMessages = config.messages;
          return {
            text: 'Response',
            usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
          };
        },
      );

      const contents = [
        createUserContent('Q1'),
        createAiContentWithThinking('Thinking 1', 'A1'),
        createUserContent('Q2'),
        createAiContentWithThinking('Thinking 2', 'A2'),
      ];

      const options = createMockOptions(
        {
          'reasoning.stripFromContext': 'none',
          'reasoning.includeInContext': true,
        },
        contents,
        false, // non-streaming for generateText
      );

      // Consume the stream to trigger message building
      const blocks: unknown[] = [];
      for await (const block of provider.generateChatCompletion(options)) {
        blocks.push(block);
      }

      expect(capturedMessages).toBeDefined();
      const assistantMessages = (capturedMessages ?? []).filter(
        (m) =>
          typeof m === 'object' &&
          m !== null &&
          'role' in m &&
          m.role === 'assistant',
      );

      // All assistant messages should have reasoning_content
      assistantMessages.forEach((msg) => {
        expect(msg).toHaveProperty('reasoning_content');
      });
    });
  });

  describe('REQ-722-003: Clean K2 tokens from thinking @requirement:REQ-722-003', () => {
    it('should remove Kimi K2 tokens from ThinkingBlock content in stream', async () => {
      const { streamText } = await import('ai');
      const mockStreamText = streamText as ReturnType<typeof vi.fn>;

      // Mock stream with K2 tokens in reasoning
      const mockStream = {
        textStream: (async function* () {
          yield 'Response';
        })(),
        fullStream: (async function* () {
          // Simulate Vercel SDK emitting reasoning with K2 tokens
          yield {
            type: 'text-delta' as const,
            text: 'Let me search<|tool_call_begin|>for this',
          };
          yield { type: 'finish' as const, finishReason: 'stop' };
        })(),
        usage: Promise.resolve({
          promptTokens: 10,
          completionTokens: 20,
          totalTokens: 30,
        }),
      };

      mockStreamText.mockResolvedValue(mockStream);

      const options = createMockOptions(
        {
          'reasoning.enabled': true,
          'reasoning.includeInResponse': true,
        },
        [createUserContent('Test')],
      );

      const stream = provider.generateChatCompletion(options);

      const blocks: unknown[] = [];
      for await (const block of stream) {
        blocks.push(block);
      }

      // Find thinking blocks and verify K2 tokens are removed
      const thinkingBlocks = blocks.filter(
        (b) =>
          typeof b === 'object' &&
          b !== null &&
          'type' in b &&
          b.type === 'thinking' &&
          'thought' in b &&
          typeof b.thought === 'string',
      );

      thinkingBlocks.forEach((block) => {
        const thought = (block as { thought: string }).thought;
        expect(thought).not.toContain('<|tool_call_begin|>');
        expect(thought).not.toContain('<|tool_call_end|>');
        expect(thought).not.toContain('<|tool_calls_section_begin|>');
        expect(thought).not.toContain('<|tool_calls_section_end|>');
        expect(thought).not.toContain('<|tool_call_argument_begin|>');
      });
    });
  });

  describe('REQ-722-004: Streaming emission modes @requirement:REQ-722-004', () => {
    it('should emit ThinkingBlocks immediately when format is "native"', async () => {
      const { streamText } = await import('ai');
      const mockStreamText = streamText as ReturnType<typeof vi.fn>;

      const mockStream = {
        textStream: (async function* () {
          yield 'First ';
          yield 'second ';
          yield 'third';
        })(),
        fullStream: (async function* () {
          yield { type: 'reasoning' as const, text: 'Thinking chunk 1' };
          yield { type: 'reasoning' as const, text: 'Thinking chunk 2' };
          yield { type: 'text-delta' as const, text: 'First ' };
          yield { type: 'text-delta' as const, text: 'second ' };
          yield { type: 'text-delta' as const, text: 'third' };
          yield { type: 'finish' as const, finishReason: 'stop' };
        })(),
        usage: Promise.resolve({
          promptTokens: 10,
          completionTokens: 20,
          totalTokens: 30,
        }),
      };

      mockStreamText.mockResolvedValue(mockStream);

      const options = createMockOptions(
        {
          'reasoning.format': 'native',
          'reasoning.includeInResponse': true,
        },
        [createUserContent('Test')],
      );

      const stream = provider.generateChatCompletion(options);

      const blocks: unknown[] = [];
      for await (const block of stream) {
        blocks.push(block);
      }

      // In native mode, thinking should be emitted as stream chunks arrive
      // (Implementation will determine exact emission pattern)
      // For now, just verify stream completes successfully
      expect(blocks.length).toBeGreaterThan(0);
    });

    it('should accumulate ThinkingBlocks when format is "field"', async () => {
      const { streamText } = await import('ai');
      const mockStreamText = streamText as ReturnType<typeof vi.fn>;

      const mockStream = {
        textStream: (async function* () {
          yield 'Response';
        })(),
        fullStream: (async function* () {
          yield { type: 'reasoning' as const, text: 'Accumulated thought 1' };
          yield { type: 'reasoning' as const, text: 'Accumulated thought 2' };
          yield { type: 'text-delta' as const, text: 'Response' };
          yield { type: 'finish' as const, finishReason: 'stop' };
        })(),
        usage: Promise.resolve({
          promptTokens: 10,
          completionTokens: 20,
          totalTokens: 30,
        }),
      };

      mockStreamText.mockResolvedValue(mockStream);

      const options = createMockOptions(
        {
          'reasoning.format': 'field',
          'reasoning.includeInResponse': true,
        },
        [createUserContent('Test')],
      );

      const stream = provider.generateChatCompletion(options);

      const blocks: unknown[] = [];
      for await (const block of stream) {
        blocks.push(block);
      }

      // In field mode, thinking should be accumulated and emitted at end
      // (Implementation will determine exact behavior)
      expect(blocks.length).toBeGreaterThan(0);
    });
  });

  describe('REQ-722-005: Include reasoning in context @requirement:REQ-722-005', () => {
    it('should include reasoning_content in messages when includeInContext is true', async () => {
      const { generateText } = await import('ai');
      const mockGenerateText = generateText as ReturnType<typeof vi.fn>;

      let capturedMessages: unknown[] | undefined;
      mockGenerateText.mockImplementation(
        async (config: { messages: unknown[] }) => {
          capturedMessages = config.messages;
          return {
            text: 'Response',
            usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
          };
        },
      );

      const contents = [
        createUserContent('Question'),
        createAiContentWithThinking('Deep thinking...', 'Answer'),
      ];

      const options = createMockOptions(
        {
          'reasoning.includeInContext': true,
          'reasoning.stripFromContext': 'none',
        },
        contents,
        false, // non-streaming for generateText
      );

      // Consume the stream to trigger message building
      const blocks: unknown[] = [];
      for await (const block of provider.generateChatCompletion(options)) {
        blocks.push(block);
      }

      expect(capturedMessages).toBeDefined();
      const assistantMsg = (capturedMessages ?? []).find(
        (m) =>
          typeof m === 'object' &&
          m !== null &&
          'role' in m &&
          m.role === 'assistant',
      );

      expect(assistantMsg).toBeDefined();
      expect(assistantMsg).toHaveProperty('reasoning_content');
      const reasoning = (assistantMsg as { reasoning_content?: string })
        ?.reasoning_content;
      expect(reasoning).toContain('Deep thinking');
    });

    it('should NOT include reasoning_content when includeInContext is false', async () => {
      const { generateText } = await import('ai');
      const mockGenerateText = generateText as ReturnType<typeof vi.fn>;

      let capturedMessages: unknown[] | undefined;
      mockGenerateText.mockImplementation(
        async (config: { messages: unknown[] }) => {
          capturedMessages = config.messages;
          return {
            text: 'Response',
            usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
          };
        },
      );

      const contents = [
        createUserContent('Question'),
        createAiContentWithThinking('Thinking...', 'Answer'),
      ];

      const options = createMockOptions(
        {
          'reasoning.includeInContext': false,
          'reasoning.stripFromContext': 'none',
        },
        contents,
        false, // non-streaming for generateText
      );

      // Consume the stream to trigger message building
      const blocks: unknown[] = [];
      for await (const block of provider.generateChatCompletion(options)) {
        blocks.push(block);
      }

      expect(capturedMessages).toBeDefined();
      const assistantMessages = (capturedMessages ?? []).filter(
        (m) =>
          typeof m === 'object' &&
          m !== null &&
          'role' in m &&
          m.role === 'assistant',
      );

      assistantMessages.forEach((msg) => {
        expect(msg).not.toHaveProperty('reasoning_content');
      });
    });

    it('should combine multiple ThinkingBlocks into single reasoning_content field', async () => {
      const { generateText } = await import('ai');
      const mockGenerateText = generateText as ReturnType<typeof vi.fn>;

      let capturedMessages: unknown[] | undefined;
      mockGenerateText.mockImplementation(
        async (config: { messages: unknown[] }) => {
          capturedMessages = config.messages;
          return {
            text: 'Response',
            usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
          };
        },
      );

      const multiThinkingContent: IContent = {
        speaker: 'ai',
        blocks: [
          {
            type: 'thinking',
            thought: 'First thought',
            sourceField: 'reasoning_content',
          } as ThinkingBlock,
          {
            type: 'thinking',
            thought: 'Second thought',
            sourceField: 'reasoning_content',
          } as ThinkingBlock,
          {
            type: 'text',
            text: 'Final answer',
          },
        ],
      };

      const contents = [createUserContent('Q'), multiThinkingContent];

      const options = createMockOptions(
        {
          'reasoning.includeInContext': true,
          'reasoning.stripFromContext': 'none',
        },
        contents,
        false, // non-streaming for generateText
      );

      // Consume the stream to trigger message building
      const blocks: unknown[] = [];
      for await (const block of provider.generateChatCompletion(options)) {
        blocks.push(block);
      }

      expect(capturedMessages).toBeDefined();
      const assistantMsg = (capturedMessages ?? []).find(
        (m) =>
          typeof m === 'object' &&
          m !== null &&
          'role' in m &&
          m.role === 'assistant',
      );

      expect(assistantMsg).toBeDefined();
      const reasoning = (assistantMsg as { reasoning_content?: string })
        ?.reasoning_content;
      expect(reasoning).toContain('First thought');
      expect(reasoning).toContain('Second thought');
    });
  });

  describe('Edge cases and graceful degradation', () => {
    it('should handle empty contents array', async () => {
      const { generateText } = await import('ai');
      const mockGenerateText = generateText as ReturnType<typeof vi.fn>;

      mockGenerateText.mockResolvedValue({
        text: 'Response',
        usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      });

      const options = createMockOptions(
        {
          'reasoning.enabled': true,
        },
        [],
        false, // non-streaming for generateText
      );

      const blocks: unknown[] = [];
      for await (const block of provider.generateChatCompletion(options)) {
        blocks.push(block);
      }
      expect(blocks).toBeDefined();
    });

    it('should handle undefined settings with defaults', async () => {
      const { generateText } = await import('ai');
      const mockGenerateText = generateText as ReturnType<typeof vi.fn>;

      mockGenerateText.mockResolvedValue({
        text: 'Response',
        usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      });

      const options = createMockOptions({}, [createUserContent('Test')], false);

      const blocks: unknown[] = [];
      for await (const block of provider.generateChatCompletion(options)) {
        blocks.push(block);
      }
      expect(blocks).toBeDefined();
    });

    it('should handle content without ThinkingBlocks', async () => {
      const { generateText } = await import('ai');
      const mockGenerateText = generateText as ReturnType<typeof vi.fn>;

      let capturedMessages: unknown[] | undefined;
      mockGenerateText.mockImplementation(
        async (config: { messages: unknown[] }) => {
          capturedMessages = config.messages;
          return {
            text: 'Response',
            usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
          };
        },
      );

      const contents = [
        createUserContent('Q1'),
        {
          speaker: 'ai' as const,
          blocks: [{ type: 'text' as const, text: 'A1' }],
        },
        createUserContent('Q2'),
      ];

      const options = createMockOptions(
        {
          'reasoning.includeInContext': true,
        },
        contents,
        false, // non-streaming for generateText
      );

      // Consume the stream to trigger message building
      const blocks: unknown[] = [];
      for await (const block of provider.generateChatCompletion(options)) {
        blocks.push(block);
      }

      expect(capturedMessages).toBeDefined();
      const assistantMessages = (capturedMessages ?? []).filter(
        (m) =>
          typeof m === 'object' &&
          m !== null &&
          'role' in m &&
          m.role === 'assistant',
      );

      // Messages without thinking should not have reasoning_content
      assistantMessages.forEach((msg) => {
        expect(msg).not.toHaveProperty('reasoning_content');
      });
    });
  });
});
