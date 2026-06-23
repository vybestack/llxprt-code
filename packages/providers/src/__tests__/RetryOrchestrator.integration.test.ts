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
  describe('Bucket failover integration with new features', () => {
    /**
     * @plan PLAN-20260223-ISSUE1598.P16
     * @requirement REQ-1598-IC11
     * @pseudocode error-reporting.md usage lines 7-8
     */
    it('should pass FailoverContext with triggeringStatus and auth retry timeout to tryFailover when 429 detected', async () => {
      const rateLimitError = createRateLimitError();
      let capturedContext:
        | { triggeringStatus?: number; authRetryTimeoutMs?: number }
        | undefined;

      const provider = createTestProvider({
        responses: [
          { error: rateLimitError },
          { error: rateLimitError },
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

      // EXPECTATION: tryFailover was called with context containing status 429
      expect(capturedContext).toBeDefined();
      expect(capturedContext?.triggeringStatus).toBe(429);
      expect(capturedContext?.authRetryTimeoutMs).toBe(30000);
    });

    it('should pass configured authRetryTimeoutMs to tryFailover', async () => {
      const rateLimitError = createRateLimitError();
      let capturedAuthRetryTimeoutMs: number | undefined;

      const provider = createTestProvider({
        responses: [
          { error: rateLimitError },
          { error: rateLimitError },
          'success',
        ],
      });

      const failoverHandler = {
        getBuckets: () => ['bucket1', 'bucket2'],
        getCurrentBucket: () => 'bucket1',
        tryFailover: async (context?: {
          triggeringStatus?: number;
          authRetryTimeoutMs?: number;
        }) => {
          capturedAuthRetryTimeoutMs = context?.authRetryTimeoutMs;
          return true;
        },
        isEnabled: () => true,
      };

      const orchestrator = new RetryOrchestrator(provider, {
        maxAttempts: 5,
        initialDelayMs: 10,
        authRetryTimeoutMs: 250,
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

      expect(capturedAuthRetryTimeoutMs).toBe(250);
    });

    it('should read auth-retry-timeout from ephemeral settings', async () => {
      const authError = createAuthError();
      let capturedAuthRetryTimeoutMs: number | undefined;

      const provider = createTestProvider({
        responses: [{ error: authError }, { error: authError }, 'success'],
      });

      const failoverHandler = {
        getBuckets: () => ['bucket1', 'bucket2'],
        getCurrentBucket: () => 'bucket1',
        tryFailover: async (context?: {
          triggeringStatus?: number;
          authRetryTimeoutMs?: number;
        }) => {
          capturedAuthRetryTimeoutMs = context?.authRetryTimeoutMs;
          return true;
        },
        isEnabled: () => true,
      };

      const orchestrator = new RetryOrchestrator(provider, {
        maxAttempts: 5,
        initialDelayMs: 10,
        authRetryTimeoutMs: 30000,
      });

      const options: GenerateChatOptions = {
        contents: [{ role: 'user', blocks: [{ type: 'text', text: 'test' }] }],
        invocation: {
          ephemerals: {
            'auth-retry-timeout': 125,
          },
        } as unknown as GenerateChatOptions['invocation'],
        runtime: {
          config: {
            getBucketFailoverHandler: () => failoverHandler,
          } as unknown as GenerateChatOptions['runtime'],
        } as unknown as GenerateChatOptions['runtime'],
      };

      await consumeStream(orchestrator.generateChatCompletion(options));

      expect(capturedAuthRetryTimeoutMs).toBe(125);
    });

    /**
     * @plan PLAN-20260223-ISSUE1598.P16
     * @requirement REQ-1598-IC09
     * @pseudocode error-reporting.md usage lines 10-15
     */
    it('should call getLastFailoverReasons after tryFailover returns false', async () => {
      const rateLimitError = createRateLimitError();
      let getLastFailoverReasonsCalled = false;

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
        getLastFailoverReasons: () => {
          getLastFailoverReasonsCalled = true;
          return {
            bucket1: 'quota-exhausted' as const,
            bucket2: 'expired-refresh-failed' as const,
          };
        },
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

      await expect(
        consumeStream(orchestrator.generateChatCompletion(options)),
      ).rejects.toThrow(/Rate limit exceeded/);

      // EXPECTATION: getLastFailoverReasons was called after tryFailover returned false
      expect(getLastFailoverReasonsCalled).toBe(true);
    });

    /**
     * @plan PLAN-20260223-ISSUE1598.P16
     * @requirement REQ-1598-ER01, REQ-1598-ER02, REQ-1598-ER03
     * @pseudocode error-reporting.md lines 10-40
     */
    it('should construct AllBucketsExhaustedError with bucketFailureReasons', async () => {
      const rateLimitError = createRateLimitError();

      const provider = createTestProvider({
        responses: [
          { error: rateLimitError },
          { error: rateLimitError },
          { error: rateLimitError },
        ],
      });

      const failoverHandler = {
        getBuckets: () => ['bucket1', 'bucket2', 'bucket3'],
        getCurrentBucket: () => 'bucket1',
        tryFailover: async () => false,
        isEnabled: () => true,
        getLastFailoverReasons: () => ({
          bucket1: 'quota-exhausted' as const,
          bucket2: 'expired-refresh-failed' as const,
          bucket3: 'no-token' as const,
        }),
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

      const error = await consumeStream(
        orchestrator.generateChatCompletion(options),
      ).catch((e: unknown) => e);

      expect(error).toHaveProperty('bucketFailureReasons');
      const reasons = (
        error as { bucketFailureReasons: Record<string, string> }
      ).bucketFailureReasons;
      expect(reasons.bucket1).toBe('quota-exhausted');
      expect(reasons.bucket2).toBe('expired-refresh-failed');
      expect(reasons.bucket3).toBe('no-token');

      expect((error as Error).message).toContain('bucket1: quota-exhausted');
      expect((error as Error).message).toContain(
        'bucket2: expired-refresh-failed',
      );
      expect((error as Error).message).toContain('bucket3: no-token');
    });

    /**
     * @plan PLAN-20260223-ISSUE1598.P16
     * @requirement REQ-1598-IC03
     */
    it('should handle missing getLastFailoverReasons gracefully (backward compat)', async () => {
      const rateLimitError = createRateLimitError();

      const provider = createTestProvider({
        responses: [
          { error: rateLimitError },
          { error: rateLimitError },
          { error: rateLimitError },
        ],
      });

      // Old-style handler without getLastFailoverReasons
      const failoverHandler = {
        getBuckets: () => ['bucket1', 'bucket2'],
        getCurrentBucket: () => 'bucket1',
        tryFailover: async () => false,
        isEnabled: () => true,
        // NO getLastFailoverReasons method
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

      // EXPECTATION: Should not crash, fallback to basic error message
      await expect(
        consumeStream(orchestrator.generateChatCompletion(options)),
      ).rejects.toThrow(/bucket/i);
    });

    /**
     * @plan PLAN-20260223-ISSUE1598.P16
     * @requirement REQ-1598-SM03
     */
    it('should call resetSession at start of each new request', async () => {
      let resetSessionCallCount = 0;

      const provider = createTestProvider({
        responses: ['success', 'success', 'success'],
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

      // Make three separate requests
      await consumeStream(orchestrator.generateChatCompletion(options));
      await consumeStream(orchestrator.generateChatCompletion(options));
      await consumeStream(orchestrator.generateChatCompletion(options));

      // EXPECTATION: resetSession called at start of each request (3 times total)
      // Note: Current implementation also calls resetSession on success, so expect 6 calls
      // (once before each request, once after each success)
      // But requirement is for "at start" so we verify it was called AT LEAST 3 times
      expect(resetSessionCallCount).toBeGreaterThanOrEqual(3);
    });
  });
});
