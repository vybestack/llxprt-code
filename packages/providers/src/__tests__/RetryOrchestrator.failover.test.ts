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

/**
 * Helper to create a 400 bad request error
 */

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
 * Helper to create an Anthropic SDK-wrapped api_error (Internal Server Error).
 *
 * Mirrors how the Anthropic SDK throws stream error events: it constructs an
 * APIError with `status: undefined` and stores the entire response body on the
 * `error` property. The retryable type therefore lives at
 * `error.error.error.type`, with the intermediate `error.error.type` being the
 * generic envelope value "error". Carries no HTTP status, so retryability must
 * be derived from the body-level type (issue #2053).
 */

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

    it('should find failover handler from options.config when runtime.config is missing', async () => {
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
        config: {
          getBucketFailoverHandler: () => failoverHandler,
        } as unknown as GenerateChatOptions['config'],
        // No runtime.config set
      };

      const result = await consumeStream(
        orchestrator.generateChatCompletion(options),
      );

      expect(result).toHaveLength(1);
      expect(currentBucket).toBe('bucket2');
    });

    it('should failover on persistent network/connection errors', async () => {
      const networkError = createNetworkError('ECONNRESET');
      let currentBucket = 'bucket1';
      const buckets = ['bucket1', 'bucket2'];
      let bucketIndex = 0;

      const provider = createTestProvider({
        responses: [
          { error: networkError },
          { error: networkError }, // Trigger failover after 2 consecutive network errors
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

    it('should NOT failover on single network error (retries first)', async () => {
      const networkError = createNetworkError('ECONNRESET');
      let failoverAttempted = false;

      const provider = createTestProvider({
        responses: [
          { error: networkError }, // Single network error, then succeed
          'success',
        ],
      });

      const failoverHandler = {
        getBuckets: () => ['bucket1', 'bucket2'],
        getCurrentBucket: () => 'bucket1',
        tryFailover: async () => {
          failoverAttempted = true;
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
      expect(failoverAttempted).toBe(false); // Should NOT have attempted failover
    });

    it('should pass FailoverContext with undefined triggeringStatus for network errors', async () => {
      const networkError = createNetworkError('ECONNRESET');
      let capturedContext: { triggeringStatus?: number } | undefined;

      const provider = createTestProvider({
        responses: [
          { error: networkError },
          { error: networkError },
          'success',
        ],
      });

      const failoverHandler = {
        getBuckets: () => ['bucket1', 'bucket2'],
        getCurrentBucket: () => 'bucket1',
        tryFailover: async (context?: { triggeringStatus?: number }) => {
          capturedContext = context;
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

      expect(capturedContext).toBeDefined();
      expect(capturedContext?.triggeringStatus).toBeUndefined();
    });

    it('should throw AllBucketsExhaustedError when all buckets exhausted due to network errors', async () => {
      const networkError = createNetworkError('ECONNRESET');
      let bucketIndex = 0;
      const buckets = ['bucket1', 'bucket2'];

      const provider = createTestProvider({
        responses: [
          { error: networkError },
          { error: networkError }, // Failover to bucket2
          { error: networkError },
          { error: networkError }, // All buckets exhausted
        ],
      });

      const failoverHandler = {
        getBuckets: () => buckets,
        getCurrentBucket: () =>
          buckets[Math.min(bucketIndex, buckets.length - 1)],
        tryFailover: async () => {
          bucketIndex++;
          return bucketIndex < buckets.length;
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

    it('should reset network error counter when a different error type occurs', async () => {
      const networkError = createNetworkError('ECONNRESET');
      const rateLimitError = createRateLimitError();
      let failoverAttempted = false;

      // Network error, then 429 (resets network counter), then network error (counter starts fresh)
      const provider = createTestProvider({
        responses: [
          { error: networkError },
          { error: rateLimitError }, // Resets consecutiveNetworkErrors
          { error: networkError }, // Only 1 consecutive network error, no failover
          'success',
        ],
      });

      const failoverHandler = {
        getBuckets: () => ['bucket1', 'bucket2'],
        getCurrentBucket: () => 'bucket1',
        tryFailover: async () => {
          failoverAttempted = true;
          return true;
        },
        isEnabled: () => true,
      };

      const orchestrator = new RetryOrchestrator(provider, {
        maxAttempts: 6,
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
      // The 429 between network errors resets the counter, so no failover triggered
      expect(failoverAttempted).toBe(false);
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

    it('should call resetSession on successful request completion', async () => {
      let resetSessionCallCount = 0;

      const provider = createTestProvider({
        responses: ['success', 'success'],
      });

      const failoverHandler = {
        getBuckets: () => ['bucket1', 'bucket2'],
        getCurrentBucket: () => 'bucket1',
        tryFailover: async () => false,
        isEnabled: () => true,
        resetSession: () => {
          resetSessionCallCount++;
        },
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

      // Each successful request should call resetSession once
      await consumeStream(orchestrator.generateChatCompletion(options));
      await consumeStream(orchestrator.generateChatCompletion(options));

      expect(resetSessionCallCount).toBe(2);
    });

    it('should NOT call resetSession when request fails after exhausting retries', async () => {
      let resetSessionCallCount = 0;
      const rateLimitError = createRateLimitError();

      const provider = createTestProvider({
        responses: [
          { error: rateLimitError },
          { error: rateLimitError },
          { error: rateLimitError },
        ],
      });

      const failoverHandler = {
        getBuckets: () => ['bucket1', 'bucket2'],
        getCurrentBucket: () => 'bucket1',
        tryFailover: async () => false, // No more buckets
        isEnabled: () => true,
        resetSession: () => {
          resetSessionCallCount++;
        },
      };

      const orchestrator = new RetryOrchestrator(provider, {
        maxAttempts: 3,
        initialDelayMs: 1,
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
      ).rejects.toThrow(/Rate limit exceeded/);

      // resetSession should NOT be called since request never succeeded
      expect(resetSessionCallCount).toBe(0);
    });
  });
});
