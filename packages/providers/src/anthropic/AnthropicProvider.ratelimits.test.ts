/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tests for AnthropicProvider - rate limit tracking.
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
  describe('Rate Limit Tracking', () => {
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
        expect(rateLimitInfo?.requestsReset).toStrictEqual(
          new Date('2025-11-21T12:00:00Z'),
        );
        expect(rateLimitInfo?.tokensLimit).toBe(100000);
        expect(rateLimitInfo?.tokensRemaining).toBe(95000);
        expect(rateLimitInfo?.tokensReset).toStrictEqual(
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
        const sleepSpy = vi
          .spyOn(provider as never, 'sleep')
          .mockResolvedValue(undefined as never);

        settingsService.setProviderSetting('anthropic', 'streaming', 'enabled');
        settingsService.setProviderSetting(
          'anthropic',
          'rate-limit-throttle',
          'on',
        );

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

        // Wait a bit to allow the throttling to trigger
        await gen.next();

        // Verify the second request was made (after throttling)
        // Since we established rate limit at 4% remaining (below 5% threshold),
        // throttling should have occurred
        expect(secondWithResponse).toHaveBeenCalled();

        // Verify sleep was called for throttling
        expect(sleepSpy).toHaveBeenCalled();
        const sleepDuration = sleepSpy.mock.calls[0][0] as number;
        expect(sleepDuration).toBeGreaterThan(0);
        expect(sleepDuration).toBeLessThanOrEqual(5000);

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
  });
});
