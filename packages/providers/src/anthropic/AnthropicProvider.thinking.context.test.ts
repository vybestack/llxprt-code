/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tests for AnthropicProvider extended thinking: non-streaming and context preservation.
 * Split from AnthropicProvider.thinking.test.ts for max-lines compliance.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import type {
  IContent,
  ThinkingBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type {
  AnthropicContentBlock,
  AnthropicRequestBody,
} from './test-utils/anthropicTestUtils.js';
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

  describe('Non-Streaming Thinking Tests @requirement:REQ-ANTHROPIC-THINK-003', () => {
    beforeEach(() => {
      settingsService.setProviderSetting('anthropic', 'streaming', 'disabled');
      // Use global settings (not provider-specific) for reasoning
      settingsService.set('reasoning.enabled', true);
    });

    it('should extract ThinkingBlock from content array with type thinking', async () => {
      mockMessagesCreate.mockResolvedValueOnce({
        content: [
          {
            type: 'thinking',
            thinking: 'Let me analyze this carefully...',
            signature: 'sig123',
          },
          {
            type: 'text',
            text: 'Based on my analysis, the answer is X.',
          },
        ],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Analyze this' }],
        },
      ];

      const generator = provider.generateChatCompletion(
        buildCallOptions(messages),
      );
      const result = await generator.next();

      expect(result.value).toBeDefined();
      const content = result.value as IContent;

      const thinkingBlock = content.blocks.find(
        (b) => b.type === 'thinking',
      ) as ThinkingBlock;
      expect(thinkingBlock).toBeDefined();
      expect(thinkingBlock.type).toBe('thinking');
      expect(thinkingBlock.thought).toBe('Let me analyze this carefully...');
      expect(thinkingBlock.sourceField).toBe('thinking');
      expect(thinkingBlock.signature).toBe('sig123');
    });

    it('should convert thinking content to ThinkingBlock format', async () => {
      mockMessagesCreate.mockResolvedValueOnce({
        content: [
          {
            type: 'thinking',
            thinking: 'Step 1: Consider the constraints',
            signature: 'sig456',
          },
        ],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Think step by step' }],
        },
      ];

      const generator = provider.generateChatCompletion(
        buildCallOptions(messages),
      );
      const result = await generator.next();

      const content = result.value as IContent;
      const thinkingBlock = content.blocks.find(
        (b) => b.type === 'thinking',
      ) as ThinkingBlock;

      expect(thinkingBlock).toMatchObject({
        type: 'thinking',
        thought: 'Step 1: Consider the constraints',
        sourceField: 'thinking',
        signature: 'sig456',
      });
    });

    it('should handle multiple thinking blocks in response', async () => {
      mockMessagesCreate.mockResolvedValueOnce({
        content: [
          {
            type: 'thinking',
            thinking: 'First thought',
            signature: 'sig1',
          },
          {
            type: 'text',
            text: 'Interim response',
          },
          {
            type: 'thinking',
            thinking: 'Second thought',
            signature: 'sig2',
          },
          {
            type: 'text',
            text: 'Final response',
          },
        ],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Complex problem' }],
        },
      ];

      const generator = provider.generateChatCompletion(
        buildCallOptions(messages),
      );
      const result = await generator.next();

      const content = result.value as IContent;
      const thinkingBlocks = content.blocks.filter(
        (b) => b.type === 'thinking',
      );

      expect(thinkingBlocks).toHaveLength(2);
      expect(thinkingBlocks[0].thought).toBe('First thought');
      expect(thinkingBlocks[1].thought).toBe('Second thought');
    });
  });

  describe('Context Preservation Tests @requirement:REQ-ANTHROPIC-THINK-004', () => {
    beforeEach(() => {
      settingsService.setProviderSetting('anthropic', 'streaming', 'disabled');
    });

    it('should apply reasoning.stripFromContext policy "all"', async () => {
      settingsService.set('reasoning.stripFromContext', 'all');
      settingsService.set('reasoning.includeInContext', true);

      mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'response' }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Hello' }],
        },
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'thinking',
              thought: 'Previous thinking',
              sourceField: 'thinking',
              signature: 'sig1',
            } as ThinkingBlock,
            { type: 'text', text: 'Previous response' },
          ],
        },
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Continue' }],
        },
      ];

      const generator = provider.generateChatCompletion(
        buildCallOptions(messages),
      );
      await generator.next();

      const request = mockMessagesCreate.mock
        .calls[0][0] as AnthropicRequestBody;

      // Find the assistant message in the request
      const assistantMsg = request.messages.find((m) => m.role === 'assistant');
      expect(assistantMsg).toBeDefined();

      // Should not have thinking block (stripped by policy)
      expect(Array.isArray(assistantMsg?.content)).toBe(true);
      const hasThinking = (
        assistantMsg!.content as AnthropicContentBlock[]
      ).some((block) => block.type === 'thinking');
      expect(hasThinking).toBe(false);
    });

    it('should apply reasoning.stripFromContext policy "allButLast"', async () => {
      settingsService.set('reasoning.stripFromContext', 'allButLast');
      settingsService.set('reasoning.includeInContext', true);

      mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'response' }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'First' }],
        },
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'thinking',
              thought: 'First thinking',
              sourceField: 'thinking',
              signature: 'sig1',
            } as ThinkingBlock,
            { type: 'text', text: 'First response' },
          ],
        },
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Second' }],
        },
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'thinking',
              thought: 'Second thinking',
              sourceField: 'thinking',
              signature: 'sig2',
            } as ThinkingBlock,
            { type: 'text', text: 'Second response' },
          ],
        },
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Third' }],
        },
      ];

      const generator = provider.generateChatCompletion(
        buildCallOptions(messages),
      );
      await generator.next();

      const request = mockMessagesCreate.mock
        .calls[0][0] as AnthropicRequestBody;

      // Find all assistant messages
      const assistantMsgs = request.messages.filter(
        (m) => m.role === 'assistant',
      );
      expect(assistantMsgs.length).toBeGreaterThan(0);

      // First assistant message should not have thinking (stripped)
      expect(Array.isArray(assistantMsgs[0]?.content)).toBe(true);
      const hasThinking = (
        assistantMsgs[0].content as AnthropicContentBlock[]
      ).some((block) => block.type === 'thinking');
      expect(hasThinking).toBe(false);

      // Last assistant message should have thinking (kept)
      const lastAssistantMsg = assistantMsgs[assistantMsgs.length - 1];
      expect(Array.isArray(lastAssistantMsg.content)).toBe(true);
      const thinkingBlock = (
        lastAssistantMsg.content as AnthropicContentBlock[]
      ).find((block) => block.type === 'thinking');
      expect(thinkingBlock).toBeDefined();
    });

    it('should apply reasoning.stripFromContext policy "none"', async () => {
      settingsService.set('reasoning.stripFromContext', 'none');
      settingsService.set('reasoning.includeInContext', true);

      mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'response' }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Hello' }],
        },
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'thinking',
              thought: 'Thinking content',
              sourceField: 'thinking',
              signature: 'sig1',
            } as ThinkingBlock,
            { type: 'text', text: 'Response' },
          ],
        },
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Continue' }],
        },
      ];

      const generator = provider.generateChatCompletion(
        buildCallOptions(messages),
      );
      await generator.next();

      const request = mockMessagesCreate.mock
        .calls[0][0] as AnthropicRequestBody;

      const assistantMsg = request.messages.find((m) => m.role === 'assistant');
      expect(assistantMsg).toBeDefined();

      // Should have thinking block (not stripped)
      expect(Array.isArray(assistantMsg?.content)).toBe(true);
      const thinkingBlock = (
        assistantMsg!.content as AnthropicContentBlock[]
      ).find((block) => block.type === 'thinking');
      expect(thinkingBlock).toBeDefined();
    });

    it('should respect reasoning.includeInContext false', async () => {
      settingsService.set('reasoning.includeInContext', false);
      settingsService.set('reasoning.enabled', true);
      settingsService.set('reasoning.stripFromContext', 'none');

      mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'response' }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Hello' }],
        },
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'thinking',
              thought: 'Thinking content',
              sourceField: 'thinking',
              signature: 'sig1',
            } as ThinkingBlock,
            { type: 'text', text: 'Response' },
          ],
        },
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Continue' }],
        },
      ];

      const generator = provider.generateChatCompletion(
        buildCallOptions(messages),
      );
      await generator.next();

      const request = mockMessagesCreate.mock
        .calls[0][0] as AnthropicRequestBody;

      const assistantMsg = request.messages.find((m) => m.role === 'assistant');
      expect(assistantMsg).toBeDefined();

      // Should not have thinking block (includeInContext is false)
      expect(Array.isArray(assistantMsg?.content)).toBe(true);
      const hasThinking = (
        assistantMsg!.content as AnthropicContentBlock[]
      ).some((block) => block.type === 'thinking');
      expect(hasThinking).toBe(false);

      // Should still enable thinking in request since reasoning is enabled
      expect(request.thinking).toBeDefined();
    });

    it('should handle thinking blocks round-trip in conversation history', async () => {
      settingsService.set('reasoning.includeInContext', true);
      settingsService.set('reasoning.stripFromContext', 'none');
      // Use global settings (not provider-specific) for reasoning
      settingsService.set('reasoning.enabled', true);
      settingsService.setProviderSetting('anthropic', 'streaming', 'disabled');

      // First response with thinking
      mockMessagesCreate.mockResolvedValueOnce({
        content: [
          {
            type: 'thinking',
            thinking: 'Original thought',
            signature: 'sig1',
          },
          { type: 'text', text: 'First response' },
        ],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const messages1: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'First question' }],
        },
      ];

      const gen1 = provider.generateChatCompletion(buildCallOptions(messages1));
      const result1 = await gen1.next();
      const content1 = result1.value as IContent;

      // Second request includes first response
      mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Second response' }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const messages2: IContent[] = [
        ...messages1,
        content1,
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Follow-up question' }],
        },
      ];

      const gen2 = provider.generateChatCompletion(buildCallOptions(messages2));
      await gen2.next();

      const request2 = mockMessagesCreate.mock
        .calls[1][0] as AnthropicRequestBody;

      // Verify the thinking block made it into the request
      const assistantMsg = request2.messages.find(
        (m) => m.role === 'assistant',
      );
      expect(assistantMsg).toBeDefined();

      expect(Array.isArray(assistantMsg?.content)).toBe(true);
      const thinkingBlock = (
        assistantMsg!.content as AnthropicContentBlock[]
      ).find((block) => block.type === 'thinking') as
        | { type: 'thinking'; thinking: string; signature: string }
        | undefined;

      expect(thinkingBlock).toBeDefined();
      expect(thinkingBlock?.thinking).toBe('Original thought');
    });
  });
});
