/**
 * Copyright 2025 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { OpenAIVercelProvider } from './OpenAIVercelProvider.js';
import type { IContent } from '../../services/history/IContent.js';
import { createProviderCallOptions } from '../../test-utils/providerCallOptions.js';
import type { ProviderCallOptions } from '../../services/generation/models/IGenerationProvider.js';
import { createRuntimeConfigStub } from '../../test-utils/runtime.js';
import { SettingsService } from '../../settings/SettingsService.js';

vi.mock('ai', () => ({
  generateText: vi.fn(),
  streamText: vi.fn(),
  extractReasoningMiddleware: vi.fn(() => ({})),
  wrapLanguageModel: vi.fn((config) => config.model),
}));

vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: vi.fn(() => vi.fn((modelId: string) => ({ modelId }))),
}));

describe('OpenAIVercelProvider - Cache Metrics', () => {
  let provider: OpenAIVercelProvider;
  let settingsService: SettingsService;
  let config: ReturnType<typeof createRuntimeConfigStub>;

  beforeEach(() => {
    vi.clearAllMocks();
    settingsService = new SettingsService();
    settingsService.set('activeProvider', 'openaivercel');
    config = createRuntimeConfigStub(settingsService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function collectResults(
    iterator: AsyncIterableIterator<IContent>,
  ): Promise<IContent[]> {
    const results: IContent[] = [];
    for await (const content of iterator) {
      results.push(content);
    }
    return results;
  }

  function createTestProvider(): OpenAIVercelProvider {
    return new OpenAIVercelProvider('test-api-key', undefined, {
      settingsService,
    });
  }

  function createTestMessages(): IContent[] {
    return [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'Hello' }],
      },
    ];
  }

  function createTestOptions(streaming: boolean): ProviderCallOptions {
    return createProviderCallOptions({
      config,
      contents: createTestMessages(),
      settings: settingsService,
      resolved: {
        streaming,
      },
      providerName: 'openaivercel',
    });
  }

  describe('Vercel AI SDK usage format', () => {
    it('extracts cache metrics from Vercel AI SDK usage', async () => {
      const { generateText } = await import('ai');
      const mockGenerateText = generateText as ReturnType<typeof vi.fn>;

      mockGenerateText.mockResolvedValue({
        text: 'Response text',
        usage: {
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
          promptTokens: 100,
          completionTokens: 50,
        },
        toolCalls: [],
      });

      provider = createTestProvider();
      const options = createTestOptions(false);

      const results = await collectResults(
        provider.generateChatCompletion(options),
      );

      expect(results).toHaveLength(1);
      expect(results[0].metadata?.usage).toBeDefined();
      expect(results[0].metadata?.usage).toMatchObject({
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
      });
    });

    it('extracts OpenAI cache format from usage object', async () => {
      const { generateText } = await import('ai');
      const mockGenerateText = generateText as ReturnType<typeof vi.fn>;

      mockGenerateText.mockResolvedValue({
        text: 'Response text',
        usage: {
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
          promptTokens: 100,
          completionTokens: 50,
          prompt_tokens_details: {
            cached_tokens: 75,
          },
        },
        toolCalls: [],
      });

      provider = createTestProvider();
      const options = createTestOptions(false);

      const results = await collectResults(
        provider.generateChatCompletion(options),
      );

      expect(results).toHaveLength(1);
      expect(results[0].metadata?.usage).toBeDefined();
      expect(results[0].metadata?.usage).toMatchObject({
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        cachedTokens: 75,
      });
    });

    it('extracts Anthropic cache format from usage object', async () => {
      const { generateText } = await import('ai');
      const mockGenerateText = generateText as ReturnType<typeof vi.fn>;

      mockGenerateText.mockResolvedValue({
        text: 'Response text',
        usage: {
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
          cache_read_input_tokens: 60,
          cache_creation_input_tokens: 20,
        },
        toolCalls: [],
      });

      provider = createTestProvider();
      const options = createTestOptions(false);

      const results = await collectResults(
        provider.generateChatCompletion(options),
      );

      expect(results).toHaveLength(1);
      expect(results[0].metadata?.usage).toBeDefined();
      expect(results[0].metadata?.usage).toMatchObject({
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        cachedTokens: 60,
        cacheCreationTokens: 20,
      });
    });
  });

  describe('Fireworks cache headers via custom fetch', () => {
    // Note: Full end-to-end testing of Fireworks header extraction would require
    // mocking the underlying fetch to return fireworks-cached-prompt-tokens header.
    // This test verifies the streaming path works; actual header extraction is
    // covered by the cacheMetricsExtractor unit tests.
    it('handles streaming response and includes usage metadata', async () => {
      const { streamText } = await import('ai');
      const mockStreamText = streamText as ReturnType<typeof vi.fn>;

      mockStreamText.mockResolvedValue({
        fullStream: (async function* () {
          yield { type: 'text-delta', text: 'Hello' };
          yield {
            type: 'finish',
            finishReason: 'stop',
            totalUsage: {
              inputTokens: 100,
              outputTokens: 50,
            },
          };
        })(),
      });

      provider = createTestProvider();
      const options = createTestOptions(true);

      const results = await collectResults(
        provider.generateChatCompletion(options),
      );

      expect(results.length).toBeGreaterThan(0);
      const lastResult = results[results.length - 1];
      expect(lastResult.metadata).toBeDefined();
      expect(lastResult.metadata?.usage).toBeDefined();
      expect(lastResult.metadata?.usage?.promptTokens).toBe(100);
      expect(lastResult.metadata?.usage?.completionTokens).toBe(50);
    });
  });

  describe('Cache metrics in IContent metadata', () => {
    it('includes cache metrics in IContent metadata for non-streaming', async () => {
      const { generateText } = await import('ai');
      const mockGenerateText = generateText as ReturnType<typeof vi.fn>;

      mockGenerateText.mockResolvedValue({
        text: 'Response text',
        usage: {
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
          prompt_tokens_details: {
            cached_tokens: 75,
          },
        },
        toolCalls: [],
      });

      provider = createTestProvider();
      const options = createTestOptions(false);

      const results = await collectResults(
        provider.generateChatCompletion(options),
      );

      expect(results).toHaveLength(1);
      const firstResult = results[0];
      expect(firstResult.metadata).toBeDefined();
      expect(firstResult.metadata?.usage).toBeDefined();
      expect(firstResult.metadata?.usage).toMatchObject({
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        cachedTokens: 75,
      });
      expect(firstResult.metadata?.usage?.cacheCreationTokens).toBeUndefined();
      expect(firstResult.metadata?.usage?.cacheMissTokens).toBeUndefined();
    });

    it('includes cache metrics in IContent metadata for streaming', async () => {
      const { streamText } = await import('ai');
      const mockStreamText = streamText as ReturnType<typeof vi.fn>;

      mockStreamText.mockResolvedValue({
        fullStream: (async function* () {
          yield { type: 'text-delta', text: 'Hello' };
          yield {
            type: 'finish',
            finishReason: 'stop',
            totalUsage: {
              inputTokens: 100,
              outputTokens: 50,
              prompt_tokens_details: {
                cached_tokens: 75,
              },
            },
          };
        })(),
      });

      provider = createTestProvider();
      const options = createTestOptions(true);

      const results = await collectResults(
        provider.generateChatCompletion(options),
      );

      expect(results.length).toBeGreaterThan(0);
      const lastResult = results[results.length - 1];
      expect(lastResult.metadata).toBeDefined();
      expect(lastResult.metadata?.usage).toBeDefined();
      expect(lastResult.metadata?.usage).toMatchObject({
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        cachedTokens: 75,
      });
      expect(lastResult.metadata?.usage?.cacheCreationTokens).toBeUndefined();
      expect(lastResult.metadata?.usage?.cacheMissTokens).toBeUndefined();
    });

    it('handles Deepseek cache format with cache miss tokens', async () => {
      const { generateText } = await import('ai');
      const mockGenerateText = generateText as ReturnType<typeof vi.fn>;

      mockGenerateText.mockResolvedValue({
        text: 'Response text',
        usage: {
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
          prompt_cache_hit_tokens: 60,
          prompt_cache_miss_tokens: 40,
        },
        toolCalls: [],
      });

      provider = createTestProvider();
      const options = createTestOptions(false);

      const results = await collectResults(
        provider.generateChatCompletion(options),
      );

      expect(results).toHaveLength(1);
      expect(results[0].metadata?.usage).toBeDefined();
      expect(results[0].metadata?.usage).toMatchObject({
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        cachedTokens: 60,
        cacheMissTokens: 40,
      });
      expect(results[0].metadata?.usage?.cacheCreationTokens).toBeUndefined();
    });
  });
});
