/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * @fix issue3140
 * End-to-end behavioral tests for terminal-quota 429 handling through a REAL
 * RetryOrchestrator.
 *
 * The provider-level classifier closes the inner stream-retry loop, but the
 * orchestrator runs its own retry loop on top of it. Without a matching
 * decision in `shouldRetryError`, a terminal quota 429 is still retried
 * `maxAttempts` times — and because the Responses path is stateless, every one
 * of those attempts resends the entire conversation. These tests drive the
 * orchestrator with a fake provider that throws errors built by the real
 * `parseErrorResponse`, and assert the observable transport-attempt count.
 */

import { describe, it, expect } from 'bun:test';
import { RetryOrchestrator } from '../RetryOrchestrator.js';
import { parseErrorResponse } from '../openai/parseResponsesStream.js';
import type { IProvider, GenerateChatOptions } from '../IProvider.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { IModel } from '../IModel.js';

const SUCCESS_CONTENT: IContent = {
  speaker: 'ai',
  blocks: [{ type: 'text', text: 'test response' }],
};

/**
 * Fake provider that throws on every attempt for which `buildError` returns an
 * error, and yields a success chunk otherwise. Mirrors the helper used by the
 * sibling RetryOrchestrator suites so the IProvider contract is honoured
 * exactly. `onTransportCall` fires on every transport invocation, letting tests
 * count real transport attempts without mocking the orchestrator under test.
 */
function createThrowingProvider(
  buildError: () => Error | undefined,
  onTransportCall: () => void,
): IProvider {
  return {
    name: 'openai-responses',
    async *generateChatCompletion(
      _options: GenerateChatOptions,
    ): AsyncIterableIterator<IContent> {
      onTransportCall();
      const error = buildError();
      if (error !== undefined) throw error;
      yield SUCCESS_CONTENT;
    },
    async getModels(): Promise<IModel[]> {
      return [];
    },
    getDefaultModel(): string {
      return 'gpt-5';
    },
    getServerTools(): string[] {
      return [];
    },
    async invokeServerTool(): Promise<unknown> {
      return null;
    },
  };
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

async function countAttemptsFor(body: string, status = 429): Promise<number> {
  let transportCalls = 0;
  const provider = createThrowingProvider(
    () => parseErrorResponse(status, body, 'openai-responses'),
    () => {
      transportCalls += 1;
    },
  );
  const orchestrator = new RetryOrchestrator(provider, {
    maxAttempts: 6,
    initialDelayMs: 1,
  });

  await consumeStream(
    orchestrator.generateChatCompletion({ contents: [] }),
  ).catch(() => undefined);

  return transportCalls;
}

describe('RetryOrchestrator terminal-quota 429 handling @issue:3140', () => {
  it('makes exactly ONE transport attempt for a quota-exhaustion 429', async () => {
    const attempts = await countAttemptsFor(
      '{"error":{"code":"insufficient_quota","message":"You exceeded your current quota"}}',
    );
    expect(attempts).toBe(1);
  });

  it('surfaces the quota message unwrapped rather than a retries-exhausted error', async () => {
    const provider = createThrowingProvider(
      () =>
        parseErrorResponse(
          429,
          '{"error":{"code":"insufficient_quota","message":"You exceeded your current quota"}}',
          'openai-responses',
        ),
      () => undefined,
    );
    const orchestrator = new RetryOrchestrator(provider, {
      maxAttempts: 6,
      initialDelayMs: 1,
    });

    await expect(
      consumeStream(orchestrator.generateChatCompletion({ contents: [] })),
    ).rejects.toThrow(
      'Quota or billing limit exhausted: You exceeded your current quota',
    );
  });

  it('still retries a throttling 429 to the attempt limit', async () => {
    const attempts = await countAttemptsFor(
      '{"error":{"code":"rate_limit_exceeded","message":"Too many requests"}}',
    );
    expect(attempts).toBeGreaterThan(1);
  });

  it('still retries a bare 429 carrying no body code', async () => {
    const attempts = await countAttemptsFor(
      '{"error":{"message":"Too many requests"}}',
    );
    expect(attempts).toBeGreaterThan(1);
  });

  it('still retries a 5xx server error', async () => {
    const attempts = await countAttemptsFor(
      '{"error":{"message":"Internal error"}}',
      500,
    );
    expect(attempts).toBeGreaterThan(1);
  });

  /**
   * Regression guard for the property-collision hazard: the body-level error
   * `type` must not be written to a bare `type` key, because `isOverloadError`
   * reads that key and would make a 403 retryable, reversing issue #2917.
   */
  it('makes exactly ONE transport attempt for a 403 carrying type=api_error', async () => {
    const attempts = await countAttemptsFor(
      '{"error":{"type":"api_error","message":"Forbidden"}}',
      403,
    );
    expect(attempts).toBe(1);
  });
});
