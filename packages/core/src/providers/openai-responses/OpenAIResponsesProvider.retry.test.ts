/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tests for OpenAIResponsesProvider retry/backoff behavior
 * @plan PLAN-20251215-issue813
 * @requirement REQ-RETRY-001: OpenAIResponsesProvider must use retryWithBackoff for all fetch calls
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OpenAIResponsesProvider } from './OpenAIResponsesProvider.js';
import { type IContent } from '../../services/history/IContent.js';
import { createProviderCallOptions } from '../../test-utils/providerCallOptions.js';

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

const mockSettingsService = vi.hoisted(() => ({
  set: vi.fn(),
  get: vi.fn(),
  setProviderSetting: vi.fn(),
  getProviderSettings: vi.fn().mockReturnValue({}),
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  getAllGlobalSettings: vi.fn().mockReturnValue({}),
}));

const parseResponsesStreamMock = vi.hoisted(() =>
  vi.fn(async function* () {
    yield {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'test response' }],
    };
  }),
);

const parseErrorResponseMock = vi.hoisted(() =>
  vi.fn((status: number, body: string, provider: string) => {
    const error = new Error(`${provider} API error ${status}: ${body}`);
    (error as Error & { status: number }).status = status;
    return error;
  }),
);

const fetchMock = vi.hoisted(() => vi.fn());

vi.mock('../../settings/settingsServiceInstance.js', () => ({
  getSettingsService: () => mockSettingsService,
}));

vi.mock('../../core/prompts.js', () => ({
  getCoreSystemPromptAsync: vi.fn().mockResolvedValue('system prompt'),
}));

vi.mock('../openai/parseResponsesStream.js', () => ({
  parseResponsesStream: parseResponsesStreamMock,
  parseErrorResponse: parseErrorResponseMock,
}));

describe('OpenAIResponsesProvider retry behavior', () => {
  let provider: OpenAIResponsesProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    retryWithBackoffMock.mockReset();
    retryWithBackoffMock.mockImplementation(async (fn) => fn());
    mockSettingsService.getSettings.mockResolvedValue({});
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('generateChatCompletionWithOptions', () => {
    it('should wrap fetch calls with retryWithBackoff', async () => {
      retryWithBackoffMock.mockImplementation(async (fn) => {
        fetchMock.mockResolvedValueOnce({
          ok: true,
          body: {
            async *[Symbol.asyncIterator]() {
              yield new TextEncoder().encode('data: {"type":"done"}\n\n');
            },
          },
        });
        return fn();
      });

      provider = new OpenAIResponsesProvider('test-key');

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
      for await (const _chunk of generator) {
        // Consume
      }

      // Verify retryWithBackoff was called
      expect(retryWithBackoffMock).toHaveBeenCalled();
    });

    it('should provide shouldRetryOnError callback to retryWithBackoff', async () => {
      retryWithBackoffMock.mockImplementation(async (fn, options) => {
        // Verify shouldRetryOnError callback is provided
        expect(options?.shouldRetryOnError).toBeDefined();
        fetchMock.mockResolvedValueOnce({
          ok: true,
          body: undefined,
        });
        return fn();
      });

      provider = new OpenAIResponsesProvider('test-key');

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

    it('should retry on 429 rate limit errors', async () => {
      let callCount = 0;

      retryWithBackoffMock.mockImplementation(async (fn, options) => {
        const shouldRetry = options?.shouldRetryOnError || (() => false);

        while (callCount < 2) {
          try {
            callCount++;
            if (callCount === 1) {
              // First call returns 429
              fetchMock.mockResolvedValueOnce({
                ok: false,
                status: 429,
                text: async () => 'Rate limit exceeded',
              });
              const result = await fn();
              // If we get here without throwing, check if response is not ok
              if (
                result &&
                typeof result === 'object' &&
                'ok' in result &&
                !result.ok
              ) {
                const error = new Error('Rate limit exceeded');
                (error as Error & { status: number }).status = 429;
                if (shouldRetry(error)) {
                  continue;
                }
                throw error;
              }
              return result;
            }
            // Second call succeeds
            fetchMock.mockResolvedValueOnce({
              ok: true,
              body: undefined,
            });
            return fn();
          } catch (error) {
            if (!shouldRetry(error as Error)) {
              throw error;
            }
          }
        }
        fetchMock.mockResolvedValueOnce({
          ok: true,
          body: undefined,
        });
        return fn();
      });

      provider = new OpenAIResponsesProvider('test-key');

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

      // Should have succeeded (not thrown)
      expect(retryWithBackoffMock).toHaveBeenCalled();
    });

    it('should not retry on 400 bad request errors', async () => {
      retryWithBackoffMock.mockImplementation(async (_fn, options) => {
        const shouldRetry = options?.shouldRetryOnError;
        const error = new Error('Bad request');
        (error as Error & { status: number }).status = 400;

        // The shouldRetryOnError predicate should return false for 400
        expect(shouldRetry).toBeDefined();
        expect(shouldRetry!(error)).toBe(false);

        throw error;
      });

      provider = new OpenAIResponsesProvider('test-key');

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

    it('should retry on 5xx server errors', async () => {
      let callCount = 0;

      retryWithBackoffMock.mockImplementation(async (fn, options) => {
        const shouldRetry = options?.shouldRetryOnError || (() => false);

        while (callCount < 2) {
          try {
            callCount++;
            if (callCount === 1) {
              const error = new Error('Service unavailable');
              (error as Error & { status: number }).status = 503;
              if (shouldRetry(error)) {
                continue;
              }
              throw error;
            }
            fetchMock.mockResolvedValueOnce({
              ok: true,
              body: undefined,
            });
            return fn();
          } catch (error) {
            if (!shouldRetry(error as Error)) {
              throw error;
            }
          }
        }
        fetchMock.mockResolvedValueOnce({
          ok: true,
          body: undefined,
        });
        return fn();
      });

      provider = new OpenAIResponsesProvider('test-key');

      const generator = provider.generateChatCompletion(
        createProviderCallOptions({
          providerName: provider.name,
          contents: [
            {
              speaker: 'human',
              blocks: [{ type: 'text', text: 'test 503 retry' }],
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

  describe('getModels', () => {
    it('should wrap models fetch with retryWithBackoff', async () => {
      retryWithBackoffMock.mockImplementation(async (fn) => {
        fetchMock.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            data: [{ id: 'o3-mini' }, { id: 'o1' }],
          }),
        });
        return fn();
      });

      provider = new OpenAIResponsesProvider('test-key');

      const models = await provider.getModels();

      // Verify retryWithBackoff was called for getModels
      expect(retryWithBackoffMock).toHaveBeenCalled();
      expect(models.length).toBeGreaterThan(0);
    });
  });

  describe('shouldRetryOnError predicate', () => {
    it('should return true for 429 errors', async () => {
      let capturedPredicate: ((error: Error) => boolean) | undefined;

      retryWithBackoffMock.mockImplementation(async (_fn, options) => {
        capturedPredicate = options?.shouldRetryOnError;
        fetchMock.mockResolvedValueOnce({
          ok: true,
          body: undefined,
        });
        return { ok: true, body: undefined };
      });

      provider = new OpenAIResponsesProvider('test-key');

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
        // Consume
      }

      expect(capturedPredicate).toBeDefined();
      const error429 = new Error('Rate limit');
      (error429 as Error & { status: number }).status = 429;
      expect(capturedPredicate!(error429)).toBe(true);
    });

    it('should return true for 5xx errors', async () => {
      let capturedPredicate: ((error: Error) => boolean) | undefined;

      retryWithBackoffMock.mockImplementation(async (_fn, options) => {
        capturedPredicate = options?.shouldRetryOnError;
        fetchMock.mockResolvedValueOnce({
          ok: true,
          body: undefined,
        });
        return { ok: true, body: undefined };
      });

      provider = new OpenAIResponsesProvider('test-key');

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
      const error500 = new Error('Internal server error');
      (error500 as Error & { status: number }).status = 500;
      const error502 = new Error('Bad gateway');
      (error502 as Error & { status: number }).status = 502;
      const error503 = new Error('Service unavailable');
      (error503 as Error & { status: number }).status = 503;

      expect(capturedPredicate!(error500)).toBe(true);
      expect(capturedPredicate!(error502)).toBe(true);
      expect(capturedPredicate!(error503)).toBe(true);
    });

    it('should return false for 400 errors', async () => {
      let capturedPredicate: ((error: Error) => boolean) | undefined;

      retryWithBackoffMock.mockImplementation(async (_fn, options) => {
        capturedPredicate = options?.shouldRetryOnError;
        fetchMock.mockResolvedValueOnce({
          ok: true,
          body: undefined,
        });
        return { ok: true, body: undefined };
      });

      provider = new OpenAIResponsesProvider('test-key');

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
      const error400 = new Error('Bad request');
      (error400 as Error & { status: number }).status = 400;
      expect(capturedPredicate!(error400)).toBe(false);
    });
  });
});
