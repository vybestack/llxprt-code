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

    it('should use maxAttempts: 1 for streaming fetch to avoid double-retry', async () => {
      retryWithBackoffMock.mockImplementation(async (fn, options) => {
        // Verify maxAttempts is 1 — outer while loop owns retry logic
        expect(options?.maxAttempts).toBe(1);
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

    it('should not retry on 400 bad request errors', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => 'Bad request',
      });

      retryWithBackoffMock.mockImplementation(async (fn) => fn());

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

      // 400 should not be retried — only 1 fetch call
      expect(fetchMock).toHaveBeenCalledTimes(1);
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

    it('should provide shouldRetryOnError to getModels retryWithBackoff', async () => {
      retryWithBackoffMock.mockImplementation(async (fn, options) => {
        // getModels still uses full retryWithBackoff with shouldRetryOnError
        expect(options?.shouldRetryOnError).toBeDefined();
        fetchMock.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            data: [{ id: 'o3-mini' }],
          }),
        });
        return fn();
      });

      provider = new OpenAIResponsesProvider('test-key');

      const models = await provider.getModels();

      expect(retryWithBackoffMock).toHaveBeenCalled();
      expect(models.length).toBeGreaterThan(0);
    });
  });
});
