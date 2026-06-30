/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tests for AnthropicProvider extended thinking: config and streaming.
 * Split from AnthropicProvider.thinking.test.ts for max-lines compliance.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import type {
  IContent,
  ThinkingBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { AnthropicRequestBody } from './test-utils/anthropicTestUtils.js';
import {
  mockMessagesCreate,
  setupThinkingProvider,
  type ThinkingTestSetup,
} from './test-utils/anthropicThinkingTestSetup.js';
import { clearActiveProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';

describe('AnthropicProvider Extended Thinking @plan:PLAN-ANTHROPIC-THINKING', () => {
  let provider: ThinkingTestSetup['provider'];
  let settingsService: ThinkingTestSetup['settingsService'];
  let buildCallOptions: ThinkingTestSetup['buildCallOptions'];

  beforeEach(() => {
    vi.clearAllMocks();
    const setup = setupThinkingProvider();
    provider = setup.provider;
    settingsService = setup.settingsService;
    buildCallOptions = setup.buildCallOptions;
  });

  afterEach(() => {
    clearActiveProviderRuntimeContext();
  });

  describe('Thinking Config Tests @requirement:REQ-ANTHROPIC-THINK-001', () => {
    it('should add thinking config when reasoning.enabled is true', async () => {
      // Use global settings (not provider-specific) for reasoning
      settingsService.set('reasoning.enabled', true);
      settingsService.set('reasoning.budgetTokens', 5000);

      mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'response' }],
        usage: { input_tokens: 100, output_tokens: 50 },
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

      const request = mockMessagesCreate.mock
        .calls[0][0] as AnthropicRequestBody;
      expect(request.thinking).toBeDefined();
      expect(request.thinking).toStrictEqual({
        type: 'enabled',
        budget_tokens: 5000,
      });
    });

    it('should use default budget_tokens of 10000 when not specified', async () => {
      // Use global settings (not provider-specific) for reasoning
      settingsService.set('reasoning.enabled', true);
      // Don't set budgetTokens - should default to 10000

      mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'response' }],
        usage: { input_tokens: 100, output_tokens: 50 },
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

      const request = mockMessagesCreate.mock
        .calls[0][0] as AnthropicRequestBody;
      expect(request.thinking).toBeDefined();
      expect(request.thinking?.budget_tokens).toBe(10000);
    });

    it('should NOT add thinking config when reasoning.enabled is false', async () => {
      // Use global settings (not provider-specific) for reasoning
      settingsService.set('reasoning.enabled', false);

      mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'response' }],
        usage: { input_tokens: 100, output_tokens: 50 },
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

      const request = mockMessagesCreate.mock
        .calls[0][0] as AnthropicRequestBody;
      expect(request.thinking).toBeUndefined();
    });

    it('should NOT add thinking config when reasoning.enabled is not set', async () => {
      // Don't set reasoning.enabled at all

      mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'response' }],
        usage: { input_tokens: 100, output_tokens: 50 },
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

      const request = mockMessagesCreate.mock
        .calls[0][0] as AnthropicRequestBody;
      expect(request.thinking).toBeUndefined();
    });

    it('should respect custom budget_tokens value', async () => {
      // Use global settings (not provider-specific) for reasoning
      settingsService.set('reasoning.enabled', true);
      settingsService.set('reasoning.budgetTokens', 20000);

      mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'response' }],
        usage: { input_tokens: 100, output_tokens: 50 },
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

      const request = mockMessagesCreate.mock
        .calls[0][0] as AnthropicRequestBody;
      expect(request.thinking?.budget_tokens).toBe(20000);
    });

    it('should use adaptive thinking for Opus 4.6+ when no explicit budgetTokens @issue:1307', async () => {
      // Use Opus 4.6 model
      settingsService.set('reasoning.enabled', true);
      // Don't set budgetTokens or set adaptiveThinking to true

      mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'response' }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Hello' }],
        },
      ];

      const generator = provider.generateChatCompletion(
        buildCallOptions(messages, {
          settingsOverrides: {
            global: {
              model: 'claude-opus-4-6',
            },
          },
        }),
      );
      await generator.next();

      const request = mockMessagesCreate.mock
        .calls[0][0] as AnthropicRequestBody;
      expect(request.thinking).toBeDefined();
      expect(request.thinking?.type).toBe('adaptive');
      expect(request.thinking?.budget_tokens).toBeUndefined();
    });

    it('should use manual mode for Opus 4.6+ when explicit budgetTokens is set @issue:1307', async () => {
      settingsService.set('reasoning.enabled', true);
      settingsService.set('reasoning.budgetTokens', 15000);

      mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'response' }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Hello' }],
        },
      ];

      const generator = provider.generateChatCompletion(
        buildCallOptions(messages, {
          settingsOverrides: {
            global: {
              model: 'claude-opus-4-6',
            },
          },
        }),
      );
      await generator.next();

      const request = mockMessagesCreate.mock
        .calls[0][0] as AnthropicRequestBody;
      expect(request.thinking).toBeDefined();
      expect(request.thinking?.type).toBe('enabled');
      expect(request.thinking?.budget_tokens).toBe(15000);
    });

    it('should use manual mode when adaptiveThinking is explicitly false @issue:1307', async () => {
      settingsService.set('reasoning.enabled', true);
      settingsService.set('reasoning.adaptiveThinking', false);

      mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'response' }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Hello' }],
        },
      ];

      const generator = provider.generateChatCompletion(
        buildCallOptions(messages, {
          settingsOverrides: {
            global: {
              model: 'claude-opus-4-6',
            },
          },
        }),
      );
      await generator.next();

      const request = mockMessagesCreate.mock
        .calls[0][0] as AnthropicRequestBody;
      expect(request.thinking).toBeDefined();
      expect(request.thinking?.type).toBe('enabled');
      expect(request.thinking?.budget_tokens).toBe(10000); // default
    });

    it('should place effort in output_config not under thinking @issue:1307', async () => {
      settingsService.set('reasoning.enabled', true);
      settingsService.set('reasoning.effort', 'medium');

      mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'response' }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Hello' }],
        },
      ];

      const generator = provider.generateChatCompletion(
        buildCallOptions(messages, {
          settingsOverrides: {
            global: {
              model: 'claude-opus-4-6',
            },
          },
        }),
      );
      await generator.next();

      const request = mockMessagesCreate.mock
        .calls[0][0] as AnthropicRequestBody;
      expect(request.output_config).toBeDefined();
      expect(request.output_config?.effort).toBe('medium');
      // Effort should NOT be under thinking
      expect((request.thinking as { effort?: string }).effort).toBeUndefined();
    });

    it('should map xhigh effort to max for Opus 4.6+ @issue:1307', async () => {
      settingsService.set('reasoning.enabled', true);
      settingsService.set('reasoning.effort', 'xhigh');

      mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'response' }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Hello' }],
        },
      ];

      const generator = provider.generateChatCompletion(
        buildCallOptions(messages, {
          settingsOverrides: {
            global: {
              model: 'claude-opus-4-6',
            },
          },
        }),
      );
      await generator.next();

      const request = mockMessagesCreate.mock
        .calls[0][0] as AnthropicRequestBody;
      expect(request.output_config?.effort).toBe('max');
    });

    it('should downgrade xhigh effort to high for non-Opus-4.6 models @issue:1307', async () => {
      settingsService.set('reasoning.enabled', true);
      settingsService.set('reasoning.effort', 'xhigh');

      mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'response' }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Hello' }],
        },
      ];

      const generator = provider.generateChatCompletion(
        buildCallOptions(messages, {
          settingsOverrides: {
            global: {
              model: 'claude-opus-4-5-20251101',
            },
          },
        }),
      );
      await generator.next();

      const request = mockMessagesCreate.mock
        .calls[0][0] as AnthropicRequestBody;
      expect(request.output_config?.effort).toBe('high');
    });

    it('should downgrade max effort to high for non-Opus-4.6 models @issue:1307', async () => {
      settingsService.set('reasoning.enabled', true);
      settingsService.set('reasoning.effort', 'max' as unknown as 'xhigh');

      mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'response' }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Hello' }],
        },
      ];

      const generator = provider.generateChatCompletion(
        buildCallOptions(messages, {
          settingsOverrides: {
            global: {
              model: 'claude-opus-4-5-20251101',
            },
          },
        }),
      );
      await generator.next();

      const request = mockMessagesCreate.mock
        .calls[0][0] as AnthropicRequestBody;
      expect(request.output_config?.effort).toBe('high');
    });

    it('should map minimal effort to low @issue:1307', async () => {
      settingsService.set('reasoning.enabled', true);
      settingsService.set('reasoning.effort', 'minimal');

      mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'response' }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Hello' }],
        },
      ];

      const generator = provider.generateChatCompletion(
        buildCallOptions(messages, {
          settingsOverrides: {
            global: {
              model: 'claude-opus-4-6',
            },
          },
        }),
      );
      await generator.next();

      const request = mockMessagesCreate.mock
        .calls[0][0] as AnthropicRequestBody;
      expect(request.output_config?.effort).toBe('low');
    });

    it('should use manual mode for non-Opus-4.6 models even without budgetTokens @issue:1307', async () => {
      settingsService.set('reasoning.enabled', true);
      // No budgetTokens set

      mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'response' }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Hello' }],
        },
      ];

      const generator = provider.generateChatCompletion(
        buildCallOptions(messages, {
          settingsOverrides: {
            global: {
              model: 'claude-sonnet-4-5-20250929',
            },
          },
        }),
      );
      await generator.next();

      const request = mockMessagesCreate.mock
        .calls[0][0] as AnthropicRequestBody;
      expect(request.thinking).toBeDefined();
      expect(request.thinking?.type).toBe('enabled');
      expect(request.thinking?.budget_tokens).toBe(10000);
    });

    it('should use adaptive thinking for Sonnet 5 when no explicit budgetTokens @issue:2289', async () => {
      settingsService.set('reasoning.enabled', true);
      // Don't set budgetTokens

      mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'response' }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Hello' }],
        },
      ];

      const generator = provider.generateChatCompletion(
        buildCallOptions(messages, {
          settingsOverrides: {
            global: {
              model: 'claude-sonnet-5',
            },
          },
        }),
      );
      await generator.next();

      const request = mockMessagesCreate.mock
        .calls[0][0] as AnthropicRequestBody;
      expect(request.thinking).toBeDefined();
      expect(request.thinking?.type).toBe('adaptive');
      expect(request.thinking?.budget_tokens).toBeUndefined();
    });

    it('should map xhigh effort to max for Sonnet 5 @issue:2289', async () => {
      settingsService.set('reasoning.enabled', true);
      settingsService.set('reasoning.effort', 'xhigh');

      mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'response' }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Hello' }],
        },
      ];

      const generator = provider.generateChatCompletion(
        buildCallOptions(messages, {
          settingsOverrides: {
            global: {
              model: 'claude-sonnet-5',
            },
          },
        }),
      );
      await generator.next();

      const request = mockMessagesCreate.mock
        .calls[0][0] as AnthropicRequestBody;
      expect(request.output_config?.effort).toBe('max');
    });
  });

  describe('Streaming Thinking Tests @requirement:REQ-ANTHROPIC-THINK-002', () => {
    beforeEach(() => {
      settingsService.setProviderSetting('anthropic', 'streaming', 'enabled');
      // Use global settings (not provider-specific) for reasoning
      settingsService.set('reasoning.enabled', true);
    });

    it('should handle content_block_start with type thinking', async () => {
      const mockStream = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'content_block_start',
            index: 0,
            content_block: {
              type: 'thinking',
              thinking: '',
            },
          };
          yield {
            type: 'content_block_delta',
            index: 0,
            delta: {
              type: 'thinking_delta',
              thinking: 'Let me think about this problem...',
            },
          };
          yield {
            type: 'content_block_stop',
            index: 0,
          };
        },
      };

      mockMessagesCreate.mockResolvedValue(mockStream);

      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Solve this' }],
        },
      ];

      const generator = provider.generateChatCompletion(
        buildCallOptions(messages),
      );

      const chunks: IContent[] = [];
      for await (const chunk of generator) {
        chunks.push(chunk);
      }

      // Should have received thinking block
      const thinkingChunks = chunks.filter((c) =>
        c.blocks.some((b) => b.type === 'thinking'),
      );
      expect(thinkingChunks.length).toBeGreaterThan(0);

      const thinkingBlock = thinkingChunks[0].blocks.find(
        (b) => b.type === 'thinking',
      ) as ThinkingBlock;
      expect(thinkingBlock).toBeDefined();
      expect(thinkingBlock.thought).toContain('Let me think');
      expect(thinkingBlock.sourceField).toBe('thinking');
    });

    it('should accumulate thinking_delta events', async () => {
      const mockStream = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'content_block_start',
            index: 0,
            content_block: {
              type: 'thinking',
              thinking: '',
            },
          };
          yield {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'thinking_delta', thinking: 'First part ' },
          };
          yield {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'thinking_delta', thinking: 'second part ' },
          };
          yield {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'thinking_delta', thinking: 'third part' },
          };
          yield {
            type: 'content_block_stop',
            index: 0,
          };
        },
      };

      mockMessagesCreate.mockResolvedValue(mockStream);

      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Think deeply' }],
        },
      ];

      const generator = provider.generateChatCompletion(
        buildCallOptions(messages),
      );

      const chunks: IContent[] = [];
      for await (const chunk of generator) {
        chunks.push(chunk);
      }

      // Find all thinking chunks and verify accumulation
      const thinkingChunks = chunks.filter((c) =>
        c.blocks.some((b) => b.type === 'thinking'),
      );

      expect(thinkingChunks.length).toBeGreaterThan(0);

      // Last thinking chunk should have accumulated text
      const lastThinkingChunk = thinkingChunks[thinkingChunks.length - 1];
      const thinkingBlock = lastThinkingChunk.blocks.find(
        (b) => b.type === 'thinking',
      ) as ThinkingBlock;

      expect(thinkingBlock.thought).toContain('First part');
      expect(thinkingBlock.thought).toContain('second part');
      expect(thinkingBlock.thought).toContain('third part');
    });

    it('should capture signature on content_block_stop for thinking blocks', async () => {
      const mockSignature = 'abc123signature';
      const mockStream = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'content_block_start',
            index: 0,
            content_block: {
              type: 'thinking',
              thinking: '',
            },
          };
          yield {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'thinking_delta', thinking: 'Thinking...' },
          };
          yield {
            type: 'content_block_stop',
            index: 0,
            content_block: {
              type: 'thinking',
              thinking: 'Thinking...',
              signature: mockSignature,
            },
          };
        },
      };

      mockMessagesCreate.mockResolvedValue(mockStream);

      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Test signature' }],
        },
      ];

      const generator = provider.generateChatCompletion(
        buildCallOptions(messages),
      );

      const chunks: IContent[] = [];
      for await (const chunk of generator) {
        chunks.push(chunk);
      }

      const thinkingChunks = chunks.filter((c) =>
        c.blocks.some((b) => b.type === 'thinking'),
      );
      expect(thinkingChunks.length).toBeGreaterThan(0);

      const thinkingBlock = thinkingChunks[0].blocks.find(
        (b) => b.type === 'thinking',
      ) as ThinkingBlock;
      expect(thinkingBlock.signature).toBe(mockSignature);
    });

    it('should handle interleaved thinking and text blocks', async () => {
      const mockStream = {
        async *[Symbol.asyncIterator]() {
          // Thinking block
          yield {
            type: 'content_block_start',
            index: 0,
            content_block: { type: 'thinking', thinking: '' },
          };
          yield {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'thinking_delta', thinking: 'Analyzing...' },
          };
          yield {
            type: 'content_block_stop',
            index: 0,
          };
          // Text block
          yield {
            type: 'content_block_start',
            index: 1,
            content_block: { type: 'text', text: '' },
          };
          yield {
            type: 'content_block_delta',
            index: 1,
            delta: { type: 'text_delta', text: 'The answer is 42.' },
          };
          yield {
            type: 'content_block_stop',
            index: 1,
          };
        },
      };

      mockMessagesCreate.mockResolvedValue(mockStream);

      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'What is the answer?' }],
        },
      ];

      const generator = provider.generateChatCompletion(
        buildCallOptions(messages),
      );

      const chunks: IContent[] = [];
      for await (const chunk of generator) {
        chunks.push(chunk);
      }

      // Should have both thinking and text chunks
      const hasThinking = chunks.some((c) =>
        c.blocks.some((b) => b.type === 'thinking'),
      );
      const hasText = chunks.some((c) =>
        c.blocks.some((b) => b.type === 'text'),
      );

      expect(hasThinking).toBe(true);
      expect(hasText).toBe(true);
    });
  });
});
