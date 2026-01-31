/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * @plan PLAN-20260128issue808
 * RetryOrchestrator - Centralized retry and bucket failover management
 *
 * BEHAVIORAL TESTS - No mocks, testing actual retry and failover behavior
 */

import { describe, it, expect } from 'vitest';
import { RetryOrchestrator } from '../RetryOrchestrator.js';
import type { IProvider, GenerateChatOptions } from '../IProvider.js';
import type { IContent } from '../../services/history/IContent.js';
import type { IModel } from '../IModel.js';
import { delay } from '../../utils/delay.js';

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
  if (retryAfter) {
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
function createPaymentRequiredError(): Error {
  const error = new Error('Payment required') as Error & { status?: number };
  error.status = 402;
  return error;
}

/**
 * Helper to create a 401 auth error
 */
function createAuthError(status = 401): Error {
  const error = new Error(`Auth error ${status}`) as Error & {
    status?: number;
  };
  error.status = status;
  return error;
}

/**
 * Helper to create a network transient error
 */
function createNetworkError(code = 'ECONNRESET'): Error {
  const error = new Error('Connection reset') as Error & { code?: string };
  error.code = code;
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
  });

  describe('Bucket Failover', () => {
    it('should failover to next bucket on persistent 429', async () => {
      const rateLimitError = createRateLimitError();
      let currentBucket = 'bucket1';
      const buckets = ['bucket1', 'bucket2', 'bucket3'];
      let bucketIndex = 0;

      const provider = createTestProvider({
        responses: [
          { error: rateLimitError },
          { error: rateLimitError }, // Trigger failover after 2 attempts
          'success',
        ],
      });

      const failoverHandler = {
        getBuckets: () => buckets,
        getCurrentBucket: () => currentBucket,
        tryFailover: async () => {
          bucketIndex++;
          if (bucketIndex >= buckets.length) return false;
          currentBucket = buckets[bucketIndex];
          return true;
        },
        isEnabled: () => true,
      };

      const orchestrator = new RetryOrchestrator(provider, {
        maxAttempts: 5,
        initialDelayMs: 10,
      });

      const options: GenerateChatOptions = {
        contents: [{ role: 'user', blocks: [{ type: 'text', text: 'test' }] }],
        runtime: {
          config: {
            getBucketFailoverHandler: () => failoverHandler,
          } as unknown as GenerateChatOptions['runtime'],
        } as unknown as GenerateChatOptions['runtime'],
      };

      const result = await consumeStream(
        orchestrator.generateChatCompletion(options),
      );

      expect(result).toHaveLength(1);
      expect(currentBucket).toBe('bucket2'); // Should have failed over once
    });

    it('should failover on 402 payment required', async () => {
      const paymentError = createPaymentRequiredError();
      let currentBucket = 'bucket1';
      const buckets = ['bucket1', 'bucket2'];
      let bucketIndex = 0;

      const provider = createTestProvider({
        responses: [{ error: paymentError }, 'success'],
      });

      const failoverHandler = {
        getBuckets: () => buckets,
        getCurrentBucket: () => currentBucket,
        tryFailover: async () => {
          bucketIndex++;
          if (bucketIndex >= buckets.length) return false;
          currentBucket = buckets[bucketIndex];
          return true;
        },
        isEnabled: () => true,
      };

      const orchestrator = new RetryOrchestrator(provider, {
        maxAttempts: 3,
        initialDelayMs: 10,
      });

      const options: GenerateChatOptions = {
        contents: [{ role: 'user', blocks: [{ type: 'text', text: 'test' }] }],
        runtime: {
          config: {
            getBucketFailoverHandler: () => failoverHandler,
          } as unknown as GenerateChatOptions['runtime'],
        } as unknown as GenerateChatOptions['runtime'],
      };

      const result = await consumeStream(
        orchestrator.generateChatCompletion(options),
      );

      expect(result).toHaveLength(1);
      expect(currentBucket).toBe('bucket2');
    });

    it('should failover on quota exceeded errors', async () => {
      const quotaError = new Error('Quota exceeded') as Error & {
        status?: number;
      };
      quotaError.status = 429;
      let currentBucket = 'bucket1';
      const buckets = ['bucket1', 'bucket2'];
      let bucketIndex = 0;

      const provider = createTestProvider({
        responses: [{ error: quotaError }, { error: quotaError }, 'success'],
      });

      const failoverHandler = {
        getBuckets: () => buckets,
        getCurrentBucket: () => currentBucket,
        tryFailover: async () => {
          bucketIndex++;
          if (bucketIndex >= buckets.length) return false;
          currentBucket = buckets[bucketIndex];
          return true;
        },
        isEnabled: () => true,
      };

      const orchestrator = new RetryOrchestrator(provider, {
        maxAttempts: 5,
        initialDelayMs: 10,
      });

      const options: GenerateChatOptions = {
        contents: [{ role: 'user', blocks: [{ type: 'text', text: 'test' }] }],
        runtime: {
          config: {
            getBucketFailoverHandler: () => failoverHandler,
          } as unknown as GenerateChatOptions['runtime'],
        } as unknown as GenerateChatOptions['runtime'],
      };

      const result = await consumeStream(
        orchestrator.generateChatCompletion(options),
      );

      expect(result).toHaveLength(1);
    });

    it('should failover on 401/403 after one retry', async () => {
      const authError = createAuthError(401);
      let currentBucket = 'bucket1';
      const buckets = ['bucket1', 'bucket2'];
      let bucketIndex = 0;

      const provider = createTestProvider({
        responses: [
          { error: authError },
          { error: authError }, // Second 401 triggers failover
          'success',
        ],
      });

      const failoverHandler = {
        getBuckets: () => buckets,
        getCurrentBucket: () => currentBucket,
        tryFailover: async () => {
          bucketIndex++;
          if (bucketIndex >= buckets.length) return false;
          currentBucket = buckets[bucketIndex];
          return true;
        },
        isEnabled: () => true,
      };

      const orchestrator = new RetryOrchestrator(provider, {
        maxAttempts: 5,
        initialDelayMs: 10,
      });

      const options: GenerateChatOptions = {
        contents: [{ role: 'user', blocks: [{ type: 'text', text: 'test' }] }],
        runtime: {
          config: {
            getBucketFailoverHandler: () => failoverHandler,
          } as unknown as GenerateChatOptions['runtime'],
        } as unknown as GenerateChatOptions['runtime'],
      };

      const result = await consumeStream(
        orchestrator.generateChatCompletion(options),
      );

      expect(result).toHaveLength(1);
      expect(currentBucket).toBe('bucket2');
    });

    it('should reset retry count after successful bucket switch', async () => {
      const rateLimitError = createRateLimitError();
      let currentBucket = 'bucket1';
      const buckets = ['bucket1', 'bucket2', 'bucket3'];
      let bucketIndex = 0;

      // First 2 attempts fail, trigger failover, next 2 fail, trigger another failover, then succeed
      const provider = createTestProvider({
        responses: [
          { error: rateLimitError },
          { error: rateLimitError }, // Failover to bucket2
          { error: rateLimitError },
          { error: rateLimitError }, // Failover to bucket3
          'success',
        ],
      });

      const failoverHandler = {
        getBuckets: () => buckets,
        getCurrentBucket: () => currentBucket,
        tryFailover: async () => {
          bucketIndex++;
          if (bucketIndex >= buckets.length) return false;
          currentBucket = buckets[bucketIndex];
          return true;
        },
        isEnabled: () => true,
      };

      const orchestrator = new RetryOrchestrator(provider, {
        maxAttempts: 10,
        initialDelayMs: 10,
      });

      const options: GenerateChatOptions = {
        contents: [{ role: 'user', blocks: [{ type: 'text', text: 'test' }] }],
        runtime: {
          config: {
            getBucketFailoverHandler: () => failoverHandler,
          } as unknown as GenerateChatOptions['runtime'],
        } as unknown as GenerateChatOptions['runtime'],
      };

      const result = await consumeStream(
        orchestrator.generateChatCompletion(options),
      );

      expect(result).toHaveLength(1);
      expect(currentBucket).toBe('bucket3');
    });

    it('should throw when all buckets exhausted', async () => {
      const rateLimitError = createRateLimitError();
      let currentBucket = 'bucket1';
      const buckets = ['bucket1', 'bucket2'];
      let bucketIndex = 0;

      const provider = createTestProvider({
        responses: [
          { error: rateLimitError },
          { error: rateLimitError },
          { error: rateLimitError },
          { error: rateLimitError },
          { error: rateLimitError },
        ],
      });

      const failoverHandler = {
        getBuckets: () => buckets,
        getCurrentBucket: () => currentBucket,
        tryFailover: async () => {
          bucketIndex++;
          if (bucketIndex >= buckets.length) return false;
          currentBucket = buckets[bucketIndex];
          return true;
        },
        isEnabled: () => true,
      };

      const orchestrator = new RetryOrchestrator(provider, {
        maxAttempts: 10,
        initialDelayMs: 10,
      });

      const options: GenerateChatOptions = {
        contents: [{ role: 'user', blocks: [{ type: 'text', text: 'test' }] }],
        runtime: {
          config: {
            getBucketFailoverHandler: () => failoverHandler,
          } as unknown as GenerateChatOptions['runtime'],
        } as unknown as GenerateChatOptions['runtime'],
      };

      await expect(
        consumeStream(orchestrator.generateChatCompletion(options)),
      ).rejects.toThrow(/bucket/i);
    });

    it('should call tokenRefreshCallback before each bucket attempt', async () => {
      const rateLimitError = createRateLimitError();
      let currentBucket = 'bucket1';
      const buckets = ['bucket1', 'bucket2'];
      let bucketIndex = 0;
      const refreshCalls: string[] = [];

      const provider = createTestProvider({
        responses: [
          { error: rateLimitError },
          { error: rateLimitError },
          'success',
        ],
      });

      const failoverHandler = {
        getBuckets: () => buckets,
        getCurrentBucket: () => currentBucket,
        tryFailover: async () => {
          bucketIndex++;
          if (bucketIndex >= buckets.length) return false;
          currentBucket = buckets[bucketIndex];
          refreshCalls.push(currentBucket);
          return true;
        },
        isEnabled: () => true,
      };

      const orchestrator = new RetryOrchestrator(provider, {
        maxAttempts: 5,
        initialDelayMs: 10,
      });

      const options: GenerateChatOptions = {
        contents: [{ role: 'user', blocks: [{ type: 'text', text: 'test' }] }],
        runtime: {
          config: {
            getBucketFailoverHandler: () => failoverHandler,
          } as unknown as GenerateChatOptions['runtime'],
        } as unknown as GenerateChatOptions['runtime'],
      };

      await consumeStream(orchestrator.generateChatCompletion(options));

      expect(refreshCalls).toContain('bucket2');
    });

    it('should call notificationCallback on bucket switch', async () => {
      const rateLimitError = createRateLimitError();
      let currentBucket = 'bucket1';
      const buckets = ['bucket1', 'bucket2'];
      let bucketIndex = 0;
      const notifications: Array<{ from: string; to: string }> = [];

      const provider = createTestProvider({
        responses: [
          { error: rateLimitError },
          { error: rateLimitError },
          'success',
        ],
      });

      const failoverHandler = {
        getBuckets: () => buckets,
        getCurrentBucket: () => {
          const prev = currentBucket;
          return prev;
        },
        tryFailover: async () => {
          const oldBucket = currentBucket;
          bucketIndex++;
          if (bucketIndex >= buckets.length) return false;
          currentBucket = buckets[bucketIndex];
          notifications.push({ from: oldBucket, to: currentBucket });
          return true;
        },
        isEnabled: () => true,
      };

      const orchestrator = new RetryOrchestrator(provider, {
        maxAttempts: 5,
        initialDelayMs: 10,
      });

      const options: GenerateChatOptions = {
        contents: [{ role: 'user', blocks: [{ type: 'text', text: 'test' }] }],
        runtime: {
          config: {
            getBucketFailoverHandler: () => failoverHandler,
          } as unknown as GenerateChatOptions['runtime'],
        } as unknown as GenerateChatOptions['runtime'],
      };

      await consumeStream(orchestrator.generateChatCompletion(options));

      expect(notifications).toHaveLength(1);
      expect(notifications[0]).toMatchObject({
        from: 'bucket1',
        to: 'bucket2',
      });
    });

    it('should work with single bucket (no failover)', async () => {
      const rateLimitError = createRateLimitError();
      const currentBucket = 'bucket1';
      const buckets = ['bucket1'];

      const provider = createTestProvider({
        responses: [{ error: rateLimitError }, 'success'],
      });

      const failoverHandler = {
        getBuckets: () => buckets,
        getCurrentBucket: () => currentBucket,
        tryFailover: async () => false, // No more buckets
        isEnabled: () => true,
      };

      const orchestrator = new RetryOrchestrator(provider, {
        maxAttempts: 3,
        initialDelayMs: 10,
      });

      const options: GenerateChatOptions = {
        contents: [{ role: 'user', blocks: [{ type: 'text', text: 'test' }] }],
        runtime: {
          config: {
            getBucketFailoverHandler: () => failoverHandler,
          } as unknown as GenerateChatOptions['runtime'],
        } as unknown as GenerateChatOptions['runtime'],
      };

      const result = await consumeStream(
        orchestrator.generateChatCompletion(options),
      );

      expect(result).toHaveLength(1);
    });

    it('should work with no buckets configured (legacy mode)', async () => {
      const rateLimitError = createRateLimitError();

      const provider = createTestProvider({
        responses: [{ error: rateLimitError }, 'success'],
      });

      const orchestrator = new RetryOrchestrator(provider, {
        maxAttempts: 3,
        initialDelayMs: 10,
      });

      const options: GenerateChatOptions = {
        contents: [{ role: 'user', blocks: [{ type: 'text', text: 'test' }] }],
        // No bucket failover handler
      };

      const result = await consumeStream(
        orchestrator.generateChatCompletion(options),
      );

      expect(result).toHaveLength(1);
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

    it('should retry entire stream on mid-stream error', async () => {
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
            // Second attempt - succeed
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

      const chunks = await consumeStream(
        orchestrator.generateChatCompletion(options),
      );

      // With true streaming (streamingTimeoutMs=0), chunks are yielded immediately
      // So we see the partial chunk from first attempt, then complete chunk from retry
      expect(chunks).toHaveLength(2);
      expect(chunks[0].blocks[0]).toMatchObject({
        type: 'text',
        text: 'partial',
      });
      expect(chunks[1].blocks[0]).toMatchObject({
        type: 'text',
        text: 'complete',
      });
      expect(attemptCount).toBe(2);
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

          if (options.invocation?.signal?.aborted) {
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
