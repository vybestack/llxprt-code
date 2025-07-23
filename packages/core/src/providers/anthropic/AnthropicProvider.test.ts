import { vi, describe, it, expect, beforeEach } from 'vitest';
import { AnthropicProvider } from './AnthropicProvider.js';
import { ITool } from '../ITool.js';
import { ContentGeneratorRole } from '../ContentGeneratorRole.js';
import { IMessage } from '../IMessage.js';

// Mock the ToolFormatter
vi.mock('../../tools/ToolFormatter.js', () => ({
  ToolFormatter: vi.fn().mockImplementation(() => ({
    toProviderFormat: vi.fn((tools: ITool[], format: string) => {
      if (format === 'anthropic') {
        return tools.map((tool) => ({
          name: tool.function.name,
          description: tool.function.description || '',
          input_schema: {
            type: 'object',
            ...tool.function.parameters,
          },
        }));
      }
      return tools;
    }),
    fromProviderFormat: vi.fn((rawToolCall: unknown, format: string) => {
      if (format === 'anthropic') {
        const toolCall = rawToolCall as {
          id: string;
          name: string;
          input?: unknown;
        };
        return [
          {
            id: toolCall.id,
            type: 'function',
            function: {
              name: toolCall.name,
              arguments: toolCall.input ? JSON.stringify(toolCall.input) : '',
            },
          },
        ];
      }
      return [rawToolCall];
    }),
  })),
}));

// Mock the retry utility
vi.mock('../../utils/retry.js', () => ({
  retryWithBackoff: vi.fn(async (fn, options) => {
    let lastError;
    let attempts = 0;
    const maxAttempts = 2;

    while (attempts < maxAttempts) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        attempts++;
        if (
          attempts < maxAttempts &&
          options?.shouldRetry &&
          options.shouldRetry(error)
        ) {
          continue;
        }
        throw error;
      }
    }
    throw lastError;
  }),
}));

// Mock the Anthropic SDK
vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: {
      create: vi.fn(),
    },
    beta: {
      models: {
        list: vi.fn().mockReturnValue({
          async *[Symbol.asyncIterator]() {
            const models = [
              { id: 'claude-opus-4-20250514', display_name: 'Claude 4 Opus' },
              {
                id: 'claude-sonnet-4-20250514',
                display_name: 'Claude 4 Sonnet',
              },
              {
                id: 'claude-3-7-opus-20250115',
                display_name: 'Claude 3.7 Opus',
              },
              {
                id: 'claude-3-7-sonnet-20250115',
                display_name: 'Claude 3.7 Sonnet',
              },
              {
                id: 'claude-3-5-sonnet-20241022',
                display_name: 'Claude 3.5 Sonnet',
              },
              {
                id: 'claude-3-5-haiku-20241022',
                display_name: 'Claude 3.5 Haiku',
              },
              { id: 'claude-3-opus-20240229', display_name: 'Claude 3 Opus' },
              {
                id: 'claude-3-sonnet-20240229',
                display_name: 'Claude 3 Sonnet',
              },
              { id: 'claude-3-haiku-20240307', display_name: 'Claude 3 Haiku' },
            ];
            for (const model of models) {
              yield model;
            }
          },
        }),
      },
    },
  })),
}));

describe('AnthropicProvider', () => {
  let provider: AnthropicProvider;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockAnthropicInstance: any;

  beforeEach(async () => {
    // Clear all mocks before each test
    vi.clearAllMocks();

    // Create provider with test API key
    provider = new AnthropicProvider('test-api-key');

    // Get the mocked Anthropic instance
    const Anthropic = vi.mocked((await import('@anthropic-ai/sdk')).default);
    mockAnthropicInstance = Anthropic.mock.results[0].value;
  });

  describe('getModels', () => {
    it('should return a list of Anthropic models including latest aliases', async () => {
      const models = await provider.getModels();

      expect(models).toHaveLength(11); // 2 latest aliases + 9 specific versions

      // Check for latest aliases
      expect(models.some((m) => m.id === 'claude-opus-4-latest')).toBe(true);
      expect(models.some((m) => m.id === 'claude-sonnet-4-latest')).toBe(true);

      // Check for Claude 4 models
      expect(models.some((m) => m.id === 'claude-opus-4-20250514')).toBe(true);
      expect(models.some((m) => m.id === 'claude-sonnet-4-20250514')).toBe(
        true,
      );

      // Check for Claude 3.7 models
      expect(models.some((m) => m.id === 'claude-3-7-opus-20250115')).toBe(
        true,
      );
      expect(models.some((m) => m.id === 'claude-3-7-sonnet-20250115')).toBe(
        true,
      );

      // Check that all models have correct provider
      models.forEach((model) => {
        expect(model.provider).toBe('anthropic');
        expect(model.supportedToolFormats).toContain('anthropic');
      });
    });

    it('should return models with correct structure', async () => {
      const models = await provider.getModels();

      models.forEach((model) => {
        expect(model).toHaveProperty('id');
        expect(model).toHaveProperty('name');
        expect(model).toHaveProperty('provider');
        expect(model).toHaveProperty('supportedToolFormats');
        expect(model.provider).toBe('anthropic');
        expect(model.supportedToolFormats).toContain('anthropic');
      });
    });
  });

  describe('generateChatCompletion', () => {
    it('should stream content from Anthropic API', async () => {
      // Mock streaming response
      const mockStream = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'content_block_delta',
            delta: { type: 'text_delta', text: 'Hello' },
          };
          yield {
            type: 'content_block_delta',
            delta: { type: 'text_delta', text: ' world' },
          };
        },
      };

      mockAnthropicInstance.messages.create.mockResolvedValue(mockStream);

      const messages: IMessage[] = [
        { role: ContentGeneratorRole.USER, content: 'Say hello' },
      ];
      const generator = provider.generateChatCompletion(messages);

      const chunks = [];
      for await (const chunk of generator) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual([
        { role: 'assistant', content: 'Hello' },
        { role: 'assistant', content: ' world' },
      ]);

      expect(mockAnthropicInstance.messages.create).toHaveBeenCalledWith({
        model: 'claude-sonnet-4-20250514',
        messages: [{ role: 'user', content: 'Say hello' }],
        max_tokens: 64000,
        stream: true,
      });
    });

    it('should handle tool calls in the stream', async () => {
      const mockStream = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'content_block_start',
            content_block: {
              type: 'tool_use',
              id: 'tool-123',
              name: 'get_weather',
            },
          };
          yield {
            type: 'content_block_delta',
            delta: {
              type: 'input_json_delta',
              partial_json: '{"location":"San Francisco"}',
            },
          };
          yield { type: 'content_block_stop' };
          yield {
            type: 'content_block_delta',
            delta: { type: 'text_delta', text: 'Result' },
          };
        },
      };

      mockAnthropicInstance.messages.create.mockResolvedValue(mockStream);

      const messages: IMessage[] = [
        { role: ContentGeneratorRole.USER, content: 'What is the weather?' },
      ];
      const tools = [
        {
          type: 'function' as const,
          function: {
            name: 'get_weather',
            description: 'Get the weather',
            parameters: { type: 'object', properties: {} },
          },
        },
      ];

      const generator = provider.generateChatCompletion(messages, tools);

      const chunks = [];
      for await (const chunk of generator) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual([
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'tool-123',
              type: 'function',
              function: {
                name: 'get_weather',
                arguments: '{"location":"San Francisco"}',
              },
            },
          ],
        },
        { role: 'assistant', content: 'Result' },
      ]);

      expect(mockAnthropicInstance.messages.create).toHaveBeenCalledWith({
        model: 'claude-sonnet-4-20250514',
        messages: [{ role: 'user', content: 'What is the weather?' }],
        max_tokens: 64000,
        stream: true,
        tools: [
          {
            name: 'get_weather',
            description: 'Get the weather',
            input_schema: { type: 'object', properties: {} },
          },
        ],
      });
    });

    it('should handle API errors', async () => {
      mockAnthropicInstance.messages.create.mockRejectedValue(
        new Error('API Error'),
      );

      const messages: IMessage[] = [
        { role: ContentGeneratorRole.USER, content: 'test' },
      ];
      const generator = provider.generateChatCompletion(messages);

      await expect(generator.next()).rejects.toThrow(
        'Anthropic API error: API Error',
      );
    });

    it('should handle usage tracking', async () => {
      const mockStream = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'message_start',
            message: {
              usage: { input_tokens: 10, output_tokens: 0 },
            },
          };
          yield {
            type: 'content_block_delta',
            delta: { type: 'text_delta', text: 'Hello' },
          };
          yield {
            type: 'message_delta',
            usage: { input_tokens: 10, output_tokens: 5 },
          };
          yield {
            type: 'content_block_delta',
            delta: { type: 'text_delta', text: ' world' },
          };
          yield {
            type: 'message_stop',
          };
        },
      };

      mockAnthropicInstance.messages.create.mockResolvedValue(mockStream);

      const messages: IMessage[] = [
        { role: ContentGeneratorRole.USER, content: 'Say hello' },
      ];
      const generator = provider.generateChatCompletion(messages);

      const chunks = [];
      for await (const chunk of generator) {
        chunks.push(chunk);
      }

      // Filter out usage chunks for verification
      const usageChunks = chunks.filter((c) => (c as IMessage).usage);
      expect(usageChunks).toHaveLength(3);

      // Check first usage (from message_start)
      expect((usageChunks[0] as IMessage).usage).toEqual({
        prompt_tokens: 10,
        completion_tokens: 0,
        total_tokens: 10,
      });

      // Check updated usage from message_delta
      expect((usageChunks[1] as IMessage).usage).toEqual({
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
      });

      // Check final usage from message_stop (same as last update)
      expect((usageChunks[2] as IMessage).usage).toEqual({
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
      });
    });

    it('should ignore unknown chunk types', async () => {
      const mockStream = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'content_block_delta',
            delta: { type: 'text_delta', text: 'Hello' },
          };
          yield { type: 'content_block_stop' }; // Should be ignored
          yield { type: 'message_delta' }; // Should be ignored without usage
          yield {
            type: 'content_block_delta',
            delta: { type: 'text_delta', text: ' world' },
          };
        },
      };

      mockAnthropicInstance.messages.create.mockResolvedValue(mockStream);

      const messages: IMessage[] = [
        { role: ContentGeneratorRole.USER, content: 'Say hello' },
      ];
      const generator = provider.generateChatCompletion(messages);

      const chunks = [];
      for await (const chunk of generator) {
        chunks.push(chunk);
      }

      // Filter to only content chunks
      const contentChunks = chunks.filter((c) => (c as IMessage).content);
      expect(contentChunks).toHaveLength(2);
      expect((contentChunks[0] as IMessage).content).toBe('Hello');
      expect((contentChunks[1] as IMessage).content).toBe(' world');
    });

    it('should use ToolFormatter for tool conversion', async () => {
      const mockStream = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'content_block_delta',
            delta: { type: 'text_delta', text: 'Done' },
          };
        },
      };

      mockAnthropicInstance.messages.create.mockResolvedValue(mockStream);

      const tools = [
        {
          type: 'function' as const,
          function: {
            name: 'test_tool',
            description: 'A test tool',
            parameters: {
              type: 'object',
              properties: { foo: { type: 'string' } },
            },
          },
        },
      ];

      const messages: IMessage[] = [
        { role: ContentGeneratorRole.USER, content: 'test' },
      ];
      const generator = provider.generateChatCompletion(messages, tools);

      const chunks = [];
      for await (const chunk of generator) {
        chunks.push(chunk);
      }

      // Verify ToolFormatter was used
      const ToolFormatterMock = vi.mocked(
        (await import('../../tools/ToolFormatter.js')).ToolFormatter,
      );
      const toolFormatterInstance = ToolFormatterMock.mock.results[0].value;

      expect(toolFormatterInstance.toProviderFormat).toHaveBeenCalledWith(
        tools,
        'anthropic',
      );
    });

    it('should retry on rate limit errors', { timeout: 10000 }, async () => {
      // First call fails with overloaded error
      mockAnthropicInstance.messages.create
        .mockRejectedValueOnce(
          new Error(
            'Anthropic API error: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}',
          ),
        )
        .mockResolvedValueOnce({
          async *[Symbol.asyncIterator]() {
            yield {
              type: 'content_block_delta',
              delta: { type: 'text_delta', text: 'Success' },
            };
          },
        });

      const messages: IMessage[] = [
        { role: ContentGeneratorRole.USER, content: 'Test retry' },
      ];
      const generator = provider.generateChatCompletion(messages);

      const chunks = [];
      for await (const chunk of generator) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual([{ role: 'assistant', content: 'Success' }]);

      // Should have been called twice (first failed, second succeeded)
      expect(mockAnthropicInstance.messages.create).toHaveBeenCalledTimes(2);
    });

    it('should not retry on non-retryable errors', async () => {
      mockAnthropicInstance.messages.create.mockRejectedValue(
        new Error('Invalid API key'),
      );

      const messages: IMessage[] = [
        { role: ContentGeneratorRole.USER, content: 'Test' },
      ];
      const generator = provider.generateChatCompletion(messages);

      await expect(generator.next()).rejects.toThrow(
        'Anthropic API error: Invalid API key',
      );

      // Should have only been called once (no retry)
      expect(mockAnthropicInstance.messages.create).toHaveBeenCalledTimes(1);
    });

    it(
      'should validate and fix tool_use/tool_result mismatches on retry',
      { timeout: 10000 },
      async () => {
        // First call fails after partial tool use
        mockAnthropicInstance.messages.create
          .mockRejectedValueOnce(
            new Error(
              'Anthropic API error: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}',
            ),
          )
          .mockResolvedValueOnce({
            async *[Symbol.asyncIterator]() {
              yield {
                type: 'content_block_delta',
                delta: { type: 'text_delta', text: 'Fixed and working' },
              };
            },
          });

        // Messages with a tool call but no tool result (simulating corrupted state)
        const messages: IMessage[] = [
          { role: ContentGeneratorRole.USER, content: 'Test' },
          {
            role: ContentGeneratorRole.ASSISTANT,
            content: '',
            tool_calls: [
              {
                id: 'broken-tool-123',
                type: 'function' as const,
                function: {
                  name: 'test_tool',
                  arguments: '{}',
                },
              },
            ],
          },
          { role: ContentGeneratorRole.USER, content: 'Continue' }, // This would normally cause an error
        ];

        const generator = provider.generateChatCompletion(messages);

        const chunks = [];
        for await (const chunk of generator) {
          chunks.push(chunk);
        }

        expect(chunks).toEqual([
          { role: 'assistant', content: 'Fixed and working' },
        ]);

        // Check the second call had fixed messages
        const secondCallArgs =
          mockAnthropicInstance.messages.create.mock.calls[1][0];
        const anthropicMessages = secondCallArgs.messages;

        // Should have the tool result added automatically
        expect(anthropicMessages).toHaveLength(4);
        expect(anthropicMessages[2]).toEqual({
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'broken-tool-123',
              content: 'Error: Tool execution was interrupted. Please retry.',
            },
          ],
        });
      },
    );
  });
});
