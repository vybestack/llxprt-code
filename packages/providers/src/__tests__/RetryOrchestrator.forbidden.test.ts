/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * @fix issue2917
 * Behavioral tests for RetryOrchestrator handling of a persistent provider 403.
 *
 * A 403 ("forbidden") is a terminal configuration/authorization problem, not a
 * throttle. Retrying it blindly only delays the surfaced error. These tests
 * drive a real RetryOrchestrator with a fake provider that throws real
 * status-bearing errors, and assert the observable transport-attempt count and
 * the surfaced error shape.
 */

import { describe, it, expect, vi } from 'bun:test';
import { RetryOrchestrator } from '../RetryOrchestrator.js';
import type { IProvider, GenerateChatOptions } from '../IProvider.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { IModel } from '../IModel.js';
import type { OnAuthErrorHandler } from '@vybestack/llxprt-code-core/config/configTypes.js';

/**
 * Fake provider that replays a fixed list of responses. Mirrors the helper used
 * by the sibling RetryOrchestrator suites so the IProvider contract is honoured
 * exactly. `onTransportCall` fires on every transport invocation, letting tests
 * count real transport attempts without mocking the orchestrator under test.
 */
function createTestProvider(config: {
  name?: string;
  responses?: Array<'success' | 'error' | { error: Error }>;
  onTransportCall?: () => void;
}): IProvider {
  let callCount = 0;

  const successContent: IContent = {
    speaker: 'ai',
    blocks: [{ type: 'text', text: 'test response' }],
  };

  return {
    name: config.name ?? 'test-provider',
    async *generateChatCompletion(_options: GenerateChatOptions) {
      config.onTransportCall?.();
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

      yield successContent;
    },
    async getModels(): Promise<IModel[]> {
      return [];
    },
    getDefaultModel(): string {
      return 'test-model';
    },
  };
}

/** A status-bearing error matching Crusoe's forbidden-response body (issue #2917). */
function createForbiddenError(): Error {
  const error = new Error(
    "Request blocked: parameter 'reasoning' is not allowed",
  ) as Error & { status?: number };
  error.status = 403;
  return error;
}

/** Generic status-bearing error for table-driven assertions. */
function createStatusError(status: number, message?: string): Error {
  const error = new Error(message ?? `HTTP ${status}`) as Error & {
    status?: number;
  };
  error.status = status;
  return error;
}

/** Consume an async iterator fully, surfacing any thrown error as a rejection. */
async function consumeStream(
  stream: AsyncIterableIterator<IContent>,
): Promise<IContent[]> {
  const chunks: IContent[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return chunks;
}

describe('RetryOrchestrator forbidden (403) handling — issue #2917', () => {
  it('surfaces a persistent 403 after exactly one attempt when no recovery handler is configured (AC1)', async () => {
    let transportCalls = 0;
    const provider = createTestProvider({
      responses: [{ error: createForbiddenError() }],
      onTransportCall: () => {
        transportCalls++;
      },
    });
    const orchestrator = new RetryOrchestrator(provider, {
      maxAttempts: 6,
      initialDelayMs: 1,
    });

    await expect(
      consumeStream(
        orchestrator.generateChatCompletion({
          contents: [],
        }),
      ),
    ).rejects.toThrow("Request blocked: parameter 'reasoning' is not allowed");

    // No auth-error handler and no bucket-failover handler are configured, so
    // no refresh can possibly occur: the orchestrator must make exactly one
    // transport attempt and rethrow immediately — identical to 422/400/404.
    expect(transportCalls).toBe(1);
  });

  it('still grants a single auth-refresh retry when an onAuthError handler is configured (AC3)', async () => {
    let transportCalls = 0;
    const handleAuthError = vi.fn().mockResolvedValue(undefined);
    const onAuthErrorHandler: OnAuthErrorHandler = { handleAuthError };

    const provider = createTestProvider({
      responses: [{ error: createForbiddenError() }, 'success'],
      onTransportCall: () => {
        transportCalls++;
      },
    });
    const orchestrator = new RetryOrchestrator(provider, {
      maxAttempts: 6,
      initialDelayMs: 1,
    });

    const result = await consumeStream(
      orchestrator.generateChatCompletion({
        contents: [],
        resolved: { authToken: 'revoked-403-token' },
        runtime: {
          config: {
            getOnAuthErrorHandler: () => onAuthErrorHandler,
          },
        },
      } as GenerateChatOptions),
    );

    // With a real recovery mechanism, the orchestrator retries exactly once
    // (initial attempt + one auth-refresh retry) and invokes the handler once.
    expect(transportCalls).toBe(2);
    expect(handleAuthError).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(1);
  });

  it('still refreshes then fails over when a bucketFailoverHandler is configured (AC4)', async () => {
    const attemptBuckets: string[] = [];
    let failoverCalls = 0;
    const buckets = ['bucket1', 'bucket2'];
    let bucketIndex = 0;
    let currentBucket = buckets[bucketIndex];

    const provider = createTestProvider({
      responses: [
        { error: createForbiddenError() },
        { error: createForbiddenError() },
        'success',
      ],
      onTransportCall: () => {
        attemptBuckets.push(currentBucket);
      },
    });
    const orchestrator = new RetryOrchestrator(provider, {
      maxAttempts: 6,
      initialDelayMs: 1,
    });

    const result = await consumeStream(
      orchestrator.generateChatCompletion({
        contents: [],
        runtime: {
          config: {
            getBucketFailoverHandler: () => ({
              getBuckets: () => buckets,
              getCurrentBucket: () => currentBucket,
              tryFailover: async () => {
                failoverCalls++;
                bucketIndex++;
                if (bucketIndex >= buckets.length) return false;
                currentBucket = buckets[bucketIndex];
                return true;
              },
              isEnabled: () => true,
            }),
          },
        },
      } as GenerateChatOptions),
    );

    // First 403 triggers the refresh-retry allowance on the ORIGINAL bucket,
    // and only the second 403 triggers bucket failover. Asserting the bucket
    // per attempt pins that ordering: a failover after the first 403 would
    // still produce three calls and still end on bucket2.
    expect(attemptBuckets).toStrictEqual(['bucket1', 'bucket1', 'bucket2']);
    expect(failoverCalls).toBe(1);
    expect(result).toHaveLength(1);
  });

  it('preserves the provider status (403) and body text in the surfaced error (AC2)', async () => {
    const provider = createTestProvider({
      responses: [{ error: createForbiddenError() }],
    });
    const orchestrator = new RetryOrchestrator(provider, {
      maxAttempts: 6,
      initialDelayMs: 1,
    });

    let thrown: unknown;
    try {
      await consumeStream(
        orchestrator.generateChatCompletion({ contents: [] }),
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeDefined();
    expect((thrown as { status?: number }).status).toBe(403);
    const message = thrown instanceof Error ? thrown.message : String(thrown);
    expect(message).toContain(
      "Request blocked: parameter 'reasoning' is not allowed",
    );
  });

  it.each([
    { status: 400, label: 'bad request' },
    { status: 404, label: 'not found' },
    { status: 422, label: 'unprocessable entity' },
  ])(
    'does not retry a persistent $label (status $status) (AC5)',
    async ({ status }) => {
      let transportCalls = 0;
      const provider = createTestProvider({
        responses: [{ error: createStatusError(status) }],
        onTransportCall: () => {
          transportCalls++;
        },
      });
      const orchestrator = new RetryOrchestrator(provider, {
        maxAttempts: 6,
        initialDelayMs: 1,
      });

      await expect(
        consumeStream(orchestrator.generateChatCompletion({ contents: [] })),
      ).rejects.toThrow(`HTTP ${status}`);

      expect(transportCalls).toBe(1);
    },
  );

  it.each([
    { status: 429, label: 'rate limit' },
    { status: 503, label: 'service unavailable' },
  ])(
    'still retries a persistent $label (status $status) beyond a single refresh attempt (AC5)',
    async ({ status }) => {
      let transportCalls = 0;
      const provider = createTestProvider({
        responses: [{ error: createStatusError(status) }],
        onTransportCall: () => {
          transportCalls++;
        },
      });
      const orchestrator = new RetryOrchestrator(provider, {
        maxAttempts: 6,
        initialDelayMs: 1,
      });

      await expect(
        consumeStream(orchestrator.generateChatCompletion({ contents: [] })),
      ).rejects.toThrow(`HTTP ${status}`);

      expect(transportCalls).toBe(6);
    },
  );
});
