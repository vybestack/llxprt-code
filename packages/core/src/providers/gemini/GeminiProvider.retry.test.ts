/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tests for GeminiProvider retry/backoff behavior
 * @plan PLAN-20251215-issue813
 * @requirement REQ-RETRY-001: GeminiProvider must use retryWithBackoff for all SDK calls
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GeminiProvider } from './GeminiProvider.js';
import { type IContent } from '../../services/history/IContent.js';
import { createProviderCallOptions } from '../../test-utils/providerCallOptions.js';
import { ApiError } from '@google/genai';

// Track calls to retryWithBackoff
const retryWithBackoffMock = vi.hoisted(() =>
  vi.fn(async (fn: () => Promise<unknown>) => fn()),
);

// Mock the retry utility
vi.mock('../../utils/retry.js', () => ({
  retryWithBackoff: retryWithBackoffMock,
  getErrorStatus: vi.fn((error: unknown) => {
    if (error && typeof error === 'object' && 'status' in error) {
      return (error as { status: number }).status;
    }
    return undefined;
  }),
  isNetworkTransientError: vi.fn(() => false),
}));

const generateContentStreamMock = vi.hoisted(() => vi.fn());
const generateContentMock = vi.hoisted(() => vi.fn());

const googleGenAIConstructor = vi.hoisted(() =>
  vi.fn().mockImplementation(() => ({
    models: {
      generateContentStream: generateContentStreamMock,
      generateContent: generateContentMock,
    },
  })),
);

vi.mock('@google/genai', () => ({
  GoogleGenAI: googleGenAIConstructor,
  Type: { OBJECT: 'object' },
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
      this.name = 'ApiError';
    }
  },
}));

vi.mock('../../core/prompts.js', () => ({
  getCoreSystemPromptAsync: vi.fn().mockResolvedValue('system prompt'),
}));

vi.mock('../../code_assist/codeAssist.js', () => ({
  createCodeAssistContentGenerator: vi.fn(),
}));

const mockSettingsService = vi.hoisted(() => ({
  set: vi.fn(),
  get: vi.fn(),
  getProviderSettings: vi.fn().mockReturnValue({}),
  updateSettings: vi.fn(),
  getAllGlobalSettings: vi.fn().mockReturnValue({}),
}));

vi.mock('../../settings/settingsServiceInstance.js', () => ({
  getSettingsService: vi.fn(() => mockSettingsService),
}));

describe('GeminiProvider retry behavior', () => {
  let provider: GeminiProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    retryWithBackoffMock.mockReset();
    retryWithBackoffMock.mockImplementation(async (fn) => fn());
    generateContentStreamMock.mockReset();
    generateContentMock.mockReset();
    delete process.env.GEMINI_API_KEY;
  });

  afterEach(() => {
    delete process.env.GEMINI_API_KEY;
  });

  describe('generateChatCompletionWithOptions', () => {
    it('should wrap streaming API calls with retryWithBackoff', async () => {
      const fakeStream = {
        async *[Symbol.asyncIterator]() {
          yield {
            candidates: [
              {
                content: {
                  parts: [{ text: 'retry test response' }],
                },
              },
            ],
          };
        },
      };

      // Make retryWithBackoff execute the streaming call
      retryWithBackoffMock.mockImplementation(async (fn) => {
        generateContentStreamMock.mockResolvedValueOnce(fakeStream);
        return fn();
      });

      process.env.GEMINI_API_KEY = 'test-key';
      provider = new GeminiProvider('test-key');

      const generator = provider.generateChatCompletion(
        createProviderCallOptions({
          providerName: provider.name,
          contents: [
            {
              speaker: 'human',
              blocks: [{ type: 'text', text: 'hello retry' }],
            },
          ] as IContent[],
        }),
      );

      // Consume the generator
      const results: IContent[] = [];
      for await (const chunk of generator) {
        results.push(chunk);
      }

      // Verify retryWithBackoff was called
      expect(retryWithBackoffMock).toHaveBeenCalled();

      // Verify the retry options include proper error handling
      const retryCall = retryWithBackoffMock.mock.calls[0];
      expect(retryCall).toBeDefined();
      const options = retryCall?.[1] as { shouldRetryOnError?: unknown };
      expect(options?.shouldRetryOnError).toBeDefined();
    });

    it('should wrap non-streaming API calls with retryWithBackoff', async () => {
      const response = {
        candidates: [
          {
            content: {
              parts: [{ text: 'non-streaming response' }],
            },
          },
        ],
      };

      retryWithBackoffMock.mockImplementation(async (fn) => {
        generateContentMock.mockResolvedValueOnce(response);
        return fn();
      });

      process.env.GEMINI_API_KEY = 'test-key';
      provider = new GeminiProvider('test-key');

      // Force non-streaming mode
      (
        provider as unknown as {
          providerConfig: {
            getEphemeralSettings?: () => Record<string, unknown>;
          };
        }
      ).providerConfig = {
        getEphemeralSettings: () => ({
          streaming: 'disabled',
        }),
      };

      const generator = provider.generateChatCompletion(
        createProviderCallOptions({
          providerName: provider.name,
          contents: [
            {
              speaker: 'human',
              blocks: [{ type: 'text', text: 'hello non-streaming' }],
            },
          ] as IContent[],
        }),
      );

      // Consume the generator
      const results: IContent[] = [];
      for await (const chunk of generator) {
        results.push(chunk);
      }

      // Verify retryWithBackoff was called for non-streaming
      expect(retryWithBackoffMock).toHaveBeenCalled();
    });

    it('should retry on 429 rate limit errors', async () => {
      let callCount = 0;
      const fakeStream = {
        async *[Symbol.asyncIterator]() {
          yield {
            candidates: [
              {
                content: {
                  parts: [{ text: 'success after retry' }],
                },
              },
            ],
          };
        },
      };

      // Simulate retry behavior: fail first, succeed second
      retryWithBackoffMock.mockImplementation(async (fn, options) => {
        const shouldRetry = options?.shouldRetryOnError || (() => false);
        while (callCount < 2) {
          try {
            callCount++;
            if (callCount === 1) {
              const error = new ApiError(429, 'Rate limit exceeded');
              throw error;
            }
            generateContentStreamMock.mockResolvedValueOnce(fakeStream);
            return fn();
          } catch (error) {
            if (!shouldRetry(error as Error)) {
              throw error;
            }
            // Continue to retry
          }
        }
        generateContentStreamMock.mockResolvedValueOnce(fakeStream);
        return fn();
      });

      process.env.GEMINI_API_KEY = 'test-key';
      provider = new GeminiProvider('test-key');

      const generator = provider.generateChatCompletion(
        createProviderCallOptions({
          providerName: provider.name,
          contents: [
            {
              speaker: 'human',
              blocks: [{ type: 'text', text: 'test 429 retry' }],
            },
          ] as IContent[],
        }),
      );

      const results: IContent[] = [];
      for await (const chunk of generator) {
        results.push(chunk);
      }

      // Should have succeeded after retry
      expect(results.length).toBeGreaterThan(0);
    });

    it('should not retry on 400 bad request errors', async () => {
      retryWithBackoffMock.mockImplementation(async (fn, options) => {
        const shouldRetry = options?.shouldRetryOnError;
        const error = new ApiError(400, 'Bad request');

        // The shouldRetryOnError predicate should return false for 400
        expect(shouldRetry).toBeDefined();
        expect(shouldRetry!(error)).toBe(false);

        throw error;
      });

      process.env.GEMINI_API_KEY = 'test-key';
      provider = new GeminiProvider('test-key');

      const generator = provider.generateChatCompletion(
        createProviderCallOptions({
          providerName: provider.name,
          contents: [
            {
              speaker: 'human',
              blocks: [{ type: 'text', text: 'test 400 no retry' }],
            },
          ] as IContent[],
        }),
      );

      await expect(async () => {
        for await (const _chunk of generator) {
          // Should throw before yielding
        }
      }).rejects.toThrow();
    });

    it('should provide shouldRetryOnError callback to retryWithBackoff', async () => {
      const fakeStream = {
        async *[Symbol.asyncIterator]() {
          yield {
            candidates: [
              {
                content: {
                  parts: [{ text: 'retry options test' }],
                },
              },
            ],
          };
        },
      };

      retryWithBackoffMock.mockImplementation(async (fn, options) => {
        // Verify shouldRetryOnError callback is provided
        expect(options?.shouldRetryOnError).toBeDefined();
        generateContentStreamMock.mockResolvedValueOnce(fakeStream);
        return fn();
      });

      process.env.GEMINI_API_KEY = 'test-key';
      provider = new GeminiProvider('test-key');

      const generator = provider.generateChatCompletion(
        createProviderCallOptions({
          providerName: provider.name,
          contents: [
            {
              speaker: 'human',
              blocks: [{ type: 'text', text: 'retry options test' }],
            },
          ] as IContent[],
        }),
      );

      for await (const _chunk of generator) {
        // Consume
      }

      expect(retryWithBackoffMock).toHaveBeenCalled();
    });
  });

  describe('invokeServerTool', () => {
    it('should wrap web_search calls with retryWithBackoff', async () => {
      const searchResult = {
        candidates: [
          {
            content: {
              parts: [{ text: 'search results' }],
            },
          },
        ],
      };

      retryWithBackoffMock.mockImplementation(async (fn) => {
        generateContentMock.mockResolvedValueOnce(searchResult);
        return fn();
      });

      process.env.GEMINI_API_KEY = 'test-key';
      provider = new GeminiProvider('test-key');

      await provider.invokeServerTool('web_search', { query: 'test query' });

      // Verify retryWithBackoff was called for web_search
      expect(retryWithBackoffMock).toHaveBeenCalled();
    });

    it('should wrap web_fetch calls with retryWithBackoff', async () => {
      const fetchResult = {
        candidates: [
          {
            content: {
              parts: [{ text: 'fetch results' }],
            },
          },
        ],
      };

      retryWithBackoffMock.mockImplementation(async (fn) => {
        generateContentMock.mockResolvedValueOnce(fetchResult);
        return fn();
      });

      process.env.GEMINI_API_KEY = 'test-key';
      provider = new GeminiProvider('test-key');

      await provider.invokeServerTool('web_fetch', {
        prompt: 'fetch https://example.com',
      });

      // Verify retryWithBackoff was called for web_fetch
      expect(retryWithBackoffMock).toHaveBeenCalled();
    });

    it('should retry server tool calls on 429 errors', async () => {
      let attempts = 0;
      const searchResult = {
        candidates: [
          {
            content: {
              parts: [{ text: 'success after retry' }],
            },
          },
        ],
      };

      retryWithBackoffMock.mockImplementation(async (fn, options) => {
        const shouldRetry = options?.shouldRetryOnError || (() => false);
        while (attempts < 3) {
          try {
            attempts++;
            if (attempts <= 2) {
              const error = new ApiError(429, 'Rate limit');
              if (!shouldRetry(error)) {
                throw error;
              }
              continue;
            }
            generateContentMock.mockResolvedValueOnce(searchResult);
            return fn();
          } catch (error) {
            if (!shouldRetry(error as Error)) {
              throw error;
            }
          }
        }
        generateContentMock.mockResolvedValueOnce(searchResult);
        return fn();
      });

      process.env.GEMINI_API_KEY = 'test-key';
      provider = new GeminiProvider('test-key');

      const result = await provider.invokeServerTool('web_search', {
        query: 'retry test',
      });

      expect(result).toBeDefined();
    });

    it('should retry server tool calls on 5xx errors', async () => {
      let attempts = 0;
      const searchResult = {
        candidates: [
          {
            content: {
              parts: [{ text: 'success after 500' }],
            },
          },
        ],
      };

      retryWithBackoffMock.mockImplementation(async (fn, options) => {
        const shouldRetry = options?.shouldRetryOnError || (() => false);
        while (attempts < 2) {
          try {
            attempts++;
            if (attempts === 1) {
              const error = new ApiError(503, 'Service unavailable');
              if (!shouldRetry(error)) {
                throw error;
              }
              continue;
            }
            generateContentMock.mockResolvedValueOnce(searchResult);
            return fn();
          } catch (error) {
            if (!shouldRetry(error as Error)) {
              throw error;
            }
          }
        }
        generateContentMock.mockResolvedValueOnce(searchResult);
        return fn();
      });

      process.env.GEMINI_API_KEY = 'test-key';
      provider = new GeminiProvider('test-key');

      const result = await provider.invokeServerTool('web_search', {
        query: '5xx retry test',
      });

      expect(result).toBeDefined();
    });
  });

  describe('shouldRetryOnError predicate', () => {
    it('should return true for 429 errors', async () => {
      let capturedPredicate: ((error: Error) => boolean) | undefined;

      retryWithBackoffMock.mockImplementation(async (_fn, options) => {
        capturedPredicate = options?.shouldRetryOnError;
        // Don't actually call fn, just capture the predicate
        return {
          candidates: [{ content: { parts: [{ text: 'test' }] } }],
        };
      });

      process.env.GEMINI_API_KEY = 'test-key';
      provider = new GeminiProvider('test-key');

      // Force non-streaming to get simpler flow
      (
        provider as unknown as {
          providerConfig: {
            getEphemeralSettings?: () => Record<string, unknown>;
          };
        }
      ).providerConfig = {
        getEphemeralSettings: () => ({
          streaming: 'disabled',
        }),
      };

      const generator = provider.generateChatCompletion(
        createProviderCallOptions({
          providerName: provider.name,
          contents: [
            {
              speaker: 'human',
              blocks: [{ type: 'text', text: 'predicate test' }],
            },
          ] as IContent[],
        }),
      );

      for await (const _chunk of generator) {
        // Consume to trigger the call
      }

      expect(capturedPredicate).toBeDefined();
      const error429 = new ApiError(429, 'Rate limit');
      expect(capturedPredicate!(error429)).toBe(true);
    });

    it('should return true for 5xx errors', async () => {
      let capturedPredicate: ((error: Error) => boolean) | undefined;

      retryWithBackoffMock.mockImplementation(async (_fn, options) => {
        capturedPredicate = options?.shouldRetryOnError;
        return {
          candidates: [{ content: { parts: [{ text: 'test' }] } }],
        };
      });

      process.env.GEMINI_API_KEY = 'test-key';
      provider = new GeminiProvider('test-key');

      (
        provider as unknown as {
          providerConfig: {
            getEphemeralSettings?: () => Record<string, unknown>;
          };
        }
      ).providerConfig = {
        getEphemeralSettings: () => ({
          streaming: 'disabled',
        }),
      };

      const generator = provider.generateChatCompletion(
        createProviderCallOptions({
          providerName: provider.name,
          contents: [
            {
              speaker: 'human',
              blocks: [{ type: 'text', text: 'predicate test 5xx' }],
            },
          ] as IContent[],
        }),
      );

      for await (const _chunk of generator) {
        // Consume
      }

      expect(capturedPredicate).toBeDefined();
      const error500 = new ApiError(500, 'Internal server error');
      const error502 = new ApiError(502, 'Bad gateway');
      const error503 = new ApiError(503, 'Service unavailable');

      expect(capturedPredicate!(error500)).toBe(true);
      expect(capturedPredicate!(error502)).toBe(true);
      expect(capturedPredicate!(error503)).toBe(true);
    });

    it('should return false for 400 errors', async () => {
      let capturedPredicate: ((error: Error) => boolean) | undefined;

      retryWithBackoffMock.mockImplementation(async (_fn, options) => {
        capturedPredicate = options?.shouldRetryOnError;
        return {
          candidates: [{ content: { parts: [{ text: 'test' }] } }],
        };
      });

      process.env.GEMINI_API_KEY = 'test-key';
      provider = new GeminiProvider('test-key');

      (
        provider as unknown as {
          providerConfig: {
            getEphemeralSettings?: () => Record<string, unknown>;
          };
        }
      ).providerConfig = {
        getEphemeralSettings: () => ({
          streaming: 'disabled',
        }),
      };

      const generator = provider.generateChatCompletion(
        createProviderCallOptions({
          providerName: provider.name,
          contents: [
            {
              speaker: 'human',
              blocks: [{ type: 'text', text: 'predicate test 400' }],
            },
          ] as IContent[],
        }),
      );

      for await (const _chunk of generator) {
        // Consume
      }

      expect(capturedPredicate).toBeDefined();
      const error400 = new ApiError(400, 'Bad request');
      expect(capturedPredicate!(error400)).toBe(false);
    });
  });
});
