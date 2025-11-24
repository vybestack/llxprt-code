/**
 * Example test file demonstrating test-first development for baseLLMClient
 * This file shows the structure and approach for comprehensive testing
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { BaseLLMClient } from '../../../packages/core/src/core/baseLLMClient';
import { IBaseLLMClient } from '../../../packages/core/src/core/IBaseLLMClient';
import { IUtilityLLMProvider } from '../../../packages/core/src/core/IUtilityLLMProvider';
import { Config } from '../../../packages/core/src/config/config';
import { IProviderManager } from '../../../packages/core/src/providers/IProviderManager';
import { IContent } from '../../../packages/core/src/services/history/IContent';
import {
  GenerateJsonOptions,
  EmbeddingOptions,
  GenerateContentOptions,
  UtilityOperation
} from '../../../packages/core/src/core/baseLLMClient.types';

describe('BaseLLMClient', () => {
  let baseLLMClient: IBaseLLMClient;
  let mockConfig: jest.Mocked<Config>;
  let mockProviderManager: jest.Mocked<IProviderManager>;
  let mockAnthropicProvider: jest.Mocked<IUtilityLLMProvider>;
  let mockOpenAIProvider: jest.Mocked<IUtilityLLMProvider>;
  let mockGeminiProvider: jest.Mocked<IUtilityLLMProvider>;

  beforeEach(() => {
    // Setup mocks
    mockConfig = {
      getModel: jest.fn().mockReturnValue('claude-3-5-sonnet-20241022'),
      getProvider: jest.fn().mockReturnValue('anthropic'),
      getApiKey: jest.fn().mockReturnValue('test-api-key'),
      getProxy: jest.fn().mockReturnValue(undefined),
    } as any;

    mockProviderManager = {
      getActiveProvider: jest.fn(),
      getProvider: jest.fn(),
      listProviders: jest.fn().mockReturnValue(['anthropic', 'openai', 'gemini']),
    } as any;

    // Mock provider implementations
    mockAnthropicProvider = {
      name: 'anthropic',
      generateJson: jest.fn(),
      generateEmbedding: jest.fn(),
      generateContent: jest.fn(),
      countTokens: jest.fn(),
      supportsOperation: jest.fn(),
    };

    mockOpenAIProvider = {
      name: 'openai',
      generateJson: jest.fn(),
      generateEmbedding: jest.fn(),
      generateContent: jest.fn(),
      countTokens: jest.fn(),
      supportsOperation: jest.fn(),
    };

    mockGeminiProvider = {
      name: 'gemini',
      generateJson: jest.fn(),
      generateEmbedding: jest.fn(),
      generateContent: jest.fn(),
      countTokens: jest.fn(),
      supportsOperation: jest.fn(),
    };

    // Wire up provider manager
    mockProviderManager.getProvider.mockImplementation((name: string) => {
      switch (name) {
        case 'anthropic': return mockAnthropicProvider;
        case 'openai': return mockOpenAIProvider;
        case 'gemini': return mockGeminiProvider;
        default: return null;
      }
    });

    baseLLMClient = new BaseLLMClient(mockConfig, mockProviderManager);
  });

  describe('generateJson', () => {
    const mockContents: IContent[] = [
      {
        role: 'user',
        parts: [{ text: 'Extract data from this text' }],
      },
    ];

    const mockSchema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
        age: { type: 'number' },
      },
      required: ['name', 'age'],
    };

    it('should generate JSON with Anthropic provider', async () => {
      const expectedResult = { name: 'John', age: 30 };
      mockAnthropicProvider.generateJson.mockResolvedValue(expectedResult);
      mockAnthropicProvider.supportsOperation.mockReturnValue(true);

      const result = await baseLLMClient.generateJson(
        mockContents,
        mockSchema,
        { provider: 'anthropic' }
      );

      expect(result).toEqual(expectedResult);
      expect(mockAnthropicProvider.generateJson).toHaveBeenCalledWith(
        mockContents,
        mockSchema,
        expect.objectContaining({
          model: 'claude-3-5-sonnet-20241022',
        })
      );
    });

    it('should generate JSON with OpenAI provider using JSON mode', async () => {
      const expectedResult = { name: 'Jane', age: 25 };
      mockOpenAIProvider.generateJson.mockResolvedValue(expectedResult);
      mockOpenAIProvider.supportsOperation.mockReturnValue(true);
      mockConfig.getProvider.mockReturnValue('openai');

      const result = await baseLLMClient.generateJson(
        mockContents,
        mockSchema,
        { provider: 'openai', model: 'gpt-4-turbo-preview' }
      );

      expect(result).toEqual(expectedResult);
      expect(mockOpenAIProvider.generateJson).toHaveBeenCalled();
    });

    it('should handle malformed JSON by extracting from markdown', async () => {
      const markdownWrappedJson = '```json\n{"name": "Bob", "age": 35}\n```';
      const expectedResult = { name: 'Bob', age: 35 };

      // Mock provider returning markdown-wrapped JSON
      mockGeminiProvider.generateJson.mockResolvedValue(markdownWrappedJson);
      mockGeminiProvider.supportsOperation.mockReturnValue(true);

      const result = await baseLLMClient.generateJson(
        mockContents,
        mockSchema,
        { provider: 'gemini' }
      );

      expect(result).toEqual(expectedResult);
    });

    it('should retry on transient failures with exponential backoff', async () => {
      const expectedResult = { name: 'Alice', age: 28 };

      // Fail twice, then succeed
      mockAnthropicProvider.generateJson
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Rate limit'))
        .mockResolvedValueOnce(expectedResult);

      mockAnthropicProvider.supportsOperation.mockReturnValue(true);

      const result = await baseLLMClient.generateJson(
        mockContents,
        mockSchema,
        { provider: 'anthropic', maxRetries: 3 }
      );

      expect(result).toEqual(expectedResult);
      expect(mockAnthropicProvider.generateJson).toHaveBeenCalledTimes(3);
    });

    it('should respect abort signals', async () => {
      const abortController = new AbortController();

      mockAnthropicProvider.generateJson.mockImplementation(async () => {
        // Simulate some async work
        await new Promise(resolve => setTimeout(resolve, 100));
        if (abortController.signal.aborted) {
          throw new Error('Aborted');
        }
        return { name: 'Test', age: 20 };
      });

      mockAnthropicProvider.supportsOperation.mockReturnValue(true);

      // Abort immediately
      abortController.abort();

      await expect(
        baseLLMClient.generateJson(
          mockContents,
          mockSchema,
          { provider: 'anthropic', abortSignal: abortController.signal }
        )
      ).rejects.toThrow('Aborted');
    });

    it('should fallback to default provider when specified provider fails', async () => {
      const expectedResult = { name: 'Fallback', age: 40 };

      // Primary provider fails
      mockAnthropicProvider.generateJson.mockRejectedValue(
        new Error('Provider unavailable')
      );
      mockAnthropicProvider.supportsOperation.mockReturnValue(true);

      // Fallback provider succeeds
      mockGeminiProvider.generateJson.mockResolvedValue(expectedResult);
      mockGeminiProvider.supportsOperation.mockReturnValue(true);

      mockConfig.getProvider.mockReturnValue('gemini'); // Default fallback

      const result = await baseLLMClient.generateJson(
        mockContents,
        mockSchema,
        { provider: 'anthropic' } // Try anthropic first
      );

      expect(result).toEqual(expectedResult);
      expect(mockGeminiProvider.generateJson).toHaveBeenCalled();
    });
  });

  describe('generateEmbedding', () => {
    const mockTexts = ['Hello world', 'Test embedding'];

    it('should generate embeddings with OpenAI provider', async () => {
      const expectedEmbeddings = [
        [0.1, 0.2, 0.3, 0.4],
        [0.5, 0.6, 0.7, 0.8],
      ];

      mockOpenAIProvider.generateEmbedding.mockResolvedValue(expectedEmbeddings);
      mockOpenAIProvider.supportsOperation.mockReturnValue(true);

      const result = await baseLLMClient.generateEmbedding(
        mockTexts,
        { provider: 'openai', model: 'text-embedding-3-small' }
      );

      expect(result).toEqual(expectedEmbeddings);
      expect(result.length).toBe(mockTexts.length);
    });

    it('should throw for providers that don\'t support embeddings', async () => {
      mockAnthropicProvider.supportsOperation.mockImplementation(
        (op: UtilityOperation) => op !== UtilityOperation.GENERATE_EMBEDDING
      );

      await expect(
        baseLLMClient.generateEmbedding(
          mockTexts,
          { provider: 'anthropic' }
        )
      ).rejects.toThrow('Provider anthropic does not support embeddings');
    });

    it('should handle empty text array', async () => {
      const result = await baseLLMClient.generateEmbedding(
        [],
        { provider: 'openai' }
      );

      expect(result).toEqual([]);
      expect(mockOpenAIProvider.generateEmbedding).not.toHaveBeenCalled();
    });

    it('should batch large text arrays appropriately', async () => {
      const largeTextArray = Array(150).fill('Sample text');
      const batchSize = 100; // OpenAI batch limit

      mockOpenAIProvider.supportsOperation.mockReturnValue(true);
      mockOpenAIProvider.generateEmbedding.mockImplementation(
        async (texts: string[]) => {
          return texts.map(() => [0.1, 0.2, 0.3]);
        }
      );

      const result = await baseLLMClient.generateEmbedding(
        largeTextArray,
        { provider: 'openai' }
      );

      expect(result.length).toBe(150);
      expect(mockOpenAIProvider.generateEmbedding).toHaveBeenCalledTimes(2);
    });
  });

  describe('generateContent', () => {
    const mockContents: IContent[] = [
      {
        role: 'user',
        parts: [{ text: 'Tell me a story' }],
      },
    ];

    it('should generate content with all supported providers', async () => {
      const providers = ['anthropic', 'openai', 'gemini'];

      for (const provider of providers) {
        const mockProvider = mockProviderManager.getProvider(provider);
        const expectedResponse = {
          text: `Response from ${provider}`,
          usage: {
            promptTokens: 10,
            completionTokens: 20,
            totalTokens: 30,
          },
        };

        mockProvider!.generateContent.mockResolvedValue(expectedResponse);
        mockProvider!.supportsOperation.mockReturnValue(true);

        const result = await baseLLMClient.generateContent(
          mockContents,
          { provider }
        );

        expect(result.text).toBe(`Response from ${provider}`);
        expect(result.usage?.totalTokens).toBe(30);
      }
    });

    it('should apply system instructions correctly', async () => {
      const systemInstruction = 'You are a helpful assistant';
      mockGeminiProvider.supportsOperation.mockReturnValue(true);
      mockGeminiProvider.generateContent.mockResolvedValue({
        text: 'Response with system instruction',
        usage: { promptTokens: 15, completionTokens: 25, totalTokens: 40 },
      });

      await baseLLMClient.generateContent(
        mockContents,
        {
          provider: 'gemini',
          systemInstruction
        }
      );

      expect(mockGeminiProvider.generateContent).toHaveBeenCalledWith(
        mockContents,
        expect.objectContaining({
          systemInstruction,
        })
      );
    });

    it('should respect max token limits', async () => {
      const maxTokens = 100;
      mockOpenAIProvider.supportsOperation.mockReturnValue(true);
      mockOpenAIProvider.generateContent.mockResolvedValue({
        text: 'Limited response',
        finishReason: 'length',
      });

      await baseLLMClient.generateContent(
        mockContents,
        {
          provider: 'openai',
          maxTokens
        }
      );

      expect(mockOpenAIProvider.generateContent).toHaveBeenCalledWith(
        mockContents,
        expect.objectContaining({
          maxTokens,
        })
      );
    });
  });

  describe('countTokens', () => {
    const mockContents: IContent[] = [
      {
        role: 'user',
        parts: [{ text: 'Count my tokens please' }],
      },
    ];

    it('should count tokens accurately for each provider', async () => {
      const providers = [
        { name: 'anthropic', tokens: 15 },
        { name: 'openai', tokens: 14 },
        { name: 'gemini', tokens: 16 },
      ];

      for (const { name, tokens } of providers) {
        const mockProvider = mockProviderManager.getProvider(name);
        mockProvider!.countTokens.mockResolvedValue({
          totalTokens: tokens,
          promptTokens: tokens,
        });
        mockProvider!.supportsOperation.mockReturnValue(true);

        const result = await baseLLMClient.countTokens(
          mockContents,
          { provider: name }
        );

        expect(result.totalTokens).toBe(tokens);
      }
    });

    it('should provide estimates for unsupported providers', async () => {
      mockAnthropicProvider.supportsOperation.mockImplementation(
        (op: UtilityOperation) => op !== UtilityOperation.COUNT_TOKENS
      );

      const result = await baseLLMClient.countTokens(
        mockContents,
        { provider: 'anthropic' }
      );

      // Should use estimation: ~4 characters per token
      const expectedTokens = Math.ceil('Count my tokens please'.length / 4);
      expect(result.totalTokens).toBeCloseTo(expectedTokens, 1);
    });
  });

  describe('provider selection and caching', () => {
    it('should cache provider instances', async () => {
      // Make multiple calls with same provider
      await baseLLMClient.generateContent(mockContents, { provider: 'openai' });
      await baseLLMClient.generateContent(mockContents, { provider: 'openai' });
      await baseLLMClient.generateContent(mockContents, { provider: 'openai' });

      // Provider should only be instantiated once
      expect(mockProviderManager.getProvider).toHaveBeenCalledWith('openai');
      expect(mockProviderManager.getProvider).toHaveBeenCalledTimes(1);
    });

    it('should validate provider capabilities before use', async () => {
      mockAnthropicProvider.supportsOperation.mockReturnValue(false);

      await expect(
        baseLLMClient.generateJson(
          mockContents,
          {},
          { provider: 'anthropic' }
        )
      ).rejects.toThrow('Provider anthropic does not support generateJson');
    });
  });

  describe('error handling', () => {
    it('should provide meaningful error messages with context', async () => {
      const originalError = new Error('API request failed');
      mockGeminiProvider.generateJson.mockRejectedValue(originalError);
      mockGeminiProvider.supportsOperation.mockReturnValue(true);

      await expect(
        baseLLMClient.generateJson(
          mockContents,
          {},
          { provider: 'gemini', model: 'gemini-pro' }
        )
      ).rejects.toThrow(
        expect.objectContaining({
          message: expect.stringContaining('gemini'),
          message: expect.stringContaining('gemini-pro'),
          cause: originalError,
        })
      );
    });

    it('should handle authentication failures', async () => {
      mockOpenAIProvider.generateContent.mockRejectedValue(
        new Error('Invalid API key')
      );
      mockOpenAIProvider.supportsOperation.mockReturnValue(true);

      await expect(
        baseLLMClient.generateContent(
          mockContents,
          { provider: 'openai' }
        )
      ).rejects.toThrow('Authentication failed for provider openai');
    });

    it('should handle quota exceeded errors', async () => {
      mockAnthropicProvider.generateContent.mockRejectedValue(
        new Error('Rate limit exceeded')
      );
      mockAnthropicProvider.supportsOperation.mockReturnValue(true);

      await expect(
        baseLLMClient.generateContent(
          mockContents,
          { provider: 'anthropic' }
        )
      ).rejects.toThrow('Quota exceeded for provider anthropic');
    });
  });
});