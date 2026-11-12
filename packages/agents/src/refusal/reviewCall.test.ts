/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Issue #4036: the reviewer call must end, one way or another. The provider is
 * the external boundary here, so these tests stand in a small stream for it.
 */

import { describe, expect, it } from 'bun:test';
import type { RuntimeGenerateChatOptions } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProviderChat.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { callReviewProvider, ReviewTimeoutError } from './reviewCall.js';

function streamOf(chunks: readonly IContent[]) {
  return {
    async *generateChatCompletion(): AsyncGenerator<IContent> {
      await Promise.resolve();
      yield* chunks;
    },
  };
}

const NO_REQUEST: RuntimeGenerateChatOptions = { contents: [] };

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
});
