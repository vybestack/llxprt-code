/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { GenerateChatOptions, IProvider } from '../IProvider.js';
import { RetryOrchestrator } from '../RetryOrchestrator.js';
import { attachTransportAttemptBudget } from '../transportAttemptBudget.js';

function rateLimitError(): Error {
  return Object.assign(new Error('Rate limit exceeded'), { status: 429 });
}

function failingProvider(onCall: () => void): IProvider {
  return {
    name: 'test-provider',
    async *generateChatCompletion(): AsyncGenerator<IContent> {
      onCall();
      yield* [];
      throw rateLimitError();
    },
    async getModels() {
      return [];
    },
    getDefaultModel() {
      return 'test-model';
    },
    getServerTools() {
      return [];
    },
    async invokeServerTool() {
      return null;
    },
  };
}

async function consume(stream: AsyncIterableIterator<IContent>): Promise<void> {
  for await (const _chunk of stream) {
    // Consume the real retry stream.
  }
}

describe('RetryOrchestrator failover transport budget', () => {
  it('never exceeds the global transport budget when a bucket switch succeeds', async () => {
    let transportCalls = 0;
    let failoverCalls = 0;
    const orchestrator = new RetryOrchestrator(
      failingProvider(() => transportCalls++),
      { maxAttempts: 3, initialDelayMs: 0 },
    );
    const options: GenerateChatOptions = {
      contents: [],
      config: {
        getBucketFailoverHandler: () => ({
          getBuckets: () => ['bucket1', 'bucket2'],
          getCurrentBucket: () => 'bucket1',
          tryFailover: async () => {
            failoverCalls++;
            return true;
          },
          isEnabled: () => true,
        }),
      } as GenerateChatOptions['config'],
    };

    await expect(
      consume(orchestrator.generateChatCompletion(options)),
    ).rejects.toMatchObject({ reason: 'retries_exhausted' });
    expect({ transportCalls, failoverCalls }).toStrictEqual({
      transportCalls: 3,
      failoverCalls: 1,
    });
  });

  it('preserves the final 429 classification when a shared request budget exhausts before nested retries', async () => {
    let transportCalls = 0;
    const orchestrator = new RetryOrchestrator(
      failingProvider(() => transportCalls++),
      { maxAttempts: 4, initialDelayMs: 0 },
    );
    const request = attachTransportAttemptBudget({ contents: [] }, 2);

    try {
      const failure = await consume(
        orchestrator.generateChatCompletion(request.options),
      ).then(
        () => undefined,
        (error: unknown) => error,
      );

      expect({ failure, transportCalls, budget: request.budget }).toMatchObject(
        {
          failure: {
            category: 'rate_limit',
            status: 429,
            reason: 'retries_exhausted',
            isRetryable: false,
          },
          transportCalls: 2,
          budget: { limit: 2, used: 2 },
        },
      );
    } finally {
      request.release();
    }
  });

  it('does not start a transport after aborting a never-resolving bucket failover', async () => {
    const controller = new AbortController();
    let transports = 0;
    let transportsWhenFailoverStarted = 0;
    let notifyStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      notifyStarted = resolve;
    });
    const orchestrator = new RetryOrchestrator(
      failingProvider(() => transports++),
      { maxAttempts: 3, initialDelayMs: 0 },
    );
    const consumption = consume(
      orchestrator.generateChatCompletion({
        contents: [],
        config: {
          getBucketFailoverHandler: () => ({
            getBuckets: () => ['bucket1', 'bucket2'],
            getCurrentBucket: () => 'bucket1',
            tryFailover: async () => {
              transportsWhenFailoverStarted = transports;
              notifyStarted();
              return new Promise<boolean>(() => {});
            },
            isEnabled: () => true,
          }),
        } as GenerateChatOptions['config'],
        invocation: {
          signal: controller.signal,
        } as GenerateChatOptions['invocation'],
      }),
    );

    await started;
    controller.abort();

    await expect(consumption).rejects.toThrow(/abort/i);
    expect(transports).toBe(transportsWhenFailoverStarted);
  });
});
