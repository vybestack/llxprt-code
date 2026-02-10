/**
 * Tests for Anthropic provider extended thinking support.
 *
 * @plan PLAN-ANTHROPIC-THINKING
 * @requirement REQ-ANTHROPIC-THINK-001
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AnthropicProvider } from './AnthropicProvider.js';
import type {
  IContent,
  ThinkingBlock,
} from '../../services/history/IContent.js';
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

// Anthropic SDK types for thinking
import type {
  AnthropicContentBlock,
  AnthropicRequestBody,
} from './test-utils/anthropicTestUtils.js';

// Mock the prompts module
vi.mock('../../core/prompts.js', () => ({
  getCoreSystemPromptAsync: vi.fn(
    async () => "You are Claude Code, Anthropic's official CLI for Claude.",
  ),
}));

// Mock the retry utility
vi.mock('../../utils/retry.js', () => ({
  retryWithBackoff: vi.fn(async (fn) => await fn()),
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
  })),
}));

describe('AnthropicProvider Extended Thinking @plan:PLAN-ANTHROPIC-THINKING', () => {
  let provider: AnthropicProvider;
  let runtimeContext: ProviderRuntimeContext;
  let settingsService: SettingsService;

  beforeEach(() => {
    vi.clearAllMocks();

    // Helper to get ephemeral settings - captures settingsService in closure
    let ephemeralSettingsGetter: () => Record<string, unknown> = () => ({});

    const result = createProviderWithRuntime<AnthropicProvider>(
      ({ settingsService: svc }) => {
        svc.set('auth-key', 'test-api-key');
        svc.set('activeProvider', 'anthropic');
        svc.setProviderSetting('anthropic', 'streaming', 'disabled');

        // Create ephemeral settings getter that reads from this settings service
        ephemeralSettingsGetter = () => ({
          ...svc.getAllGlobalSettings(),
          ...svc.getProviderSettings('anthropic'),
        });

        return new AnthropicProvider('test-api-key', undefined, {
          ...TEST_PROVIDER_CONFIG,
          getEphemeralSettings: ephemeralSettingsGetter,
        });
      },
      {
        runtimeId: 'anthropic.thinking.test',
        metadata: { source: 'AnthropicProvider.thinking.test.ts' },
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

    setActiveProviderRuntimeContext(runtimeContext);
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
      expect(request.thinking).toEqual({
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
      expect((request.thinking as { effort?: string })?.effort).toBeUndefined();
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
      ) as ThinkingBlock[];

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
        assistantMsgs[0]!.content as AnthropicContentBlock[]
      ).some((block) => block.type === 'thinking');
      expect(hasThinking).toBe(false);

      // Last assistant message should have thinking (kept)
      const lastAssistantMsg = assistantMsgs[assistantMsgs.length - 1];
      expect(Array.isArray(lastAssistantMsg?.content)).toBe(true);
      const thinkingBlock = (
        lastAssistantMsg!.content as AnthropicContentBlock[]
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

  describe('Multi-Turn Thinking Persistence Tests @requirement:REQ-ISSUE1150-FIX', () => {
    beforeEach(() => {
      settingsService.setProviderSetting('anthropic', 'streaming', 'disabled');
      settingsService.set('reasoning.enabled', true);
      settingsService.set('reasoning.includeInContext', true);
      settingsService.set('reasoning.stripFromContext', 'none');
    });

    it('should NOT disable thinking when tool calls have associated thinking blocks in history', async () => {
      // Simulate a multi-turn conversation with thinking + tool calls
      const messages: IContent[] = [
        // Turn 1: User asks
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'List files in current directory' }],
        },
        // Turn 2: AI responds with thinking + tool call
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'thinking',
              thought: 'I need to list the files',
              sourceField: 'thinking',
              signature: 'sig1',
            } as ThinkingBlock,
            {
              type: 'tool_call',
              id: 'hist_tool_001',
              name: 'list_directory',
              parameters: { path: '.' },
            },
          ],
        },
        // Turn 3: Tool result
        {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'hist_tool_001',
              toolName: 'list_directory',
              result: 'file1.txt, file2.txt',
            },
          ],
        },
        // Turn 4: User asks follow-up
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'What is in file1.txt?' }],
        },
      ];

      mockMessagesCreate.mockResolvedValueOnce({
        content: [
          {
            type: 'thinking',
            thinking: 'Now I need to read the file',
            signature: 'sig2',
          },
          { type: 'text', text: 'Let me read that file' },
        ],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const generator = provider.generateChatCompletion(
        buildCallOptions(messages),
      );
      await generator.next();

      const request = mockMessagesCreate.mock
        .calls[0][0] as AnthropicRequestBody;

      // Verify thinking is still enabled (NOT disabled)
      expect(request.thinking).toBeDefined();
      expect(request.thinking?.type).toBe('enabled');

      // Verify the tool call message includes thinking block
      const assistantMsg = request.messages.find(
        (m) =>
          m.role === 'assistant' &&
          Array.isArray(m.content) &&
          m.content.some((b) => b.type === 'tool_use'),
      );
      expect(assistantMsg).toBeDefined();

      const hasThinking = (
        assistantMsg!.content as AnthropicContentBlock[]
      ).some((b) => b.type === 'thinking' || b.type === 'redacted_thinking');
      expect(hasThinking).toBe(true);
    });

    it('should not attach orphaned thinking across intervening messages', async () => {
      // Simulate streaming scenario where thinking and tool calls are in separate IContent items
      // with a human message in between. These should NOT be merged into later tool calls.
      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Do something' }],
        },
        // Thinking block arrives first (orphaned - no tool call yet)
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'thinking',
              thought: 'Planning my approach',
              sourceField: 'thinking',
              signature: 'sig1',
            } as ThinkingBlock,
          ],
        },
        // Interruption keeps thinking orphaned
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Please continue' }],
        },
        // Tool calls arrive separately
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'tool_call',
              id: 'hist_tool_002',
              name: 'do_something',
              parameters: {},
            },
          ],
        },
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'tool_call',
              id: 'hist_tool_003',
              name: 'do_something_else',
              parameters: {},
            },
          ],
        },
        {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'hist_tool_002',
              toolName: 'do_something',
              result: 'Done',
            },
          ],
        },
        {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'hist_tool_003',
              toolName: 'do_something_else',
              result: 'Done again',
            },
          ],
        },
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Continue' }],
        },
      ];

      mockMessagesCreate.mockResolvedValueOnce({
        content: [
          {
            type: 'thinking',
            thinking: 'Continuing work',
            signature: 'sig2',
          },
          { type: 'text', text: 'Continuing...' },
        ],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const generator = provider.generateChatCompletion(
        buildCallOptions(messages),
      );
      await generator.next();

      const request = mockMessagesCreate.mock
        .calls[0][0] as AnthropicRequestBody;

      const assistantMessages = request.messages.filter(
        (m) =>
          m.role === 'assistant' &&
          Array.isArray(m.content) &&
          m.content.some((block) => block.type === 'tool_use'),
      );
      expect(assistantMessages).toHaveLength(2);

      const firstContent = assistantMessages[0]
        .content as AnthropicContentBlock[];
      const secondContent = assistantMessages[1]
        .content as AnthropicContentBlock[];

      const firstHasThinking = firstContent.some(
        (block) =>
          block.type === 'thinking' || block.type === 'redacted_thinking',
      );
      const secondHasThinking = secondContent.some(
        (block) =>
          block.type === 'thinking' || block.type === 'redacted_thinking',
      );

      expect(firstHasThinking).toBe(false);
      expect(secondHasThinking).toBe(false);
    });

    it('should keep thinking enabled even when no thinking blocks exist for tool calls', async () => {
      // Simulate a scenario where tool call has NO associated thinking at all
      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Do something' }],
        },
        // AI responds with tool call but NO thinking block anywhere
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'tool_call',
              id: 'hist_tool_003',
              name: 'do_something',
              parameters: {},
            },
          ],
        },
        {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'hist_tool_003',
              toolName: 'do_something',
              result: 'Done',
            },
          ],
        },
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Continue' }],
        },
      ];

      mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Response' }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const generator = provider.generateChatCompletion(
        buildCallOptions(messages),
      );
      await generator.next();

      const request = mockMessagesCreate.mock
        .calls[0][0] as AnthropicRequestBody;

      expect(request.thinking).toBeDefined();
    });

    it('should merge orphaned thinking blocks into the next assistant message without tool calls', async () => {
      mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Response' }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'First question' }],
        },
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'thinking',
              thought: 'Thinking about it',
              sourceField: 'thinking',
              signature: 'sig-merge',
            } as ThinkingBlock,
          ],
        },
        {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'Final answer' }],
        },
      ];

      const generator = provider.generateChatCompletion(
        buildCallOptions(messages),
      );
      await generator.next();

      const request = mockMessagesCreate.mock
        .calls[0][0] as AnthropicRequestBody;
      const assistantMessages = request.messages.filter(
        (m) => m.role === 'assistant' && Array.isArray(m.content),
      );

      const lastAssistant = assistantMessages[assistantMessages.length - 1];
      const content = lastAssistant.content as AnthropicContentBlock[];

      expect(content[0]).toMatchObject({
        type: 'thinking',
        signature: 'sig-merge',
      });

      const thinkingBlocks = assistantMessages.flatMap((message) =>
        (message.content as AnthropicContentBlock[]).filter(
          (block) => block.type === 'thinking',
        ),
      );
      expect(thinkingBlocks).toHaveLength(1);
    });

    it('should find orphaned thinking up to 3 messages back', async () => {
      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Start' }],
        },
        // Orphaned thinking block
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'thinking',
              thought: 'Deep thinking',
              sourceField: 'thinking',
              signature: 'sig1',
            } as ThinkingBlock,
          ],
        },
        // Some text in between
        {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'Intermediate response' }],
        },
        // Tool result
        {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'hist_tool_004',
              toolName: 'some_tool',
              result: 'Result',
            },
          ],
        },
        // Tool call 3 messages after thinking
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'tool_call',
              id: 'hist_tool_005',
              name: 'another_tool',
              parameters: {},
            },
          ],
        },
        {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'hist_tool_005',
              toolName: 'another_tool',
              result: 'Done',
            },
          ],
        },
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Continue' }],
        },
      ];

      mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Response' }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const generator = provider.generateChatCompletion(
        buildCallOptions(messages),
      );
      await generator.next();

      const request = mockMessagesCreate.mock
        .calls[0][0] as AnthropicRequestBody;

      const assistantMsg = request.messages.find(
        (m) => m.role === 'assistant' && Array.isArray(m.content),
      );
      expect(assistantMsg).toBeDefined();

      const content = assistantMsg?.content as AnthropicContentBlock[];
      expect(content?.[0]).toMatchObject({
        type: 'thinking',
        signature: 'sig1',
      });
    });
  });
});
