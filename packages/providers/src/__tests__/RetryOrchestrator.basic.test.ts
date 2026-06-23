/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { RetryOrchestrator } from '../RetryOrchestrator.js';
import type { IProvider, GenerateChatOptions } from '../IProvider.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { IModel } from '../IModel.js';
import { delay } from '@vybestack/llxprt-code-core/utils/delay.js';

/**
 * Test helper: Creates a fake provider that behaves according to provided scenarios
 */
function createTestProvider(config: {
  name?: string;
  responses?: Array<'success' | 'error' | { error: Error }>;
  streamChunks?: IContent[][];
}): IProvider {
  let callCount = 0;

  const successContent: IContent = {
    speaker: 'ai',
    blocks: [{ type: 'text', text: 'test response' }],
  };

  return {
    name: config.name ?? 'test-provider',
    async *generateChatCompletion(_options: GenerateChatOptions) {
      const responseIndex = Math.min(
        callCount,
        (config.responses?.length ?? 1) - 1,
      );
      callCount++;

      const response = config.responses?.[responseIndex] ?? 'success';

      if (response === 'error') {
        throw new Error('Generic error');
      } else if (typeof response === 'object' && 'error' in response) {
        throw response.error;
      }

      // Success case - yield chunks
      const chunks = config.streamChunks?.[responseIndex] ?? [successContent];
      for (const chunk of chunks) {
        yield chunk;
      }
    },
    async getModels(): Promise<IModel[]> {
      return [];
    },
    getDefaultModel(): string {
      return 'test-model';
    },
    getServerTools(): string[] {
      return [];
    },
    async invokeServerTool(): Promise<unknown> {
      return null;
    },
  };
}

/**
 * Helper to create a 429 rate limit error
 */
function createRateLimitError(retryAfter?: number): Error {
  const error = new Error('Rate limit exceeded') as Error & {
    status?: number;
    response?: { headers?: { 'retry-after'?: string } };
  };
  error.status = 429;
  if (retryAfter != null && retryAfter > 0) {
    error.response = {
      headers: {
        'retry-after': retryAfter.toString(),
      },
    };
  }
  return error;
}

/**
 * Helper to create a 5xx server error
 */
function createServerError(status = 500): Error {
  const error = new Error(`Server error ${status}`) as Error & {
    status?: number;
  };
  error.status = status;
  return error;
}

/**
 * Helper to create a 400 bad request error
 */
function createBadRequestError(): Error {
  const error = new Error('Bad request') as Error & { status?: number };
  error.status = 400;
  return error;
}

/**
 * Helper to create a 402 payment required error
 */

/**
 * Helper to create a 401 auth error
 */

/**
 * Helper to create a network transient error
 */
function createNetworkError(code = 'ECONNRESET'): Error {
  const error = new Error('Connection reset') as Error & { code?: string };
  error.code = code;
  return error;
}

/**
 * Helper to create an Anthropic SDK-wrapped api_error (Internal Server Error).
 *
 * Mirrors how the Anthropic SDK throws stream error events: it constructs an
 * APIError with `status: undefined` and stores the entire response body on the
 * `error` property. The retryable type therefore lives at
 * `error.error.error.type`, with the intermediate `error.error.type` being the
 * generic envelope value "error". Carries no HTTP status, so retryability must
 * be derived from the body-level type (issue #2053).
 */
function createAnthropicApiError(): Error {
  const error = new Error('Internal server error') as Error & {
    status?: number;
    error?: unknown;
  };
  error.status = undefined;
  error.error = {
    type: 'error',
    error: {
      details: null,
      type: 'api_error',
      message: 'Internal server error',
    },
    request_id: 'req_011Cc7LnNajEpxrjW4iJ67q7',
  };
  return error;
}

/**
 * Helper to consume async iterator and return all chunks
 */
async function consumeStream(
  stream: AsyncIterableIterator<IContent>,
): Promise<IContent[]> {
  const chunks: IContent[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return chunks;
}

describe('RetryOrchestrator', () => {
  describe('Basic Retry Behavior', () => {
    it('should succeed on first attempt when no errors', async () => {
      const provider = createTestProvider({ responses: ['success'] });
      const orchestrator = new RetryOrchestrator(provider);

      const options: GenerateChatOptions = {
        contents: [{ role: 'user', blocks: [{ type: 'text', text: 'test' }] }],
      };

      const result = await consumeStream(
        orchestrator.generateChatCompletion(options),
      );

      expect(result).toHaveLength(1);
      expect(result[0].blocks[0]).toMatchObject({
        type: 'text',
        text: 'test response',
      });
    });

    it('should retry on 429 rate limit errors', async () => {
      const rateLimitError = createRateLimitError();
      const provider = createTestProvider({
        responses: [{ error: rateLimitError }, 'success'],
      });

      const orchestrator = new RetryOrchestrator(provider, {
        maxAttempts: 3,
        initialDelayMs: 10, // Fast for testing
      });

      const options: GenerateChatOptions = {
        contents: [{ role: 'user', blocks: [{ type: 'text', text: 'test' }] }],
      };

      const result = await consumeStream(
        orchestrator.generateChatCompletion(options),
      );

      expect(result).toHaveLength(1);
      expect(result[0].blocks[0]).toMatchObject({
        type: 'text',
        text: 'test response',
      });
    });

    it('should retry on 5xx server errors', async () => {
      const serverError = createServerError(503);
      const provider = createTestProvider({
        responses: [{ error: serverError }, 'success'],
      });

      const orchestrator = new RetryOrchestrator(provider, {
        maxAttempts: 3,
        initialDelayMs: 10,
      });

      const options: GenerateChatOptions = {
        contents: [{ role: 'user', blocks: [{ type: 'text', text: 'test' }] }],
      };

      const result = await consumeStream(
        orchestrator.generateChatCompletion(options),
      );

      expect(result).toHaveLength(1);
    });

    it('should NOT retry on 400 bad request', async () => {
      const badRequestError = createBadRequestError();
      const provider = createTestProvider({
        responses: [{ error: badRequestError }],
      });

      const orchestrator = new RetryOrchestrator(provider, {
        maxAttempts: 3,
        initialDelayMs: 10,
      });

      const options: GenerateChatOptions = {
        contents: [{ role: 'user', blocks: [{ type: 'text', text: 'test' }] }],
      };

      await expect(
        consumeStream(orchestrator.generateChatCompletion(options)),
      ).rejects.toThrow('Bad request');
    });

    it('should retry on network transient errors', async () => {
      const networkError = createNetworkError('ECONNRESET');
      const provider = createTestProvider({
        responses: [{ error: networkError }, 'success'],
      });

      const orchestrator = new RetryOrchestrator(provider, {
        maxAttempts: 3,
        initialDelayMs: 10,
      });

      const options: GenerateChatOptions = {
        contents: [{ role: 'user', blocks: [{ type: 'text', text: 'test' }] }],
      };

      const result = await consumeStream(
        orchestrator.generateChatCompletion(options),
      );

      expect(result).toHaveLength(1);
    });

    it('should respect maxAttempts configuration', async () => {
      const rateLimitError = createRateLimitError();
      const provider = createTestProvider({
        responses: [
          { error: rateLimitError },
          { error: rateLimitError },
          { error: rateLimitError },
        ],
      });

      const orchestrator = new RetryOrchestrator(provider, {
        maxAttempts: 2,
        initialDelayMs: 10,
      });

      const options: GenerateChatOptions = {
        contents: [{ role: 'user', blocks: [{ type: 'text', text: 'test' }] }],
      };

      await expect(
        consumeStream(orchestrator.generateChatCompletion(options)),
      ).rejects.toThrow('Rate limit exceeded');
    });

    it('should apply exponential backoff with jitter', async () => {
      const rateLimitError = createRateLimitError();
      const provider = createTestProvider({
        responses: [
          { error: rateLimitError },
          { error: rateLimitError },
          'success',
        ],
      });

      const orchestrator = new RetryOrchestrator(provider, {
        maxAttempts: 3,
        initialDelayMs: 100,
        maxDelayMs: 1000,
      });

      const options: GenerateChatOptions = {
        contents: [{ role: 'user', blocks: [{ type: 'text', text: 'test' }] }],
      };

      const startTime = Date.now();
      await consumeStream(orchestrator.generateChatCompletion(options));
      const elapsed = Date.now() - startTime;

      // Should have at least 2 delays (first ~100ms, second ~200ms with jitter)
      // Allow some variance for jitter and execution time
      expect(elapsed).toBeGreaterThan(200); // At least some backoff happened
    });

    it('should respect Retry-After header', async () => {
      const rateLimitError = createRateLimitError(1); // 1 second
      const provider = createTestProvider({
        responses: [{ error: rateLimitError }, 'success'],
      });

      const orchestrator = new RetryOrchestrator(provider, {
        maxAttempts: 3,
        initialDelayMs: 50,
      });

      const options: GenerateChatOptions = {
        contents: [{ role: 'user', blocks: [{ type: 'text', text: 'test' }] }],
      };

      const startTime = Date.now();
      await consumeStream(orchestrator.generateChatCompletion(options));
      const elapsed = Date.now() - startTime;

      // Should respect the 1 second Retry-After
      expect(elapsed).toBeGreaterThan(900); // Allow some margin
    });

    it('should track throttle wait time via callback', async () => {
      const rateLimitError = createRateLimitError();
      const provider = createTestProvider({
        responses: [{ error: rateLimitError }, 'success'],
      });

      const throttleWaits: number[] = [];
      const orchestrator = new RetryOrchestrator(provider, {
        maxAttempts: 3,
        initialDelayMs: 50,
        trackThrottleWaitTime: (waitTimeMs) => throttleWaits.push(waitTimeMs),
      });

      const options: GenerateChatOptions = {
        contents: [{ role: 'user', blocks: [{ type: 'text', text: 'test' }] }],
      };

      await consumeStream(orchestrator.generateChatCompletion(options));

      expect(throttleWaits.length).toBeGreaterThan(0);
      expect(throttleWaits[0]).toBeGreaterThan(0);
    });

    it('should retry on Anthropic SDK-wrapped api_error and then succeed (issue #2053)', async () => {
      // Reproduces issue #2053: an Anthropic "Internal server error" (api_error)
      // arrives with no HTTP status, wrapped by the SDK at
      // error.error.error.type. Previously this broke the loop instead of
      // retrying. The orchestrator must retry and yield the eventual success.
      const apiError = createAnthropicApiError();
      const provider = createTestProvider({
        responses: [{ error: apiError }, 'success'],
      });

      const orchestrator = new RetryOrchestrator(provider, {
        maxAttempts: 3,
        initialDelayMs: 10,
      });

      const options: GenerateChatOptions = {
        contents: [{ role: 'user', blocks: [{ type: 'text', text: 'test' }] }],
      };

      const result = await consumeStream(
        orchestrator.generateChatCompletion(options),
      );

      expect(result).toHaveLength(1);
      expect(result[0].blocks[0]).toMatchObject({
        type: 'text',
        text: 'test response',
      });
    });
  });
  describe('Streaming Support', () => {
    it('should yield chunks as they arrive', async () => {
      const chunk1: IContent = {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'chunk1' }],
      };
      const chunk2: IContent = {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'chunk2' }],
      };

      const provider = createTestProvider({
        streamChunks: [[chunk1, chunk2]],
      });

      const orchestrator = new RetryOrchestrator(provider);

      const options: GenerateChatOptions = {
        contents: [{ role: 'user', blocks: [{ type: 'text', text: 'test' }] }],
      };

      const chunks: IContent[] = [];
      for await (const chunk of orchestrator.generateChatCompletion(options)) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(2);
      expect(chunks[0].blocks[0]).toMatchObject({
        type: 'text',
        text: 'chunk1',
      });
      expect(chunks[1].blocks[0]).toMatchObject({
        type: 'text',
        text: 'chunk2',
      });
    });

    it('should NOT retry when chunks were already yielded (prevents mixed response)', async () => {
      // When chunks have already been yielded to the caller and an error occurs,
      // we should NOT retry - that would produce a mixed response (partial + retry).
      // Instead, propagate the error immediately.
      let attemptCount = 0;

      const provider: IProvider = {
        name: 'streaming-test-provider',
        async *generateChatCompletion(_options: GenerateChatOptions) {
          attemptCount++;

          if (attemptCount === 1) {
            // First attempt - yield one chunk then error
            yield {
              speaker: 'ai',
              blocks: [{ type: 'text', text: 'partial' }],
            } as IContent;
            throw createNetworkError('STREAM_INTERRUPTED');
          } else {
            // Second attempt - should never be reached
            yield {
              speaker: 'ai',
              blocks: [{ type: 'text', text: 'complete' }],
            } as IContent;
          }
        },
        async getModels(): Promise<IModel[]> {
          return [];
        },
        getDefaultModel(): string {
          return 'test-model';
        },
        getServerTools(): string[] {
          return [];
        },
        async invokeServerTool(): Promise<unknown> {
          return null;
        },
      };

      const orchestrator = new RetryOrchestrator(provider, {
        maxAttempts: 3,
        initialDelayMs: 10,
      });

      const options: GenerateChatOptions = {
        contents: [{ role: 'user', blocks: [{ type: 'text', text: 'test' }] }],
      };

      const chunks: IContent[] = [];
      let thrownError: Error | null = null;
      try {
        for await (const chunk of orchestrator.generateChatCompletion(
          options,
        )) {
          chunks.push(chunk);
        }
      } catch (e) {
        thrownError = e as Error;
      }

      // Should have received the partial chunk before the error
      expect(chunks).toHaveLength(1);
      expect(chunks[0].blocks[0]).toMatchObject({
        type: 'text',
        text: 'partial',
      });

      // Should have thrown an error (no retry when chunks were yielded)
      expect(thrownError).not.toBeNull();
      expect(thrownError?.message).toContain('Connection reset');

      // Should NOT have attempted a second try
      expect(attemptCount).toBe(1);
    });

    it('should apply timeout for first chunk', async () => {
      const provider: IProvider = {
        name: 'slow-streaming-provider',
        async *generateChatCompletion(_options: GenerateChatOptions) {
          // Delay before first chunk
          await delay(200);
          yield {
            speaker: 'ai',
            blocks: [{ type: 'text', text: 'slow' }],
          } as IContent;
        },
        async getModels(): Promise<IModel[]> {
          return [];
        },
        getDefaultModel(): string {
          return 'test-model';
        },
        getServerTools(): string[] {
          return [];
        },
        async invokeServerTool(): Promise<unknown> {
          return null;
        },
      };

      const orchestrator = new RetryOrchestrator(provider, {
        streamingTimeoutMs: 100, // Timeout before first chunk arrives
        maxAttempts: 1, // Don't retry - just timeout immediately
      });

      const options: GenerateChatOptions = {
        contents: [{ role: 'user', blocks: [{ type: 'text', text: 'test' }] }],
      };

      await expect(
        consumeStream(orchestrator.generateChatCompletion(options)),
      ).rejects.toThrow(/timeout/i);
    });

    it('should failover on stream timeout', async () => {
      let attemptCount = 0;

      const provider: IProvider = {
        name: 'timeout-failover-provider',
        async *generateChatCompletion(_options: GenerateChatOptions) {
          attemptCount++;

          if (attemptCount === 1) {
            // First attempt times out (slow)
            await delay(200);
            yield {
              speaker: 'ai',
              blocks: [{ type: 'text', text: 'too slow' }],
            } as IContent;
          } else {
            // Second attempt succeeds quickly
            yield {
              speaker: 'ai',
              blocks: [{ type: 'text', text: 'success' }],
            } as IContent;
          }
        },
        async getModels(): Promise<IModel[]> {
          return [];
        },
        getDefaultModel(): string {
          return 'test-model';
        },
        getServerTools(): string[] {
          return [];
        },
        async invokeServerTool(): Promise<unknown> {
          return null;
        },
      };

      const orchestrator = new RetryOrchestrator(provider, {
        maxAttempts: 3,
        initialDelayMs: 10,
        streamingTimeoutMs: 100, // Timeout after 100ms for first chunk
      });

      const options: GenerateChatOptions = {
        contents: [{ role: 'user', blocks: [{ type: 'text', text: 'test' }] }],
      };

      // First attempt times out, second attempt succeeds
      const result = await consumeStream(
        orchestrator.generateChatCompletion(options),
      );

      expect(result).toHaveLength(1);
      expect(result[0].blocks[0]).toMatchObject({
        type: 'text',
        text: 'success',
      });
      expect(attemptCount).toBe(2);
    });
  });
  describe('Configuration', () => {
    it('should read retries from ephemeral settings', async () => {
      const rateLimitError = createRateLimitError();
      const provider = createTestProvider({
        responses: [
          { error: rateLimitError },
          { error: rateLimitError },
          { error: rateLimitError },
          'success',
        ],
      });

      const orchestrator = new RetryOrchestrator(provider, {
        initialDelayMs: 10,
      });

      const options: GenerateChatOptions = {
        contents: [{ role: 'user', blocks: [{ type: 'text', text: 'test' }] }],
        invocation: {
          ephemerals: {
            retries: 5, // Override default maxAttempts
          },
        } as unknown as GenerateChatOptions['runtime'],
      };

      const result = await consumeStream(
        orchestrator.generateChatCompletion(options),
      );

      expect(result).toHaveLength(1);
    });

    it('should read retrywait from ephemeral settings', async () => {
      const rateLimitError = createRateLimitError();
      const provider = createTestProvider({
        responses: [{ error: rateLimitError }, 'success'],
      });

      const orchestrator = new RetryOrchestrator(provider, {
        maxAttempts: 3,
      });

      const options: GenerateChatOptions = {
        contents: [{ role: 'user', blocks: [{ type: 'text', text: 'test' }] }],
        invocation: {
          ephemerals: {
            retrywait: 20, // Override initial delay
          },
        } as unknown as GenerateChatOptions['runtime'],
      };

      const startTime = Date.now();
      await consumeStream(orchestrator.generateChatCompletion(options));
      const elapsed = Date.now() - startTime;

      // Should use the ephemeral retrywait value
      expect(elapsed).toBeLessThan(100); // Fast retry
    });

    it('should use defaults when settings not provided', async () => {
      const rateLimitError = createRateLimitError();
      const provider = createTestProvider({
        responses: [{ error: rateLimitError }, 'success'],
      });

      // Override defaults to make test faster
      const orchestrator = new RetryOrchestrator(provider, {
        initialDelayMs: 10,
      });

      const options: GenerateChatOptions = {
        contents: [{ role: 'user', blocks: [{ type: 'text', text: 'test' }] }],
      };

      const result = await consumeStream(
        orchestrator.generateChatCompletion(options),
      );

      expect(result).toHaveLength(1);
    });
  });
  describe('Abort Signal', () => {
    it('should abort immediately when signal is already aborted', async () => {
      const provider = createTestProvider({ responses: ['success'] });
      const orchestrator = new RetryOrchestrator(provider);

      const abortController = new AbortController();
      abortController.abort();

      const options: GenerateChatOptions = {
        contents: [{ role: 'user', blocks: [{ type: 'text', text: 'test' }] }],
        invocation: {
          signal: abortController.signal,
        } as unknown as GenerateChatOptions['runtime'],
      };

      await expect(
        consumeStream(orchestrator.generateChatCompletion(options)),
      ).rejects.toThrow(/abort/i);
    });

    it('should abort during backoff delay', async () => {
      const rateLimitError = createRateLimitError();
      const provider = createTestProvider({
        responses: [{ error: rateLimitError }, 'success'],
      });

      const orchestrator = new RetryOrchestrator(provider, {
        maxAttempts: 3,
        initialDelayMs: 1000, // Long delay
      });

      const abortController = new AbortController();

      const options: GenerateChatOptions = {
        contents: [{ role: 'user', blocks: [{ type: 'text', text: 'test' }] }],
        invocation: {
          signal: abortController.signal,
        } as unknown as GenerateChatOptions['runtime'],
      };

      // Abort after a short time during the backoff
      setTimeout(() => abortController.abort(), 100);

      await expect(
        consumeStream(orchestrator.generateChatCompletion(options)),
      ).rejects.toThrow(/abort/i);
    });

    it('should propagate abort to underlying provider', async () => {
      let providerCalls = 0;
      let providerReceivedOptions: GenerateChatOptions | undefined;

      const provider: IProvider = {
        name: 'abort-test-provider',
        async *generateChatCompletion(options: GenerateChatOptions) {
          providerCalls++;
          providerReceivedOptions = options;

          // Simulate provider checking signal
          await delay(50);

          if (options.invocation?.signal?.aborted === true) {
            throw new Error('Aborted');
          }

          yield {
            speaker: 'ai',
            blocks: [{ type: 'text', text: 'test' }],
          } as IContent;
        },
        async getModels(): Promise<IModel[]> {
          return [];
        },
        getDefaultModel(): string {
          return 'test-model';
        },
        getServerTools(): string[] {
          return [];
        },
        async invokeServerTool(): Promise<unknown> {
          return null;
        },
      };

      const orchestrator = new RetryOrchestrator(provider);

      const abortController = new AbortController();

      const options: GenerateChatOptions = {
        contents: [{ role: 'user', blocks: [{ type: 'text', text: 'test' }] }],
        invocation: {
          signal: abortController.signal,
        } as unknown as GenerateChatOptions['runtime'],
      };

      // Start the request, then abort mid-flight
      const streamPromise = consumeStream(
        orchestrator.generateChatCompletion(options),
      );

      // Abort after a short delay
      setTimeout(() => abortController.abort(), 25);

      await expect(streamPromise).rejects.toThrow(/abort/i);

      // Provider should have been called and received the signal
      expect(providerCalls).toBeGreaterThan(0);
      expect(providerReceivedOptions?.invocation?.signal).toBeDefined();
      expect(providerReceivedOptions?.invocation?.signal?.aborted).toBe(true);
    });
  });
});
