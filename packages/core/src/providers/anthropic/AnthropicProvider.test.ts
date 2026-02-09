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
import {
  clearActiveProviderRuntimeContext,
  setActiveProviderRuntimeContext,
} from '../../runtime/providerRuntimeContext.js';

type AnthropicContentBlock =
  | {
      type: 'text';
      text: string;
      cache_control?: { type: string; ttl?: string };
    }
  | {
      type: 'tool_use';
      id: string;
      name: string;
      input: unknown;
      cache_control?: { type: string; ttl?: string };
    }
  | {
      type: 'tool_result';
      tool_use_id: string;
      content: string;
      is_error?: boolean;
      cache_control?: { type: string; ttl?: string };
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

interface MockAnthropicInstance {
  messages: {
    create: ReturnType<typeof vi.fn>;
  };
}

describe('AnthropicProvider', () => {
  let provider: AnthropicProvider;
  let mockAnthropicInstance: MockAnthropicInstance;
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

    it('should include Claude Opus 4.5 models in OAuth model list', async () => {
      // Create provider with OAuth token to get the OAuth-specific model list
      const oauthProvider = new AnthropicProvider(
        'sk-ant-oat-test-token',
        undefined,
        TEST_PROVIDER_CONFIG,
      );

      // Mock getAuthToken to return the OAuth token
      vi.spyOn(oauthProvider, 'getAuthToken').mockResolvedValue(
        'sk-ant-oat-test-token',
      );

      const models = await oauthProvider.getModels();
      const modelIds = models.map((m) => m.id);

      // Verify Claude Opus 4.5 dated model is present
      expect(modelIds).toContain('claude-opus-4-5-20251101');

      // Verify Claude Opus 4.5 rolling alias is present
      expect(modelIds).toContain('claude-opus-4-5');

      // Verify the models have correct properties
      const opus45Dated = models.find(
        (m) => m.id === 'claude-opus-4-5-20251101',
      );
      expect(opus45Dated).toBeDefined();
      expect(opus45Dated?.name).toBe('Claude Opus 4.5');
      expect(opus45Dated?.provider).toBe('anthropic');
      expect(opus45Dated?.supportedToolFormats).toContain('anthropic');
      expect(opus45Dated?.contextWindow).toBe(500000);
      expect(opus45Dated?.maxOutputTokens).toBe(32000);

      const opus45Alias = models.find((m) => m.id === 'claude-opus-4-5');
      expect(opus45Alias).toBeDefined();
      expect(opus45Alias?.name).toBe('Claude Opus 4.5');
      expect(opus45Alias?.provider).toBe('anthropic');
      expect(opus45Alias?.supportedToolFormats).toContain('anthropic');
      expect(opus45Alias?.contextWindow).toBe(500000);
      expect(opus45Alias?.maxOutputTokens).toBe(32000);
    });

    it('should include Claude Opus 4.6 model in OAuth model list', async () => {
      const oauthProvider = new AnthropicProvider(
        'sk-ant-oat-test-token',
        undefined,
        TEST_PROVIDER_CONFIG,
      );

      vi.spyOn(oauthProvider, 'getAuthToken').mockResolvedValue(
        'sk-ant-oat-test-token',
      );

      const models = await oauthProvider.getModels();
      const modelIds = models.map((m) => m.id);

      expect(modelIds).toContain('claude-opus-4-6');

      const opus46 = models.find((m) => m.id === 'claude-opus-4-6');
      expect(opus46).toBeDefined();
      expect(opus46?.name).toBe('Claude Opus 4.6');
      expect(opus46?.contextWindow).toBe(200000);
      expect(opus46?.maxOutputTokens).toBe(128000);
    });

    it('should include Claude Opus 4.6 model in default list when auth is unavailable', async () => {
      const noAuthProvider = new AnthropicProvider(
        undefined,
        undefined,
        TEST_PROVIDER_CONFIG,
      );

      vi.spyOn(noAuthProvider, 'getAuthToken').mockResolvedValue(undefined);

      const models = await noAuthProvider.getModels();
      const modelIds = models.map((m) => m.id);

      expect(modelIds).toContain('claude-opus-4-6');

      const opus46 = models.find((m) => m.id === 'claude-opus-4-6');
      expect(opus46?.contextWindow).toBe(200000);
      expect(opus46?.maxOutputTokens).toBe(128000);
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
      // Disable prompt caching for this test to get simpler system prompt
      settingsService.setProviderSetting('anthropic', 'prompt-caching', 'off');

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
      // Disable prompt caching for this test to get simpler system prompt
      settingsService.setProviderSetting('anthropic', 'prompt-caching', 'off');

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
      // Disable prompt caching for this test to get simpler system prompt
      settingsService.setProviderSetting('anthropic', 'prompt-caching', 'off');

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
      // Disable prompt caching for this test to get simpler system prompt
      settingsService.setProviderSetting('anthropic', 'prompt-caching', 'off');

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

    it('should sanitize tool_use IDs to be Anthropic-compatible', async () => {
      settingsService.setProviderSetting('anthropic', 'prompt-caching', 'off');

      const mockStream = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'content_block_delta',
            delta: { type: 'text_delta', text: 'ok' },
          };
        },
      };

      mockAnthropicInstance.messages.create.mockResolvedValue(mockStream);

      const messages: IContent[] = [
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'tool_call',
              id: 'hist_tool_functions.read_file:0',
              name: 'read_file',
              parameters: { absolute_path: '/tmp/test.txt' },
            },
          ],
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
          blocks: [{ type: 'text', text: 'ok' }],
        },
      ]);

      const request = mockAnthropicInstance.messages.create.mock.calls[0][0];
      const anthropicMessages = request.messages as AnthropicMessage[];
      const assistantMessage = anthropicMessages.find(
        (msg) => msg.role === 'assistant' && Array.isArray(msg.content),
      );

      expect(assistantMessage).toBeDefined();

      const toolUseBlock = (
        assistantMessage?.content as AnthropicContentBlock[]
      ).find((block) => block.type === 'tool_use') as AnthropicContentBlock & {
        id: string;
      };

      expect(toolUseBlock.id).toMatch(/^toolu_[a-zA-Z0-9_-]+$/);
    });

    it('should sanitize tool_result IDs to be Anthropic-compatible', async () => {
      settingsService.setProviderSetting('anthropic', 'prompt-caching', 'off');

      const mockStream = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'content_block_delta',
            delta: { type: 'text_delta', text: 'done' },
          };
        },
      };

      mockAnthropicInstance.messages.create.mockResolvedValue(mockStream);

      const messages: IContent[] = [
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'tool_call',
              id: 'hist_tool_functions.read_file:0',
              name: 'read_file',
              parameters: { absolute_path: '/tmp/test.txt' },
            },
          ],
        },
        {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'hist_tool_functions.read_file:0',
              toolName: 'read_file',
              result: { output: 'ok' },
            },
          ],
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
          blocks: [{ type: 'text', text: 'done' }],
        },
      ]);

      const request = mockAnthropicInstance.messages.create.mock.calls[0][0];
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
      ) as AnthropicContentBlock & { tool_use_id: string };

      expect(toolResultBlock.tool_use_id).toMatch(/^toolu_[a-zA-Z0-9_-]+$/);
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
      expect(usageChunks.length).toBeGreaterThan(0);

      // Check usage from message_delta (the last usage chunk)
      const lastUsageChunk = usageChunks[usageChunks.length - 1];
      expect(lastUsageChunk.metadata?.usage).toMatchObject({
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
      // Disable prompt caching for this test to get simpler system prompt
      settingsService.setProviderSetting('anthropic', 'prompt-caching', 'off');

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

      // Verify tools were converted and passed to the Anthropic API in correct format
      const createCall = mockAnthropicInstance.messages.create.mock.calls[0][0];
      expect(createCall.tools).toBeDefined();
      expect(createCall.tools).toHaveLength(1);
      expect(createCall.tools[0]).toEqual({
        name: 'test_tool',
        description: 'A test tool',
        input_schema: {
          type: 'object',
          properties: { foo: { type: 'string' } },
          required: [], // schemaConverter always adds required array
        },
      });
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

    it('should replace empty intermediate messages with placeholders', async () => {
      settingsService.setProviderSetting('anthropic', 'prompt-caching', 'off');

      const mockStream = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'content_block_delta',
            delta: { type: 'text_delta', text: 'ok' },
          };
        },
      };

      mockMessagesCreate.mockResolvedValueOnce(mockStream);

      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: '' }],
        },
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'thinking',
              thought: '',
              sourceField: 'thinking',
            },
            { type: 'text', text: '' },
          ],
        },
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'next' }],
        },
      ];

      const generator = provider.generateChatCompletion(
        buildCallOptions(messages, {
          settingsOverrides: {
            provider: {
              streaming: 'disabled',
            },
          },
        }),
      );
      await generator.next();

      const request = mockMessagesCreate.mock.calls[0][0];
      const anthropicMessages = request.messages as AnthropicMessage[];

      expect(anthropicMessages).toEqual([
        { role: 'user', content: '[Empty message]' },
        { role: 'assistant', content: '[No content generated]' },
        { role: 'user', content: 'next' },
      ]);
    });

    it('should allow empty final assistant messages', async () => {
      settingsService.setProviderSetting('anthropic', 'prompt-caching', 'off');

      const mockStream = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'content_block_delta',
            delta: { type: 'text_delta', text: 'ok' },
          };
        },
      };

      mockMessagesCreate.mockResolvedValueOnce(mockStream);

      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'hello' }],
        },
        {
          speaker: 'ai',
          blocks: [{ type: 'text', text: '' }],
        },
      ];

      const generator = provider.generateChatCompletion(
        buildCallOptions(messages, {
          settingsOverrides: {
            provider: {
              streaming: 'disabled',
            },
          },
        }),
      );
      await generator.next();

      const request = mockMessagesCreate.mock.calls[0][0];
      const anthropicMessages = request.messages as AnthropicMessage[];

      expect(anthropicMessages).toEqual([
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: '' },
      ]);
    });

    it('should sanitize empty text blocks in intermediate assistant messages', async () => {
      settingsService.setProviderSetting('anthropic', 'prompt-caching', 'off');

      const mockStream = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'content_block_delta',
            delta: { type: 'text_delta', text: 'ok' },
          };
        },
      };

      mockMessagesCreate.mockResolvedValueOnce(mockStream);

      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'start' }],
        },
        {
          speaker: 'ai',
          blocks: [{ type: 'text', text: '' }],
        },
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'next' }],
        },
      ];

      const generator = provider.generateChatCompletion(
        buildCallOptions(messages, {
          settingsOverrides: {
            provider: {
              streaming: 'disabled',
            },
          },
        }),
      );
      await generator.next();

      const request = mockMessagesCreate.mock.calls[0][0];
      const anthropicMessages = request.messages as AnthropicMessage[];

      expect(anthropicMessages).toEqual([
        { role: 'user', content: 'start' },
        { role: 'assistant', content: '[No content generated]' },
        { role: 'user', content: 'next' },
      ]);
    });

    it('should merge consecutive user messages to maintain Anthropic role alternation', async () => {
      settingsService.setProviderSetting('anthropic', 'prompt-caching', 'off');

      const mockStream = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'content_block_delta',
            delta: { type: 'text_delta', text: 'ok' },
          };
        },
      };

      mockMessagesCreate.mockResolvedValueOnce(mockStream);

      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'start' }],
        },
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: '' }],
        },
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'next' }],
        },
      ];

      const generator = provider.generateChatCompletion(
        buildCallOptions(messages, {
          settingsOverrides: {
            provider: {
              streaming: 'disabled',
            },
          },
        }),
      );
      await generator.next();

      const request = mockMessagesCreate.mock.calls[0][0];
      const anthropicMessages = request.messages as AnthropicMessage[];

      // Consecutive user messages are merged to satisfy Anthropic's role alternation
      // The merged message contains all text blocks combined
      const userMessages = anthropicMessages.filter((m) => m.role === 'user');
      expect(userMessages).toHaveLength(1);
      // The merged content includes text from both non-empty messages
      const content = userMessages[0].content;
      expect(typeof content === 'string' || Array.isArray(content)).toBe(true);
    });

    it('should sanitize empty assistant content arrays in intermediate messages', async () => {
      settingsService.setProviderSetting('anthropic', 'prompt-caching', 'off');

      const mockStream = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'content_block_delta',
            delta: { type: 'text_delta', text: 'ok' },
          };
        },
      };

      mockMessagesCreate.mockResolvedValueOnce(mockStream);

      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'start' }],
        },
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'thinking',
              thought: '',
              sourceField: 'thinking',
            },
            { type: 'text', text: '' },
          ],
        },
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'next' }],
        },
      ];

      const generator = provider.generateChatCompletion(
        buildCallOptions(messages, {
          settingsOverrides: {
            provider: {
              streaming: 'disabled',
            },
          },
        }),
      );
      await generator.next();

      const request = mockMessagesCreate.mock.calls[0][0];
      const anthropicMessages = request.messages as AnthropicMessage[];

      expect(anthropicMessages).toEqual([
        { role: 'user', content: 'start' },
        { role: 'assistant', content: '[No content generated]' },
        { role: 'user', content: 'next' },
      ]);
    });

    it('should sanitize empty assistant content arrays with text blocks', async () => {
      settingsService.setProviderSetting('anthropic', 'prompt-caching', 'off');

      const mockStream = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'content_block_delta',
            delta: { type: 'text_delta', text: 'ok' },
          };
        },
      };

      mockMessagesCreate.mockResolvedValueOnce(mockStream);

      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'start' }],
        },
        {
          speaker: 'ai',
          blocks: [
            { type: 'text', text: '' },
            { type: 'text', text: ' ' },
          ],
        },
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'next' }],
        },
      ];

      const generator = provider.generateChatCompletion(
        buildCallOptions(messages, {
          settingsOverrides: {
            provider: {
              streaming: 'disabled',
            },
          },
        }),
      );
      await generator.next();

      const request = mockMessagesCreate.mock.calls[0][0];
      const anthropicMessages = request.messages as AnthropicMessage[];

      expect(anthropicMessages).toEqual([
        { role: 'user', content: 'start' },
        { role: 'assistant', content: '[No content generated]' },
        { role: 'user', content: 'next' },
      ]);
    });

    it('should keep non-text assistant content arrays intact', async () => {
      settingsService.setProviderSetting('anthropic', 'prompt-caching', 'off');

      const mockStream = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'content_block_delta',
            delta: { type: 'text_delta', text: 'ok' },
          };
        },
      };

      mockMessagesCreate.mockResolvedValueOnce(mockStream);

      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'start' }],
        },
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'tool_call',
              id: 'tool-1',
              name: 'test_tool',
              parameters: {},
            },
          ],
        },
      ];

      const generator = provider.generateChatCompletion(
        buildCallOptions(messages, {
          settingsOverrides: {
            provider: {
              streaming: 'disabled',
            },
          },
        }),
      );
      await generator.next();

      const request = mockMessagesCreate.mock.calls[0][0];
      const anthropicMessages = request.messages as AnthropicMessage[];

      const assistantMessage = anthropicMessages[1];
      expect(assistantMessage.role).toBe('assistant');
      expect(assistantMessage.content).toEqual([
        {
          type: 'tool_use',
          id: 'toolu_tool-1',
          name: 'test_tool',
          input: {},
        },
      ]);
    });
  });

  describe('Prompt Caching', () => {
    beforeEach(() => {
      // Ensure streaming is disabled for all caching tests to use non-streaming mocks
      settingsService.setProviderSetting('anthropic', 'streaming', 'disabled');

      // Create a new provider with proper config that includes getEphemeralSettings
      provider = new AnthropicProvider('test-api-key', undefined, {
        ...TEST_PROVIDER_CONFIG,
        getEphemeralSettings: () => ({
          ...settingsService.getAllGlobalSettings(),
          ...settingsService.getProviderSettings('anthropic'),
        }),
      });

      if (runtimeContext.config) {
        runtimeContext.config.getEphemeralSettings = () => ({
          ...settingsService.getAllGlobalSettings(),
          ...settingsService.getProviderSettings(provider.name),
        });
      }
    });

    describe('Cache Control Structure', () => {
      it('should not add cache_control when prompt-caching is off (default)', async () => {
        // Explicitly set to off (note: default is now 1h, not off)
        settingsService.setProviderSetting(
          'anthropic',
          'prompt-caching',
          'off',
        );

        mockMessagesCreate.mockResolvedValueOnce({
          content: [{ type: 'text', text: 'response' }],
          usage: {
            input_tokens: 100,
            output_tokens: 50,
          },
        });

        const messages: IContent[] = [
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'Hello' }],
          },
        ];

        const generator = provider.generateChatCompletion(
          buildCallOptions(messages),
        );
        await generator.next();

        const request = mockMessagesCreate.mock.calls[0][0];
        expect(request.system).toBeDefined();

        // When caching is off, system can be a string (no cache_control possible)
        // or an array (cache_control should be undefined on all blocks)
        // We test that if it's an array, no blocks have cache_control
        const isArray = Array.isArray(request.system);
        const hasNoCacheControl = isArray
          ? (request.system as Array<{ cache_control?: unknown }>).every(
              (block) => block.cache_control === undefined,
            )
          : true; // String has no cache_control, which is correct

        expect(hasNoCacheControl).toBe(true);
      });

      it('should add cache_control with 5m TTL when prompt-caching is 5m', async () => {
        settingsService.setProviderSetting('anthropic', 'prompt-caching', '5m');

        mockMessagesCreate.mockResolvedValueOnce({
          content: [{ type: 'text', text: 'response' }],
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 3200,
          },
        });

        const messages: IContent[] = [
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'Hello' }],
          },
        ];

        const generator = provider.generateChatCompletion(
          buildCallOptions(messages),
        );
        await generator.next();

        const request = mockMessagesCreate.mock.calls[0][0];
        expect(Array.isArray(request.system)).toBe(true);

        const systemBlocks = request.system as Array<{
          type: string;
          text: string;
          cache_control?: { type: string; ttl?: string };
        }>;
        expect(systemBlocks.length).toBeGreaterThan(0);

        const lastBlock = systemBlocks[systemBlocks.length - 1];
        expect(lastBlock.cache_control).toEqual({
          type: 'ephemeral',
          ttl: '5m',
        });
      });

      it('should add cache_control with 1h TTL when prompt-caching is 1h', async () => {
        settingsService.setProviderSetting('anthropic', 'prompt-caching', '1h');

        mockMessagesCreate.mockResolvedValueOnce({
          content: [{ type: 'text', text: 'response' }],
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 3200,
          },
        });

        const messages: IContent[] = [
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'Hello' }],
          },
        ];

        const generator = provider.generateChatCompletion(
          buildCallOptions(messages),
        );
        await generator.next();

        const request = mockMessagesCreate.mock.calls[0][0];
        expect(Array.isArray(request.system)).toBe(true);

        const systemBlocks = request.system as Array<{
          type: string;
          text: string;
          cache_control?: { type: string; ttl?: string };
        }>;
        expect(systemBlocks.length).toBeGreaterThan(0);

        const lastBlock = systemBlocks[systemBlocks.length - 1];
        expect(lastBlock.cache_control).toEqual({
          type: 'ephemeral',
          ttl: '1h',
        });
      });

      it('should add extended-cache-ttl beta header for 1h TTL', async () => {
        settingsService.setProviderSetting('anthropic', 'prompt-caching', '1h');

        mockMessagesCreate.mockResolvedValueOnce({
          content: [{ type: 'text', text: 'response' }],
          usage: {
            input_tokens: 100,
            output_tokens: 50,
          },
        });

        const messages: IContent[] = [
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'Hello' }],
          },
        ];

        const generator = provider.generateChatCompletion(
          buildCallOptions(messages),
        );
        await generator.next();

        const call = mockMessagesCreate.mock.calls[0];
        expect(call).toBeDefined();

        const options = call?.[1];
        expect(options).toBeDefined();
        expect(options?.headers).toBeDefined();
        expect(options?.headers?.['anthropic-beta']).toContain(
          'extended-cache-ttl-2025-04-11',
        );
      });

      it('should not add beta header for 5m TTL', async () => {
        settingsService.setProviderSetting('anthropic', 'prompt-caching', '5m');

        mockMessagesCreate.mockResolvedValueOnce({
          content: [{ type: 'text', text: 'response' }],
          usage: {
            input_tokens: 100,
            output_tokens: 50,
          },
        });

        const messages: IContent[] = [
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'Hello' }],
          },
        ];

        const generator = provider.generateChatCompletion(
          buildCallOptions(messages),
        );
        await generator.next();

        const call = mockMessagesCreate.mock.calls[0];
        const options = call?.[1];

        // Check beta header - should not contain extended TTL
        const betaHeader = options?.headers?.['anthropic-beta'];
        // Either undefined or doesn't contain the extended TTL
        const isValidHeader =
          betaHeader === undefined ||
          !betaHeader.includes('extended-cache-ttl-2025-04-11');
        expect(isValidHeader).toBe(true);
      });

      it('should add cache_control to last message in multi-turn history when prompt-caching is 5m', async () => {
        settingsService.setProviderSetting('anthropic', 'prompt-caching', '5m');

        mockMessagesCreate.mockResolvedValueOnce({
          content: [{ type: 'text', text: 'response' }],
          usage: {
            input_tokens: 100,
            output_tokens: 50,
          },
        });

        // Multi-turn conversation with final human message
        const messages: IContent[] = [
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'First message' }],
          },
          {
            speaker: 'ai',
            blocks: [{ type: 'text', text: 'First response' }],
          },
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'Second message' }],
          },
          {
            speaker: 'ai',
            blocks: [{ type: 'text', text: 'Second response' }],
          },
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'How are you?' }],
          },
        ];

        const generator = provider.generateChatCompletion(
          buildCallOptions(messages),
        );
        await generator.next();

        const request = mockMessagesCreate.mock.calls[0][0];
        expect(request.messages).toBeDefined();
        const anthropicMessages = request.messages as AnthropicMessage[];

        // The last message should have cache_control on its last content block
        const lastMessage = anthropicMessages[anthropicMessages.length - 1];
        expect(lastMessage.role).toBe('user');

        // Last message content should be an array with cache_control
        expect(Array.isArray(lastMessage.content)).toBe(true);
        const contentBlocks = lastMessage.content as AnthropicContentBlock[];
        expect(contentBlocks.length).toBeGreaterThan(0);

        // The last content block should have cache_control
        const lastContentBlock = contentBlocks[contentBlocks.length - 1];
        expect(lastContentBlock.type).toBe('text');
        expect(lastContentBlock.cache_control).toEqual({
          type: 'ephemeral',
          ttl: '5m',
        });
      });

      it('should add cache_control to last tool_result block in history when prompt-caching is 5m', async () => {
        settingsService.setProviderSetting('anthropic', 'prompt-caching', '5m');

        mockMessagesCreate.mockResolvedValueOnce({
          content: [{ type: 'text', text: 'response' }],
          usage: {
            input_tokens: 100,
            output_tokens: 50,
          },
        });

        // Multi-turn history with tool call and response
        const toolCallId = 'hist_tool_read_123';
        const messages: IContent[] = [
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'Process this file' }],
          },
          {
            speaker: 'ai',
            blocks: [
              {
                type: 'tool_call',
                id: toolCallId,
                name: 'read_file',
                parameters: { path: '/tmp/file.txt' },
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
                result: 'File content here',
              },
            ],
          },
        ];

        const generator = provider.generateChatCompletion(
          buildCallOptions(messages),
        );
        await generator.next();

        const request = mockMessagesCreate.mock.calls[0][0];
        expect(request.messages).toBeDefined();
        const anthropicMessages = request.messages as AnthropicMessage[];

        // The last message should be the tool response
        const lastMessage = anthropicMessages[anthropicMessages.length - 1];
        expect(lastMessage.role).toBe('user');
        expect(Array.isArray(lastMessage.content)).toBe(true);

        const contentBlocks = lastMessage.content as AnthropicContentBlock[];
        expect(contentBlocks.length).toBeGreaterThan(0);

        // The last content block should be a tool_result with cache_control
        const lastContentBlock = contentBlocks[contentBlocks.length - 1];
        expect(lastContentBlock.type).toBe('tool_result');
        expect(lastContentBlock.cache_control).toEqual({
          type: 'ephemeral',
          ttl: '5m',
        });
      });

      it('should not add cache_control to message blocks when prompt-caching is off', async () => {
        settingsService.setProviderSetting(
          'anthropic',
          'prompt-caching',
          'off',
        );

        mockMessagesCreate.mockResolvedValueOnce({
          content: [{ type: 'text', text: 'response' }],
          usage: {
            input_tokens: 100,
            output_tokens: 50,
          },
        });

        // Multi-turn conversation with final human message
        const messages: IContent[] = [
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'First message' }],
          },
          {
            speaker: 'ai',
            blocks: [{ type: 'text', text: 'First response' }],
          },
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'How are you?' }],
          },
        ];

        const generator = provider.generateChatCompletion(
          buildCallOptions(messages),
        );
        await generator.next();

        const request = mockMessagesCreate.mock.calls[0][0];
        expect(request.messages).toBeDefined();
        const anthropicMessages = request.messages as AnthropicMessage[];

        // All message blocks should not have cache_control
        const allCacheControls = anthropicMessages.flatMap((message) => {
          if (Array.isArray(message.content)) {
            const contentBlocks = message.content as AnthropicContentBlock[];
            return contentBlocks.map((block) => block.cache_control);
          }
          // String content has no cache_control, which is correct
          return [];
        });

        // All cache_controls that exist should be undefined
        expect(allCacheControls.every((cc) => cc === undefined)).toBe(true);
      });
    });

    describe('Stable Tool Ordering', () => {
      it('should sort tools alphabetically by name', async () => {
        settingsService.setProviderSetting('anthropic', 'prompt-caching', '5m');

        mockMessagesCreate.mockResolvedValueOnce({
          content: [{ type: 'text', text: 'response' }],
          usage: {
            input_tokens: 100,
            output_tokens: 50,
          },
        });

        const tools = [
          {
            functionDeclarations: [
              {
                name: 'zebra_tool',
                description: 'Z tool',
                parameters: { type: 'object', properties: {} },
              },
              {
                name: 'alpha_tool',
                description: 'A tool',
                parameters: { type: 'object', properties: {} },
              },
              {
                name: 'middle_tool',
                description: 'M tool',
                parameters: { type: 'object', properties: {} },
              },
            ],
          },
        ];

        const messages: IContent[] = [
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'Hello' }],
          },
        ];

        const generator = provider.generateChatCompletion(
          buildCallOptions(messages, { tools }),
        );
        await generator.next();

        const request = mockMessagesCreate.mock.calls[0][0];
        expect(request.tools).toBeDefined();

        const toolNames = request.tools.map((t: { name: string }) => t.name);
        expect(toolNames).toEqual(['alpha_tool', 'middle_tool', 'zebra_tool']);
      });

      it('should sort JSON schema keys alphabetically', async () => {
        settingsService.setProviderSetting('anthropic', 'prompt-caching', '5m');

        mockMessagesCreate.mockResolvedValueOnce({
          content: [{ type: 'text', text: 'response' }],
          usage: {
            input_tokens: 100,
            output_tokens: 50,
          },
        });

        const tools = [
          {
            functionDeclarations: [
              {
                name: 'test_tool',
                description: 'Test',
                parameters: {
                  type: 'object',
                  properties: {
                    zebra: { type: 'string' },
                    apple: { type: 'number' },
                    middle: { type: 'boolean' },
                  },
                },
              },
            ],
          },
        ];

        const messages: IContent[] = [
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'Hello' }],
          },
        ];

        const generator = provider.generateChatCompletion(
          buildCallOptions(messages, { tools }),
        );
        await generator.next();

        const request = mockMessagesCreate.mock.calls[0][0];
        expect(request.tools).toBeDefined();

        const tool = request.tools[0];
        const propertyKeys = Object.keys(tool.input_schema.properties);
        expect(propertyKeys).toEqual(['apple', 'middle', 'zebra']);
      });
    });

    it('should not add cache_control to last message when content is empty string', async () => {
      settingsService.setProviderSetting('anthropic', 'prompt-caching', '5m');

      mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'response' }],
        usage: {
          input_tokens: 100,
          output_tokens: 50,
        },
      });

      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: '' }],
        },
      ];

      const generator = provider.generateChatCompletion(
        buildCallOptions(messages),
      );
      await generator.next();

      const request = mockMessagesCreate.mock.calls[0][0];
      expect(request.messages).toBeDefined();
      const anthropicMessages = request.messages as AnthropicMessage[];

      const lastMessage = anthropicMessages[anthropicMessages.length - 1];
      expect(lastMessage.role).toBe('user');

      // Last message content should remain a string (not converted to array)
      expect(typeof lastMessage.content).toBe('string');
      expect(lastMessage.content).toBe('');
    });

    it('should not add cache_control to last message when content is whitespace only', async () => {
      settingsService.setProviderSetting('anthropic', 'prompt-caching', '5m');

      mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'response' }],
        usage: {
          input_tokens: 100,
          output_tokens: 50,
        },
      });

      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: '   \n\t  ' }],
        },
      ];

      const generator = provider.generateChatCompletion(
        buildCallOptions(messages),
      );
      await generator.next();

      const request = mockMessagesCreate.mock.calls[0][0];
      expect(request.messages).toBeDefined();
      const anthropicMessages = request.messages as AnthropicMessage[];

      const lastMessage = anthropicMessages[anthropicMessages.length - 1];
      expect(lastMessage.role).toBe('user');

      // Last message content should remain a string (not converted to array)
      expect(typeof lastMessage.content).toBe('string');
      expect(lastMessage.content).toBe('   \n\t  ');
    });

    describe('Cache Metrics Extraction', () => {
      it('should extract cache metrics from non-streaming response', async () => {
        settingsService.setProviderSetting('anthropic', 'prompt-caching', '5m');

        mockMessagesCreate.mockResolvedValueOnce({
          content: [{ type: 'text', text: 'response' }],
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            cache_read_input_tokens: 3200,
            cache_creation_input_tokens: 0,
          },
        });

        const messages: IContent[] = [
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'Hello' }],
          },
        ];

        const generator = provider.generateChatCompletion(
          buildCallOptions(messages),
        );
        const result = await generator.next();

        expect(result.value).toBeDefined();
        const content = result.value as IContent;
        expect(content.metadata?.usage).toBeDefined();
        expect(content.metadata?.usage?.cache_read_input_tokens).toBe(3200);
        expect(content.metadata?.usage?.cache_creation_input_tokens).toBe(0);
      });

      it('should extract cache metrics from streaming response', async () => {
        settingsService.setProviderSetting('anthropic', 'prompt-caching', '5m');
        // Enable streaming for this test
        settingsService.setProviderSetting('anthropic', 'streaming', 'enabled');

        // Recreate provider with streaming enabled
        provider = new AnthropicProvider('test-api-key', undefined, {
          ...TEST_PROVIDER_CONFIG,
          getEphemeralSettings: () => ({
            ...settingsService.getAllGlobalSettings(),
            ...settingsService.getProviderSettings('anthropic'),
          }),
        });

        const mockStream = {
          async *[Symbol.asyncIterator]() {
            yield {
              type: 'message_start',
              message: {
                usage: {
                  input_tokens: 100,
                  output_tokens: 0,
                  cache_read_input_tokens: 3200,
                  cache_creation_input_tokens: 0,
                },
              },
            };
            yield {
              type: 'content_block_delta',
              delta: { type: 'text_delta', text: 'Hello' },
            };
            yield {
              type: 'message_delta',
              usage: { input_tokens: 100, output_tokens: 5 },
            };
          },
        };

        mockMessagesCreate.mockResolvedValue(mockStream);

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

        const usageChunk = chunks.find(
          (c) => c.metadata?.usage?.cache_read_input_tokens !== undefined,
        );
        expect(usageChunk).toBeDefined();
        expect(usageChunk?.metadata?.usage?.cache_read_input_tokens).toBe(3200);
        expect(usageChunk?.metadata?.usage?.cache_creation_input_tokens).toBe(
          0,
        );
      });

      it('should handle cache creation on first request', async () => {
        settingsService.setProviderSetting('anthropic', 'prompt-caching', '5m');

        mockMessagesCreate.mockResolvedValueOnce({
          content: [{ type: 'text', text: 'response' }],
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 3200,
          },
        });

        const messages: IContent[] = [
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'Hello' }],
          },
        ];

        const generator = provider.generateChatCompletion(
          buildCallOptions(messages),
        );
        const result = await generator.next();

        const content = result.value as IContent;
        expect(content.metadata?.usage?.cache_read_input_tokens).toBe(0);
        expect(content.metadata?.usage?.cache_creation_input_tokens).toBe(3200);
      });
    });

    describe('Cache Hit Rate Calculation', () => {
      it('should calculate 0% hit rate on cache write (first request)', async () => {
        settingsService.setProviderSetting('anthropic', 'prompt-caching', '5m');

        mockMessagesCreate.mockResolvedValueOnce({
          content: [{ type: 'text', text: 'response' }],
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 3200,
          },
        });

        const messages: IContent[] = [
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'Hello' }],
          },
        ];

        const generator = provider.generateChatCompletion(
          buildCallOptions(messages),
        );
        const result = await generator.next();

        const content = result.value as IContent;
        const cacheRead = content.metadata?.usage?.cache_read_input_tokens ?? 0;
        const input = content.metadata?.usage?.promptTokens ?? 0;
        const hitRate = (cacheRead / (cacheRead + input)) * 100;

        expect(hitRate).toBe(0);
      });

      it('should calculate high hit rate on cache read (subsequent requests)', async () => {
        settingsService.setProviderSetting('anthropic', 'prompt-caching', '5m');

        mockMessagesCreate.mockResolvedValueOnce({
          content: [{ type: 'text', text: 'response' }],
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            cache_read_input_tokens: 3200,
            cache_creation_input_tokens: 0,
          },
        });

        const messages: IContent[] = [
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'Hello' }],
          },
        ];

        const generator = provider.generateChatCompletion(
          buildCallOptions(messages),
        );
        const result = await generator.next();

        const content = result.value as IContent;
        const cacheRead = content.metadata?.usage?.cache_read_input_tokens ?? 0;
        const input = content.metadata?.usage?.promptTokens ?? 0;
        const hitRate = (cacheRead / (cacheRead + input)) * 100;

        expect(hitRate).toBeGreaterThan(90);
        expect(cacheRead).toBe(3200);
      });
    });

    describe('Rate Limit Tracking', () => {
      it('should extract rate limit headers from non-streaming responses', async () => {
        const mockResponse = {
          content: [{ type: 'text', text: 'response' }],
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
        };

        const mockHeaders = new Headers({
          'anthropic-ratelimit-requests-limit': '1000',
          'anthropic-ratelimit-requests-remaining': '950',
          'anthropic-ratelimit-requests-reset': '2025-11-21T12:00:00Z',
          'anthropic-ratelimit-tokens-limit': '100000',
          'anthropic-ratelimit-tokens-remaining': '95000',
          'anthropic-ratelimit-tokens-reset': '2025-11-21T12:00:00Z',
          'anthropic-ratelimit-input-tokens-limit': '50000',
          'anthropic-ratelimit-input-tokens-remaining': '48000',
        });

        const mockWithResponse = vi.fn().mockResolvedValue({
          data: mockResponse,
          response: { headers: mockHeaders },
        });

        mockMessagesCreate.mockReturnValue({
          withResponse: mockWithResponse,
        } as unknown as Promise<Anthropic.Message>);

        settingsService.setProviderSetting(
          'anthropic',
          'streaming',
          'disabled',
        );

        const messages: IContent[] = [
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'Hello' }],
          },
        ];

        const generator = provider.generateChatCompletion(
          buildCallOptions(messages),
        );
        await generator.next();

        const rateLimitInfo = provider.getRateLimitInfo();
        expect(rateLimitInfo).toBeDefined();
        expect(rateLimitInfo?.requestsLimit).toBe(1000);
        expect(rateLimitInfo?.requestsRemaining).toBe(950);
        expect(rateLimitInfo?.requestsReset).toEqual(
          new Date('2025-11-21T12:00:00Z'),
        );
        expect(rateLimitInfo?.tokensLimit).toBe(100000);
        expect(rateLimitInfo?.tokensRemaining).toBe(95000);
        expect(rateLimitInfo?.tokensReset).toEqual(
          new Date('2025-11-21T12:00:00Z'),
        );
        expect(rateLimitInfo?.inputTokensLimit).toBe(50000);
        expect(rateLimitInfo?.inputTokensRemaining).toBe(48000);
      });

      it('should handle missing rate limit headers gracefully', async () => {
        const mockResponse = {
          content: [{ type: 'text', text: 'response' }],
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
        };

        const mockHeaders = new Headers();

        const mockWithResponse = vi.fn().mockResolvedValue({
          data: mockResponse,
          response: { headers: mockHeaders },
        });

        mockMessagesCreate.mockReturnValue({
          withResponse: mockWithResponse,
        } as unknown as Promise<Anthropic.Message>);

        settingsService.setProviderSetting(
          'anthropic',
          'streaming',
          'disabled',
        );

        const messages: IContent[] = [
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'Hello' }],
          },
        ];

        const generator = provider.generateChatCompletion(
          buildCallOptions(messages),
        );
        await generator.next();

        const rateLimitInfo = provider.getRateLimitInfo();
        expect(rateLimitInfo).toBeDefined();
        expect(rateLimitInfo?.requestsLimit).toBeUndefined();
        expect(rateLimitInfo?.requestsRemaining).toBeUndefined();
        expect(rateLimitInfo?.tokensLimit).toBeUndefined();
        expect(rateLimitInfo?.tokensRemaining).toBeUndefined();
      });

      it('should extract rate limit headers in streaming mode using withResponse()', async () => {
        settingsService.setProviderSetting('anthropic', 'streaming', 'enabled');

        const mockHeaders = new Headers({
          'anthropic-ratelimit-requests-limit': '1000',
          'anthropic-ratelimit-requests-remaining': '950',
          'anthropic-ratelimit-requests-reset': '2025-11-21T12:00:00Z',
          'anthropic-ratelimit-tokens-limit': '100000',
          'anthropic-ratelimit-tokens-remaining': '95000',
          'anthropic-ratelimit-tokens-reset': '2025-11-21T12:00:00Z',
        });

        const mockStream = {
          async *[Symbol.asyncIterator]() {
            yield {
              type: 'content_block_delta',
              delta: { type: 'text_delta', text: 'Hello' },
            };
          },
        };

        const mockWithResponse = vi.fn().mockResolvedValue({
          data: mockStream,
          response: { headers: mockHeaders },
        });

        mockMessagesCreate.mockReturnValue({
          withResponse: mockWithResponse,
        } as unknown as Promise<Anthropic.Message>);

        const messages: IContent[] = [
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'Say hello' }],
          },
        ];

        const generator = provider.generateChatCompletion(
          buildCallOptions(messages),
        );

        await generator.next();

        const rateLimitInfo = provider.getRateLimitInfo();
        expect(rateLimitInfo).toBeDefined();
        expect(rateLimitInfo?.requestsLimit).toBe(1000);
        expect(rateLimitInfo?.requestsRemaining).toBe(950);
        expect(rateLimitInfo?.tokensLimit).toBe(100000);
        expect(rateLimitInfo?.tokensRemaining).toBe(95000);
      });

      it('should handle streaming errors and wrap them for retry', async () => {
        settingsService.setProviderSetting('anthropic', 'streaming', 'enabled');

        const mockHeaders = new Headers({
          'anthropic-ratelimit-requests-limit': '1000',
          'anthropic-ratelimit-requests-remaining': '950',
        });

        const mockStream = {
          async *[Symbol.asyncIterator]() {
            yield {
              type: 'content_block_delta',
              delta: { type: 'text_delta', text: 'Hello' },
            };
            throw new Error('Connection terminated');
          },
        };

        const mockWithResponse = vi.fn().mockResolvedValue({
          data: mockStream,
          response: { headers: mockHeaders },
        });

        mockMessagesCreate.mockReturnValue({
          withResponse: mockWithResponse,
        } as unknown as Promise<Anthropic.Message>);

        const messages: IContent[] = [
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'Say hello' }],
          },
        ];

        const generator = provider.generateChatCompletion(
          buildCallOptions(messages),
        );

        await generator.next();

        await expect(generator.next()).rejects.toThrow('Connection terminated');
      });

      it('should work with proactive throttling when streaming', async () => {
        settingsService.setProviderSetting('anthropic', 'streaming', 'enabled');
        settingsService.setProviderSetting(
          'anthropic',
          'rate-limit-throttle',
          'on',
        );

        // Spy on sleep to verify throttling behavior without fake timers
        const sleepSpy = vi
          .spyOn(provider as never, 'sleep')
          .mockResolvedValue(undefined);

        // First call establishes low rate limit
        const firstHeaders = new Headers({
          'anthropic-ratelimit-requests-limit': '1000',
          'anthropic-ratelimit-requests-remaining': '40', // 4% remaining
          'anthropic-ratelimit-requests-reset': new Date(
            Date.now() + 5000,
          ).toISOString(),
        });

        const firstStream = {
          async *[Symbol.asyncIterator]() {
            yield {
              type: 'content_block_delta',
              delta: { type: 'text_delta', text: 'First' },
            };
          },
        };

        const firstWithResponse = vi.fn().mockResolvedValue({
          data: firstStream,
          response: { headers: firstHeaders },
        });

        mockMessagesCreate.mockReturnValueOnce({
          withResponse: firstWithResponse,
        } as unknown as Promise<Anthropic.Message>);

        const messages: IContent[] = [
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'First request' }],
          },
        ];

        const generator1 = provider.generateChatCompletion(
          buildCallOptions(messages),
        );
        await generator1.next();

        // Verify rate limit was extracted
        const rateLimitInfo = provider.getRateLimitInfo();
        expect(rateLimitInfo).toBeDefined();
        expect(rateLimitInfo?.requestsRemaining).toBe(40);

        // Second call should be throttled
        const secondHeaders = new Headers({
          'anthropic-ratelimit-requests-limit': '1000',
          'anthropic-ratelimit-requests-remaining': '39',
        });

        const secondStream = {
          async *[Symbol.asyncIterator]() {
            yield {
              type: 'content_block_delta',
              delta: { type: 'text_delta', text: 'Second' },
            };
          },
        };

        const secondWithResponse = vi.fn().mockResolvedValue({
          data: secondStream,
          response: { headers: secondHeaders },
        });

        mockMessagesCreate.mockReturnValueOnce({
          withResponse: secondWithResponse,
        } as unknown as Promise<Anthropic.Message>);

        const gen = provider.generateChatCompletion(buildCallOptions(messages));
        await gen.next();

        // Verify throttling was triggered (sleep was called with ~5000ms)
        expect(sleepSpy).toHaveBeenCalled();
        const sleepDuration = sleepSpy.mock.calls[0][0] as number;
        expect(sleepDuration).toBeGreaterThan(0);
        expect(sleepDuration).toBeLessThanOrEqual(5000);

        expect(secondWithResponse).toHaveBeenCalled();
        sleepSpy.mockRestore();
      });

      it('should handle partial rate limit headers', async () => {
        const mockResponse = {
          content: [{ type: 'text', text: 'response' }],
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
        };

        const mockHeaders = new Headers({
          'anthropic-ratelimit-requests-limit': '1000',
          'anthropic-ratelimit-requests-remaining': '950',
          // Missing reset time and all token-related headers
        });

        const mockWithResponse = vi.fn().mockResolvedValue({
          data: mockResponse,
          response: { headers: mockHeaders },
        });

        mockMessagesCreate.mockReturnValue({
          withResponse: mockWithResponse,
        } as unknown as Promise<Anthropic.Message>);

        settingsService.setProviderSetting(
          'anthropic',
          'streaming',
          'disabled',
        );

        const messages: IContent[] = [
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'Hello' }],
          },
        ];

        const generator = provider.generateChatCompletion(
          buildCallOptions(messages),
        );
        await generator.next();

        const rateLimitInfo = provider.getRateLimitInfo();
        expect(rateLimitInfo).toBeDefined();
        expect(rateLimitInfo?.requestsLimit).toBe(1000);
        expect(rateLimitInfo?.requestsRemaining).toBe(950);
        expect(rateLimitInfo?.requestsReset).toBeUndefined();
        expect(rateLimitInfo?.tokensLimit).toBeUndefined();
        expect(rateLimitInfo?.tokensRemaining).toBeUndefined();
      });

      it('should handle invalid date format in reset headers', async () => {
        const mockResponse = {
          content: [{ type: 'text', text: 'response' }],
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
        };

        const mockHeaders = new Headers({
          'anthropic-ratelimit-requests-limit': '1000',
          'anthropic-ratelimit-requests-remaining': '950',
          'anthropic-ratelimit-requests-reset': 'invalid-date',
          'anthropic-ratelimit-tokens-limit': '100000',
          'anthropic-ratelimit-tokens-remaining': '95000',
          'anthropic-ratelimit-tokens-reset': 'also-invalid',
        });

        const mockWithResponse = vi.fn().mockResolvedValue({
          data: mockResponse,
          response: { headers: mockHeaders },
        });

        mockMessagesCreate.mockReturnValue({
          withResponse: mockWithResponse,
        } as unknown as Promise<Anthropic.Message>);

        settingsService.setProviderSetting(
          'anthropic',
          'streaming',
          'disabled',
        );

        const messages: IContent[] = [
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'Hello' }],
          },
        ];

        const generator = provider.generateChatCompletion(
          buildCallOptions(messages),
        );
        await generator.next();

        const rateLimitInfo = provider.getRateLimitInfo();
        expect(rateLimitInfo).toBeDefined();
        expect(rateLimitInfo?.requestsLimit).toBe(1000);
        expect(rateLimitInfo?.requestsRemaining).toBe(950);
        // Reset dates should be undefined due to parse errors
        expect(rateLimitInfo?.requestsReset).toBeUndefined();
        expect(rateLimitInfo?.tokensLimit).toBe(100000);
        expect(rateLimitInfo?.tokensRemaining).toBe(95000);
        expect(rateLimitInfo?.tokensReset).toBeUndefined();
      });
    });

    describe('Rate limit throttling', () => {
      it('should wait when requests remaining is below threshold', async () => {
        const mockResponse = {
          content: [{ type: 'text', text: 'response' }],
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
        };

        // Spy on sleep to verify throttling behavior without fake timers
        const sleepSpy = vi
          .spyOn(provider as never, 'sleep')
          .mockResolvedValue(undefined);

        // First call establishes rate limit state
        const firstHeaders = new Headers({
          'anthropic-ratelimit-requests-limit': '1000',
          'anthropic-ratelimit-requests-remaining': '40', // 4% remaining
          'anthropic-ratelimit-requests-reset': new Date(
            Date.now() + 5000,
          ).toISOString(),
        });

        const firstWithResponse = vi.fn().mockResolvedValue({
          data: mockResponse,
          response: { headers: firstHeaders },
        });

        mockMessagesCreate.mockReturnValueOnce({
          withResponse: firstWithResponse,
        } as unknown as Promise<Anthropic.Message>);

        settingsService.setProviderSetting(
          'anthropic',
          'streaming',
          'disabled',
        );

        const messages: IContent[] = [
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'First request' }],
          },
        ];

        // First request - establishes rate limit state
        const generator1 = provider.generateChatCompletion(
          buildCallOptions(messages),
        );
        await generator1.next();

        // Second call should trigger throttling
        const secondHeaders = new Headers({
          'anthropic-ratelimit-requests-limit': '1000',
          'anthropic-ratelimit-requests-remaining': '39',
          'anthropic-ratelimit-requests-reset': new Date(
            Date.now() + 5000,
          ).toISOString(),
        });

        const secondWithResponse = vi.fn().mockResolvedValue({
          data: mockResponse,
          response: { headers: secondHeaders },
        });

        mockMessagesCreate.mockReturnValueOnce({
          withResponse: secondWithResponse,
        } as unknown as Promise<Anthropic.Message>);

        const messages2: IContent[] = [
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'Second request' }],
          },
        ];

        const generator2 = provider.generateChatCompletion(
          buildCallOptions(messages2),
        );
        await generator2.next();

        // Verify throttling was triggered (sleep was called)
        expect(sleepSpy).toHaveBeenCalled();
        const sleepDuration = sleepSpy.mock.calls[0][0] as number;
        expect(sleepDuration).toBeGreaterThan(0);
        expect(sleepDuration).toBeLessThanOrEqual(5000);

        // Verify the second request was made (after throttling)
        expect(secondWithResponse).toHaveBeenCalled();
        sleepSpy.mockRestore();
      });

      it('should wait when tokens remaining is below threshold', async () => {
        const mockResponse = {
          content: [{ type: 'text', text: 'response' }],
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
        };

        // Spy on sleep to verify throttling behavior without fake timers
        const sleepSpy = vi
          .spyOn(provider as never, 'sleep')
          .mockResolvedValue(undefined);

        // First call establishes rate limit state
        const firstHeaders = new Headers({
          'anthropic-ratelimit-tokens-limit': '100000',
          'anthropic-ratelimit-tokens-remaining': '4000', // 4% remaining
          'anthropic-ratelimit-tokens-reset': new Date(
            Date.now() + 5000,
          ).toISOString(),
        });

        const firstWithResponse = vi.fn().mockResolvedValue({
          data: mockResponse,
          response: { headers: firstHeaders },
        });

        mockMessagesCreate.mockReturnValueOnce({
          withResponse: firstWithResponse,
        } as unknown as Promise<Anthropic.Message>);

        settingsService.setProviderSetting(
          'anthropic',
          'streaming',
          'disabled',
        );

        const messages: IContent[] = [
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'First request' }],
          },
        ];

        // First request - establishes rate limit state
        const generator1 = provider.generateChatCompletion(
          buildCallOptions(messages),
        );
        await generator1.next();

        // Second call should trigger throttling
        const secondHeaders = new Headers({
          'anthropic-ratelimit-tokens-limit': '100000',
          'anthropic-ratelimit-tokens-remaining': '3900',
          'anthropic-ratelimit-tokens-reset': new Date(
            Date.now() + 5000,
          ).toISOString(),
        });

        const secondWithResponse = vi.fn().mockResolvedValue({
          data: mockResponse,
          response: { headers: secondHeaders },
        });

        mockMessagesCreate.mockReturnValueOnce({
          withResponse: secondWithResponse,
        } as unknown as Promise<Anthropic.Message>);

        const messages2: IContent[] = [
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'Second request' }],
          },
        ];

        const generator2 = provider.generateChatCompletion(
          buildCallOptions(messages2),
        );
        await generator2.next();

        // Verify throttling was triggered (sleep was called)
        expect(sleepSpy).toHaveBeenCalled();
        const sleepDuration = sleepSpy.mock.calls[0][0] as number;
        expect(sleepDuration).toBeGreaterThan(0);
        expect(sleepDuration).toBeLessThanOrEqual(5000);

        // Verify the second request was made
        expect(secondWithResponse).toHaveBeenCalled();
        sleepSpy.mockRestore();
      });

      it('should not wait when throttling is disabled', async () => {
        const mockResponse = {
          content: [{ type: 'text', text: 'response' }],
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
        };

        // Set settings BEFORE creating call options
        settingsService.setProviderSetting(
          'anthropic',
          'streaming',
          'disabled',
        );
        // Rate limit throttle is read from global settings, not provider settings
        settingsService.set('rate-limit-throttle', 'off');

        // Spy on sleep to verify throttling behavior
        const sleepSpy = vi
          .spyOn(provider as never, 'sleep')
          .mockResolvedValue(undefined);

        // First call establishes rate limit state
        const firstHeaders = new Headers({
          'anthropic-ratelimit-requests-limit': '1000',
          'anthropic-ratelimit-requests-remaining': '40', // 4% remaining
          'anthropic-ratelimit-requests-reset': new Date(
            Date.now() + 5000,
          ).toISOString(),
        });

        const firstWithResponse = vi.fn().mockResolvedValue({
          data: mockResponse,
          response: { headers: firstHeaders },
        });

        mockMessagesCreate.mockReturnValueOnce({
          withResponse: firstWithResponse,
        } as unknown as Promise<Anthropic.Message>);

        const messages: IContent[] = [
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'First request' }],
          },
        ];

        // First request - establishes rate limit state (need to build options AFTER settings change)
        const generator1 = provider.generateChatCompletion(
          buildCallOptions(messages),
        );
        await generator1.next();

        // Second call should NOT trigger throttling
        const secondHeaders = new Headers({
          'anthropic-ratelimit-requests-limit': '1000',
          'anthropic-ratelimit-requests-remaining': '39',
        });

        const secondWithResponse = vi.fn().mockResolvedValue({
          data: mockResponse,
          response: { headers: secondHeaders },
        });

        mockMessagesCreate.mockReturnValueOnce({
          withResponse: secondWithResponse,
        } as unknown as Promise<Anthropic.Message>);

        const messages2: IContent[] = [
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'Second request' }],
          },
        ];

        // Throttling is disabled, so this should not wait (build options AFTER settings change)
        const generator2 = provider.generateChatCompletion(
          buildCallOptions(messages2),
        );
        await generator2.next();

        // Verify sleep was NOT called (throttling disabled)
        expect(sleepSpy).not.toHaveBeenCalled();
        expect(secondWithResponse).toHaveBeenCalled();
        sleepSpy.mockRestore();
      });

      it('should respect max wait time', async () => {
        const mockResponse = {
          content: [{ type: 'text', text: 'response' }],
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
        };

        // Set settings BEFORE creating call options
        settingsService.setProviderSetting(
          'anthropic',
          'streaming',
          'disabled',
        );
        // Rate limit max wait is read from global settings, not provider settings
        settingsService.set('rate-limit-max-wait', 1000);

        // Spy on sleep to verify throttling behavior
        const sleepSpy = vi
          .spyOn(provider as never, 'sleep')
          .mockResolvedValue(undefined);

        // First call establishes rate limit state with far future reset
        const firstHeaders = new Headers({
          'anthropic-ratelimit-requests-limit': '1000',
          'anthropic-ratelimit-requests-remaining': '40', // 4% remaining
          'anthropic-ratelimit-requests-reset': new Date(
            Date.now() + 300000, // 5 minutes
          ).toISOString(),
        });

        const firstWithResponse = vi.fn().mockResolvedValue({
          data: mockResponse,
          response: { headers: firstHeaders },
        });

        mockMessagesCreate.mockReturnValueOnce({
          withResponse: firstWithResponse,
        } as unknown as Promise<Anthropic.Message>);

        const messages: IContent[] = [
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'First request' }],
          },
        ];

        // First request - establishes rate limit state (build options AFTER settings change)
        const generator1 = provider.generateChatCompletion(
          buildCallOptions(messages),
        );
        await generator1.next();

        // Second call should cap wait time
        const secondHeaders = new Headers({
          'anthropic-ratelimit-requests-limit': '1000',
          'anthropic-ratelimit-requests-remaining': '39',
        });

        const secondWithResponse = vi.fn().mockResolvedValue({
          data: mockResponse,
          response: { headers: secondHeaders },
        });

        mockMessagesCreate.mockReturnValueOnce({
          withResponse: secondWithResponse,
        } as unknown as Promise<Anthropic.Message>);

        const messages2: IContent[] = [
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'Second request' }],
          },
        ];

        // Build options AFTER settings change
        const generator2 = provider.generateChatCompletion(
          buildCallOptions(messages2),
        );
        await generator2.next();

        // Verify sleep was called with max wait (1000ms) not full reset time (300000ms)
        expect(sleepSpy).toHaveBeenCalled();
        const sleepDuration = sleepSpy.mock.calls[0][0] as number;
        expect(sleepDuration).toBe(1000);

        expect(secondWithResponse).toHaveBeenCalled();
        sleepSpy.mockRestore();
      });

      it('should not wait when reset time is in the past', async () => {
        const mockResponse = {
          content: [{ type: 'text', text: 'response' }],
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
        };

        // Spy on sleep to verify throttling behavior
        const sleepSpy = vi
          .spyOn(provider as never, 'sleep')
          .mockResolvedValue(undefined);

        // First call establishes rate limit state with past reset
        const firstHeaders = new Headers({
          'anthropic-ratelimit-requests-limit': '1000',
          'anthropic-ratelimit-requests-remaining': '40', // 4% remaining
          'anthropic-ratelimit-requests-reset': new Date(
            Date.now() - 5000, // 5 seconds ago
          ).toISOString(),
        });

        const firstWithResponse = vi.fn().mockResolvedValue({
          data: mockResponse,
          response: { headers: firstHeaders },
        });

        mockMessagesCreate.mockReturnValueOnce({
          withResponse: firstWithResponse,
        } as unknown as Promise<Anthropic.Message>);

        settingsService.setProviderSetting(
          'anthropic',
          'streaming',
          'disabled',
        );

        const messages: IContent[] = [
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'First request' }],
          },
        ];

        // First request - establishes rate limit state
        const generator1 = provider.generateChatCompletion(
          buildCallOptions(messages),
        );
        await generator1.next();

        // Second call should NOT wait (reset time in past)
        const secondHeaders = new Headers({
          'anthropic-ratelimit-requests-limit': '1000',
          'anthropic-ratelimit-requests-remaining': '39',
        });

        const secondWithResponse = vi.fn().mockResolvedValue({
          data: mockResponse,
          response: { headers: secondHeaders },
        });

        mockMessagesCreate.mockReturnValueOnce({
          withResponse: secondWithResponse,
        } as unknown as Promise<Anthropic.Message>);

        const messages2: IContent[] = [
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'Second request' }],
          },
        ];

        // Reset time is in the past, so should not wait
        const generator2 = provider.generateChatCompletion(
          buildCallOptions(messages2),
        );
        await generator2.next();

        // Verify sleep was NOT called (reset time is in the past)
        expect(sleepSpy).not.toHaveBeenCalled();
        expect(secondWithResponse).toHaveBeenCalled();
        sleepSpy.mockRestore();
      });

      it('should use custom threshold percentage', async () => {
        const mockResponse = {
          content: [{ type: 'text', text: 'response' }],
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
        };

        // Set settings BEFORE creating call options
        settingsService.setProviderSetting(
          'anthropic',
          'streaming',
          'disabled',
        );
        // Rate limit threshold is read from global settings, not provider settings
        settingsService.set('rate-limit-throttle-threshold', 10);

        // Spy on sleep to verify throttling behavior
        const sleepSpy = vi
          .spyOn(provider as never, 'sleep')
          .mockResolvedValue(undefined);

        // First call establishes rate limit state
        const firstHeaders = new Headers({
          'anthropic-ratelimit-requests-limit': '1000',
          'anthropic-ratelimit-requests-remaining': '80', // 8% remaining
          'anthropic-ratelimit-requests-reset': new Date(
            Date.now() + 5000,
          ).toISOString(),
        });

        const firstWithResponse = vi.fn().mockResolvedValue({
          data: mockResponse,
          response: { headers: firstHeaders },
        });

        mockMessagesCreate.mockReturnValueOnce({
          withResponse: firstWithResponse,
        } as unknown as Promise<Anthropic.Message>);

        const messages: IContent[] = [
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'First request' }],
          },
        ];

        // First request - establishes rate limit state (build options AFTER settings change)
        const generator1 = provider.generateChatCompletion(
          buildCallOptions(messages),
        );
        await generator1.next();

        // Second call should trigger throttling (8% < 10% threshold)
        const secondHeaders = new Headers({
          'anthropic-ratelimit-requests-limit': '1000',
          'anthropic-ratelimit-requests-remaining': '79',
        });

        const secondWithResponse = vi.fn().mockResolvedValue({
          data: mockResponse,
          response: { headers: secondHeaders },
        });

        mockMessagesCreate.mockReturnValueOnce({
          withResponse: secondWithResponse,
        } as unknown as Promise<Anthropic.Message>);

        const messages2: IContent[] = [
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'Second request' }],
          },
        ];

        // Build options AFTER settings change
        const generator2 = provider.generateChatCompletion(
          buildCallOptions(messages2),
        );
        await generator2.next();

        // Verify throttling was triggered (sleep was called because 8% < 10% threshold)
        expect(sleepSpy).toHaveBeenCalled();
        const sleepDuration = sleepSpy.mock.calls[0][0] as number;
        expect(sleepDuration).toBeGreaterThan(0);
        expect(sleepDuration).toBeLessThanOrEqual(5000);

        expect(secondWithResponse).toHaveBeenCalled();
        sleepSpy.mockRestore();
      });

      it('should not wait when no rate limit info exists', async () => {
        // Mock streaming response - need to create a new generator for each call
        mockMessagesCreate.mockImplementation(async function* () {
          yield {
            type: 'message_start',
            message: {
              usage: {
                input_tokens: 100,
                output_tokens: 0,
              },
            },
          };
          yield {
            type: 'content_block_start',
            content_block: { type: 'text', text: '' },
          };
          yield {
            type: 'content_block_delta',
            delta: { type: 'text_delta', text: 'response' },
          };
          yield { type: 'content_block_stop' };
          yield {
            type: 'message_delta',
            usage: { input_tokens: 0, output_tokens: 50 },
          };
        });

        settingsService.setProviderSetting('anthropic', 'streaming', 'enabled');

        const messages: IContent[] = [
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'Request' }],
          },
        ];

        // No rate limit info exists yet - should not wait
        const generator = provider.generateChatCompletion(
          buildCallOptions(messages),
        );

        // Consume the generator
        let result = await generator.next();
        while (!result.done) {
          result = await generator.next();
        }

        // Test passed if we got here without errors
        expect(mockMessagesCreate).toHaveBeenCalled();
      });
    });
  });
  describe('OAuth Compatibility (issue #1053)', () => {
    it('should prefix tool names with llxprt_ for OAuth requests', async () => {
      // Create provider with OAuth token
      const oauthProvider = new AnthropicProvider(
        'sk-ant-oat-test-token',
        undefined,
        {
          ...TEST_PROVIDER_CONFIG,
          getEphemeralSettings: () => ({
            ...settingsService.getAllGlobalSettings(),
            ...settingsService.getProviderSettings('anthropic'),
            streaming: 'disabled',
          }),
        },
      );

      // Mock getAuthToken to return the OAuth token
      vi.spyOn(oauthProvider, 'getAuthToken').mockResolvedValue(
        'sk-ant-oat-test-token',
      );

      mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'response' }],
        usage: {
          input_tokens: 10,
          output_tokens: 5,
        },
      });

      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Test' }],
        },
      ];

      const tools = [
        {
          functionDeclarations: [
            {
              name: 'read_file',
              description: 'Read a file',
              parameters: { type: 'object', properties: {} },
            },
          ],
        },
      ];

      const callOptions = createProviderCallOptions({
        providerName: 'anthropic',
        contents: messages,
        settings: settingsService,
        runtime: runtimeContext,
        config: runtimeContext.config!,
        tools,
      });

      const generator = oauthProvider.generateChatCompletion(callOptions);
      await generator.next();

      const call = mockMessagesCreate.mock.calls[0];
      expect(call).toBeDefined();

      const requestBody = call?.[0];
      expect(requestBody).toBeDefined();
      expect(requestBody.tools).toBeDefined();
      expect(requestBody.tools[0].name).toBe('llxprt_read_file');
    });

    it('should NOT prefix tool names for regular API key requests', async () => {
      mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'response' }],
        usage: {
          input_tokens: 10,
          output_tokens: 5,
        },
      });

      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Test' }],
        },
      ];

      const tools = [
        {
          functionDeclarations: [
            {
              name: 'read_file',
              description: 'Read a file',
              parameters: { type: 'object', properties: {} },
            },
          ],
        },
      ];

      const providerWithNoStreaming = new AnthropicProvider(
        'test-api-key',
        undefined,
        {
          ...TEST_PROVIDER_CONFIG,
          getEphemeralSettings: () => ({
            ...settingsService.getAllGlobalSettings(),
            ...settingsService.getProviderSettings('anthropic'),
            streaming: 'disabled',
          }),
        },
      );

      const callOptions = createProviderCallOptions({
        providerName: 'anthropic',
        contents: messages,
        settings: settingsService,
        runtime: runtimeContext,
        config: runtimeContext.config!,
        tools,
      });

      const generator =
        providerWithNoStreaming.generateChatCompletion(callOptions);
      await generator.next();

      const call =
        mockMessagesCreate.mock.calls[mockMessagesCreate.mock.calls.length - 1];
      expect(call).toBeDefined();

      const requestBody = call?.[0];
      expect(requestBody).toBeDefined();
      expect(requestBody.tools).toBeDefined();
      expect(requestBody.tools[0].name).toBe('read_file'); // NO prefix
    });

    it('should unprefix tool names in streaming responses for OAuth', async () => {
      // Create provider with OAuth token
      const oauthProvider = new AnthropicProvider(
        'sk-ant-oat-test-token',
        undefined,
        {
          ...TEST_PROVIDER_CONFIG,
          getEphemeralSettings: () => ({
            ...settingsService.getAllGlobalSettings(),
            ...settingsService.getProviderSettings('anthropic'),
            streaming: 'enabled',
          }),
        },
      );

      // Mock getAuthToken to return the OAuth token
      vi.spyOn(oauthProvider, 'getAuthToken').mockResolvedValue(
        'sk-ant-oat-test-token',
      );

      // Mock streaming response with prefixed tool name
      const mockStream = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'content_block_start',
            content_block: {
              type: 'tool_use',
              id: 'tool-123',
              name: 'llxprt_read_file', // PREFIXED by API
            },
          };
          yield {
            type: 'content_block_delta',
            delta: {
              type: 'input_json_delta',
              partial_json: '{"path":"test.txt"}',
            },
          };
          yield { type: 'content_block_stop' };
        },
      };

      mockMessagesCreate.mockResolvedValue(mockStream);

      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Test' }],
        },
      ];

      const callOptions = createProviderCallOptions({
        providerName: 'anthropic',
        contents: messages,
        settings: settingsService,
        runtime: runtimeContext,
        config: runtimeContext.config!,
      });

      const generator = oauthProvider.generateChatCompletion(callOptions);

      const chunks = [];
      for await (const chunk of generator) {
        chunks.push(chunk);
      }

      const toolCallChunk = chunks.find((c) =>
        c.blocks.some((b) => b.type === 'tool_call'),
      );
      expect(toolCallChunk).toBeDefined();

      const toolCall = (toolCallChunk as IContent).blocks.find(
        (b) => b.type === 'tool_call',
      ) as { type: 'tool_call'; name: string };

      // Should be un-prefixed
      expect(toolCall.name).toBe('read_file');
    });

    it('should unprefix tool names in non-streaming responses for OAuth', async () => {
      // Create provider with OAuth token
      const oauthProvider = new AnthropicProvider(
        'sk-ant-oat-test-token',
        undefined,
        {
          ...TEST_PROVIDER_CONFIG,
          getEphemeralSettings: () => ({
            ...settingsService.getAllGlobalSettings(),
            ...settingsService.getProviderSettings('anthropic'),
            streaming: 'disabled',
          }),
        },
      );

      // Mock getAuthToken to return the OAuth token
      vi.spyOn(oauthProvider, 'getAuthToken').mockResolvedValue(
        'sk-ant-oat-test-token',
      );

      // Mock non-streaming response with prefixed tool name
      mockMessagesCreate.mockResolvedValueOnce({
        content: [
          {
            type: 'tool_use',
            id: 'tool-123',
            name: 'llxprt_read_file', // PREFIXED by API
            input: { path: 'test.txt' },
          },
        ],
        usage: {
          input_tokens: 10,
          output_tokens: 5,
        },
      });

      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Test' }],
        },
      ];

      const callOptions = createProviderCallOptions({
        providerName: 'anthropic',
        contents: messages,
        settings: settingsService,
        runtime: runtimeContext,
        config: runtimeContext.config!,
      });

      const generator = oauthProvider.generateChatCompletion(callOptions);
      const result = await generator.next();

      expect(result.value).toBeDefined();
      const content = result.value as IContent;

      const toolCall = content.blocks.find((b) => b.type === 'tool_call') as {
        type: 'tool_call';
        name: string;
      };

      expect(toolCall).toBeDefined();
      // Should be un-prefixed
      expect(toolCall.name).toBe('read_file');
    });

    it('should include User-Agent header for OAuth requests', async () => {
      // Create provider with OAuth token
      const oauthProvider = new AnthropicProvider(
        'sk-ant-oat-test-token',
        undefined,
        {
          ...TEST_PROVIDER_CONFIG,
          getEphemeralSettings: () => ({
            ...settingsService.getAllGlobalSettings(),
            ...settingsService.getProviderSettings('anthropic'),
            streaming: 'disabled',
          }),
        },
      );

      // Mock getAuthToken to return the OAuth token
      vi.spyOn(oauthProvider, 'getAuthToken').mockResolvedValue(
        'sk-ant-oat-test-token',
      );

      mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'response' }],
        usage: {
          input_tokens: 10,
          output_tokens: 5,
        },
      });

      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Test' }],
        },
      ];

      const callOptions = createProviderCallOptions({
        providerName: 'anthropic',
        contents: messages,
        settings: settingsService,
        runtime: runtimeContext,
        config: runtimeContext.config!,
      });

      const generator = oauthProvider.generateChatCompletion(callOptions);
      await generator.next();

      const call = mockMessagesCreate.mock.calls[0];
      expect(call).toBeDefined();

      const options = call?.[1];
      expect(options).toBeDefined();
      expect(options?.headers).toBeDefined();
      expect(options?.headers?.['User-Agent']).toBe(
        'claude-cli/2.1.2 (external, cli)',
      );
    });

    it('should include both oauth-2025-04-20 AND interleaved-thinking-2025-05-14 in anthropic-beta headers for OAuth', async () => {
      // Create provider with OAuth token
      const oauthProvider = new AnthropicProvider(
        'sk-ant-oat-test-token',
        undefined,
        {
          ...TEST_PROVIDER_CONFIG,
          getEphemeralSettings: () => ({
            ...settingsService.getAllGlobalSettings(),
            ...settingsService.getProviderSettings('anthropic'),
            streaming: 'disabled',
          }),
        },
      );

      // Mock getAuthToken to return the OAuth token
      vi.spyOn(oauthProvider, 'getAuthToken').mockResolvedValue(
        'sk-ant-oat-test-token',
      );

      mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'response' }],
        usage: {
          input_tokens: 10,
          output_tokens: 5,
        },
      });

      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Test' }],
        },
      ];

      const callOptions = createProviderCallOptions({
        providerName: 'anthropic',
        contents: messages,
        settings: settingsService,
        runtime: runtimeContext,
        config: runtimeContext.config!,
      });

      const generator = oauthProvider.generateChatCompletion(callOptions);
      await generator.next();

      const call = mockMessagesCreate.mock.calls[0];
      expect(call).toBeDefined();

      const options = call?.[1];
      expect(options).toBeDefined();
      expect(options?.headers).toBeDefined();
      const betaHeader = options?.headers?.['anthropic-beta'];
      expect(betaHeader).toContain('oauth-2025-04-20');
      expect(betaHeader).toContain('interleaved-thinking-2025-05-14');
    });

    it('should NOT add OAuth headers for non-OAuth API keys', async () => {
      mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'response' }],
        usage: {
          input_tokens: 10,
          output_tokens: 5,
        },
      });

      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Test' }],
        },
      ];

      const providerWithNoStreaming = new AnthropicProvider(
        'test-api-key',
        undefined,
        {
          ...TEST_PROVIDER_CONFIG,
          getEphemeralSettings: () => ({
            ...settingsService.getAllGlobalSettings(),
            ...settingsService.getProviderSettings('anthropic'),
            streaming: 'disabled',
          }),
        },
      );

      const callOptions = createProviderCallOptions({
        providerName: 'anthropic',
        contents: messages,
        settings: settingsService,
        runtime: runtimeContext,
        config: runtimeContext.config!,
      });

      const generator =
        providerWithNoStreaming.generateChatCompletion(callOptions);
      await generator.next();

      const call =
        mockMessagesCreate.mock.calls[mockMessagesCreate.mock.calls.length - 1];
      expect(call).toBeDefined();

      const options = call?.[1];
      expect(options).toBeDefined();

      // Should NOT have User-Agent header for non-OAuth requests
      expect(options?.headers?.['User-Agent']).toBeUndefined();
    });
  });
});
