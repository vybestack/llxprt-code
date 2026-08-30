/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Fence test for issue #2532 AC-04 / AC-05 at the orchestrator level.
 *
 * AC-04: once a request is committed (any IContent — including a metadata-only
 * chunk — has been yielded outward), no recovery decision may replay it inside the
 * same request budget: no orchestrator retry, no bucket rotation, and the error
 * surfaces terminal. Auth-kind failures after commitment MAY invoke the auth error
 * handler at most once (prepare-future-only) but must never replay the request.
 *
 * AC-05: before any outward exposure, transient network / 429 / 5xx /
 * in-band overload / first-chunk timeout errors remain retryable inside the
 * shared transport budget.
 *
 * These tests compose a REAL RetryOrchestrator around a scripted fake provider
 * and count transport invocations plus iterator return() calls, mirroring the
 * forbidden-composed pattern. The fake provider returns each scripted stream
 * directly (no yield* re-delegation) so return() tracking observes exactly the
 * iterator the guarded stream owns, and its pending next() is abort-aware the
 * way a real SDK-backed stream is.
 */

import { describe, expect, it } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { GenerateChatOptions, IProvider } from '../IProvider.js';
import type { IModel } from '../IModel.js';
import type { OnAuthErrorHandler } from '@vybestack/llxprt-code-core/config/configTypes.js';
import { delay } from '@vybestack/llxprt-code-core/utils/delay.js';
import { RetryOrchestrator } from '../RetryOrchestrator.js';
import { getRequestSignal } from '../utils/abortSignal.js';
import { decodeRetryFailure } from '../retryFailureTaxonomy.js';
import { isTerminalRetryError } from '../retryErrorClassification.js';

const metadataChunk: IContent = {
  speaker: 'ai',
  blocks: [],
  metadata: {
    usage: {
      promptTokens: 3,
      completionTokens: 0,
      totalTokens: 3,
    },
  },
};

const textChunk: IContent = {
  speaker: 'ai',
  blocks: [{ type: 'text', text: 'hello' }],
};

/** A status-bearing error like those thrown by real transports. */
function createStatusError(
  status: number,
  message: string,
): Error & { status: number } {
  const error = new Error(message) as Error & { status: number };
  error.status = status;
  return error;
}

/**
 * Anthropic-style in-band overload: HTTP-200-shaped SSE error event whose
 * body decodes to 'overloaded_error'. The retryable type lives at
 * error.error.error.type (the intermediate error.error.type is the generic
 * envelope value "error"), matching isOverloadError.
 */
function createInBandOverloadError(): Error {
  const error = new Error('Overloaded') as Error & {
    error?: { type: string; error?: { type: string } };
  };
  error.error = {
    type: 'error',
    error: { type: 'overloaded_error' },
  };
  return error;
}

type StreamFactory = (
  signal: AbortSignal | undefined,
) => AsyncGenerator<IContent>;

interface ScriptedProviderOptions {
  readonly script: readonly StreamFactory[];
}

/**
 * A scripted provider whose generateChatCompletion RETURNS each scripted
 * stream directly. The guarded stream therefore owns exactly the iterator the
 * script created, and return() tracking is deterministic.
 */
function createScriptedProvider(options: ScriptedProviderOptions): {
  provider: IProvider;
  calls: () => number;
} {
  let callCount = 0;
  const provider: IProvider = {
    name: 'scripted-provider',
    generateChatCompletion(
      optionsOrContents: GenerateChatOptions | IContent[],
    ): AsyncIterableIterator<IContent> {
      const requestOptions = optionsOrContents as GenerateChatOptions;
      const index = callCount++;
      const factory =
        index < options.script.length
          ? options.script[index]
          : options.script[options.script.length - 1];
      return factory(getRequestSignal(requestOptions));
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
  return { provider, calls: () => callCount };
}

/**
 * Wraps a stream factory so the produced iterator counts return() calls,
 * without changing iteration semantics.
 */
function trackedStream(factory: StreamFactory): {
  factory: StreamFactory;
  returns: () => number;
} {
  let returnCount = 0;
  const wrapper: StreamFactory = async function* wrapped(signal) {
    const iterator = factory(signal)[Symbol.asyncIterator]();
    let completed = false;
    try {
      let result = await iterator.next();
      while (result.done !== true) {
        yield result.value;
        result = await iterator.next();
      }
      completed = true;
      return result.value;
    } finally {
      if (!completed) {
        returnCount += 1;
        await iterator.return(undefined);
      }
    }
  };
  return { factory: wrapper, returns: () => returnCount };
}

function onAuthErrorOptions(handler: OnAuthErrorHandler): GenerateChatOptions {
  return {
    contents: [],
    resolved: { authToken: 'revoked-token' },
    runtime: {
      config: {
        getOnAuthErrorHandler: () => handler,
      },
    },
  } as unknown as GenerateChatOptions;
}

function bucketFailoverOptions(
  tryFailover: () => Promise<boolean>,
): GenerateChatOptions {
  return {
    contents: [],
    runtime: {
      config: {
        getBucketFailoverHandler: () => ({
          getBuckets: () => ['bucket1'],
          getCurrentBucket: () => 'bucket1',
          tryFailover,
          isEnabled: () => true,
        }),
      },
    },
  } as unknown as GenerateChatOptions;
}

interface TrackedStreamResult {
  readonly chunks: IContent[];
  readonly error: unknown;
}

async function consumeStream(
  stream: AsyncIterableIterator<IContent>,
): Promise<TrackedStreamResult> {
  const chunks: IContent[] = [];
  let error: unknown;
  try {
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
  } catch (caught) {
    error = caught;
  }
  return { chunks, error };
}

describe('RetryOrchestrator commitment boundary (issue #2532 AC-04/AC-05)', () => {
  describe('AC-04: committed requests are never replayed', () => {
    it('a: timeout-enabled partial text then network error → exactly one call, original error, no backoff, no failover', async () => {
      const networkError = new Error('Connection error.');
      const failover = { calls: 0 };
      const { provider, calls } = createScriptedProvider({
        script: [
          async function* () {
            yield textChunk;
            throw networkError;
          },
          async function* () {
            yield textChunk;
          },
        ],
      });
      const orchestrator = new RetryOrchestrator(provider, {
        maxAttempts: 4,
        initialDelayMs: 1000,
        streamingTimeoutMs: 5000,
        trackThrottleWaitTime: () => {
          throw new Error('no backoff delay should be applied');
        },
      });

      const { chunks, error } = await consumeStream(
        orchestrator.generateChatCompletion(
          bucketFailoverOptions(() => {
            failover.calls++;
            return Promise.resolve(true);
          }),
        ),
      );

      expect(chunks).toStrictEqual([textChunk]);
      expect(error).toBe(networkError);
      expect(isTerminalRetryError(error)).toBe(true);
      expect(calls()).toBe(1);
      expect(failover.calls).toBe(0);
    });

    it('b: 429 after text → no replay', async () => {
      const statusError = createStatusError(429, 'Rate limited');
      const { provider, calls } = createScriptedProvider({
        script: [
          async function* () {
            yield textChunk;
            throw statusError;
          },
          async function* () {
            yield textChunk;
          },
        ],
      });
      const orchestrator = new RetryOrchestrator(provider, {
        maxAttempts: 4,
        initialDelayMs: 1,
        streamingTimeoutMs: 5000,
      });

      const { chunks, error } = await consumeStream(
        orchestrator.generateChatCompletion({ contents: [] }),
      );

      expect(chunks).toStrictEqual([textChunk]);
      expect(error).toBe(statusError);
      expect(calls()).toBe(1);
    });

    it('b: 5xx after text → no replay', async () => {
      const statusError = createStatusError(503, 'Service unavailable');
      const { provider, calls } = createScriptedProvider({
        script: [
          async function* () {
            yield textChunk;
            throw statusError;
          },
          async function* () {
            yield textChunk;
          },
        ],
      });
      const orchestrator = new RetryOrchestrator(provider, {
        maxAttempts: 4,
        initialDelayMs: 1,
        streamingTimeoutMs: 5000,
      });

      const { chunks, error } = await consumeStream(
        orchestrator.generateChatCompletion({ contents: [] }),
      );

      expect(chunks).toStrictEqual([textChunk]);
      expect(error).toBe(statusError);
      expect(calls()).toBe(1);
    });

    it('b: in-band overload-shaped error after text → no replay', async () => {
      const overload = createInBandOverloadError();
      const { provider, calls } = createScriptedProvider({
        script: [
          async function* () {
            yield textChunk;
            throw overload;
          },
          async function* () {
            yield textChunk;
          },
        ],
      });
      const orchestrator = new RetryOrchestrator(provider, {
        maxAttempts: 4,
        initialDelayMs: 1,
        streamingTimeoutMs: 5000,
      });

      const { chunks, error } = await consumeStream(
        orchestrator.generateChatCompletion({ contents: [] }),
      );

      expect(decodeRetryFailure(overload).kind).toBe('overload');
      expect(chunks).toStrictEqual([textChunk]);
      expect(error).toBe(overload);
      expect(calls()).toBe(1);
    });

    it('c: metadata-only exposure then failure → NO replay (metadata counts as exposure)', async () => {
      const networkError = new Error('Connection broken');
      const { provider, calls } = createScriptedProvider({
        script: [
          async function* () {
            yield metadataChunk;
            throw networkError;
          },
          async function* () {
            yield textChunk;
          },
        ],
      });
      const orchestrator = new RetryOrchestrator(provider, {
        maxAttempts: 4,
        initialDelayMs: 1,
        streamingTimeoutMs: 5000,
      });

      const { chunks, error } = await consumeStream(
        orchestrator.generateChatCompletion({ contents: [] }),
      );

      expect(chunks).toStrictEqual([metadataChunk]);
      expect(error).toBe(networkError);
      expect(isTerminalRetryError(error)).toBe(true);
      expect(calls()).toBe(1);
    });

    it('f: 401 error after text → auth handler at most once, exactly one transport call, error surfaces', async () => {
      const authError = createStatusError(401, 'authentication_error');
      const handlerCalls: string[] = [];
      const { provider, calls } = createScriptedProvider({
        script: [
          async function* () {
            yield textChunk;
            throw authError;
          },
          async function* () {
            yield textChunk;
          },
        ],
      });
      const orchestrator = new RetryOrchestrator(provider, {
        maxAttempts: 4,
        initialDelayMs: 1,
        streamingTimeoutMs: 5000,
      });

      const { chunks, error } = await consumeStream(
        orchestrator.generateChatCompletion(
          onAuthErrorOptions({
            handleAuthError: (context) => {
              handlerCalls.push(context.errorStatus.toString());
              return Promise.resolve();
            },
          }),
        ),
      );

      expect(chunks).toStrictEqual([textChunk]);
      expect(error).toBe(authError);
      expect(calls()).toBe(1);
      expect(handlerCalls).toStrictEqual(['401']);
    });
  });

  describe('AC-05: pre-exposure recovery preserved', () => {
    it('d: pre-exposure in-band overload → retries within budget', async () => {
      const overload = createInBandOverloadError();
      const { provider, calls } = createScriptedProvider({
        script: [
          async function* () {
            throw overload;
            yield textChunk;
          },
          async function* () {
            throw overload;
            yield textChunk;
          },
          async function* () {
            yield textChunk;
          },
        ],
      });
      const throttles: number[] = [];
      const orchestrator = new RetryOrchestrator(provider, {
        maxAttempts: 3,
        initialDelayMs: 50,
        trackThrottleWaitTime: (ms) => throttles.push(ms),
      });

      const { chunks, error } = await consumeStream(
        orchestrator.generateChatCompletion({ contents: [] }),
      );

      expect(error).toBeUndefined();
      expect(chunks).toStrictEqual([textChunk]);
      expect(calls()).toBe(3);
      expect(throttles.length).toBeGreaterThanOrEqual(1);
    });

    it('e: first-chunk timeout before output → retries within budget, losing iterator closed', async () => {
      const tracked = trackedStream(async function* (signal) {
        // Abort-aware the way a real SDK stream is: the pending next()
        // settles when the attempt is aborted, letting return() through.
        await delay(5000, signal);
        yield textChunk;
      });
      const { provider, calls } = createScriptedProvider({
        script: [
          tracked.factory,
          async function* () {
            yield textChunk;
          },
        ],
      });
      const orchestrator = new RetryOrchestrator(provider, {
        maxAttempts: 3,
        initialDelayMs: 10,
        streamingTimeoutMs: 5,
      });

      const { chunks, error } = await consumeStream(
        orchestrator.generateChatCompletion({ contents: [] }),
      );

      expect(error).toBeUndefined();
      expect(chunks).toStrictEqual([textChunk]);
      expect(calls()).toBe(2);
      expect(tracked.returns()).toBeGreaterThanOrEqual(1);
    });

    it('g: cancellation during first-chunk race → AbortError surfaces, no retry, iterator closed', async () => {
      const tracked = trackedStream(async function* (signal) {
        await delay(50, signal);
        yield textChunk;
      });
      const { provider, calls } = createScriptedProvider({
        script: [
          tracked.factory,
          async function* () {
            yield textChunk;
          },
        ],
      });
      const orchestrator = new RetryOrchestrator(provider, {
        maxAttempts: 3,
        initialDelayMs: 1,
        streamingTimeoutMs: 5000,
      });
      const controller = new AbortController();

      const cancellation = setTimeout(() => controller.abort(), 5);
      const { chunks, error } = await consumeStream(
        orchestrator.generateChatCompletion({
          contents: [],
          metadata: { abortSignal: controller.signal },
        }),
      );
      clearTimeout(cancellation);

      expect(chunks).toStrictEqual([]);
      expect(error).toBeDefined();
      expect(error instanceof Error ? error.name : String(error)).toBe(
        'AbortError',
      );
      expect(calls()).toBe(1);
      expect(tracked.returns()).toBeGreaterThanOrEqual(1);
    });
  });
});
