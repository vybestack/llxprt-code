/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tests for AnthropicProvider - cache metrics and hit rate.
 * Split from AnthropicProvider.test.ts for max-lines compliance.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AnthropicProvider } from './AnthropicProvider.js';
import { TEST_PROVIDER_CONFIG } from '../test-utils/providerTestConfig.js';
import { clearActiveProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  setupAnthropicProvider,
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
  let provider: AnthropicProvider;
  let settingsService: AnthropicTestSetup['settingsService'];
  let runtimeContext: ProviderRuntimeContext;
  let buildCallOptions: AnthropicTestSetup['buildCallOptions'];

  beforeEach(() => {
    vi.clearAllMocks();
    const setup = setupAnthropicProvider();
    settingsService = setup.settingsService;
    runtimeContext = setup.runtimeContext;
    buildCallOptions = setup.buildCallOptions;
    runtimeContext.config.getEphemeralSettings = () => ({
      ...settingsService.getAllGlobalSettings(),
      ...settingsService.getProviderSettings('anthropic'),
    });
    provider = new AnthropicProvider('test-api-key', undefined, {
      ...TEST_PROVIDER_CONFIG,
      getEphemeralSettings: () => ({
        ...settingsService.getAllGlobalSettings(),
        ...settingsService.getProviderSettings('anthropic'),
      }),
    });
    runtimeContext.config.streaming = 'disabled';
  });

  afterEach(() => {
    clearActiveProviderRuntimeContext();
  });
  describe('Prompt Caching - Metrics', () => {
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
  });
});
