/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BaseLLMClient } from './baseLlmClient.js';
import type { ContentGenerator } from './contentGenerator.js';
import type {
  GenerateContentResponse,
  GenerateContentParameters,
  EmbedContentResponse,
  CountTokensResponse,
  CountTokensParameters,
} from '@google/genai';

// Mock retryWithBackoff to immediately call the function once without delays
// This prevents actual retry delays from running during tests
vi.mock('../utils/retry.js', () => ({
  retryWithBackoff: vi.fn(
    async <T>(
      fn: () => Promise<T>,
      options?: { shouldRetryOnContent?: (response: T) => boolean },
    ) => {
      // Execute the function once (first attempt)
      const result = await fn();

      // If shouldRetryOnContent is provided and returns true (indicating retry needed),
      // simulate what would happen after exhausting retries
      if (options?.shouldRetryOnContent?.(result)) {
        throw new Error('Retry attempts exhausted');
      }

      return result;
    },
  ),
}));

describe('BaseLLMClient', () => {
  let mockContentGenerator: ContentGenerator;
  let baseLlmClient: BaseLLMClient;

  beforeEach(() => {
    // Create mock ContentGenerator with all required methods
    mockContentGenerator = {
      generateContent: vi.fn(),
      generateContentStream: vi.fn(),
      countTokens: vi.fn(),
      embedContent: vi.fn(),
      userTier: undefined,
    };

    baseLlmClient = new BaseLLMClient(mockContentGenerator);
  });

  describe('generateJson', () => {
    it('should generate valid JSON from a prompt', async () => {
      // Mock response with JSON content
      const mockResponse: GenerateContentResponse = {
        candidates: [
          {
            content: {
              role: 'model',
              parts: [{ text: '{"name": "test", "value": 42}' }],
            },
          },
        ],
      };

      vi.mocked(mockContentGenerator.generateContent).mockResolvedValue(
        mockResponse,
      );

      const result = await baseLlmClient.generateJson({
        prompt: 'Generate a JSON object with name and value',
        model: 'gemini-pro',
      });

      expect(result).toEqual({ name: 'test', value: 42 });
      expect(mockContentGenerator.generateContent).toHaveBeenCalledTimes(1);
    });

    it('should handle JSON wrapped in markdown code blocks', async () => {
      const mockResponse: GenerateContentResponse = {
        candidates: [
          {
            content: {
              role: 'model',
              parts: [{ text: '```json\n{"status": "ok"}\n```' }],
            },
          },
        ],
      };

      vi.mocked(mockContentGenerator.generateContent).mockResolvedValue(
        mockResponse,
      );

      const result = await baseLlmClient.generateJson({
        prompt: 'Generate status',
        model: 'gemini-pro',
      });

      expect(result).toEqual({ status: 'ok' });
    });

    it('should use provided schema for validation', async () => {
      const mockResponse: GenerateContentResponse = {
        candidates: [
          {
            content: {
              role: 'model',
              parts: [{ text: '{"required": "field"}' }],
            },
          },
        ],
      };

      vi.mocked(mockContentGenerator.generateContent).mockResolvedValue(
        mockResponse,
      );

      const schema = {
        type: 'object',
        properties: {
          required: { type: 'string' },
        },
        required: ['required'],
      };

      await baseLlmClient.generateJson({
        prompt: 'Generate data',
        schema,
        model: 'gemini-pro',
      });

      const callArgs = vi.mocked(mockContentGenerator.generateContent).mock
        .calls[0][0] as GenerateContentParameters;
      expect(callArgs.config?.responseJsonSchema).toEqual(schema);
      expect(callArgs.config?.responseMimeType).toBe('application/json');
    });

    it('should handle generation errors gracefully', async () => {
      vi.mocked(mockContentGenerator.generateContent).mockRejectedValue(
        new Error('API Error'),
      );

      await expect(
        baseLlmClient.generateJson({
          prompt: 'Generate data',
          model: 'gemini-pro',
        }),
      ).rejects.toThrow('Failed to generate content: API Error');
    });

    it('should handle empty response', async () => {
      const mockResponse: GenerateContentResponse = {
        candidates: [
          {
            content: {
              role: 'model',
              parts: [],
            },
          },
        ],
      };

      vi.mocked(mockContentGenerator.generateContent).mockResolvedValue(
        mockResponse,
      );

      await expect(
        baseLlmClient.generateJson({
          prompt: 'Generate data',
          model: 'gemini-pro',
        }),
      ).rejects.toThrow('Failed to generate content');
    });

    it('should handle invalid JSON in response', async () => {
      const mockResponse: GenerateContentResponse = {
        candidates: [
          {
            content: {
              role: 'model',
              parts: [{ text: 'not valid json' }],
            },
          },
        ],
      };

      vi.mocked(mockContentGenerator.generateContent).mockResolvedValue(
        mockResponse,
      );

      await expect(
        baseLlmClient.generateJson({
          prompt: 'Generate data',
          model: 'gemini-pro',
        }),
      ).rejects.toThrow('Failed to generate content');
    });

    it('should support custom temperature', async () => {
      const mockResponse: GenerateContentResponse = {
        candidates: [
          {
            content: {
              role: 'model',
              parts: [{ text: '{"temp": "test"}' }],
            },
          },
        ],
      };

      vi.mocked(mockContentGenerator.generateContent).mockResolvedValue(
        mockResponse,
      );

      await baseLlmClient.generateJson({
        prompt: 'Generate data',
        model: 'gemini-pro',
        temperature: 0.7,
      });

      const callArgs = vi.mocked(mockContentGenerator.generateContent).mock
        .calls[0][0] as GenerateContentParameters;
      expect(callArgs.config?.temperature).toBe(0.7);
    });
  });

  describe('generateEmbedding', () => {
    it('should generate embeddings for text', async () => {
      const mockEmbedResponse: EmbedContentResponse = {
        embeddings: [
          {
            values: [0.1, 0.2, 0.3, 0.4, 0.5],
          },
        ],
      };

      vi.mocked(mockContentGenerator.embedContent).mockResolvedValue(
        mockEmbedResponse,
      );

      const result = await baseLlmClient.generateEmbedding({
        text: 'test text',
        model: 'embedding-001',
      });

      expect(result).toEqual([0.1, 0.2, 0.3, 0.4, 0.5]);
      expect(mockContentGenerator.embedContent).toHaveBeenCalledTimes(1);
    });

    it('should handle multiple text inputs', async () => {
      const mockEmbedResponse: EmbedContentResponse = {
        embeddings: [{ values: [0.1, 0.2] }, { values: [0.3, 0.4] }],
      };

      vi.mocked(mockContentGenerator.embedContent).mockResolvedValue(
        mockEmbedResponse,
      );

      const result = await baseLlmClient.generateEmbedding({
        text: ['text1', 'text2'],
        model: 'embedding-001',
      });

      expect(result).toEqual([
        [0.1, 0.2],
        [0.3, 0.4],
      ]);
    });

    it('should handle embedding errors', async () => {
      vi.mocked(mockContentGenerator.embedContent).mockRejectedValue(
        new Error('Embedding failed'),
      );

      await expect(
        baseLlmClient.generateEmbedding({
          text: 'test',
          model: 'embedding-001',
        }),
      ).rejects.toThrow('Failed to generate embedding: Embedding failed');
    });

    it('should validate embeddings response', async () => {
      const mockEmbedResponse: EmbedContentResponse = {
        embeddings: [],
      };

      vi.mocked(mockContentGenerator.embedContent).mockResolvedValue(
        mockEmbedResponse,
      );

      await expect(
        baseLlmClient.generateEmbedding({
          text: 'test',
          model: 'embedding-001',
        }),
      ).rejects.toThrow('No embeddings found in API response');
    });
  });

  describe('countTokens', () => {
    it('should count tokens in text', async () => {
      const mockCountResponse: CountTokensResponse = {
        totalTokens: 42,
      };

      vi.mocked(mockContentGenerator.countTokens).mockResolvedValue(
        mockCountResponse,
      );

      const result = await baseLlmClient.countTokens({
        text: 'test text',
        model: 'gemini-pro',
      });

      expect(result).toBe(42);
      expect(mockContentGenerator.countTokens).toHaveBeenCalledTimes(1);
    });

    it('should handle count errors', async () => {
      vi.mocked(mockContentGenerator.countTokens).mockRejectedValue(
        new Error('Count failed'),
      );

      await expect(
        baseLlmClient.countTokens({
          text: 'test',
          model: 'gemini-pro',
        }),
      ).rejects.toThrow('Failed to count tokens: Count failed');
    });

    it('should handle contents array', async () => {
      const mockCountResponse: CountTokensResponse = {
        totalTokens: 100,
      };

      vi.mocked(mockContentGenerator.countTokens).mockResolvedValue(
        mockCountResponse,
      );

      const result = await baseLlmClient.countTokens({
        contents: [
          { role: 'user', parts: [{ text: 'message 1' }] },
          { role: 'model', parts: [{ text: 'response 1' }] },
        ],
        model: 'gemini-pro',
      });

      expect(result).toBe(100);
      const callArgs = vi.mocked(mockContentGenerator.countTokens).mock
        .calls[0][0] as CountTokensParameters;
      expect(callArgs.contents).toHaveLength(2);
    });
  });

  describe('generateContent', () => {
    it('should call generateContent with correct parameters', async () => {
      const mockResponse: GenerateContentResponse = {
        candidates: [
          {
            content: {
              role: 'model',
              parts: [{ text: 'This is the content.' }],
            },
          },
        ],
      };

      vi.mocked(mockContentGenerator.generateContent).mockResolvedValue(
        mockResponse,
      );

      const abortController = new AbortController();
      const options = {
        model: 'test-model',
        contents: [{ role: 'user', parts: [{ text: 'Give me content.' }] }],
        abortSignal: abortController.signal,
        promptId: 'content-prompt-id',
      } as const;

      const result = await baseLlmClient.generateContent(options);

      expect(result).toBe(mockResponse);

      // Validate the parameters passed to the underlying generator
      expect(mockContentGenerator.generateContent).toHaveBeenCalledTimes(1);
      const callArgs = vi.mocked(mockContentGenerator.generateContent).mock
        .calls[0][0] as GenerateContentParameters;
      expect(callArgs.model).toBe('test-model');
      expect(callArgs.contents).toEqual(options.contents);
      expect(callArgs.config?.temperature).toBe(0);
      expect(callArgs.config?.topP).toBe(1);
    });

    it('should handle empty response', async () => {
      const mockResponse: GenerateContentResponse = {
        candidates: [
          {
            content: {
              role: 'model',
              parts: [],
            },
          },
        ],
      };

      vi.mocked(mockContentGenerator.generateContent).mockResolvedValue(
        mockResponse,
      );

      const abortController = new AbortController();
      const options = {
        model: 'test-model',
        contents: [{ role: 'user', parts: [{ text: 'Give me content.' }] }],
        abortSignal: abortController.signal,
        promptId: 'content-prompt-id',
      } as const;

      await expect(baseLlmClient.generateContent(options)).rejects.toThrow(
        'Failed to generate content',
      );
    });

    it('should support system instruction', async () => {
      const mockResponse: GenerateContentResponse = {
        candidates: [
          {
            content: {
              role: 'model',
              parts: [{ text: 'Response with instruction.' }],
            },
          },
        ],
      };

      vi.mocked(mockContentGenerator.generateContent).mockResolvedValue(
        mockResponse,
      );

      const abortController = new AbortController();
      await baseLlmClient.generateContent({
        model: 'test-model',
        contents: [{ role: 'user', parts: [{ text: 'Query' }] }],
        systemInstruction: 'Be helpful',
        abortSignal: abortController.signal,
        promptId: 'test-id',
      });

      const callArgs = vi.mocked(mockContentGenerator.generateContent).mock
        .calls[0][0] as GenerateContentParameters;
      expect(callArgs.config?.systemInstruction).toBe('Be helpful');
    });
  });

  describe('constructor', () => {
    it('should throw if contentGenerator is not provided', () => {
      expect(() => {
        new BaseLLMClient(null as unknown as ContentGenerator);
      }).toThrow('ContentGenerator is required');
    });

    it('should accept a valid ContentGenerator', () => {
      expect(() => new BaseLLMClient(mockContentGenerator)).not.toThrow();
    });
  });
});
