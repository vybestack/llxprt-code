/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BaseLLMClient } from './baseLlmClient.js';
import type { ContentGenerator } from '@vybestack/llxprt-code-core/core/contentGenerator.js';
import type { ModelOutput } from '@vybestack/llxprt-code-core/llm-types/index.js';

// Mock retryWithBackoff to immediately call the function once without delays
vi.mock('@vybestack/llxprt-code-core/utils/retry.js', () => ({
  retryWithBackoff: vi.fn(
    async <T>(
      fn: () => Promise<T>,
      options?: { shouldRetryOnContent?: (response: T) => boolean },
    ) => {
      const result = await fn();
      if (options?.shouldRetryOnContent?.(result) === true) {
        throw new Error('Retry attempts exhausted');
      }
      return result;
    },
  ),
}));

function textModelOutput(text: string): ModelOutput {
  return {
    content: {
      speaker: 'ai',
      blocks: [{ type: 'text', text }],
    },
  };
}

describe('BaseLLMClient', () => {
  let mockContentGenerator: ContentGenerator;
  let baseLlmClient: BaseLLMClient;

  beforeEach(() => {
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
      vi.mocked(mockContentGenerator.generateContent).mockResolvedValue(
        textModelOutput('{"name": "test", "value": 42}'),
      );

      const result = await baseLlmClient.generateJson({
        prompt: 'Generate a JSON object with name and value',
        model: 'gemini-pro',
      });

      expect(result).toStrictEqual({ name: 'test', value: 42 });
      expect(mockContentGenerator.generateContent).toHaveBeenCalledTimes(1);
    });

    it('should handle JSON wrapped in markdown code blocks', async () => {
      vi.mocked(mockContentGenerator.generateContent).mockResolvedValue(
        textModelOutput('```json\n{"status": "ok"}\n```'),
      );

      const result = await baseLlmClient.generateJson({
        prompt: 'Generate status',
        model: 'gemini-pro',
      });

      expect(result).toStrictEqual({ status: 'ok' });
    });

    it('should use provided schema for validation', async () => {
      vi.mocked(mockContentGenerator.generateContent).mockResolvedValue(
        textModelOutput('{"required": "field"}'),
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
        .calls[0][0];
      expect(callArgs.settings?.responseJsonSchema).toStrictEqual(schema);
      expect(callArgs.modelParams?.responseMimeType).toBe('application/json');
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
      vi.mocked(mockContentGenerator.generateContent).mockResolvedValue(
        textModelOutput(''),
      );

      await expect(
        baseLlmClient.generateJson({
          prompt: 'Generate data',
          model: 'gemini-pro',
        }),
      ).rejects.toThrow('Failed to generate content');
    });

    it('should handle invalid JSON in response', async () => {
      vi.mocked(mockContentGenerator.generateContent).mockResolvedValue(
        textModelOutput('not valid json'),
      );

      await expect(
        baseLlmClient.generateJson({
          prompt: 'Generate data',
          model: 'gemini-pro',
        }),
      ).rejects.toThrow('Failed to generate content');
    });

    it('should support custom temperature', async () => {
      vi.mocked(mockContentGenerator.generateContent).mockResolvedValue(
        textModelOutput('{"temp": "test"}'),
      );

      await baseLlmClient.generateJson({
        prompt: 'Generate data',
        model: 'gemini-pro',
        temperature: 0.7,
      });

      const callArgs = vi.mocked(mockContentGenerator.generateContent).mock
        .calls[0][0];
      expect(callArgs.settings?.temperature).toBe(0.7);
    });
  });

  describe('generateEmbedding', () => {
    it('should generate embeddings for text', async () => {
      vi.mocked(mockContentGenerator.embedContent).mockResolvedValue({
        embeddings: [[0.1, 0.2, 0.3, 0.4, 0.5]],
      });

      const result = await baseLlmClient.generateEmbedding({
        text: 'test text',
        model: 'embedding-001',
      });

      expect(result).toStrictEqual([0.1, 0.2, 0.3, 0.4, 0.5]);
      expect(mockContentGenerator.embedContent).toHaveBeenCalledTimes(1);
    });

    it('should handle multiple text inputs', async () => {
      vi.mocked(mockContentGenerator.embedContent).mockResolvedValue({
        embeddings: [
          [0.1, 0.2],
          [0.3, 0.4],
        ],
      });

      const result = await baseLlmClient.generateEmbedding({
        text: ['text1', 'text2'],
        model: 'embedding-001',
      });

      expect(result).toStrictEqual([
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
      vi.mocked(mockContentGenerator.embedContent).mockResolvedValue({
        embeddings: [],
      });

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
      vi.mocked(mockContentGenerator.countTokens).mockResolvedValue({
        totalTokens: 42,
      });

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
      vi.mocked(mockContentGenerator.countTokens).mockResolvedValue({
        totalTokens: 100,
      });

      const result = await baseLlmClient.countTokens({
        contents: [
          { role: 'user', parts: [{ text: 'message 1' }] },
          { role: 'model', parts: [{ text: 'response 1' }] },
        ],
        model: 'gemini-pro',
      });

      expect(result).toBe(100);
      const callArgs = vi.mocked(mockContentGenerator.countTokens).mock
        .calls[0][0];
      expect(callArgs.contents).toHaveLength(2);
    });
  });

  describe('generateContent', () => {
    it('should call generateContent with correct parameters', async () => {
      const mockOutput = textModelOutput('This is the content.');
      vi.mocked(mockContentGenerator.generateContent).mockResolvedValue(
        mockOutput,
      );

      const abortController = new AbortController();
      const options = {
        model: 'test-model',
        contents: [{ role: 'user', parts: [{ text: 'Give me content.' }] }],
        abortSignal: abortController.signal,
        promptId: 'content-prompt-id',
      } as const;

      const result = await baseLlmClient.generateContent(options);

      expect(result).toBe(mockOutput);

      expect(mockContentGenerator.generateContent).toHaveBeenCalledTimes(1);
      const callArgs = vi.mocked(mockContentGenerator.generateContent).mock
        .calls[0][0];
      expect(callArgs.model).toBe('test-model');
      expect(callArgs.settings?.temperature).toBe(0);
      expect(callArgs.settings?.topP).toBe(1);
    });

    it('should handle empty response', async () => {
      vi.mocked(mockContentGenerator.generateContent).mockResolvedValue(
        textModelOutput(''),
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
      vi.mocked(mockContentGenerator.generateContent).mockResolvedValue(
        textModelOutput('Response with instruction.'),
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
        .calls[0][0];
      expect(callArgs.settings?.systemInstruction).toBe('Be helpful');
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
