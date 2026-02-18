/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tests for LoggingContentGenerator finish_reasons wiring.
 * The ApiResponseEvent.finish_reasons field should be populated from
 * GenerateContentResponse.candidates[].finishReason.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { LoggingContentGenerator } from './loggingContentGenerator.js';
import type { ContentGenerator } from './contentGenerator.js';
import type { Config } from '../config/config.js';
import type {
  GenerateContentResponse,
  GenerateContentParameters,
} from '@google/genai';
import * as loggers from '../telemetry/loggers.js';

vi.mock('../telemetry/loggers.js', async (importOriginal) => {
  const actual = await importOriginal<typeof loggers>();
  return {
    ...actual,
    logApiResponse: vi.fn(),
    logApiError: vi.fn(),
    logApiRequest: vi.fn(),
  };
});

function createMockConfig(): Config {
  return {} as Config;
}

function createMockContentGenerator(
  overrides: Partial<ContentGenerator> = {},
): ContentGenerator {
  return {
    generateContent: vi.fn(),
    generateContentStream: vi.fn(),
    countTokens: vi.fn(),
    embedContent: vi.fn(),
    ...overrides,
  } as unknown as ContentGenerator;
}

function createMockResponse(
  finishReasons: string[] = [],
): GenerateContentResponse {
  return {
    text: 'Hello world',
    modelVersion: 'test-model-v1',
    usageMetadata: {
      promptTokenCount: 10,
      candidatesTokenCount: 5,
      totalTokenCount: 15,
    },
    candidates: finishReasons.map((reason) => ({
      finishReason: reason,
      content: { parts: [{ text: 'Hello world' }], role: 'model' },
    })),
  } as unknown as GenerateContentResponse;
}

describe('LoggingContentGenerator finish_reasons', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('generateContent', () => {
    it('should pass finish_reasons from response candidates to ApiResponseEvent', async () => {
      const mockResponse = createMockResponse(['STOP']);
      const wrapped = createMockContentGenerator({
        generateContent: vi.fn().mockResolvedValue(mockResponse),
      });
      const config = createMockConfig();
      const generator = new LoggingContentGenerator(wrapped, config);

      await generator.generateContent(
        { model: 'test-model', contents: [] } as GenerateContentParameters,
        'prompt-1',
      );

      expect(loggers.logApiResponse).toHaveBeenCalled();
      const call = vi.mocked(loggers.logApiResponse).mock.calls[0];
      expect(call[1].finish_reasons).toEqual(['STOP']);
    });

    it('should handle multiple candidates with different finish reasons', async () => {
      const mockResponse = createMockResponse(['STOP', 'MAX_TOKENS']);
      const wrapped = createMockContentGenerator({
        generateContent: vi.fn().mockResolvedValue(mockResponse),
      });
      const config = createMockConfig();
      const generator = new LoggingContentGenerator(wrapped, config);

      await generator.generateContent(
        { model: 'test-model', contents: [] } as GenerateContentParameters,
        'prompt-1',
      );

      expect(loggers.logApiResponse).toHaveBeenCalled();
      const call = vi.mocked(loggers.logApiResponse).mock.calls[0];
      expect(call[1].finish_reasons).toEqual(['STOP', 'MAX_TOKENS']);
    });

    it('should default to empty array when no candidates exist', async () => {
      const mockResponse = {
        text: 'Hello',
        modelVersion: 'test-model-v1',
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 5,
          totalTokenCount: 15,
        },
      } as unknown as GenerateContentResponse;

      const wrapped = createMockContentGenerator({
        generateContent: vi.fn().mockResolvedValue(mockResponse),
      });
      const config = createMockConfig();
      const generator = new LoggingContentGenerator(wrapped, config);

      await generator.generateContent(
        { model: 'test-model', contents: [] } as GenerateContentParameters,
        'prompt-1',
      );

      expect(loggers.logApiResponse).toHaveBeenCalled();
      const call = vi.mocked(loggers.logApiResponse).mock.calls[0];
      expect(call[1].finish_reasons).toEqual([]);
    });
  });

  describe('generateContentStream', () => {
    it('should pass finish_reasons from the last streamed response to ApiResponseEvent', async () => {
      const lastResponse = createMockResponse(['STOP']);

      async function* mockStream(): AsyncGenerator<GenerateContentResponse> {
        yield createMockResponse([]);
        yield lastResponse;
      }

      const wrapped = createMockContentGenerator({
        generateContentStream: vi.fn().mockResolvedValue(mockStream()),
      });
      const config = createMockConfig();
      const generator = new LoggingContentGenerator(wrapped, config);

      const stream = await generator.generateContentStream(
        { model: 'test-model', contents: [] } as GenerateContentParameters,
        'prompt-1',
      );

      // Consume the stream
      for await (const _chunk of stream) {
        // consume
      }

      expect(loggers.logApiResponse).toHaveBeenCalled();
      const call = vi.mocked(loggers.logApiResponse).mock.calls[0];
      expect(call[1].finish_reasons).toEqual(['STOP']);
    });

    it('should default to empty array when streamed responses have no candidates', async () => {
      const responseWithoutCandidates = {
        text: 'Hello',
        modelVersion: 'test-model-v1',
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 5,
          totalTokenCount: 15,
        },
      } as unknown as GenerateContentResponse;

      async function* mockStream(): AsyncGenerator<GenerateContentResponse> {
        yield responseWithoutCandidates;
      }

      const wrapped = createMockContentGenerator({
        generateContentStream: vi.fn().mockResolvedValue(mockStream()),
      });
      const config = createMockConfig();
      const generator = new LoggingContentGenerator(wrapped, config);

      const stream = await generator.generateContentStream(
        { model: 'test-model', contents: [] } as GenerateContentParameters,
        'prompt-1',
      );

      for await (const _chunk of stream) {
        // consume
      }

      expect(loggers.logApiResponse).toHaveBeenCalled();
      const call = vi.mocked(loggers.logApiResponse).mock.calls[0];
      expect(call[1].finish_reasons).toEqual([]);
    });

    it('should filter out undefined/null finish reasons from candidates', async () => {
      const mockResponse = {
        text: 'Hello',
        modelVersion: 'test-model-v1',
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 5,
          totalTokenCount: 15,
        },
        candidates: [
          {
            finishReason: 'STOP',
            content: { parts: [{ text: 'Hello' }], role: 'model' },
          },
          {
            finishReason: undefined,
            content: { parts: [{ text: 'World' }], role: 'model' },
          },
        ],
      } as unknown as GenerateContentResponse;

      const wrapped = createMockContentGenerator({
        generateContent: vi.fn().mockResolvedValue(mockResponse),
      });
      const config = createMockConfig();
      const generator = new LoggingContentGenerator(wrapped, config);

      await generator.generateContent(
        { model: 'test-model', contents: [] } as GenerateContentParameters,
        'prompt-1',
      );

      expect(loggers.logApiResponse).toHaveBeenCalled();
      const call = vi.mocked(loggers.logApiResponse).mock.calls[0];
      expect(call[1].finish_reasons).toEqual(['STOP']);
    });
  });
});
