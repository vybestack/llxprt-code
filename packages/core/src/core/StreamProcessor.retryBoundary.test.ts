/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for StreamProcessor stream retry boundary fix.
 * Verifies that first chunk consumption happens inside retryWithBackoff.
 *
 * @issue #1750 — Stream retry boundary
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StreamProcessor } from './StreamProcessor.js';
import { EmptyStreamError } from './geminiChatTypes.js';
import type { IContent } from '../services/history/IContent.js';
import type { GenerateContentResponse } from '@google/genai';
import type { Content, SendMessageParameters } from '@google/genai';

// Import retry utility types
import type * as retryModule from '../utils/retry.js';

// Mock the retry utility
vi.mock('../utils/retry.js', async () => {
  const actual = await vi.importActual<typeof retryModule>('../utils/retry.js');
  return {
    ...actual,
    retryWithBackoff: vi.fn(),
  };
});

// Mock turnLogging
vi.mock('./turnLogging.js', () => ({
  logApiRequest: vi.fn(),
  logApiResponse: vi.fn(),
  logApiError: vi.fn(),
}));

import { retryWithBackoff } from '../utils/retry.js';
import { prependAsyncGenerator } from '../utils/asyncIterator.js';
import { logApiResponse } from './turnLogging.js';

// Helper to create valid IContent with blocks
function createIContent(text: string): IContent {
  return {
    role: 'model',
    parts: [{ text }],
    blocks: [{ type: 'text', text }],
    metadata: {},
  };
}

describe('StreamProcessor._buildAndSendStreamRequest — stream retry boundary (#1750)', () => {
  let processor: StreamProcessor;
  let mockProvider: {
    name: string;
    generateChatCompletion: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Create minimal mock provider
    mockProvider = {
      name: 'test-provider',
      generateChatCompletion: vi.fn(),
    };

    // Create processor with minimal mocks
    processor = Object.create(StreamProcessor.prototype);

    const mockRuntimeContext = {
      state: {
        model: 'test-model',
        baseUrl: 'https://test.example.com',
        runtimeId: 'test-runtime',
        sessionId: 'test-session',
        provider: 'test-provider',
      },
      providerRuntime: {
        config: {
          getEnableHooks: () => false,
          getHookSystem: () => null,
        },
        runtimeId: 'test-runtime',
      },
      ephemerals: {
        reasoning: {
          includeInContext: () => false,
        },
      },
      tools: {
        listToolNames: () => [],
        getToolMetadata: () => undefined,
      },
      telemetry: {
        logApiRequest: vi.fn(),
        logApiResponse: vi.fn(),
        logApiError: vi.fn(),
      },
    };

    const mockCompressionHandler = {
      enforceContextWindow: vi.fn().mockResolvedValue(undefined),
      lastPromptTokenCount: 0,
    };

    const mockConversationManager = {
      makePositionMatcher: () => ({}),
      recordHistory: vi.fn(),
    };

    const mockHistoryService = {
      generateTurnKey: () => 'test-turn',
      getIdGeneratorCallback: () => () => 'test-id',
      getCuratedForProvider: (contents: IContent[]) => contents,
      add: vi.fn(),
      getAll: () => [],
      waitForTokenUpdates: vi.fn().mockResolvedValue(undefined),
    };

    const mockProviderRuntimeBuilder = () => ({
      config: {
        getEnableHooks: () => false,
        getHookSystem: () => null,
        getUserMemory: () => undefined,
      },
      settingsService: {},
      metadata: {},
    });

    Object.assign(processor, {
      runtimeContext: mockRuntimeContext,
      compressionHandler: mockCompressionHandler,
      conversationManager: mockConversationManager,
      historyService: mockHistoryService,
      providerResolver: () => mockProvider,
      providerRuntimeBuilder: mockProviderRuntimeBuilder,
      generationConfig: {},
      logger: { debug: () => {}, warn: () => {} },
    });

    // Mock retryWithBackoff to capture and execute the API call
    (retryWithBackoff as ReturnType<typeof vi.fn>).mockImplementation(
      async <T>(fn: () => Promise<T>) => fn(),
    );
  });

  describe('first chunk consumption within retry boundary', () => {
    it('forwards cancellation to the wrapped source iterator before first next', async () => {
      let sourceClosed = false;

      async function* source(): AsyncGenerator<number> {
        try {
          yield 2;
          await new Promise<void>(() => {
            // keep source pending to mimic a live stream
          });
        } finally {
          sourceClosed = true;
        }
      }

      const sourceIterator = source();
      const firstResult = await sourceIterator.next();
      expect(firstResult.done).toBe(false);

      const wrapped = prependAsyncGenerator(firstResult.value, sourceIterator);

      const cancelResult = await wrapped.return();
      expect(cancelResult.done).toBe(true);
      expect(sourceClosed).toBe(true);
    });

    it('should consume first chunk inside _buildAndSendStreamRequest before returning', async () => {
      // Track when the provider is called vs when the stream yields
      const timeline: string[] = [];

      async function* mockStream(): AsyncGenerator<IContent> {
        timeline.push('provider:started');
        yield createIContent('first chunk');
        timeline.push('provider:yielded:first');
        yield createIContent('second chunk');
        timeline.push('provider:yielded:second');
      }

      mockProvider.generateChatCompletion.mockImplementation(() => {
        timeline.push('generateChatCompletion:called');
        return mockStream();
      });

      // Access private method for testing
      const buildAndSend = (
        processor as unknown as {
          _buildAndSendStreamRequest: (
            params: unknown,
            promptId: string,
            userContent: Content | Content[],
            provider: typeof mockProvider,
          ) => Promise<AsyncGenerator<GenerateContentResponse>>;
        }
      )._buildAndSendStreamRequest;

      const params = { contents: [] };
      const userContent: Content = { role: 'user', parts: [{ text: 'test' }] };

      // Call the method directly (this will be wrapped by retryWithBackoff in real usage)
      const result = await buildAndSend.call(
        processor,
        params,
        'test-prompt',
        userContent,
        mockProvider,
      );

      // The stream should be returned but first chunk should already be consumed
      timeline.push('method:returned');

      // Now consume from the returned generator
      const firstResult = await result.next();
      timeline.push('consumer:received:first');

      // The first chunk from _convertIContentStream should be already available
      // without needing to wait for the provider to yield again
      expect(firstResult.done).toBe(false);
      expect(firstResult.value).toBeDefined();

      // Verify the timeline shows first chunk was consumed before method returned
      // This is the key fix - the first chunk establishes the HTTP connection
      const providerStartedIdx = timeline.indexOf('provider:started');
      const methodReturnedIdx = timeline.indexOf('method:returned');
      expect(providerStartedIdx).toBeGreaterThan(-1);
      expect(providerStartedIdx).toBeLessThan(methodReturnedIdx);
    });

    it('should throw EmptyStreamError when stream is immediately exhausted', async () => {
      // Create a stream that immediately returns (empty)
      // eslint-disable-next-line require-yield
      async function* emptyStream(): AsyncGenerator<IContent> {
        return;
      }

      mockProvider.generateChatCompletion.mockReturnValue(emptyStream());

      const buildAndSend = (
        processor as unknown as {
          _buildAndSendStreamRequest: (
            params: unknown,
            promptId: string,
            userContent: Content | Content[],
            provider: typeof mockProvider,
          ) => Promise<AsyncGenerator<GenerateContentResponse>>;
        }
      )._buildAndSendStreamRequest;

      const params = { contents: [] };
      const userContent: Content = { role: 'user', parts: [{ text: 'test' }] };

      // Should throw EmptyStreamError since stream is empty
      await expect(
        buildAndSend.call(
          processor,
          params,
          'test-prompt',
          userContent,
          mockProvider,
        ),
      ).rejects.toThrow(EmptyStreamError);

      // Ensure empty attempts are not logged as successful responses.
      expect(logApiResponse).not.toHaveBeenCalled();
    });
  });

  describe('execute stream call retry classification', () => {
    it('should classify EmptyStreamError as retryable in the retry policy', async () => {
      let capturedShouldRetryOnError:
        | ((error: unknown, retryFetchErrors?: boolean) => boolean)
        | undefined;
      (retryWithBackoff as ReturnType<typeof vi.fn>).mockImplementation(
        async <T>(
          fn: () => Promise<T>,
          options?: {
            shouldRetryOnError?: (
              error: unknown,
              retryFetchErrors?: boolean,
            ) => boolean;
          },
        ) => {
          capturedShouldRetryOnError = options?.shouldRetryOnError;
          return fn();
        },
      );

      const executeStreamApiCall = (
        processor as unknown as {
          _executeStreamApiCall: (
            params: { config?: { abortSignal?: AbortSignal } },
            promptId: string,
            userContent: Content | Content[],
            provider: { name: string },
          ) => Promise<AsyncGenerator<GenerateContentResponse>>;
        }
      )._executeStreamApiCall;

      const providerStub = { name: 'test-provider' };
      await executeStreamApiCall
        .call(
          processor,
          { config: {} },
          'test-prompt',
          { role: 'user', parts: [{ text: 'test' }] },
          providerStub,
        )
        .catch(() => {
          // ignore - _buildAndSendStreamRequest internals are not relevant to this assertion
        });

      expect(capturedShouldRetryOnError).toBeDefined();
      expect(
        capturedShouldRetryOnError?.(
          new EmptyStreamError(
            'Model stream ended immediately with no content.',
          ),
        ),
      ).toBe(true);
    });

    it('should pass retryFetchErrors through the retry policy classifier', async () => {
      let capturedRetryFetchErrors: boolean | undefined;
      let capturedShouldRetryOnError:
        | ((error: unknown, retryFetchErrors?: boolean) => boolean)
        | undefined;

      (retryWithBackoff as ReturnType<typeof vi.fn>).mockImplementation(
        async <T>(
          fn: () => Promise<T>,
          options?: {
            retryFetchErrors?: boolean;
            shouldRetryOnError?: (
              error: unknown,
              retryFetchErrors?: boolean,
            ) => boolean;
          },
        ) => {
          capturedRetryFetchErrors = options?.retryFetchErrors;
          capturedShouldRetryOnError = options?.shouldRetryOnError;
          return fn();
        },
      );

      const executeStreamApiCall = (
        processor as unknown as {
          _executeStreamApiCall: (
            params: {
              config?: {
                abortSignal?: AbortSignal;
                retryFetchErrors?: boolean;
              };
            },
            promptId: string,
            userContent: Content | Content[],
            provider: { name: string },
          ) => Promise<AsyncGenerator<GenerateContentResponse>>;
        }
      )._executeStreamApiCall;

      const providerStub = { name: 'test-provider' };
      await executeStreamApiCall
        .call(
          processor,
          { config: { retryFetchErrors: true } },
          'test-prompt',
          { role: 'user', parts: [{ text: 'test' }] },
          providerStub,
        )
        .catch(() => {
          // ignore - _buildAndSendStreamRequest internals are not relevant to this assertion
        });

      expect(capturedRetryFetchErrors).toBe(true);
      expect(capturedShouldRetryOnError).toBeDefined();
      expect(
        capturedShouldRetryOnError?.(
          new Error('fetch failed sending request'),
          false,
        ),
      ).toBe(false);
      expect(
        capturedShouldRetryOnError?.(
          new Error('fetch failed sending request'),
          true,
        ),
      ).toBe(true);
    });
  });

  describe('error handling during first chunk retrieval', () => {
    it('should throw network errors during first chunk consumption so they can be caught by retry', async () => {
      // Simulate a network error when consuming the first chunk
      async function* failingStream(): AsyncGenerator<IContent> {
        // First yield simulates establishing connection
        yield createIContent('first');
        // Second yield throws network error
        throw new Error('Connection reset');
      }

      mockProvider.generateChatCompletion.mockReturnValue(failingStream());

      const buildAndSend = (
        processor as unknown as {
          _buildAndSendStreamRequest: (
            params: unknown,
            promptId: string,
            userContent: Content | Content[],
            provider: typeof mockProvider,
          ) => Promise<AsyncGenerator<GenerateContentResponse>>;
        }
      )._buildAndSendStreamRequest;

      const params = { contents: [] };
      const userContent: Content = { role: 'user', parts: [{ text: 'test' }] };

      // First chunk succeeds, but the error during iteration should be handled
      const result = await buildAndSend.call(
        processor,
        params,
        'test-prompt',
        userContent,
        mockProvider,
      );

      // Consume first chunk (succeeds)
      const first = await result.next();
      expect(first.done).toBe(false);

      // Second chunk should throw
      await expect(result.next()).rejects.toThrow('Connection reset');
    });

    it('should wrap lazy generators so errors occur within retry boundary', async () => {
      // This test verifies that a lazy async generator (where the actual API call
      // happens on first iteration) has its first chunk consumed within the
      // retry boundary, ensuring connection errors trigger retry logic.

      let apiCallMade = false;

      // eslint-disable-next-line require-yield
      async function* lazyGenerator(): AsyncGenerator<IContent> {
        // This simulates the actual API call happening when iteration starts
        apiCallMade = true;
        // Simulate connection error during first chunk
        throw new Error('ECONNRESET');
      }

      mockProvider.generateChatCompletion.mockReturnValue(lazyGenerator());

      const buildAndSend = (
        processor as unknown as {
          _buildAndSendStreamRequest: (
            params: unknown,
            promptId: string,
            userContent: Content | Content[],
            provider: typeof mockProvider,
          ) => Promise<AsyncGenerator<GenerateContentResponse>>;
        }
      )._buildAndSendStreamRequest;

      const params = { contents: [] };
      const userContent: Content = { role: 'user', parts: [{ text: 'test' }] };

      // The error should occur during _buildAndSendStreamRequest
      // (inside the retry boundary), not when the caller later iterates
      await expect(
        buildAndSend.call(
          processor,
          params,
          'test-prompt',
          userContent,
          mockProvider,
        ),
      ).rejects.toThrow('ECONNRESET');

      // Verify the API call was actually attempted
      expect(apiCallMade).toBe(true);
    });
  });
});

describe('StreamProcessor.makeApiCallAndProcessStream — cancellation before first next', () => {
  it('should forward return to the preloaded stream without creating the processed stream', async () => {
    let sourceClosed = false;

    async function* source(): AsyncGenerator<GenerateContentResponse> {
      try {
        yield {
          candidates: [{ content: { parts: [{ text: 'prefetched' }] } }],
        } as GenerateContentResponse;
        await new Promise<void>(() => {
          // Keep source pending to mimic an active stream.
        });
      } finally {
        sourceClosed = true;
      }
    }

    const sourceIterator = source();
    const prefetched = await sourceIterator.next();
    expect(prefetched.done).toBe(false);

    const preloadedStream = prependAsyncGenerator(
      prefetched.value,
      sourceIterator,
    );

    const processStreamResponse = vi.fn(() => {
      async function* processed(): AsyncGenerator<GenerateContentResponse> {
        yield {
          candidates: [{ content: { parts: [{ text: 'processed' }] } }],
        } as GenerateContentResponse;
      }
      return processed();
    });

    const executeStreamApiCall = vi.fn().mockResolvedValue(preloadedStream);

    const provider = {
      name: 'test-provider',
      generateChatCompletion: vi.fn(),
    };

    const processor = Object.create(
      StreamProcessor.prototype,
    ) as StreamProcessor;
    Object.assign(processor, {
      runtimeContext: {
        state: {
          model: 'test-model',
          baseUrl: 'https://test.example.com',
        },
      },
      compressionHandler: {
        enforceContextWindow: vi.fn().mockResolvedValue(undefined),
      },
      providerResolver: vi.fn(() => provider),
      _executeStreamApiCall: executeStreamApiCall,
      processStreamResponse,
      logger: { debug: () => {}, warn: () => {} },
    });

    const stream = await processor.makeApiCallAndProcessStream(
      { config: {} } as SendMessageParameters,
      'test-prompt',
      0,
      { role: 'user', parts: [{ text: 'hello' }] },
    );

    const returnResult = await stream.return();

    expect(returnResult.done).toBe(true);
    expect(processStreamResponse).not.toHaveBeenCalled();
    expect(sourceClosed).toBe(true);
    expect(executeStreamApiCall).toHaveBeenCalledTimes(1);
  });
});

describe('StreamProcessor._executeStreamApiCall — retry integration (#1750)', () => {
  it('should have API call errors caught by retryWithBackoff', async () => {
    // Import the actual retryWithBackoff to test integration
    const { retryWithBackoff: actualRetry } =
      await vi.importActual<typeof import('../utils/retry.js')>(
        '../utils/retry.js',
      );

    // Track retry attempts
    let _attemptCount = 0;
    const mockApiCall = vi.fn().mockImplementation(async () => {
      _attemptCount++;
      if (_attemptCount < 3) {
        const error = new Error('429 Rate Limited') as Error & {
          status: number;
        };
        error.status = 429;
        throw error;
      }
      // Return a generator on success
      async function* successStream(): AsyncGenerator<GenerateContentResponse> {
        yield {
          candidates: [{ content: { parts: [{ text: 'success' }] } }],
        } as GenerateContentResponse;
      }
      return successStream();
    });

    // Use actual retry logic with limited attempts
    const result = await actualRetry(mockApiCall, {
      maxAttempts: 3,
      initialDelayMs: 10,
      maxDelayMs: 100,
    });

    // Verify retries happened
    expect(_attemptCount).toBe(3);
    expect(mockApiCall).toHaveBeenCalledTimes(3);

    // Verify we got a working generator
    const firstChunk = await result.next();
    expect(firstChunk.done).toBe(false);
    expect(firstChunk.value).toBeDefined();
  });

  it('should trigger bucket failover on persistent 429 errors', async () => {
    const { retryWithBackoff: actualRetry } =
      await vi.importActual<typeof import('../utils/retry.js')>(
        '../utils/retry.js',
      );

    let _failoverCalled = false;
    const mockOnPersistent429 = vi.fn().mockResolvedValue(true); // Simulate successful failover

    let _attemptCount = 0;
    const mockApiCall = vi.fn().mockImplementation(async () => {
      _attemptCount++;
      if (!_failoverCalled) {
        const error = new Error('429 Rate Limited') as Error & {
          status: number;
        };
        error.status = 429;
        throw error;
      }
      async function* successStream(): AsyncGenerator<GenerateContentResponse> {
        yield {
          candidates: [{ content: { parts: [{ text: 'after failover' }] } }],
        } as GenerateContentResponse;
      }
      return successStream();
    });

    try {
      await actualRetry(mockApiCall, {
        maxAttempts: 5,
        initialDelayMs: 10,
        maxDelayMs: 100,
        onPersistent429: async () => {
          _failoverCalled = true;
          return mockOnPersistent429();
        },
      });
    } catch {
      // Expected to potentially fail in this test setup
    }

    // Verify failover was attempted
    expect(_failoverCalled).toBe(true);
    expect(mockOnPersistent429).toHaveBeenCalled();
  });
});
