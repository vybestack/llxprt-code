/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Behavioral tests for RetryOrchestrator bucket-failover backoff delay.
 * When a bucketed profile fails over to the next bucket, a backoff delay
 * must be applied before the first attempt on the new bucket (issue #1564).
 */

import { describe, it, expect } from 'bun:test';
import { RetryOrchestrator } from '../RetryOrchestrator.js';
import type { IProvider, GenerateChatOptions } from '../IProvider.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { IModel } from '../IModel.js';

function createTestProvider(config: {
  responses?: Array<'success' | 'error' | { error: Error }>;
}): IProvider {
  let callCount = 0;
  const successContent: IContent = {
    speaker: 'ai',
    blocks: [{ type: 'text', text: 'test response' }],
  };
  return {
    name: 'test-provider',
    async *generateChatCompletion() {
      const idx = Math.min(callCount, (config.responses?.length ?? 1) - 1);
      callCount++;
      const response = config.responses?.[idx] ?? 'success';
      if (response === 'error') throw new Error('Generic error');
      if (typeof response === 'object' && 'error' in response)
        throw response.error;
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

function createRateLimitError(): Error {
  const error = new Error('Rate limit exceeded') as Error & {
    status?: number;
  };
  error.status = 429;
  return error;
}

async function consumeStream(
  stream: AsyncIterableIterator<IContent>,
): Promise<IContent[]> {
  const chunks: IContent[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return chunks;
}

function createFailoverHandler(buckets: string[]) {
  let bucketIndex = 0;
  let currentBucket = buckets[0];
  return {
    handler: {
      getBuckets: () => buckets,
      getCurrentBucket: () => currentBucket,
      tryFailover: async () => {
        bucketIndex++;
        if (bucketIndex >= buckets.length) return false;
        currentBucket = buckets[bucketIndex];
        return true;
      },
      isEnabled: () => true,
    },
    getCurrentBucket: () => currentBucket,
  };
}

function makeOptions(failoverHandler: unknown): GenerateChatOptions {
  return {
    contents: [{ role: 'user', blocks: [{ type: 'text', text: 'test' }] }],
    runtime: {
      config: {
        getBucketFailoverHandler: () => failoverHandler,
      } as unknown as GenerateChatOptions['runtime'],
    } as unknown as GenerateChatOptions['runtime'],
  };
}

describe('RetryOrchestrator - bucket failover backoff delay (issue #1564)', () => {
  it('applies backoff delay after successful 429 bucket failover', async () => {
    const rateLimitError = createRateLimitError();
    const throttleCalls: number[] = [];
    const { handler, getCurrentBucket } = createFailoverHandler([
      'bucket1',
      'bucket2',
      'bucket3',
    ]);

    const provider = createTestProvider({
      responses: [
        { error: rateLimitError },
        { error: rateLimitError }, // Trigger failover after 2 consecutive 429s
        'success',
      ],
    });

    const orchestrator = new RetryOrchestrator(provider, {
      maxAttempts: 5,
      initialDelayMs: 10,
      trackThrottleWaitTime: (ms: number) => throttleCalls.push(ms),
    });

    const result = await consumeStream(
      orchestrator.generateChatCompletion(makeOptions(handler)),
    );

    expect(result).toHaveLength(1);
    expect(getCurrentBucket()).toBe('bucket2');
    // Two throttle delays: one for the normal retry before failover
    // threshold, one for the backoff after the failover switch.
    expect(throttleCalls).toHaveLength(2);
    expect(throttleCalls[0]).toBeGreaterThan(0);
    expect(throttleCalls[1]).toBeGreaterThan(0);
  });

  it('applies backoff delay after Anthropic overloaded_error failover', async () => {
    // Anthropic SDK wraps stream errors so the retryable type lives at
    // error.error.error.type (the intermediate error.error.type is the
    // generic envelope value "error"). This matches the real SDK shape
    // documented in isOverloadError.
    const overloadedError = new Error('Overloaded');
    (
      overloadedError as unknown as {
        error: { type: string; error: { type: string } };
      }
    ).error = {
      type: 'error',
      error: { type: 'overloaded_error' },
    };
    const throttleCalls: number[] = [];
    const { handler, getCurrentBucket } = createFailoverHandler([
      'bucket1',
      'bucket2',
    ]);

    const provider = createTestProvider({
      responses: [
        { error: overloadedError },
        { error: overloadedError },
        'success',
      ],
    });

    const orchestrator = new RetryOrchestrator(provider, {
      maxAttempts: 5,
      initialDelayMs: 10,
      trackThrottleWaitTime: (ms: number) => throttleCalls.push(ms),
    });

    const result = await consumeStream(
      orchestrator.generateChatCompletion(makeOptions(handler)),
    );

    expect(result).toHaveLength(1);
    expect(getCurrentBucket()).toBe('bucket2');
    expect(throttleCalls).toHaveLength(2);
    expect(throttleCalls[0]).toBeGreaterThan(0);
    expect(throttleCalls[1]).toBeGreaterThan(0);
  });

  it('throws when all buckets are exhausted without backoff delay', async () => {
    const rateLimitError = createRateLimitError();
    const throttleCalls: number[] = [];
    // Single-bucket handler where tryFailover always returns false
    // (no next bucket available).
    const exhaustedHandler = {
      getBuckets: () => ['bucket1'],
      getCurrentBucket: () => 'bucket1',
      tryFailover: async () => false,
      isEnabled: () => true,
    };

    const provider = createTestProvider({
      responses: [
        { error: rateLimitError },
        { error: rateLimitError }, // Trigger failover attempt
      ],
    });

    const orchestrator = new RetryOrchestrator(provider, {
      maxAttempts: 5,
      initialDelayMs: 10,
      trackThrottleWaitTime: (ms: number) => throttleCalls.push(ms),
    });

    await expect(
      consumeStream(
        orchestrator.generateChatCompletion(makeOptions(exhaustedHandler)),
      ),
    ).rejects.toThrow(/exhaust/i);

    // Only the normal retry delay before failover threshold — no
    // backoff delay after an exhausted failover result.
    expect(throttleCalls).toHaveLength(1);
  });
});
