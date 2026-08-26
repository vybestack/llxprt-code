/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { createAbortError } from '@vybestack/llxprt-code-core/utils/delay.js';
import { guardStream } from '../guardedStream.js';
import { decodeRetryFailure } from '../retryFailureTaxonomy.js';
import { isTerminalRetryError } from '../retryErrorClassification.js';
import {
  getRequestCommitState,
  resolveRetryRequestContext,
  type RetryRequestContext,
} from '../retryRequestContext.js';

const requestDefaults = {
  maxAttempts: 2,
  initialDelayMs: 0,
  authRetryTimeoutMs: 500,
};

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

const toolCallChunk: IContent = {
  speaker: 'ai',
  blocks: [
    {
      type: 'tool_call',
      id: 'call-1',
      name: 'lookup',
      parameters: { query: 'value' },
    },
  ],
};

interface TrackedStream {
  readonly iterator: AsyncIterableIterator<IContent>;
  readonly returnCalls: () => number;
}

function createRequestContext(): RetryRequestContext {
  return resolveRetryRequestContext({ contents: [] }, requestDefaults);
}

function trackIterator(
  source: AsyncGenerator<IContent, void, undefined>,
): TrackedStream {
  let returnCallCount = 0;
  const iterator: AsyncIterableIterator<IContent> = {
    next: () => source.next(),
    return: async () => {
      returnCallCount += 1;
      return source.return(undefined);
    },
    [Symbol.asyncIterator]() {
      return this;
    },
  };
  return {
    iterator,
    returnCalls: () => returnCallCount,
  };
}

async function nextChunk(
  stream: AsyncGenerator<IContent, boolean>,
): Promise<IContent> {
  const result = await stream.next();
  if (result.done === true) {
    throw new Error('Expected the guarded stream to yield a chunk');
  }
  return result.value;
}

async function captureFailure(operation: Promise<unknown>): Promise<unknown> {
  try {
    await operation;
  } catch (error) {
    return error;
  }
  throw new Error('Expected operation to fail');
}

async function* waitForAbort(
  signal: AbortSignal,
): AsyncGenerator<IContent, void, undefined> {
  await new Promise<void>((_resolve, reject) => {
    const rejectWithAbort = () => reject(createAbortError(signal.reason));
    if (signal.aborted) {
      rejectWithAbort();
      return;
    }
    signal.addEventListener('abort', rejectWithAbort, { once: true });
  });
  yield textChunk;
}

describe('guardStream', () => {
  it('marks each chunk before exposure and upgrades metadata to content to tool call without downgrading', async () => {
    async function* source(): AsyncGenerator<IContent, void, undefined> {
      yield metadataChunk;
      yield textChunk;
      yield toolCallChunk;
      yield metadataChunk;
    }
    const context = createRequestContext();
    const controller = new AbortController();
    const guarded = guardStream(source(), {
      attemptController: controller,
      context,
    });

    expect(await nextChunk(guarded)).toBe(metadataChunk);
    expect(getRequestCommitState(context)).toMatchObject({
      committed: true,
      exposure: 'metadata',
    });
    expect(await nextChunk(guarded)).toBe(textChunk);
    expect(getRequestCommitState(context).exposure).toBe('content');
    expect(await nextChunk(guarded)).toBe(toolCallChunk);
    expect(getRequestCommitState(context).exposure).toBe('tool_call');
    expect(await nextChunk(guarded)).toBe(metadataChunk);
    expect(getRequestCommitState(context).exposure).toBe('tool_call');
    expect(await guarded.next()).toStrictEqual({ done: true, value: true });

    expect(controller.signal.aborted).toBe(false);
    context.releaseBudget();
  });

  it('marks and rethrows the same failure after output and closes the iterator', async () => {
    const streamFailure = new Error('stream failed after output');
    async function* source(): AsyncGenerator<IContent, void, undefined> {
      yield textChunk;
      throw streamFailure;
    }
    const tracked = trackIterator(source());
    const context = createRequestContext();
    const controller = new AbortController();
    const guarded = guardStream(tracked.iterator, {
      attemptController: controller,
      context,
    });

    expect(await nextChunk(guarded)).toBe(textChunk);
    const thrown = await captureFailure(guarded.next());

    expect(thrown).toBe(streamFailure);
    expect(isTerminalRetryError(thrown)).toBe(true);
    expect(context.committed).toBe(true);
    expect(tracked.returnCalls()).toBe(1);
    expect(controller.signal.aborted).toBe(true);
    context.releaseBudget();
  });

  it('leaves a pre-output failure retryable and closes the iterator', async () => {
    const streamFailure = new Error('stream failed before output');
    async function* source(): AsyncGenerator<IContent, void, undefined> {
      throw streamFailure;
      yield textChunk;
    }
    const tracked = trackIterator(source());
    const context = createRequestContext();
    const controller = new AbortController();
    const guarded = guardStream(tracked.iterator, {
      attemptController: controller,
      context,
    });

    const thrown = await captureFailure(guarded.next());

    expect(thrown).toBe(streamFailure);
    expect(isTerminalRetryError(thrown)).toBe(false);
    expect(context.committed).toBe(false);
    expect(tracked.returnCalls()).toBe(1);
    expect(controller.signal.aborted).toBe(true);
    context.releaseBudget();
  });

  it('times out the first chunk, aborts and closes the losing iterator, and remains retryable', async () => {
    const controller = new AbortController();
    const tracked = trackIterator(waitForAbort(controller.signal));
    const context = createRequestContext();
    const guarded = guardStream(tracked.iterator, {
      timeoutMs: 10,
      attemptController: controller,
      context,
    });

    const thrown = await captureFailure(guarded.next());

    expect(thrown).toBeInstanceOf(Error);
    expect(thrown instanceof Error ? thrown.message : '').toBe(
      'Stream timeout: first chunk not received after 10ms',
    );
    expect(decodeRetryFailure(thrown).kind).toBe('timeout');
    expect(isTerminalRetryError(thrown)).toBe(false);
    expect(context.committed).toBe(false);
    expect(controller.signal.aborted).toBe(true);
    expect(tracked.returnCalls()).toBe(1);
    context.releaseBudget();
  });

  it('returns false for an empty stream without aborting or closing it', async () => {
    async function* source(): AsyncGenerator<IContent, void, undefined> {
      return;
    }
    const tracked = trackIterator(source());
    const context = createRequestContext();
    const controller = new AbortController();
    const guarded = guardStream(tracked.iterator, {
      attemptController: controller,
      context,
    });

    expect(await guarded.next()).toStrictEqual({ done: true, value: false });
    expect(context.committed).toBe(false);
    expect(controller.signal.aborted).toBe(false);
    expect(tracked.returnCalls()).toBe(0);
    context.releaseBudget();
  });

  it('surfaces cancellation during the first-chunk race and closes the iterator', async () => {
    const controller = new AbortController();
    const tracked = trackIterator(waitForAbort(controller.signal));
    const context = createRequestContext();
    const guarded = guardStream(tracked.iterator, {
      timeoutMs: 1_000,
      attemptController: controller,
      context,
    });
    const cancellation = setTimeout(
      () => controller.abort(new Error('caller cancelled')),
      0,
    );

    const thrown = await captureFailure(guarded.next());
    clearTimeout(cancellation);

    expect(thrown).toBeInstanceOf(Error);
    expect(thrown instanceof Error ? thrown.name : '').toBe('AbortError');
    expect(isTerminalRetryError(thrown)).toBe(true);
    expect(context.committed).toBe(false);
    expect(tracked.returnCalls()).toBe(1);
    context.releaseBudget();
  });

  it('surfaces an abort before the first next call and closes the iterator', async () => {
    async function* source(): AsyncGenerator<IContent, void, undefined> {
      yield textChunk;
    }
    const tracked = trackIterator(source());
    const context = createRequestContext();
    const controller = new AbortController();
    controller.abort(new Error('cancelled before iteration'));
    const guarded = guardStream(tracked.iterator, {
      attemptController: controller,
      context,
    });

    const thrown = await captureFailure(guarded.next());

    expect(thrown).toBeInstanceOf(Error);
    expect(thrown instanceof Error ? thrown.name : '').toBe('AbortError');
    expect(context.committed).toBe(false);
    expect(tracked.returnCalls()).toBe(1);
    context.releaseBudget();
  });
});
