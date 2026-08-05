/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * @fix issue2917
 * Composed end-to-end regression test for the two-layer retry stack.
 *
 * In production, `StreamProcessor._executeStreamApiCall`
 * (packages/agents/src/core/StreamProcessor.ts:253) wraps a provider's
 * `RetryOrchestrator` call in core `retryWithBackoff`. The isolated
 * per-layer tests cannot detect the nested duplication that issue #2917
 * exposed (each layer independently granting an "auth refresh retry" for a
 * 403, compounding transport attempts). This test composes the real layers
 * exactly as StreamProcessor does and counts raw transport invocations
 * across both layers, so a regression that reintroduces the duplication
 * fails here.
 *
 * Rather than scaffold a full StreamProcessor, this mirrors the composition
 * directly: core `retryWithBackoff` around a real `RetryOrchestrator`, using
 * the SAME options StreamProcessor passes (notably `onPersistent429`, which
 * returns null when no failover bucket is configured, and the
 * `shouldRetryOnError` predicate that combines `EmptyStreamError`,
 * `isTerminalRetryError`, and core `isRetryableError`). If that call site
 * changes, update this mirror accordingly.
 */

import { describe, it, expect } from 'bun:test';
import {
  retryWithBackoff,
  isRetryableError,
} from '@vybestack/llxprt-code-core/utils/retry.js';
import { EmptyStreamError } from '@vybestack/llxprt-code-core/core/chatSessionTypes.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { RetryOrchestrator } from '../RetryOrchestrator.js';
import { isTerminalRetryError } from '../retryErrorClassification.js';
import type { IProvider, GenerateChatOptions } from '../IProvider.js';
import type { IModel } from '../IModel.js';

/**
 * Fake provider that throws a fixed status error on every transport call and
 * counts each call, so the test can measure raw transport invocations across
 * both retry layers without mocking the units under test.
 */
function createAlwaysFailingProvider(config: {
  error: Error & { status?: number };
  onTransportCall?: () => void;
}): IProvider {
  return {
    name: 'test-provider',
    async *generateChatCompletion(_options: GenerateChatOptions) {
      config.onTransportCall?.();
      throw config.error;
      // Unreachable: satisfies require-yield and pins the generator's yield type.
      yield {
        speaker: 'ai',
        blocks: [{ type: 'text', text: '' }],
      } satisfies IContent;
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

/** A status-bearing error matching Crusoe's forbidden-response body. */
function createStatusError(
  status: number,
  message: string,
): Error & { status: number } {
  const error = new Error(message) as Error & { status: number };
  error.status = status;
  return error;
}

/**
 * Drive a RetryOrchestrator turn exactly like StreamProcessor does: eagerly
 * pull the first chunk WITHIN the retry boundary (mirroring
 * `StreamProcessor._consumeFirstChunkAndReturn`) so a throw-before-output
 * surfaces as a rejection of `fn()` rather than during later streaming. A
 * fresh orchestrator stream is created per call so each outer retry gets a
 * clean inner retry state, matching production where the orchestrator is
 * invoked once per outer attempt.
 */
function runProviderTurn(
  orchestrator: RetryOrchestrator,
  options: GenerateChatOptions,
): () => Promise<IContent[]> {
  return async (): Promise<IContent[]> => {
    const stream = orchestrator.generateChatCompletion(options);
    const first = await stream.next();
    if (first.done === true) return [];
    const chunks: IContent[] = [first.value];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    return chunks;
  };
}

describe('issue #2917 — composed two-layer retry (core retryWithBackoff around RetryOrchestrator)', () => {
  it('a persistent 403 with no recovery handlers costs a bounded number of transport calls and surfaces the provider error', async () => {
    let transportCalls = 0;
    const provider = createAlwaysFailingProvider({
      error: createStatusError(
        403,
        "Request blocked: parameter 'reasoning' is not allowed",
      ),
      onTransportCall: () => {
        transportCalls++;
      },
    });
    const orchestrator = new RetryOrchestrator(provider, {
      maxAttempts: 6,
      initialDelayMs: 1,
      maxDelayMs: 5,
    });
    const options: GenerateChatOptions = { contents: [] };

    const promise = retryWithBackoff(runProviderTurn(orchestrator, options), {
      maxAttempts: 5,
      initialDelayMs: 1,
      maxDelayMs: 5,
      // Mirrors StreamProcessor: _handleBucketFailover returns null when no
      // failover handler is configured.
      onPersistent429: async () => null,
      shouldRetryOnError: (error) =>
        error instanceof EmptyStreamError ||
        (!isTerminalRetryError(error) && isRetryableError(error)),
    });

    let thrown: unknown;
    try {
      await promise;
    } catch (error) {
      thrown = error;
    }

    // With issue #2917 fixed, the inner RetryOrchestrator makes exactly one
    // transport attempt (no refresh can occur without a recovery handler).
    // The outer core layer preserves its single onPersistent429-driven refresh
    // retry before failover-returns-null -> throw (issue #1123). Total = 2.
    // Before the fix this was 4 (each layer granted its own refresh retry).
    expect(transportCalls).toBe(2);

    expect(thrown).toBeDefined();
    expect((thrown as Error & { status: number }).status).toBe(403);
    const message = thrown instanceof Error ? thrown.message : String(thrown);
    expect(message).toContain(
      "Request blocked: parameter 'reasoning' is not allowed",
    );
  });

  it('a persistent 422 through the same composition costs exactly one transport call (issue acceptance: "the same way a 422 does")', async () => {
    let transportCalls = 0;
    const provider = createAlwaysFailingProvider({
      error: createStatusError(422, 'Unprocessable entity'),
      onTransportCall: () => {
        transportCalls++;
      },
    });
    const orchestrator = new RetryOrchestrator(provider, {
      maxAttempts: 6,
      initialDelayMs: 1,
      maxDelayMs: 5,
    });
    const options: GenerateChatOptions = { contents: [] };

    const promise = retryWithBackoff(runProviderTurn(orchestrator, options), {
      maxAttempts: 5,
      initialDelayMs: 1,
      maxDelayMs: 5,
      onPersistent429: async () => null,
      shouldRetryOnError: (error) =>
        error instanceof EmptyStreamError ||
        (!isTerminalRetryError(error) && isRetryableError(error)),
    });

    await expect(promise).rejects.toThrow('Unprocessable entity');

    // 422 is not retryable at either layer and has no recovery path, so it
    // surfaces after a single transport invocation — the baseline the issue
    // requires a 403 to match.
    expect(transportCalls).toBe(1);
  });
});
