/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 * @plan PLAN-20250909-TOKTRACK.P07
 * @requirement REQ-003
 * Provider-specific behavioral tests for token tracking
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ProviderManager } from '../packages/core/src/providers/ProviderManager.js';
import { OpenAIProvider } from '../packages/core/src/providers/openai/OpenAIProvider.js';
import { AnthropicProvider } from '../packages/core/src/providers/anthropic/AnthropicProvider.js';
import { GeminiProvider } from '../packages/core/src/providers/gemini/GeminiProvider.js';
import { LoggingProviderWrapper } from '../packages/core/src/providers/LoggingProviderWrapper.js';
import { Config } from '../packages/core/src/config/config.js';
import type { RedactionConfig } from '../packages/core/src/config/types.js';
import { initializeTestProviderRuntime } from '../packages/core/src/test-utils/runtime.js';
import { clearActiveProviderRuntimeContext } from '../packages/core/src/runtime/providerRuntimeContext.js';
import { resetSettingsService } from '../packages/core/src/settings/settingsServiceInstance.js';

/**
 * Provider-Specific Token Tracking Behavioral Tests
 *
 * These tests verify that token tracking works correctly with different
 * AI providers, handling their unique response formats and token structures.
 */
describe('Provider-Specific Token Tracking Behavioral Tests', () => {
  let providerManager: ProviderManager;
  let config: Config;
  let mockConfig: {
    getRedactionConfig: () => RedactionConfig;
    getConversationLoggingEnabled: () => boolean;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    resetSettingsService();
    const runtimeId = `token-tracking.provider.${Math.random()
      .toString(36)
      .slice(2, 10)}`;
    initializeTestProviderRuntime({
      runtimeId,
      metadata: { suite: 'token-tracking-provider', runtimeId },
    });

    config = new Config({
      sessionId: 'provider-behavioral-test-' + Date.now(),
      projectRoot: process.cwd(),
      targetDir: process.cwd(),
      llxprtHomeDir: '/tmp/.llxprt-provider-behavioral-test',
      isReadOnlyFilesystem: false,
      persistentStatePath: '/tmp/.llxprt-provider-behavioral-test/state',
      conversationLoggingEnabled: false,
      conversationLogPath: '/tmp/.llxprt-provider-behavioral-test/logs',
      getUserMemory: () => '',
      embeddingModel: 'text-embedding-3-small',
      providerConfig: undefined,
      oauthManager: undefined,
    });

    mockConfig = {
      getRedactionConfig: () => ({
        redactApiKeys: true,
        redactCredentials: true,
        redactFilePaths: false,
        redactUrls: false,
        redactEmails: false,
        redactPersonalInfo: false,
      }),
      getConversationLoggingEnabled: () => false,
    };

    providerManager = new ProviderManager();
    providerManager.setConfig(config);
    config.setProviderManager(providerManager);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearActiveProviderRuntimeContext();
  });

  /**
   * OpenAI Provider Token Handling
   * Behavioral Test: Verify OpenAI-specific token formats are handled correctly
   */
  describe('OpenAI Provider Token Handling', () => {
    it('should extract tokens from standard OpenAI completion response', () => {
      // Given: An OpenAI provider wrapper
      const openaiProvider = new OpenAIProvider('test-key');
      const wrapper = new LoggingProviderWrapper(openaiProvider, mockConfig);

      // When: Processing a standard OpenAI completion response
      const openaiResponse = {
        id: 'chatcmpl-test',
        object: 'chat.completion',
        usage: {
          prompt_tokens: 250,
          completion_tokens: 150,
          total_tokens: 400,
        },
      };

      const tokenCounts =
        wrapper.extractTokenCountsFromResponse(openaiResponse);

      // Then: Tokens are extracted correctly from usage object
      expect(tokenCounts.input_token_count).toBe(250);
      expect(tokenCounts.output_token_count).toBe(150);
      expect(tokenCounts.cached_content_token_count).toBe(0);
      expect(tokenCounts.tool_token_count).toBe(0);
      expect(tokenCounts.thoughts_token_count).toBe(0);
    });

    it('should handle OpenAI streaming response chunks without usage', () => {
      // Given: An OpenAI provider wrapper
      const openaiProvider = new OpenAIProvider('test-key');
      const wrapper = new LoggingProviderWrapper(openaiProvider, mockConfig);

      // When: Processing streaming chunks that don't include usage
      const streamingChunk = {
        id: 'chatcmpl-test',
        object: 'chat.completion.chunk',
        choices: [
          {
            delta: { content: 'Hello' },
            index: 0,
            finish_reason: null,
          },
        ],
      };

      const tokenCounts =
        wrapper.extractTokenCountsFromResponse(streamingChunk);

      // Then: Zero tokens are returned for chunks without usage
      expect(tokenCounts.input_token_count).toBe(0);
      expect(tokenCounts.output_token_count).toBe(0);
      expect(tokenCounts.cached_content_token_count).toBe(0);
      expect(tokenCounts.tool_token_count).toBe(0);
      expect(tokenCounts.thoughts_token_count).toBe(0);
    });

    it('should extract tokens from final OpenAI streaming chunk with usage', () => {
      // Given: An OpenAI provider wrapper
      const openaiProvider = new OpenAIProvider('test-key');
      const wrapper = new LoggingProviderWrapper(openaiProvider, mockConfig);

      // When: Processing final streaming chunk with usage summary
      const finalStreamingChunk = {
        id: 'chatcmpl-test',
        object: 'chat.completion.chunk',
        choices: [
          {
            delta: {},
            index: 0,
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 300,
          completion_tokens: 180,
          total_tokens: 480,
        },
      };

      const tokenCounts =
        wrapper.extractTokenCountsFromResponse(finalStreamingChunk);

      // Then: Tokens are extracted from final chunk usage
      expect(tokenCounts.input_token_count).toBe(300);
      expect(tokenCounts.output_token_count).toBe(180);
    });

    it('should handle OpenAI function calling token usage', () => {
      // Given: An OpenAI provider wrapper
      const openaiProvider = new OpenAIProvider('test-key');
      const wrapper = new LoggingProviderWrapper(openaiProvider, mockConfig);

      // When: Processing response with function call usage
      const functionCallResponse = {
        usage: {
          prompt_tokens: 400,
          completion_tokens: 50,
          total_tokens: 450,
        },
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              function_call: {
                name: 'get_weather',
                arguments: '{"location": "San Francisco"}',
              },
            },
          },
        ],
      };

      const tokenCounts =
        wrapper.extractTokenCountsFromResponse(functionCallResponse);

      // Then: Function call tokens are counted in completion tokens
      expect(tokenCounts.input_token_count).toBe(400);
      expect(tokenCounts.output_token_count).toBe(50);
      expect(tokenCounts.tool_token_count).toBe(0); // OpenAI includes tool tokens in completion_tokens
    });
  });

  /**
   * Anthropic Provider Token Handling
   * Behavioral Test: Verify Anthropic-specific token formats are handled correctly
   */
  describe('Anthropic Provider Token Handling', () => {
    it('should extract tokens from Anthropic response headers', () => {
      // Given: An Anthropic provider wrapper
      const anthropicProvider = new AnthropicProvider('test-key');
      const wrapper = new LoggingProviderWrapper(anthropicProvider, mockConfig);

      // When: Processing Anthropic response with token headers
      const anthropicResponse = {
        id: 'msg_test',
        type: 'message',
        content: [{ type: 'text', text: 'Hello, how can I help you?' }],
        headers: {
          'anthropic-input-tokens': '200',
          'anthropic-output-tokens': '120',
        },
      };

      const tokenCounts =
        wrapper.extractTokenCountsFromResponse(anthropicResponse);

      // Then: Basic tokens are extracted from headers
      expect(tokenCounts.input_token_count).toBe(200);
      expect(tokenCounts.output_token_count).toBe(120);
      // Current implementation doesn't extract cache/tool/thoughts tokens from Anthropic headers
      expect(tokenCounts.cached_content_token_count).toBe(0);
      expect(tokenCounts.tool_token_count).toBe(0);
      expect(tokenCounts.thoughts_token_count).toBe(0);
    });

    it('should handle Anthropic streaming response with incremental headers', () => {
      // Given: An Anthropic provider wrapper
      const anthropicProvider = new AnthropicProvider('test-key');
      const wrapper = new LoggingProviderWrapper(anthropicProvider, mockConfig);

      // When: Processing streaming response with token headers
      const streamingResponse = {
        type: 'content_block_delta',
        delta: { text: 'Hello' },
        headers: {
          'anthropic-input-tokens': '150',
          'anthropic-output-tokens': '75',
        },
      };

      const tokenCounts =
        wrapper.extractTokenCountsFromResponse(streamingResponse);

      // Then: Streaming tokens are extracted correctly
      expect(tokenCounts.input_token_count).toBe(150);
      expect(tokenCounts.output_token_count).toBe(75);
    });

    it('should extract tokens from Anthropic tool use response', () => {
      // Given: An Anthropic provider wrapper
      const anthropicProvider = new AnthropicProvider('test-key');
      const wrapper = new LoggingProviderWrapper(anthropicProvider, mockConfig);

      // When: Processing response with tool use
      const toolUseResponse = {
        content: [
          {
            type: 'tool_use',
            id: 'toolu_123',
            name: 'search_web',
            input: { query: 'latest news' },
          },
        ],
        headers: {
          'anthropic-input-tokens': '350',
          'anthropic-output-tokens': '80',
          'anthropic-tool-use-input-tokens': '30',
          'anthropic-tool-use-output-tokens': '20',
        },
      };

      const tokenCounts =
        wrapper.extractTokenCountsFromResponse(toolUseResponse);

      // Then: Tool tokens are included appropriately
      expect(tokenCounts.input_token_count).toBe(350);
      expect(tokenCounts.output_token_count).toBe(80);
      // Note: Tool tokens may be counted separately or included in main counts
    });

    it('should handle Anthropic thinking (reasoning) tokens', () => {
      // Given: An Anthropic provider wrapper
      const anthropicProvider = new AnthropicProvider('test-key');
      const wrapper = new LoggingProviderWrapper(anthropicProvider, mockConfig);

      // When: Processing response with thinking tokens (using usage object format)
      const reasoningResponse = {
        content: [
          {
            type: 'thinking',
            content: 'Let me think about this problem...',
          },
          {
            type: 'text',
            text: 'Based on my analysis...',
          },
        ],
        usage: {
          prompt_tokens: 200,
          completion_tokens: 150,
          thoughts_tokens: 80, // Using usage object format
        },
      };

      const tokenCounts =
        wrapper.extractTokenCountsFromResponse(reasoningResponse);

      // Then: Reasoning/thinking tokens are tracked via usage object
      expect(tokenCounts.input_token_count).toBe(200);
      expect(tokenCounts.output_token_count).toBe(150);
      expect(tokenCounts.thoughts_token_count).toBe(80);
    });
  });

  /**
   * Gemini Provider Token Handling
   * Behavioral Test: Verify Gemini-specific token formats are handled correctly
   */
  describe('Gemini Provider Token Handling', () => {
    it('should extract tokens from Gemini response usage metadata', () => {
      // Given: A Gemini provider wrapper
      const geminiProvider = new GeminiProvider();
      const wrapper = new LoggingProviderWrapper(geminiProvider, mockConfig);

      // When: Processing Gemini response with usage object
      const geminiResponse = {
        candidates: [
          {
            content: {
              parts: [{ text: 'Hello, I can help you with that!' }],
              role: 'model',
            },
            finishReason: 'STOP',
          },
        ],
        usage: {
          prompt_tokens: 180,
          completion_tokens: 95,
          total_tokens: 275,
          cached_content_tokens: 40,
        },
      };

      const tokenCounts =
        wrapper.extractTokenCountsFromResponse(geminiResponse);

      // Then: Tokens are extracted from usage object
      expect(tokenCounts.input_token_count).toBe(180);
      expect(tokenCounts.output_token_count).toBe(95);
      expect(tokenCounts.cached_content_token_count).toBe(40);
      expect(tokenCounts.tool_token_count).toBe(0);
      expect(tokenCounts.thoughts_token_count).toBe(0);
    });

    it('should handle Gemini streaming response with progressive token counts', () => {
      // Given: A Gemini provider wrapper
      const geminiProvider = new GeminiProvider();
      const wrapper = new LoggingProviderWrapper(geminiProvider, mockConfig);

      // When: Processing streaming chunk from Gemini
      const streamingChunk = {
        candidates: [
          {
            content: {
              parts: [{ text: 'Hello' }],
              role: 'model',
            },
          },
        ],
        usage: {
          prompt_tokens: 150,
          completion_tokens: 8,
          total_tokens: 158,
        },
      };

      const tokenCounts =
        wrapper.extractTokenCountsFromResponse(streamingChunk);

      // Then: Streaming tokens are tracked correctly
      expect(tokenCounts.input_token_count).toBe(150);
      expect(tokenCounts.output_token_count).toBe(8);
    });

    it('should extract tokens from Gemini function calling response', () => {
      // Given: A Gemini provider wrapper
      const geminiProvider = new GeminiProvider();
      const wrapper = new LoggingProviderWrapper(geminiProvider, mockConfig);

      // When: Processing function calling response
      const functionCallResponse = {
        candidates: [
          {
            content: {
              parts: [
                {
                  functionCall: {
                    name: 'search_tool',
                    args: { query: 'weather today' },
                  },
                },
              ],
              role: 'model',
            },
          },
        ],
        usage: {
          prompt_tokens: 220,
          completion_tokens: 45,
          total_tokens: 265,
        },
      };

      const tokenCounts =
        wrapper.extractTokenCountsFromResponse(functionCallResponse);

      // Then: Function call tokens are included in completion count
      expect(tokenCounts.input_token_count).toBe(220);
      expect(tokenCounts.output_token_count).toBe(45);
    });
  });

  /**
   * Cross-Provider Token Consistency
   * Behavioral Test: Verify consistent behavior across different providers
   */
  describe('Cross-Provider Token Consistency', () => {
    it('should maintain consistent session totals regardless of provider mix', () => {
      // Given: Multiple providers registered
      const openaiProvider = new OpenAIProvider('test-openai-key');
      const anthropicProvider = new AnthropicProvider('test-anthropic-key');
      const geminiProvider = new GeminiProvider();

      providerManager.registerProvider(openaiProvider);
      providerManager.registerProvider(anthropicProvider);
      providerManager.registerProvider(geminiProvider);
      providerManager.resetSessionTokenUsage();

      // When: Each provider contributes tokens with different structures
      providerManager.accumulateSessionTokens('openai', {
        input: 200,
        output: 150,
        cache: 0,
        tool: 25,
        thought: 0,
      });

      providerManager.accumulateSessionTokens('anthropic', {
        input: 180,
        output: 120,
        cache: 30,
        tool: 15,
        thought: 40, // Anthropic reasoning tokens
      });

      providerManager.accumulateSessionTokens('gemini', {
        input: 160,
        output: 100,
        cache: 20,
        tool: 0,
        thought: 0,
      });

      const sessionUsage = providerManager.getSessionTokenUsage();

      // Then: All contributions are properly aggregated
      expect(sessionUsage.input).toBe(540); // 200 + 180 + 160
      expect(sessionUsage.output).toBe(370); // 150 + 120 + 100
      expect(sessionUsage.cache).toBe(50); // 0 + 30 + 20
      expect(sessionUsage.tool).toBe(40); // 25 + 15 + 0
      expect(sessionUsage.thought).toBe(40); // 0 + 40 + 0
      expect(sessionUsage.total).toBe(1040);
    });

    it('should handle missing or incomplete token data gracefully across providers', () => {
      // Given: Provider wrappers for different providers
      const providers = [
        new LoggingProviderWrapper(new OpenAIProvider('test-key'), mockConfig),
        new LoggingProviderWrapper(
          new AnthropicProvider('test-key'),
          mockConfig,
        ),
        new LoggingProviderWrapper(new GeminiProvider(), mockConfig),
      ];

      // When: Processing responses with missing or incomplete token data
      const incompleteResponses = [
        {}, // Empty response
        { usage: {} }, // Empty usage
        { headers: {} }, // Empty headers
        { usageMetadata: {} }, // Empty usage metadata
        null, // Null response
        undefined, // Undefined response
      ];

      // Then: All providers handle missing data gracefully
      providers.forEach((wrapper, providerIndex) => {
        incompleteResponses.forEach((response, responseIndex) => {
          expect(() => {
            const tokenCounts =
              wrapper.extractTokenCountsFromResponse(response);
            expect(tokenCounts.input_token_count).toBe(0);
            expect(tokenCounts.output_token_count).toBe(0);
            expect(tokenCounts.cached_content_token_count).toBe(0);
            expect(tokenCounts.tool_token_count).toBe(0);
            expect(tokenCounts.thoughts_token_count).toBe(0);
          }).not.toThrow(
            `Provider ${providerIndex}, Response ${responseIndex}`,
          );
        });
      });
    });

    it('should preserve token accuracy when switching between providers', () => {
      // Given: A session with provider switching
      providerManager.registerProvider(new OpenAIProvider('test-openai'));
      providerManager.registerProvider(new AnthropicProvider('test-anthropic'));
      providerManager.resetSessionTokenUsage();

      // When: Switching providers mid-session and accumulating tokens
      providerManager.setActiveProvider('openai');
      providerManager.accumulateSessionTokens('openai', {
        input: 100,
        output: 75,
        cache: 0,
        tool: 0,
        thought: 0,
      });

      const afterOpenAI = providerManager.getSessionTokenUsage();
      expect(afterOpenAI.total).toBe(175);

      providerManager.setActiveProvider('anthropic');
      providerManager.accumulateSessionTokens('anthropic', {
        input: 150,
        output: 90,
        cache: 25,
        tool: 10,
        thought: 20,
      });

      const afterAnthropic = providerManager.getSessionTokenUsage();
      expect(afterAnthropic.total).toBe(470); // 175 + 295

      providerManager.setActiveProvider('openai');
      providerManager.accumulateSessionTokens('openai', {
        input: 80,
        output: 60,
        cache: 15,
        tool: 5,
        thought: 0,
      });

      const final = providerManager.getSessionTokenUsage();

      // Then: Token accuracy is preserved across provider switches
      expect(final.input).toBe(330); // 100 + 150 + 80
      expect(final.output).toBe(225); // 75 + 90 + 60
      expect(final.cache).toBe(40); // 0 + 25 + 15
      expect(final.tool).toBe(15); // 0 + 10 + 5
      expect(final.thought).toBe(20); // 0 + 20 + 0
      expect(final.total).toBe(630);
    });
  });
});
