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
 * @plan PLAN-20251127-OPENAIVERCEL.P11
 * @requirement REQ-OAV-008 - Streaming Support
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { OpenAIVercelProvider } from './OpenAIVercelProvider.js';
import type { IContent } from '../../services/history/IContent.js';
import { createProviderCallOptions } from '../../test-utils/providerCallOptions.js';
import type { ProviderCallOptions } from '../../services/generation/models/IGenerationProvider.js';
import { createRuntimeConfigStub } from '../../test-utils/runtime.js';
import { SettingsService } from '../../settings/SettingsService.js';

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

describe('OpenAIVercelProvider - Streaming', () => {
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

  function createMockStream(chunks: string[]) {
    return {
      textStream: (async function* () {
        for (const chunk of chunks) {
          yield chunk;
        }
      })(),
      toolCalls: Promise.resolve([]),
      usage: Promise.resolve({ promptTokens: 10, completionTokens: 20 }),
      finishReason: Promise.resolve('stop'),
    };
  }

  function createMockStreamWithUsage(
    chunks: string[],
    usage: { promptTokens: number; completionTokens: number },
  ) {
    return {
      textStream: (async function* () {
        for (const chunk of chunks) {
          yield chunk;
        }
      })(),
      toolCalls: Promise.resolve([]),
      usage: Promise.resolve(usage),
      finishReason: Promise.resolve('stop'),
    };
  }

  function createMockStreamWithToolCalls(toolCalls: unknown[]) {
    return {
      textStream: (async function* () {
        // Empty stream - no text chunks for tool calls
      })(),
      toolCalls: Promise.resolve(toolCalls),
      usage: Promise.resolve({ promptTokens: 10, completionTokens: 20 }),
      finishReason: Promise.resolve('tool-calls'),
    };
  }

  function createMockStreamWithError(error: Error) {
    const rejectedPromise = Promise.reject(error);
    rejectedPromise.catch(() => {});

    // biome-ignore lint/correctness/useYield
    // eslint-disable-next-line require-yield
    async function* errorStream() {
      throw error;
    }

    return {
      textStream: errorStream(),
      toolCalls: rejectedPromise,
      usage: rejectedPromise,
      finishReason: rejectedPromise,
    };
  }

  describe('REQ-OAV-008: Basic Streaming', () => {
    it('should yield text chunks as they arrive', async () => {
      const { streamText } = await import('ai');
      const mockStreamText = streamText as ReturnType<typeof vi.fn>;

      const mockStream = createMockStream(['Hello', ' world', '!']);
      mockStreamText.mockResolvedValue(mockStream);

      provider = new OpenAIVercelProvider('test-api-key', undefined, {
        settingsService,
      });

      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Hello' }],
        },
      ];

      const options: ProviderCallOptions = createProviderCallOptions({
        config,
        contents: messages,
        settings: settingsService,
        streaming: true,
        providerName: 'openaivercel',
      });

      const chunks = await collectResults(
        provider.generateChatCompletion(options),
      );

      expect(chunks).toHaveLength(4);
      expect(chunks[0].blocks[0]).toMatchObject({
        type: 'text',
        text: 'Hello',
      });
      expect(chunks[1].blocks[0]).toMatchObject({
        type: 'text',
        text: ' world',
      });
      expect(chunks[2].blocks[0]).toMatchObject({
        type: 'text',
        text: '!',
      });
      expect(chunks[3].blocks).toHaveLength(0);
      expect(chunks[3].metadata?.finishReason).toBe('stop');
    });

    it('should handle multiple sequential chunks', async () => {
      const { streamText } = await import('ai');
      const mockStreamText = streamText as ReturnType<typeof vi.fn>;

      const mockStream = createMockStream(['1', '2', '3', '4', '5']);
      mockStreamText.mockResolvedValue(mockStream);

      provider = new OpenAIVercelProvider('test-api-key', undefined, {
        settingsService,
      });

      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Count to five' }],
        },
      ];

      const options: ProviderCallOptions = createProviderCallOptions({
        config,
        contents: messages,
        settings: settingsService,
        streaming: true,
        providerName: 'openaivercel',
      });

      const chunks = await collectResults(
        provider.generateChatCompletion(options),
      );

      expect(chunks).toHaveLength(6);
      for (let i = 0; i < 5; i++) {
        expect(chunks[i].blocks[0]).toMatchObject({
          type: 'text',
          text: String(i + 1),
        });
      }
      expect(chunks[5].blocks).toHaveLength(0);
      expect(chunks[5].metadata?.finishReason).toBe('stop');
    });

    it('should handle finish reason in metadata', async () => {
      const { streamText } = await import('ai');
      const mockStreamText = streamText as ReturnType<typeof vi.fn>;

      const mockStream = createMockStream(['Response']);
      mockStreamText.mockResolvedValue(mockStream);

      provider = new OpenAIVercelProvider('test-api-key', undefined, {
        settingsService,
      });

      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Hello' }],
        },
      ];

      const options: ProviderCallOptions = createProviderCallOptions({
        config,
        contents: messages,
        settings: settingsService,
        streaming: true,
        providerName: 'openaivercel',
      });

      const chunks = await collectResults(
        provider.generateChatCompletion(options),
      );

      const lastChunk = chunks[chunks.length - 1];
      expect(lastChunk.metadata?.finishReason).toBe('stop');
    });

    it('should handle empty stream gracefully', async () => {
      const { streamText } = await import('ai');
      const mockStreamText = streamText as ReturnType<typeof vi.fn>;

      const mockStream = createMockStream([]);
      mockStreamText.mockResolvedValue(mockStream);

      provider = new OpenAIVercelProvider('test-api-key', undefined, {
        settingsService,
      });

      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Hello' }],
        },
      ];

      const options: ProviderCallOptions = createProviderCallOptions({
        config,
        contents: messages,
        settings: settingsService,
        streaming: true,
        providerName: 'openaivercel',
      });

      const chunks = await collectResults(
        provider.generateChatCompletion(options),
      );

      expect(chunks).toHaveLength(1);
      expect(chunks[0].metadata?.usage).toBeDefined();
    });
  });

  describe('REQ-OAV-008: Tool Call Streaming', () => {
    it('should yield tool call chunks as they arrive', async () => {
      const { streamText } = await import('ai');
      const mockStreamText = streamText as ReturnType<typeof vi.fn>;

      const mockToolCalls = [
        {
          type: 'tool-call' as const,
          toolCallId: 'call_1',
          toolName: 'test_tool',
          args: { arg: 'value' },
        },
      ];

      const mockStream = createMockStreamWithToolCalls(mockToolCalls);
      mockStreamText.mockResolvedValue(mockStream);

      provider = new OpenAIVercelProvider('test-api-key', undefined, {
        settingsService,
      });

      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Call a tool' }],
        },
      ];

      const options: ProviderCallOptions = createProviderCallOptions({
        config,
        contents: messages,
        settings: settingsService,
        streaming: true,
        providerName: 'openaivercel',
      });

      const chunks = await collectResults(
        provider.generateChatCompletion(options),
      );

      expect(chunks.length).toBeGreaterThan(0);
      const toolCallChunk = chunks.find((c) =>
        c.blocks.some((b) => b.type === 'tool_call'),
      );
      expect(toolCallChunk).toBeDefined();

      // Type assertion after verification
      const toolCallBlock = toolCallChunk!.blocks.find(
        (b) => b.type === 'tool_call',
      );
      expect(toolCallBlock?.id).toBe('hist_tool_1');

      const lastChunk = chunks[chunks.length - 1];
      expect(lastChunk.metadata?.finishReason).toBe('tool-calls');
    });

    it('should handle multiple concurrent tool calls', async () => {
      const { streamText } = await import('ai');
      const mockStreamText = streamText as ReturnType<typeof vi.fn>;

      const mockToolCalls = [
        {
          type: 'tool-call' as const,
          toolCallId: 'call_1',
          toolName: 'tool_a',
          args: { a: 1 },
        },
        {
          type: 'tool-call' as const,
          toolCallId: 'call_2',
          toolName: 'tool_b',
          args: { b: 2 },
        },
      ];

      const mockStream = createMockStreamWithToolCalls(mockToolCalls);
      mockStreamText.mockResolvedValue(mockStream);

      provider = new OpenAIVercelProvider('test-api-key', undefined, {
        settingsService,
      });

      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Call multiple tools' }],
        },
      ];

      const options: ProviderCallOptions = createProviderCallOptions({
        config,
        contents: messages,
        settings: settingsService,
        streaming: true,
        providerName: 'openaivercel',
      });

      const chunks = await collectResults(
        provider.generateChatCompletion(options),
      );

      expect(chunks.length).toBeGreaterThan(0);
      const toolCallChunk = chunks.find((c) =>
        c.blocks.some((b) => b.type === 'tool_call'),
      );
      expect(toolCallChunk?.blocks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'hist_tool_1' }),
          expect.objectContaining({ id: 'hist_tool_2' }),
        ]),
      );

      const toolCallChunks = chunks.filter((c) =>
        c.blocks.some((b) => b.type === 'tool_call'),
      );
      expect(toolCallChunks.length).toBe(1);
      expect(toolCallChunks[0].blocks).toHaveLength(2);
    });
  });

  describe('REQ-OAV-008: Error Handling', () => {
    it('should handle errors during stream', async () => {
      const { streamText } = await import('ai');
      const mockStreamText = streamText as ReturnType<typeof vi.fn>;

      const error = new Error('Stream error occurred');
      const mockStream = createMockStreamWithError(error);
      mockStreamText.mockResolvedValue(mockStream);

      provider = new OpenAIVercelProvider('test-api-key', undefined, {
        settingsService,
      });

      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Hello' }],
        },
      ];

      const options: ProviderCallOptions = createProviderCallOptions({
        config,
        contents: messages,
        settings: settingsService,
        streaming: true,
        providerName: 'openaivercel',
      });

      await expect(async () => {
        for await (const _ of provider.generateChatCompletion(options)) {
          // iterate to trigger error
        }
      }).rejects.toThrow('Stream error occurred');
    });

    it('should handle network errors during streaming', async () => {
      const { streamText } = await import('ai');
      const mockStreamText = streamText as ReturnType<typeof vi.fn>;

      mockStreamText.mockRejectedValue(new Error('Network error'));

      provider = new OpenAIVercelProvider('test-api-key', undefined, {
        settingsService,
      });

      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Hello' }],
        },
      ];

      const options: ProviderCallOptions = createProviderCallOptions({
        config,
        contents: messages,
        settings: settingsService,
        streaming: true,
        providerName: 'openaivercel',
      });

      await expect(
        collectResults(provider.generateChatCompletion(options)),
      ).rejects.toThrow('Network error');
    });
  });

  describe('REQ-OAV-008: Usage Metadata', () => {
    it('should include usage metadata in final chunk', async () => {
      const { streamText } = await import('ai');
      const mockStreamText = streamText as ReturnType<typeof vi.fn>;

      const mockStream = createMockStreamWithUsage(['Response'], {
        promptTokens: 10,
        completionTokens: 5,
      });
      mockStreamText.mockResolvedValue(mockStream);

      provider = new OpenAIVercelProvider('test-api-key', undefined, {
        settingsService,
      });

      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Hello' }],
        },
      ];

      const options: ProviderCallOptions = createProviderCallOptions({
        config,
        contents: messages,
        settings: settingsService,
        streaming: true,
        providerName: 'openaivercel',
      });

      const chunks = await collectResults(
        provider.generateChatCompletion(options),
      );

      const lastChunk = chunks[chunks.length - 1];
      expect(lastChunk.metadata?.usage).toMatchObject({
        promptTokens: 10,
        completionTokens: 5,
      });
    });

    it('should handle missing usage metadata gracefully', async () => {
      const { streamText } = await import('ai');
      const mockStreamText = streamText as ReturnType<typeof vi.fn>;

      const mockStream = createMockStream(['Response']);
      mockStreamText.mockResolvedValue(mockStream);

      provider = new OpenAIVercelProvider('test-api-key', undefined, {
        settingsService,
      });

      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Hello' }],
        },
      ];

      const options: ProviderCallOptions = createProviderCallOptions({
        config,
        contents: messages,
        settings: settingsService,
        streaming: true,
        providerName: 'openaivercel',
      });

      const chunks = await collectResults(
        provider.generateChatCompletion(options),
      );

      const lastChunk = chunks[chunks.length - 1];
      expect(lastChunk.metadata?.usage).toBeDefined();
    });
  });

  describe('REQ-OAV-008: Content Types', () => {
    it('should handle mixed text and tool call streams', async () => {
      const { streamText } = await import('ai');
      const mockStreamText = streamText as ReturnType<typeof vi.fn>;

      const mockStream = createMockStream(['Let me ', 'help with that']);
      mockStreamText.mockResolvedValue(mockStream);

      provider = new OpenAIVercelProvider('test-api-key', undefined, {
        settingsService,
      });

      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Do something' }],
        },
      ];

      const options: ProviderCallOptions = createProviderCallOptions({
        config,
        contents: messages,
        settings: settingsService,
        streaming: true,
        providerName: 'openaivercel',
      });

      const chunks = await collectResults(
        provider.generateChatCompletion(options),
      );

      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0].blocks[0].type).toBe('text');
      expect(chunks[1].blocks[0].type).toBe('text');
    });
  });

  describe('REQ-OAV-008: Stream Configuration', () => {
    it('should pass model configuration to streamText', async () => {
      const { streamText } = await import('ai');
      const mockStreamText = streamText as ReturnType<typeof vi.fn>;

      const mockStream = createMockStream(['Response']);
      mockStreamText.mockResolvedValue(mockStream);

      provider = new OpenAIVercelProvider('test-api-key', undefined, {
        settingsService,
      });

      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Hello' }],
        },
      ];

      const options: ProviderCallOptions = createProviderCallOptions({
        config,
        contents: messages,
        settings: settingsService,
        streaming: true,
        providerName: 'openaivercel',
        modelOverride: 'gpt-4',
      });

      await collectResults(provider.generateChatCompletion(options));

      expect(mockStreamText).toHaveBeenCalledWith(
        expect.objectContaining({
          model: expect.anything(),
        }),
      );
    });

    it('should pass temperature configuration to streamText', async () => {
      const { streamText } = await import('ai');
      const mockStreamText = streamText as ReturnType<typeof vi.fn>;

      const mockStream = createMockStream(['Response']);
      mockStreamText.mockResolvedValue(mockStream);

      provider = new OpenAIVercelProvider('test-api-key', undefined, {
        settingsService,
      });

      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Hello' }],
        },
      ];

      const options: ProviderCallOptions = createProviderCallOptions({
        config,
        contents: messages,
        settings: settingsService,
        settingsOverrides: {
          provider: {
            temperature: 0.8,
          },
        },
        streaming: true,
        providerName: 'openaivercel',
      });

      await collectResults(provider.generateChatCompletion(options));

      expect(mockStreamText).toHaveBeenCalledWith(
        expect.objectContaining({
          temperature: 0.8,
        }),
      );
    });

    it('should pass maxTokens configuration to streamText', async () => {
      const { streamText } = await import('ai');
      const mockStreamText = streamText as ReturnType<typeof vi.fn>;

      const mockStream = createMockStream(['Response']);
      mockStreamText.mockResolvedValue(mockStream);

      provider = new OpenAIVercelProvider('test-api-key', undefined, {
        settingsService,
      });

      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Hello' }],
        },
      ];

      const options: ProviderCallOptions = createProviderCallOptions({
        config,
        contents: messages,
        settings: settingsService,
        settingsOverrides: {
          provider: {
            maxTokens: 100,
          },
        },
        streaming: true,
        providerName: 'openaivercel',
      });

      await collectResults(provider.generateChatCompletion(options));

      expect(mockStreamText).toHaveBeenCalledWith(
        expect.objectContaining({
          maxTokens: 100,
        }),
      );
    });
  });
});
