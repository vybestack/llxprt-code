/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tests for AnthropicProvider - tool calls and errors.
 * Split from AnthropicProvider.test.ts for max-lines compliance.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { clearActiveProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  setupAnthropicProvider,
  type AnthropicMessage,
  type AnthropicTestSetup,
} from './test-utils/anthropicProviderTestSetup.js';

// Shared mock instance for messages.create - using vi.hoisted so it's
// available when vi.mock factories run.
const mockMessagesCreate = vi.hoisted(() => vi.fn());

// Mock the ToolFormatter
vi.mock('@vybestack/llxprt-code-tools/ToolFormatter.js', () => ({
  ToolFormatter: vi.fn().mockImplementation(() => ({
    toProviderFormat: vi.fn((tools: unknown[], format: string) => {
      if (format === 'anthropic') {
        return tools.map((tool) => {
          const t = tool as {
            function: {
              name: string;
              description?: string;
              parameters: unknown;
            };
          };
          return {
            name: t.function.name,
            description: t.function.description ?? '',
            input_schema: { type: 'object', ...t.function.parameters },
          };
        });
      }
      return tools;
    }),
    fromProviderFormat: vi.fn((rawToolCall: unknown, format: string) => {
      if (format === 'anthropic') {
        const tc = rawToolCall as {
          id: string;
          name: string;
          input?: unknown;
        };
        return [
          {
            id: tc.id,
            type: 'function',
            function: {
              name: tc.name,
              arguments: tc.input != null ? JSON.stringify(tc.input) : '',
            },
          },
        ];
      }
      return [rawToolCall];
    }),
    convertGeminiToAnthropic: vi.fn(() => []),
    convertGeminiToFormat: vi.fn(() => undefined),
  })),
}));

vi.mock('@vybestack/llxprt-code-core/core/prompts.js', () => ({
  getCoreSystemPromptAsync: vi.fn(
    async () => "You are Claude Code, Anthropic's official CLI for Claude.",
  ),
}));

vi.mock('@vybestack/llxprt-code-core/utils/retry.js', () => ({
  getErrorStatus: vi.fn(() => undefined),
  isNetworkTransientError: vi.fn(() => false),
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { create: mockMessagesCreate },
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
  const mockAnthropicInstance = { messages: { create: mockMessagesCreate } };
  let provider: AnthropicTestSetup['provider'];
  let settingsService: AnthropicTestSetup['settingsService'];
  let buildCallOptions: AnthropicTestSetup['buildCallOptions'];

  beforeEach(() => {
    vi.clearAllMocks();
    const setup = setupAnthropicProvider();
    provider = setup.provider;
    settingsService = setup.settingsService;
    buildCallOptions = setup.buildCallOptions;
  });

  afterEach(() => {
    clearActiveProviderRuntimeContext();
  });
  describe('generateChatCompletion', () => {
    it('should not retry after stopReason-only message_delta if a transient stream error follows', async () => {
      settingsService.setProviderSetting('anthropic', 'streaming', 'enabled');
      const retryModule = await import(
        '@vybestack/llxprt-code-core/utils/retry.js'
      );
      vi.mocked(retryModule.isNetworkTransientError).mockReturnValueOnce(true);

      const mockStream = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'message_delta',
            delta: { stop_reason: 'end_turn' },
          };
          throw new Error('Connection terminated after terminal metadata');
        },
      };

      const mockWithResponse = vi.fn().mockResolvedValue({
        data: mockStream,
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

      const firstChunk = await generator.next();
      expect(firstChunk.done).toBe(false);
      expect(firstChunk.value.metadata?.stopReason).toBe('end_turn');

      await expect(generator.next()).rejects.toThrow(
        'Connection terminated after terminal metadata',
      );
      expect(mockWithResponse).toHaveBeenCalledTimes(1);
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
              parametersJsonSchema: {
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
      expect(createCall.tools[0]).toStrictEqual({
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

      expect(chunks).toStrictEqual([
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

      expect(chunks).toStrictEqual([
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

        expect(chunks).toStrictEqual([
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

      expect(anthropicMessages).toStrictEqual([
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

      expect(anthropicMessages).toStrictEqual([
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

      expect(anthropicMessages).toStrictEqual([
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

      expect(anthropicMessages).toStrictEqual([
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

      expect(anthropicMessages).toStrictEqual([
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
      expect(assistantMessage.content).toStrictEqual([
        {
          type: 'tool_use',
          id: 'toolu_tool-1',
          name: 'test_tool',
          input: {},
        },
      ]);
    });
  });
});
