/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { RetryOrchestrator } from '../RetryOrchestrator.js';
import type { IProvider, GenerateChatOptions } from '../IProvider.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { IModel } from '../IModel.js';

function createTestProvider(config: {
  name?: string;
  responses?: Array<'success' | 'error' | { error: Error }>;
}): IProvider {
  let callCount = 0;

  const successContent: IContent = {
    speaker: 'ai',
    blocks: [{ type: 'text', text: 'test response' }],
  };

  return {
    name: config.name ?? 'test-provider',
    async *generateChatCompletion() {
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
    getServerTools(): string[] {
      return [];
    },
    async invokeServerTool(): Promise<unknown> {
      return null;
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

function createServerError(status = 500): Error {
  const error = new Error('Internal server error') as Error & {
    status?: number;
  };
  error.status = status;
  return error;
}

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
    request_id: 'req_011CYxB3kPD86oumRyhWrd9P',
  };
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
  let failoverAttempted = false;
  return {
    handler: {
      getBuckets: () => buckets,
      getCurrentBucket: () => currentBucket,
      tryFailover: async () => {
        failoverAttempted = true;
        bucketIndex++;
        if (bucketIndex >= buckets.length) return false;
        currentBucket = buckets[bucketIndex];
        return true;
      },
      isEnabled: () => true,
    },
    get currentBucket() {
      return currentBucket;
    },
    get failoverAttempted() {
      return failoverAttempted;
    },
  };
}

function createOptions(handler: unknown): GenerateChatOptions {
  return {
    contents: [{ role: 'user', blocks: [{ type: 'text', text: 'test' }] }],
    runtime: {
      config: {
        getBucketFailoverHandler: () => handler,
      } as unknown as GenerateChatOptions['runtime'],
    } as unknown as GenerateChatOptions['runtime'],
  };
}

describe('RetryOrchestrator - 5xx server error failover (issue #1726)', () => {
  it('should failover to next bucket on persistent HTTP 5xx errors', async () => {
    const serverError = createServerError(500);
    const fo = createFailoverHandler(['bucket1', 'bucket2', 'bucket3']);

    const provider = createTestProvider({
      responses: [{ error: serverError }, { error: serverError }, 'success'],
    });

    const orchestrator = new RetryOrchestrator(provider, {
      maxAttempts: 5,
      initialDelayMs: 10,
    });

    const result = await consumeStream(
      orchestrator.generateChatCompletion(createOptions(fo.handler)),
    );

    expect(result).toHaveLength(1);
    expect(fo.currentBucket).toBe('bucket2');
  });

  it('should failover on Anthropic api_error body type via overload path', async () => {
    const apiError = createAnthropicApiError();
    const fo = createFailoverHandler(['bucket1', 'bucket2']);

    const provider = createTestProvider({
      responses: [{ error: apiError }, { error: apiError }, 'success'],
    });

    const orchestrator = new RetryOrchestrator(provider, {
      maxAttempts: 5,
      initialDelayMs: 10,
    });

    const result = await consumeStream(
      orchestrator.generateChatCompletion(createOptions(fo.handler)),
    );

    expect(result).toHaveLength(1);
    expect(fo.currentBucket).toBe('bucket2');
  });

  it('should NOT failover on single 5xx error (retries first)', async () => {
    const serverError = createServerError(500);
    const fo = createFailoverHandler(['bucket1', 'bucket2']);

    const provider = createTestProvider({
      responses: [{ error: serverError }, 'success'],
    });

    const orchestrator = new RetryOrchestrator(provider, {
      maxAttempts: 5,
      initialDelayMs: 10,
    });

    const result = await consumeStream(
      orchestrator.generateChatCompletion(createOptions(fo.handler)),
    );

    expect(result).toHaveLength(1);
    expect(fo.failoverAttempted).toBe(false);
  });

  it('should throw AllBucketsExhaustedError when all buckets exhausted due to 5xx', async () => {
    const serverError = createServerError(500);
    const buckets = ['bucket1', 'bucket2'];
    let bucketIndex = 0;

    const provider = createTestProvider({
      responses: [
        { error: serverError },
        { error: serverError },
        { error: serverError },
        { error: serverError },
      ],
    });

    const handler = {
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

    await expect(
      consumeStream(
        orchestrator.generateChatCompletion(createOptions(handler)),
      ),
    ).rejects.toThrow(/bucket/i);
  });

  it('should reset server error counter when a different error type occurs', async () => {
    const serverError = createServerError(500);
    const rateLimitError = createRateLimitError();
    const fo = createFailoverHandler(['bucket1', 'bucket2']);

    const provider = createTestProvider({
      responses: [
        { error: serverError },
        { error: rateLimitError },
        { error: serverError },
        'success',
      ],
    });

    const orchestrator = new RetryOrchestrator(provider, {
      maxAttempts: 6,
      initialDelayMs: 10,
    });

    const result = await consumeStream(
      orchestrator.generateChatCompletion(createOptions(fo.handler)),
    );

    expect(result).toHaveLength(1);
    expect(fo.failoverAttempted).toBe(false);
  });
});
