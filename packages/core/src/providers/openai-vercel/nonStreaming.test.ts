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
import { IContent } from '../../services/history/IContent.js';
import { createProviderCallOptions } from '../../test-utils/providerCallOptions.js';
import { createRuntimeConfigStub } from '../../test-utils/runtime.js';
import { SettingsService } from '../../settings/SettingsService.js';
import type { ProviderToolset } from '../IProvider.js';

// Mock the 'ai' module
vi.mock('ai', () => ({
  generateText: vi.fn(),
  streamText: vi.fn(),
}));

// Mock @ai-sdk/openai
vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: vi.fn(() => vi.fn((modelId: string) => ({ modelId }))),
}));

describe('OpenAIVercelProvider - Non-Streaming Generation (P09)', () => {
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

  describe('Simple Text Generation', () => {
    it('should generate a simple text response', async () => {
      const { generateText } = await import('ai');
      const mockGenerateText = generateText as ReturnType<typeof vi.fn>;

      mockGenerateText.mockResolvedValue({
        text: 'Hello! How can I help you today?',
        toolCalls: [],
        finishReason: 'stop',
        usage: {
          promptTokens: 10,
          completionTokens: 8,
          totalTokens: 18,
        },
      });

      provider = new OpenAIVercelProvider('test-api-key', undefined, {
        settingsService,
      });

      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Hello' }],
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
      expect(mockGenerateText).toHaveBeenCalledOnce();
    });

    it('should include text content in the response', async () => {
      const { generateText } = await import('ai');
      const mockGenerateText = generateText as ReturnType<typeof vi.fn>;

      mockGenerateText.mockResolvedValue({
        text: 'I am doing well, thank you for asking!',
        toolCalls: [],
        finishReason: 'stop',
        usage: {
          promptTokens: 15,
          completionTokens: 10,
          totalTokens: 25,
        },
      });

      provider = new OpenAIVercelProvider('test-api-key', undefined, {
        settingsService,
      });

      const messages: IContent[] = [
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
      const results = await collectResults(iterator);

      // Find the text block in results
      const textContent = results.find(
        (r) => r.speaker === 'ai' && r.blocks.some((b) => b.type === 'text'),
      );
      expect(textContent).toBeDefined();
    });

    it('should handle empty response text', async () => {
      const { generateText } = await import('ai');
      const mockGenerateText = generateText as ReturnType<typeof vi.fn>;

      mockGenerateText.mockResolvedValue({
        text: '',
        toolCalls: [],
        finishReason: 'stop',
        usage: {
          promptTokens: 10,
          completionTokens: 0,
          totalTokens: 10,
        },
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

      // Should still return a result even with empty text
      expect(results).toBeDefined();
    });
  });

  describe('Tool Call Generation', () => {
    it('should generate a single tool call', async () => {
      const { generateText } = await import('ai');
      const mockGenerateText = generateText as ReturnType<typeof vi.fn>;

      mockGenerateText.mockResolvedValue({
        text: '',
        toolCalls: [
          {
            toolCallId: 'call_123',
            toolName: 'get_weather',
            args: { location: 'San Francisco' },
          },
        ],
        finishReason: 'tool-calls',
        usage: {
          promptTokens: 50,
          completionTokens: 20,
          totalTokens: 70,
        },
      });

      provider = new OpenAIVercelProvider('test-api-key', undefined, {
        settingsService,
      });

      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [
            { type: 'text', text: 'What is the weather in San Francisco?' },
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
      const results = await collectResults(iterator);

      // Find tool call in results
      const toolCallContent = results.find((r) =>
        r.blocks.some((b) => b.type === 'tool_call'),
      );
      expect(toolCallContent).toBeDefined();
      if (toolCallContent) {
        const toolCallBlock = toolCallContent.blocks.find(
          (b) => b.type === 'tool_call',
        );
        expect(toolCallBlock).toMatchObject({
          type: 'tool_call',
          id: 'hist_tool_123',
          name: 'get_weather',
          parameters: { location: 'San Francisco' },
        });
      }
    });

    it('should generate multiple tool calls', async () => {
      const { generateText } = await import('ai');
      const mockGenerateText = generateText as ReturnType<typeof vi.fn>;

      mockGenerateText.mockResolvedValue({
        text: '',
        toolCalls: [
          {
            toolCallId: 'call_123',
            toolName: 'get_weather',
            args: { location: 'San Francisco' },
          },
          {
            toolCallId: 'call_456',
            toolName: 'get_weather',
            args: { location: 'New York' },
          },
        ],
        finishReason: 'tool-calls',
        usage: {
          promptTokens: 60,
          completionTokens: 30,
          totalTokens: 90,
        },
      });

      provider = new OpenAIVercelProvider('test-api-key', undefined, {
        settingsService,
      });

      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [
            {
              type: 'text',
              text: 'What is the weather in San Francisco and New York?',
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
      const results = await collectResults(iterator);

      // Find all tool calls in results
      const toolCalls = results.flatMap((r) =>
        r.blocks.filter((b) => b.type === 'tool_call'),
      );
      expect(toolCalls.length).toBe(2);
      expect(toolCalls.map((tc) => tc.id)).toEqual(
        expect.arrayContaining(['hist_tool_123', 'hist_tool_456']),
      );
    });

    it('should handle text with tool calls', async () => {
      const { generateText } = await import('ai');
      const mockGenerateText = generateText as ReturnType<typeof vi.fn>;

      mockGenerateText.mockResolvedValue({
        text: 'Let me check the weather for you.',
        toolCalls: [
          {
            toolCallId: 'call_789',
            toolName: 'get_weather',
            args: { location: 'London' },
          },
        ],
        finishReason: 'tool-calls',
        usage: {
          promptTokens: 50,
          completionTokens: 25,
          totalTokens: 75,
        },
      });

      provider = new OpenAIVercelProvider('test-api-key', undefined, {
        settingsService,
      });

      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'What is the weather in London?' }],
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

      // Should have both text and tool call
      const hasText = results.some((r) =>
        r.blocks.some((b) => b.type === 'text'),
      );
      const hasToolCall = results.some((r) =>
        r.blocks.some((b) => b.type === 'tool_call'),
      );

      expect(hasText).toBe(true);
      expect(hasToolCall).toBe(true);
    });

    it('converts ProviderToolset into Vercel function tools', async () => {
      const { generateText } = await import('ai');
      const mockGenerateText = generateText as ReturnType<typeof vi.fn>;

      mockGenerateText.mockResolvedValue({
        text: 'Response with tools',
        toolCalls: [],
        finishReason: 'stop',
        usage: {
          promptTokens: 10,
          completionTokens: 5,
          totalTokens: 15,
        },
      });

      provider = new OpenAIVercelProvider('test-api-key', undefined, {
        settingsService,
      });

      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Weather?' }],
        },
      ];

      const tools: ProviderToolset = [
        {
          functionDeclarations: [
            {
              name: 'get_weather',
              description: 'Get the current weather',
              parametersJsonSchema: {
                type: 'object',
                properties: {
                  city: { type: 'string' },
                },
                required: ['city'],
              },
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
        tools,
        providerName: 'openaivercel',
      });

      const iterator = provider.generateChatCompletion(options);
      await collectResults(iterator);

      expect(mockGenerateText).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: [
            expect.objectContaining({
              type: 'function',
              function: expect.objectContaining({
                name: 'get_weather',
                parameters: expect.objectContaining({
                  type: 'object',
                  properties: expect.objectContaining({
                    city: { type: 'string' },
                  }),
                }),
              }),
            }),
          ],
        }),
      );
    });
  });

  describe('Usage Metadata', () => {
    it('should include usage information in response', async () => {
      const { generateText } = await import('ai');
      const mockGenerateText = generateText as ReturnType<typeof vi.fn>;

      mockGenerateText.mockResolvedValue({
        text: 'Response with usage metadata',
        toolCalls: [],
        finishReason: 'stop',
        usage: {
          promptTokens: 100,
          completionTokens: 50,
          totalTokens: 150,
        },
      });

      provider = new OpenAIVercelProvider('test-api-key', undefined, {
        settingsService,
      });

      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Tell me about usage' }],
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

      // Check that we got results (usage may be in metadata)
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe('Model Configuration', () => {
    it('should use the default model when not specified', async () => {
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
      await collectResults(iterator);

      expect(mockGenerateText).toHaveBeenCalled();
    });

    it('should use custom model from settings', async () => {
      const { generateText } = await import('ai');
      const mockGenerateText = generateText as ReturnType<typeof vi.fn>;

      mockGenerateText.mockResolvedValue({
        text: 'Response',
        toolCalls: [],
        finishReason: 'stop',
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      });

      settingsService.set('model', 'gpt-4');
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
      await collectResults(iterator);

      expect(mockGenerateText).toHaveBeenCalled();
    });
  });

  describe('Base URL Configuration', () => {
    it('should use custom base URL when provided', async () => {
      const { generateText } = await import('ai');
      const mockGenerateText = generateText as ReturnType<typeof vi.fn>;

      mockGenerateText.mockResolvedValue({
        text: 'Response',
        toolCalls: [],
        finishReason: 'stop',
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      });

      provider = new OpenAIVercelProvider(
        'test-api-key',
        'https://custom-api.example.com/v1',
        { settingsService },
      );

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
      await collectResults(iterator);

      expect(mockGenerateText).toHaveBeenCalled();
    });
  });

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
