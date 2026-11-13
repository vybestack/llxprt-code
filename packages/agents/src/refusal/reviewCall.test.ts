/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Issue #4036: the reviewer call must end, one way or another. The provider is
 * the external boundary here, so these tests stand in a small stream for it.
 */

import { describe, expect, it } from 'bun:test';
import { createRuntimeInvocationContext } from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import type { RuntimeGenerateChatOptions } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProviderChat.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { callReviewProvider, ReviewTimeoutError } from './reviewCall.js';

async function* emptyContents(): AsyncGenerator<IContent> {}
function streamOf(chunks: readonly IContent[]) {
  return {
    async *generateChatCompletion(): AsyncGenerator<IContent> {
      await Promise.resolve();
      yield* chunks;
    },
  };
}

const NO_REQUEST: RuntimeGenerateChatOptions = { contents: emptyContents() };

const NEVER_ANSWERS = {
  generateChatCompletion(): AsyncIterable<IContent> {
    return {
      [Symbol.asyncIterator]: () => ({
        next: () => new Promise<IteratorResult<IContent>>(() => undefined),
      }),
    };
  },
};

describe('reviewer provider call', () => {
  it('collects the text, usage and finish reasons of the stream', async () => {
    const result = await callReviewProvider(
      streamOf([
        { speaker: 'ai', blocks: [{ type: 'text', text: '{"verdict":' }] },
        {
          speaker: 'ai',
          blocks: [{ type: 'text', text: '"no_change"}' }],
          metadata: {
            finishReason: 'stop',
            rawStopReason: 'end_turn',
            usage: { promptTokens: 10, completionTokens: 4, totalTokens: 14 },
          },
        },
      ]),
      NO_REQUEST,
      { timeoutMs: 1000 },
    );

    expect(result).toStrictEqual({
      text: '{"verdict":"no_change"}',
      usage: { promptTokens: 10, completionTokens: 4, totalTokens: 14 },
      finishReason: 'stop',
      rawStopReason: 'end_turn',
    });
  });

  it('gives up on a stream that never answers', async () => {
    const failure = await callReviewProvider(NEVER_ANSWERS, NO_REQUEST, {
      timeoutMs: 20,
    })
      .then(() => undefined)
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ReviewTimeoutError);
  });

  it('stops waiting as soon as the request is aborted', async () => {
    const controller = new AbortController();
    const pending = callReviewProvider(NEVER_ANSWERS, NO_REQUEST, {
      timeoutMs: 60_000,
      signal: controller.signal,
    })
      .then(() => undefined)
      .catch((error: unknown) => error);

    controller.abort();

    const failure = await pending;
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(ReviewTimeoutError);
  });

  it('passes on a failure of the provider stream', async () => {
    const failing = {
      generateChatCompletion(): AsyncIterable<IContent> {
        return {
          [Symbol.asyncIterator]: () => ({
            next: () => Promise.reject(new Error('endpoint said no')),
          }),
        };
      },
    };

    const failure = await callReviewProvider(failing, NO_REQUEST, {
      timeoutMs: 1000,
    })
      .then(() => undefined)
      .catch((error: unknown) => error);

    expect(failure).toStrictEqual(new Error('endpoint said no'));
  });

  describe('abort reaches the provider request', () => {
    const REQUEST_WITH_INVOCATION: RuntimeGenerateChatOptions = {
      contents: emptyContents(),
      invocation: createRuntimeInvocationContext({
        fetch: globalThis.fetch,
        providerName: 'openai',
        runtimeId: 'review-call-test',
        ephemeralsSnapshot: {},
      }),
    };

    /** A provider that never answers and keeps the options it was given. */
    function hangingProvider() {
      const received: RuntimeGenerateChatOptions[] = [];
      return {
        received,
        provider: {
          generateChatCompletion(
            options: RuntimeGenerateChatOptions,
          ): AsyncIterable<IContent> {
            received.push(options);
            return NEVER_ANSWERS.generateChatCompletion();
          },
        },
      };
    }

    function signalsOf(options: RuntimeGenerateChatOptions | undefined) {
      return {
        invocation: options?.invocation?.signal,
        metadata: options?.metadata?.['abortSignal'],
      };
    }

    it('aborts the signal the provider holds when the request aborts', async () => {
      const { received, provider } = hangingProvider();
      const controller = new AbortController();
      const pending = callReviewProvider(provider, REQUEST_WITH_INVOCATION, {
        timeoutMs: 60_000,
        signal: controller.signal,
      }).catch(() => undefined);

      controller.abort();
      await pending;

      const held = signalsOf(received[0]);
      expect({
        invocationAborted: held.invocation?.aborted,
        metadataAborted:
          held.metadata instanceof AbortSignal && held.metadata.aborted,
      }).toStrictEqual({ invocationAborted: true, metadataAborted: true });
    });

    it('aborts the signal the provider holds at the deadline', async () => {
      const { received, provider } = hangingProvider();

      await callReviewProvider(provider, REQUEST_WITH_INVOCATION, {
        timeoutMs: 20,
      }).catch(() => undefined);

      expect(signalsOf(received[0]).invocation?.aborted).toBe(true);
    });

    it('does not abort the provider signal of a call that finished', async () => {
      const received: RuntimeGenerateChatOptions[] = [];
      const answering = {
        generateChatCompletion(options: RuntimeGenerateChatOptions) {
          received.push(options);
          return streamOf([
            { speaker: 'ai', blocks: [{ type: 'text', text: 'done' }] },
          ]).generateChatCompletion();
        },
      };

      await callReviewProvider(answering, REQUEST_WITH_INVOCATION, {
        timeoutMs: 1000,
      });

      expect(signalsOf(received[0]).invocation?.aborted).toBe(false);
    });

    it('settles the request when the provider fails before returning a stream', async () => {
      const received: RuntimeGenerateChatOptions[] = [];
      const failing = {
        generateChatCompletion(
          options: RuntimeGenerateChatOptions,
        ): AsyncIterable<IContent> {
          received.push(options);
          throw new Error('provider unavailable');
        },
      };

      const failure = await callReviewProvider(
        failing,
        REQUEST_WITH_INVOCATION,
        { timeoutMs: 60_000 },
      ).catch((error: unknown) => error);

      expect({
        message: (failure as Error).message,
        providerSignalAborted: signalsOf(received[0]).invocation?.aborted,
      }).toStrictEqual({
        message: 'provider unavailable',
        providerSignalAborted: true,
      });
    });

    it('rejects an already aborted request without calling the provider', async () => {
      const { received, provider } = hangingProvider();
      const controller = new AbortController();
      controller.abort();

      const failure = await callReviewProvider(
        provider,
        REQUEST_WITH_INVOCATION,
        { timeoutMs: 60_000, signal: controller.signal },
      )
        .then(() => undefined)
        .catch((error: unknown) => error);

      expect({
        failed: failure instanceof Error,
        providerCalls: received.length,
      }).toStrictEqual({ failed: true, providerCalls: 0 });
    });
  });
});
