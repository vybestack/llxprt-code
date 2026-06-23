/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

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

/**
 * @plan PLAN-20251127-OPENAIVERCEL.P09
 * @requirement REQ-OAV-007 - Chat Completion Generation
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { OpenAIVercelProvider } from './OpenAIVercelProvider.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { createProviderCallOptions } from '@vybestack/llxprt-code-core/test-utils/providerCallOptions.js';
import { createRuntimeConfigStub } from '@vybestack/llxprt-code-core/test-utils/runtime.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';

// Mock the 'ai' module
vi.mock('ai', () => ({
  generateText: vi.fn(),
  streamText: vi.fn(),
  extractReasoningMiddleware: vi.fn(() => ({})),
  wrapLanguageModel: vi.fn((model) => model),
}));

// Mock @ai-sdk/openai
vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: vi.fn(() => vi.fn((modelId: string) => ({ modelId }))),
}));

describe('OpenAIVercelProvider - Non-Streaming Configuration (P09)', () => {
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

  describe('Message Conversion', () => {
    it('should convert human messages correctly', async () => {
      const { generateText } = await import('ai');
      const mockGenerateText = generateText as ReturnType<typeof vi.fn>;

      mockGenerateText.mockResolvedValue({
        text: 'Response',
        toolCalls: [],
        finishReason: 'stop',
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      });

      provider = new OpenAIVercelProvider('test-api-key', undefined, {
        settingsService,
      });

      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'User message' }],
        },
      ];

      const options = createProviderCallOptions({
        config,
        contents: messages,
        settings: settingsService,
        resolved: {
          streaming: false,
        },
        providerName: 'openaivercel',
      });

      const iterator = provider.generateChatCompletion(options);
      await collectResults(iterator);

      expect(mockGenerateText).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({
              role: 'user',
            }),
          ]),
        }),
      );
    });

    it('should convert AI messages correctly', async () => {
      const { generateText } = await import('ai');
      const mockGenerateText = generateText as ReturnType<typeof vi.fn>;

      mockGenerateText.mockResolvedValue({
        text: 'Response',
        toolCalls: [],
        finishReason: 'stop',
        usage: { promptTokens: 20, completionTokens: 5, totalTokens: 25 },
      });

      provider = new OpenAIVercelProvider('test-api-key', undefined, {
        settingsService,
      });

      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Hello' }],
        },
        {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'Hi there' }],
        },
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'How are you?' }],
        },
      ];

      const options = createProviderCallOptions({
        config,
        contents: messages,
        settings: settingsService,
        resolved: {
          streaming: false,
        },
        providerName: 'openaivercel',
      });

      const iterator = provider.generateChatCompletion(options);
      await collectResults(iterator);

      expect(mockGenerateText).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({ role: 'user' }),
            expect.objectContaining({ role: 'assistant' }),
            expect.objectContaining({ role: 'user' }),
          ]),
        }),
      );
    });

    it('should handle tool response messages', async () => {
      const { generateText } = await import('ai');
      const mockGenerateText = generateText as ReturnType<typeof vi.fn>;

      mockGenerateText.mockResolvedValue({
        text: 'The weather in San Francisco is sunny.',
        toolCalls: [],
        finishReason: 'stop',
        usage: { promptTokens: 50, completionTokens: 10, totalTokens: 60 },
      });

      provider = new OpenAIVercelProvider('test-api-key', undefined, {
        settingsService,
      });

      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'What is the weather?' }],
        },
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'tool_call',
              id: 'call_123',
              name: 'get_weather',
              parameters: { location: 'San Francisco' },
            },
          ],
        },
        {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'call_123',
              toolName: 'get_weather',
              result: { temperature: 72, condition: 'sunny' },
            },
          ],
        },
      ];

      const options = createProviderCallOptions({
        config,
        contents: messages,
        settings: settingsService,
        resolved: {
          streaming: false,
        },
        providerName: 'openaivercel',
      });

      const iterator = provider.generateChatCompletion(options);
      await collectResults(iterator);

      expect(mockGenerateText).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({ role: 'tool' }),
          ]),
        }),
      );
    });
  });

  describe('Finish Reasons', () => {
    it('should handle stop finish reason', async () => {
      const { generateText } = await import('ai');
      const mockGenerateText = generateText as ReturnType<typeof vi.fn>;

      mockGenerateText.mockResolvedValue({
        text: 'Complete response',
        toolCalls: [],
        finishReason: 'stop',
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      });

      provider = new OpenAIVercelProvider('test-api-key', undefined, {
        settingsService,
      });

      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Test' }],
        },
      ];

      const options = createProviderCallOptions({
        config,
        contents: messages,
        settings: settingsService,
        resolved: {
          streaming: false,
        },
        providerName: 'openaivercel',
      });

      const iterator = provider.generateChatCompletion(options);
      const results = await collectResults(iterator);

      expect(results.length).toBeGreaterThan(0);
    });

    it('should handle tool-calls finish reason', async () => {
      const { generateText } = await import('ai');
      const mockGenerateText = generateText as ReturnType<typeof vi.fn>;

      mockGenerateText.mockResolvedValue({
        text: '',
        toolCalls: [
          {
            toolCallId: 'call_abc',
            toolName: 'test_tool',
            args: {},
          },
        ],
        finishReason: 'tool-calls',
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      });

      provider = new OpenAIVercelProvider('test-api-key', undefined, {
        settingsService,
      });

      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Use a tool' }],
        },
      ];

      const options = createProviderCallOptions({
        config,
        contents: messages,
        settings: settingsService,
        resolved: {
          streaming: false,
        },
        providerName: 'openaivercel',
      });

      const iterator = provider.generateChatCompletion(options);
      const results = await collectResults(iterator);

      const hasToolCall = results.some((r) =>
        r.blocks.some((b) => b.type === 'tool_call'),
      );
      expect(hasToolCall).toBe(true);
    });

    it('should handle length finish reason', async () => {
      const { generateText } = await import('ai');
      const mockGenerateText = generateText as ReturnType<typeof vi.fn>;

      mockGenerateText.mockResolvedValue({
        text: 'Truncated response due to length...',
        toolCalls: [],
        finishReason: 'length',
        usage: { promptTokens: 10, completionTokens: 100, totalTokens: 110 },
      });

      provider = new OpenAIVercelProvider('test-api-key', undefined, {
        settingsService,
      });

      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Write a very long response' }],
        },
      ];

      const options = createProviderCallOptions({
        config,
        contents: messages,
        settings: settingsService,
        resolved: {
          streaming: false,
        },
        providerName: 'openaivercel',
      });

      const iterator = provider.generateChatCompletion(options);
      const results = await collectResults(iterator);

      expect(results.length).toBeGreaterThan(0);
    });
  });
});
