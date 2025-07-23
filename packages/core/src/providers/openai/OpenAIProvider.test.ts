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

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenAIProvider } from './OpenAIProvider.js';
import { ContentGeneratorRole } from '../ContentGeneratorRole.js';

// Mock OpenAI module
vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: vi.fn(),
      },
    },
    models: {
      list: vi.fn(),
    },
  })),
}));

describe('OpenAIProvider', () => {
  let provider: OpenAIProvider;
  let mockOpenAIInstance: {
    chat: { completions: { create: ReturnType<typeof vi.fn> } };
    models: { list: ReturnType<typeof vi.fn> };
  };

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new OpenAIProvider('test-api-key');
    // Set a model that doesn't use the Responses API
    provider.setModel('gpt-3.5-turbo');
    // Get the mocked OpenAI instance (typed as unknown then cast)
    mockOpenAIInstance = (
      provider as unknown as { openai: typeof mockOpenAIInstance }
    ).openai; // Cast for test
  });

  describe('generateChatCompletion with usage tracking', () => {
    it('should include stream_options with include_usage', async () => {
      const mockStream = {
        async *[Symbol.asyncIterator]() {
          yield {
            choices: [{ delta: { content: 'Hello' } }],
          };
          yield {
            choices: [{ delta: { content: ' world' } }],
            usage: {
              prompt_tokens: 10,
              completion_tokens: 5,
              total_tokens: 15,
            },
          };
        },
      };

      mockOpenAIInstance.chat.completions.create.mockResolvedValue(mockStream);

      const messages = [{ role: ContentGeneratorRole.USER, content: 'Hi' }];

      const generator = provider.generateChatCompletion(messages);
      const results: unknown[] = [];
      for await (const chunk of generator) {
        results.push(chunk);
      }

      // Verify stream_options was passed
      expect(mockOpenAIInstance.chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          stream: true,
          stream_options: { include_usage: true },
        }),
      );
    });

    it('should yield usage data when provided in stream', async () => {
      const mockStream = {
        async *[Symbol.asyncIterator]() {
          yield {
            choices: [{ delta: { content: 'Test response' } }],
          };
          yield {
            choices: [{ delta: {} }],
            usage: {
              prompt_tokens: 20,
              completion_tokens: 10,
              total_tokens: 30,
            },
          };
        },
      };

      mockOpenAIInstance.chat.completions.create.mockResolvedValue(mockStream);

      const messages = [{ role: ContentGeneratorRole.USER, content: 'Test' }];

      const generator = provider.generateChatCompletion(messages);
      const results: unknown[] = [];
      for await (const chunk of generator) {
        results.push(chunk);
      }

      // Should have content chunk and usage chunk
      expect(results).toHaveLength(2);

      // Check content chunk
      expect(results[0]).toMatchObject({
        role: ContentGeneratorRole.ASSISTANT,
        content: 'Test response',
      });

      // Check usage chunk
      expect(results[1]).toMatchObject({
        role: ContentGeneratorRole.ASSISTANT,
        content: '',
        usage: {
          prompt_tokens: 20,
          completion_tokens: 10,
          total_tokens: 30,
        },
      });
    });

    it('should handle usage data with tool calls', async () => {
      const mockStream = {
        async *[Symbol.asyncIterator]() {
          yield {
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: 'call_123',
                      function: {
                        name: 'test_tool',
                        arguments: '{"param": "value"}',
                      },
                    },
                  ],
                },
              },
            ],
          };
          yield {
            choices: [{ delta: {} }],
            usage: {
              prompt_tokens: 50,
              completion_tokens: 25,
              total_tokens: 75,
            },
          };
        },
      };

      mockOpenAIInstance.chat.completions.create.mockResolvedValue(mockStream);

      const messages = [
        { role: ContentGeneratorRole.USER, content: 'Use a tool' },
      ];
      const tools = [
        {
          type: 'function' as const,
          function: {
            name: 'test_tool',
            parameters: { type: 'object', properties: {} },
          },
        },
      ];

      const generator = provider.generateChatCompletion(messages, tools);
      const results: unknown[] = [];
      for await (const chunk of generator) {
        results.push(chunk);
      }

      // Should yield tool call with usage data
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        role: ContentGeneratorRole.ASSISTANT,
        content: '',
        tool_calls: [
          {
            id: 'call_123',
            type: 'function',
            function: {
              name: 'test_tool',
              arguments: '{"param": "value"}',
            },
          },
        ],
        usage: {
          prompt_tokens: 50,
          completion_tokens: 25,
          total_tokens: 75,
        },
      });
    });
  });

  describe('model management', () => {
    it('should set and get current model', () => {
      // We set it to gpt-3.5-turbo in beforeEach to avoid Responses API
      expect(provider.getCurrentModel()).toBe('gpt-3.5-turbo');

      provider.setModel('gpt-4o');
      expect(provider.getCurrentModel()).toBe('gpt-4o');
    });
  });

  describe('configuration methods', () => {
    it('should update API key', () => {
      const newKey = 'new-test-key';
      provider.setApiKey(newKey);

      // Verify new OpenAI instance was created
      expect((provider as unknown as { apiKey: string }).apiKey).toBe(newKey);
    });

    it('should accept empty API key', () => {
      // Should not throw error for empty API key
      expect(() => provider.setApiKey('')).not.toThrow();
      expect(() => provider.setApiKey('  ')).not.toThrow();
    });

    it('should update base URL', () => {
      const newUrl = 'https://custom.openai.com';
      provider.setBaseUrl(newUrl);

      // Verify new OpenAI instance was created with base URL
      expect((provider as unknown as { baseURL?: string }).baseURL).toBe(
        newUrl,
      );
    });
  });
});
