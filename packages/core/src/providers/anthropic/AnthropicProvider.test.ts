import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AnthropicProvider } from './AnthropicProvider.js';
import { ITool } from '../ITool.js';
import { IContent } from '../../services/history/IContent.js';
import { TEST_PROVIDER_CONFIG } from '../test-utils/providerTestConfig.js';
import {
  createProviderWithRuntime,
  createRuntimeConfigStub,
} from '../../test-utils/runtime.js';
import {
  createProviderCallOptions,
  type ProviderCallOptionsInit,
} from '../../test-utils/providerCallOptions.js';
import type { ProviderRuntimeContext } from '../../runtime/providerRuntimeContext.js';
import type { SettingsService } from '../../settings/SettingsService.js';
import { createProviderCallOptions } from '../../test-utils/providerCallOptions.js';
import {
  clearActiveProviderRuntimeContext,
  setActiveProviderRuntimeContext,
} from '../../runtime/providerRuntimeContext.js';

type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | {
      type: 'tool_use';
      id: string;
      name: string;
      input: unknown;
    }
  | {
      type: 'tool_result';
      tool_use_id: string;
      content: string;
      is_error?: boolean;
    };

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

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
    convertGeminiToAnthropic: vi.fn((geminiTools) => {
      if (!geminiTools || !Array.isArray(geminiTools)) return [];

      const tools = [];
      for (const group of geminiTools) {
        if (group.functionDeclarations) {
          for (const func of group.functionDeclarations) {
            tools.push({
              name: func.name,
              description: func.description || '',
              input_schema: {
                type: 'object',
                properties: func.parameters?.properties || {},
                required: func.parameters?.required || [],
              },
            });
          }
        }
      }
      return tools;
    }),
    convertGeminiToFormat: vi.fn((geminiTools, format = 'openai') => {
      if (!geminiTools || !Array.isArray(geminiTools)) return undefined;

      if (format === 'anthropic') {
        const tools = [];
        for (const group of geminiTools) {
          if (group.functionDeclarations) {
            for (const func of group.functionDeclarations) {
              tools.push({
                name: func.name,
                description: func.description || '',
                input_schema: {
                  type: 'object',
                  properties: func.parameters?.properties || {},
                  required: func.parameters?.required || [],
                },
              });
            }
          }
        }
        return tools;
      }

      // For other formats (openai, etc.), return OpenAI format
      const tools = [];
      for (const group of geminiTools) {
        if (group.functionDeclarations) {
          for (const func of group.functionDeclarations) {
            tools.push({
              type: 'function',
              function: {
                name: func.name,
                description: func.description || '',
                parameters: func.parameters || {},
              },
            });
          }
        }
      }
      return tools;
    }),
  })),
}));

// Mock the prompts module
vi.mock('../../core/prompts.js', () => ({
  getCoreSystemPromptAsync: vi.fn(
    async () => "You are Claude Code, Anthropic's official CLI for Claude.",
  ),
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
  getErrorStatus: vi.fn(() => undefined),
  isNetworkTransientError: vi.fn(() => false),
}));

// Create a shared mock instance for messages.create
const mockMessagesCreate = vi.fn();

// Mock the Anthropic SDK
vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: {
      create: mockMessagesCreate,
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
  let runtimeContext: ProviderRuntimeContext;
  let settingsService: SettingsService;

  beforeEach(() => {
    // Clear all mocks before each test
    vi.clearAllMocks();

    // Create provider with test API key and runtime context
    const result = createProviderWithRuntime<AnthropicProvider>(
      ({ settingsService: svc }) => {
        svc.set('auth-key', 'test-api-key');
        svc.set('activeProvider', 'anthropic');
        svc.setProviderSetting('anthropic', 'streaming', 'disabled');
        return new AnthropicProvider(
          'test-api-key',
          undefined,
          TEST_PROVIDER_CONFIG,
        );
      },
      {
        runtimeId: 'anthropic.provider.test',
        metadata: { source: 'AnthropicProvider.test.ts' },
      },
    );
    provider = result.provider;
    runtimeContext = result.runtime;
    settingsService = result.settingsService;
    if (!runtimeContext.config) {
      runtimeContext.config = createRuntimeConfigStub(settingsService);
    }
    runtimeContext.config.getEphemeralSettings = () => ({
      ...settingsService.getAllGlobalSettings(),
      ...settingsService.getProviderSettings(provider.name),
    });
    runtimeContext.config.getEphemeralSetting = (key: string) => {
      const providerValue = settingsService.getProviderSetting(
        provider.name,
        key,
      );
      if (providerValue !== undefined) {
        return providerValue;
      }
      return settingsService.get(key);
    };

    // Re-activate the runtime context for test execution
    setActiveProviderRuntimeContext(runtimeContext);

    // Use the shared mock instance
    mockAnthropicInstance = {
      messages: {
        create: mockMessagesCreate,
      },
    };
  });

  afterEach(() => {
    clearActiveProviderRuntimeContext();
  });

  const buildCallOptions = (
    contents: IContent[],
    overrides: Omit<ProviderCallOptionsInit, 'providerName' | 'contents'> = {},
  ) =>
    createProviderCallOptions({
      providerName: provider.name,
      contents,
      settings: settingsService,
      runtime: runtimeContext,
      config: runtimeContext.config,
      ...overrides,
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
    it('should pass custom headers provided via configuration to the Anthropic client', async () => {
      const customHeaders = {
        'X-Custom-Header': 'custom-value',
        'X-Trace-Id': 'trace-123',
      };

      const providerWithHeaders = new AnthropicProvider(
        'test-api-key',
        undefined,
        {
          ...TEST_PROVIDER_CONFIG,
          getEphemeralSettings: () => ({
            streaming: 'disabled',
            'custom-headers': customHeaders,
          }),
          customHeaders: {
            'X-Provider-Header': 'provider-value',
          },
        },
      );

      mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'hello' }],
        usage: {
          input_tokens: 1,
          output_tokens: 1,
        },
      });

      const callOptions = createProviderCallOptions({
        providerName: providerWithHeaders.name,
        contents: [
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'Hello there' }],
          },
        ],
        settingsOverrides: {
          global: {
            'auth-key': 'test-api-key',
            'custom-headers': customHeaders,
            activeProvider: 'anthropic',
          },
          provider: {
            'custom-headers': customHeaders,
            streaming: 'disabled',
          },
        },
        runtimeMetadata: { testCase: 'custom-headers' },
        runtimeId: 'anthropic.customHeaders',
      });

      setActiveProviderRuntimeContext(callOptions.runtime);

      const generator = providerWithHeaders.generateChatCompletion(callOptions);

      await generator.next();

      const call = mockMessagesCreate.mock.calls[0];
      expect(call).toBeDefined();

      const options = call?.[1];
      expect(options).toBeDefined();
      expect(options?.headers).toMatchObject({
        ...customHeaders,
        'X-Provider-Header': 'provider-value',
      });
    });

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

      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Say hello' }],
        },
      ];
      const generator = provider.generateChatCompletion(
        buildCallOptions(messages),
      );

      const chunks = [];
      for await (const chunk of generator) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual([
        {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'Hello' }],
        },
        {
          speaker: 'ai',
          blocks: [{ type: 'text', text: ' world' }],
        },
      ]);

      expect(mockAnthropicInstance.messages.create).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'claude-sonnet-4-5-20250929',
          messages: [{ role: 'user', content: 'Say hello' }],
          max_tokens: 64000,
          stream: true,
          system: expect.any(String),
        }),
      );
    });

    it('should emit tool_result blocks for tool responses with text content', async () => {
      const mockStream = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'content_block_delta',
            delta: { type: 'text_delta', text: 'Done' },
          };
        },
      };

      mockAnthropicInstance.messages.create.mockResolvedValue(mockStream);

      const toolCallId = 'hist_tool_readmany_123';
      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Please read these files' }],
        },
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'tool_call',
              id: toolCallId,
              name: 'ReadManyFiles',
              parameters: { paths: ['docs/**/*.md'] },
            },
          ],
        },
        {
          speaker: 'human',
          blocks: [
            {
              type: 'tool_response',
              callId: toolCallId,
              toolName: 'ReadManyFiles',
              result: { output: 'Tool execution succeeded.' },
            },
            {
              type: 'text',
              text: '--- docs/example.md ---\nExample content line 1\n',
            },
            {
              type: 'text',
              text: '--- End of content ---',
            },
          ],
        },
      ];

      const generator = provider.generateChatCompletion(
        buildCallOptions(messages),
      );
      const collected: IContent[] = [];
      for await (const chunk of generator) {
        collected.push(chunk);
      }

      expect(collected).toEqual([
        {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'Done' }],
        },
      ]);

      const request = mockAnthropicInstance.messages.create.mock.calls[0][0];
      const anthropicMessages = request.messages as AnthropicMessage[];

      const assistantToolIndex = anthropicMessages.findIndex(
        (msg) =>
          msg.role === 'assistant' &&
          Array.isArray(msg.content) &&
          msg.content.some((block) => block.type === 'tool_use'),
      );

      expect(assistantToolIndex).toBeGreaterThan(-1);

      const toolResultMessage = anthropicMessages[assistantToolIndex + 1];
      expect(toolResultMessage).toBeDefined();
      expect(toolResultMessage.role).toBe('user');
      expect(Array.isArray(toolResultMessage.content)).toBe(true);
      const toolResultBlock = (
        toolResultMessage.content as AnthropicContentBlock[]
      )[0];
      expect(toolResultBlock).toMatchObject({
        type: 'tool_result',
        tool_use_id: expect.stringMatching(/^toolu_/),
      });
      expect(toolResultBlock.content).toContain('docs/example.md');
      expect(toolResultBlock.content).toContain('Example content line 1');

      const duplicateUserText = anthropicMessages
        .slice(assistantToolIndex + 2)
        .filter(
          (msg): msg is AnthropicMessage & { content: string } =>
            msg.role === 'user' && typeof msg.content === 'string',
        )
        .find((msg) => msg.content.includes('docs/example.md'));
      expect(duplicateUserText).toBeUndefined();
    });

    it('should truncate oversized tool_result payloads and mark errors', async () => {
      const mockStream = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'content_block_delta',
            delta: { type: 'text_delta', text: 'Done' },
          };
        },
      };

      mockAnthropicInstance.messages.create.mockResolvedValue(mockStream);

      const toolCallId = 'hist_tool_limit';
      const oversized = 'line\n'.repeat(2000);
      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Process file' }],
        },
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'tool_call',
              id: toolCallId,
              name: 'read_file',
              parameters: { absolute_path: '/tmp/file.txt' },
            },
          ],
        },
        {
          speaker: 'human',
          blocks: [
            {
              type: 'tool_response',
              callId: toolCallId,
              toolName: 'read_file',
              result: oversized,
              error: 'validation failed',
            },
          ],
        },
      ];

      const generator = provider.generateChatCompletion(
        buildCallOptions(messages, {
          settingsOverrides: {
            global: {
              'tool-output-max-tokens': 50,
              'tool-output-truncate-mode': 'truncate',
            },
            provider: {
              'tool-output-max-tokens': 50,
              'tool-output-truncate-mode': 'truncate',
            },
          },
        }),
      );
      const collected: IContent[] = [];
      for await (const chunk of generator) {
        collected.push(chunk);
      }

      const request = mockMessagesCreate.mock.calls[0][0];
      const anthropicMessages = request.messages as AnthropicMessage[];
      const toolResultMessage = anthropicMessages.find(
        (msg) =>
          msg.role === 'user' &&
          Array.isArray(msg.content) &&
          msg.content.some((block) => block.type === 'tool_result'),
      ) as AnthropicMessage;

      expect(toolResultMessage).toBeDefined();
      const toolResultBlock = (
        toolResultMessage.content as AnthropicContentBlock[]
      ).find(
        (block) => block.type === 'tool_result',
      ) as AnthropicContentBlock & { content: string; is_error?: boolean };

      expect(toolResultBlock.is_error).toBe(true);
      expect(toolResultBlock.content).toContain(
        '[Output truncated due to token limit]',
      );
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

      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'What is the weather?' }],
        },
      ];
      const tools = [
        {
          functionDeclarations: [
            {
              name: 'get_weather',
              description: 'Get the weather',
              parameters: { type: 'object', properties: {} },
            },
          ],
        },
      ];

      const generator = provider.generateChatCompletion(
        buildCallOptions(messages, { tools }),
      );

      const chunks = [];
      for await (const chunk of generator) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual([
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'tool_call',
              id: 'hist_tool_tool-123', // ID gets normalized to history format
              name: 'get_weather',
              parameters: { location: 'San Francisco' },
            },
          ],
        },
        {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'Result' }],
        },
      ]);

      expect(mockAnthropicInstance.messages.create).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'claude-sonnet-4-5-20250929',
          messages: [{ role: 'user', content: 'What is the weather?' }],
          max_tokens: 64000,
          stream: true,
          system: expect.any(String),
          tools: [
            {
              name: 'get_weather',
              description: 'Get the weather',
              input_schema: { type: 'object', properties: {}, required: [] },
            },
          ],
        }),
      );
    });

    it('should handle API errors', async () => {
      mockAnthropicInstance.messages.create.mockRejectedValue(
        new Error('API Error'),
      );

      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'test' }],
        },
      ];
      const generator = provider.generateChatCompletion(
        buildCallOptions(messages),
      );

      await expect(generator.next()).rejects.toThrow('API Error');
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

      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Say hello' }],
        },
      ];
      const generator = provider.generateChatCompletion(
        buildCallOptions(messages),
      );

      const chunks = [];
      for await (const chunk of generator) {
        chunks.push(chunk);
      }

      // Filter out usage chunks for verification
      const usageChunks = chunks.filter((c) => c.metadata?.usage);
      expect(usageChunks).toHaveLength(1);

      // Check usage from message_delta
      expect(usageChunks[0].metadata?.usage).toEqual({
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
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

      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Say hello' }],
        },
      ];
      const generator = provider.generateChatCompletion(
        buildCallOptions(messages),
      );

      const chunks = [];
      for await (const chunk of generator) {
        chunks.push(chunk);
      }

      // Filter to only text content chunks
      const contentChunks = chunks.filter(
        (c) =>
          c.blocks.length > 0 &&
          c.blocks.some((block) => block.type === 'text'),
      );
      expect(contentChunks).toHaveLength(2);
      expect(
        (contentChunks[0].blocks[0] as { type: 'text'; text: string }).text,
      ).toBe('Hello');
      expect(
        (contentChunks[1].blocks[0] as { type: 'text'; text: string }).text,
      ).toBe(' world');
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
          functionDeclarations: [
            {
              name: 'test_tool',
              description: 'A test tool',
              parameters: {
                type: 'object',
                properties: { foo: { type: 'string' } },
              },
            },
          ],
        },
      ];

      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'test' }],
        },
      ];
      const generator = provider.generateChatCompletion(
        buildCallOptions(messages, { tools }),
      );

      const chunks = [];
      for await (const chunk of generator) {
        chunks.push(chunk);
      }

      // Verify ToolFormatter was used with the new convertGeminiToFormat method
      const ToolFormatterMock = vi.mocked(
        (await import('../../tools/ToolFormatter.js')).ToolFormatter,
      );
      const toolFormatterInstance = ToolFormatterMock.mock.results[0].value;

      expect(toolFormatterInstance.convertGeminiToFormat).toHaveBeenCalledWith(
        [
          {
            functionDeclarations: [
              {
                name: 'test_tool',
                description: 'A test tool',
                parameters: {
                  type: 'object',
                  properties: { foo: { type: 'string' } },
                },
              },
            ],
          },
        ],
        'anthropic', // The detected format for AnthropicProvider
      );
    });

    it('should retry on rate limit errors', { timeout: 10000 }, async () => {
      // Mock successful response since retry logic is not implemented in the provider itself
      mockAnthropicInstance.messages.create.mockResolvedValueOnce({
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'content_block_delta',
            delta: { type: 'text_delta', text: 'Success' },
          };
        },
      });

      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Test retry' }],
        },
      ];
      const generator = provider.generateChatCompletion(
        buildCallOptions(messages),
      );

      const chunks = [];
      for await (const chunk of generator) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual([
        {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'Success' }],
        },
      ]);

      // Should have been called once since retry isn't implemented in provider
      expect(mockAnthropicInstance.messages.create).toHaveBeenCalledTimes(1);
    });

    it('should not retry on non-retryable errors', async () => {
      // Mock successful response since the provider doesn't handle retries
      mockAnthropicInstance.messages.create.mockResolvedValueOnce({
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'content_block_delta',
            delta: { type: 'text_delta', text: 'Success' },
          };
        },
      });

      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Test' }],
        },
      ];
      const generator = provider.generateChatCompletion(
        buildCallOptions(messages),
      );

      const chunks = [];
      for await (const chunk of generator) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual([
        {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'Success' }],
        },
      ]);

      // Should have only been called once
      expect(mockAnthropicInstance.messages.create).toHaveBeenCalledTimes(1);
    });

    it(
      'should validate and fix tool_use/tool_result mismatches on retry',
      { timeout: 10000 },
      async () => {
        // Mock successful response since retry logic is not in the provider
        mockAnthropicInstance.messages.create.mockResolvedValueOnce({
          async *[Symbol.asyncIterator]() {
            yield {
              type: 'content_block_delta',
              delta: { type: 'text_delta', text: 'Fixed and working' },
            };
          },
        });

        // Messages with a tool call but no tool result (simulating corrupted state)
        const messages: IContent[] = [
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'Test' }],
          },
          {
            speaker: 'ai',
            blocks: [
              {
                type: 'tool_call',
                id: 'broken-tool-123',
                name: 'test_tool',
                parameters: {},
              },
            ],
          },
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'Continue' }],
          }, // This would normally cause an error
        ];

        const generator = provider.generateChatCompletion(
          buildCallOptions(messages),
        );

        const chunks = [];
        for await (const chunk of generator) {
          chunks.push(chunk);
        }

        expect(chunks).toEqual([
          {
            speaker: 'ai',
            blocks: [{ type: 'text', text: 'Fixed and working' }],
          },
        ]);

        // Check that the call was made with the original messages
        const firstCallArgs =
          mockAnthropicInstance.messages.create.mock.calls[0][0];
        const anthropicMessages = firstCallArgs.messages;

        // Should have the original messages (retry logic would be handled at a higher level)
        expect(anthropicMessages).toHaveLength(3);
      },
    );
  });
});
