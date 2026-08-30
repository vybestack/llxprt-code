/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tests for AnthropicProvider - chat - streaming and content.
 * Split from AnthropicProvider.test.ts for max-lines compliance.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { clearActiveProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  setupAnthropicProvider,
  type AnthropicContentBlock,
  type AnthropicMessage,
  type AnthropicTestSetup,
} from './test-utils/anthropicProviderTestSetup.js';
import { createAnthropicRawPostTestAdapter } from '../test-utils/rawPostTestAdapters.js';

// Shared mock instance for messages.create - using vi.hoisted so it's
// available when vi.mock factories run.
const mockMessagesCreate = vi.fn();

// Mock the ToolFormatter
void vi.mock('@vybestack/llxprt-code-tools/ToolFormatter.js', () => ({
  ToolFormatter: vi.fn().mockImplementation(() => ({
    toProviderFormat: vi.fn((tools: unknown[], format: string) => {
      if (format === 'anthropic') {
        return tools.map((tool) => {
          const t = tool as {
            function: {
              name: string;
              description?: string;
              parameters: Record<string, unknown>;
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
    convertToolDeclarationsToAnthropic: vi.fn(() => []),
    convertToolDeclarationsToFormat: vi.fn(() => undefined),
  })),
}));

void vi.mock('@vybestack/llxprt-code-core/core/prompts.js', () => ({
  getCoreSystemPromptAsync: vi.fn(
    async () => "You are Claude Code, Anthropic's official CLI for Claude.",
  ),
}));

void vi.mock('@vybestack/llxprt-code-core/utils/retry.js', () => ({
  getErrorStatus: vi.fn(() => undefined),
  isNetworkTransientError: vi.fn(() => false),
}));

void vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    ...createAnthropicRawPostTestAdapter(mockMessagesCreate),
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

describe('AnthropicProvider tool payload handling', () => {
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
    it('should sanitize tool_use IDs to be Anthropic-compatible', async () => {
      settingsService.setProviderSetting('anthropic', 'prompt-caching', 'off');

      const mockStream = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'content_block_delta',
            delta: { type: 'text_delta', text: 'ok' },
          };

          yield { type: 'message_stop' };
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

      expect(chunks).toStrictEqual([
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
      ).find((block) => block.type === 'tool_use');
      if (toolUseBlock === undefined) {
        throw new Error('expected a tool_use block in the assistant message');
      }

      expect(toolUseBlock.id).toMatch(/^toolu_[a-zA-Z0-9_-]+$/);
    });

    it('should normalize non-object tool_call parameters to empty input objects', async () => {
      settingsService.setProviderSetting('anthropic', 'prompt-caching', 'off');

      const mockStream = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'content_block_delta',
            delta: { type: 'text_delta', text: 'ok' },
          };

          yield { type: 'message_stop' };
        },
      };

      mockAnthropicInstance.messages.create.mockResolvedValue(mockStream);

      const messages: IContent[] = [
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'tool_call',
              id: 'toolu_invalid_params',
              name: 'read_file',
              parameters: '[]',
            },
          ],
        },
      ];

      const generator = provider.generateChatCompletion(
        buildCallOptions(messages),
      );

      for await (const _chunk of generator) {
        /* drain */
      }

      const request = mockAnthropicInstance.messages.create.mock.calls[0]?.[0];
      expect(request).toBeDefined();
      const anthropicMessages = request?.messages as
        | AnthropicMessage[]
        | undefined;
      const assistantContent = anthropicMessages?.find(
        (msg) => msg.role === 'assistant' && Array.isArray(msg.content),
      )?.content as AnthropicContentBlock[] | undefined;
      const toolUseInput = assistantContent?.find(
        (block) => block.type === 'tool_use',
      )?.input;

      expect(toolUseInput).toStrictEqual({});
    });

    it('should sanitize tool_result IDs to be Anthropic-compatible', async () => {
      settingsService.setProviderSetting('anthropic', 'prompt-caching', 'off');

      const mockStream = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'content_block_delta',
            delta: { type: 'text_delta', text: 'done' },
          };

          yield { type: 'message_stop' };
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

      expect(chunks).toStrictEqual([
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
      ).find((block) => block.type === 'tool_result');
      if (toolResultBlock === undefined) {
        throw new Error('expected a tool_result block in the tool message');
      }

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
          yield { type: 'message_delta' }; // Should be ignored without usage/stop_reason
          yield {
            type: 'content_block_delta',
            delta: { type: 'text_delta', text: ' world' },
          };

          yield { type: 'message_stop' };
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

    it('should propagate stopReason from message_delta even when usage is absent', async () => {
      const mockStream = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'content_block_delta',
            delta: { type: 'text_delta', text: 'Hello' },
          };
          yield {
            type: 'message_delta',
            delta: { stop_reason: 'end_turn' },
          };
          yield {
            type: 'content_block_delta',
            delta: { type: 'text_delta', text: ' world' },
          };

          yield { type: 'message_stop' };
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

      const stopReasonChunk = chunks.find(
        (c) => c.metadata?.stopReason === 'end_turn',
      );
      expect(stopReasonChunk).toBeDefined();
      expect(stopReasonChunk?.metadata?.usage).toBeUndefined();
    });
  });
});
