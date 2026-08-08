/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for Turn.run() cooperative iterator cleanup (issue #3114).
 *
 * A turn must await its provider iterator's cooperative asynchronous cleanup
 * (return()'s promise, or a generator's finally block) before the turn
 * generator finishes — including when the consumer exits early — while a
 * noncooperative iterator that never settles remains bounded by the existing
 * cleanup timeout.
 *
 * These tests drive the public Turn.run() generator with real async iterators
 * whose cleanup is controlled by a deferred release. No component is mocked
 * except the ChatSession transport (an infrastructure boundary).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'bun:test';
import type { ServerAgentStreamEvent } from './turn.js';
import { Turn, AgentEventType, DEFAULT_AGENT_ID } from './turn.js';
import type { ChatSession } from './chatSession.js';
import { StreamEventType } from './chatSession.js';
import { type MockedChatInstance, mockChunk } from './turn-test-helpers.js';
import { waitForCondition } from '../test-utils/eventLoop.js';

const { mockSendMessageStream, mockGetHistory } = {
  mockSendMessageStream: vi.fn(),
  mockGetHistory: vi.fn(),
};

void vi.mock('@vybestack/llxprt-code-core/utils/errorReporting.js', () => ({
  reportError: vi.fn(),
}));

function streamIterable(
  iterator: AsyncIterator<unknown>,
): AsyncIterable<unknown> {
  return {
    [Symbol.asyncIterator]: () => iterator,
  };
}

function chunkEvent(text: string): {
  type: typeof StreamEventType.CHUNK;
  value: ReturnType<typeof mockChunk>;
} {
  return { type: StreamEventType.CHUNK, value: mockChunk({ text }) };
}

describe('Turn run - cooperative iterator cleanup (issue #3114)', () => {
  let turn: Turn;
  let mockChatInstance: MockedChatInstance;

  beforeEach(() => {
    vi.resetAllMocks();
    mockChatInstance = {
      sendMessageStream: mockSendMessageStream,
      getHistory: mockGetHistory,
      getConfig: () => undefined,
    };
    turn = new Turn(
      mockChatInstance as unknown as ChatSession,
      'prompt-id-1',
      DEFAULT_AGENT_ID,
      'test',
    );
    mockGetHistory.mockReturnValue([]);
    mockSendMessageStream.mockResolvedValue((async function* () {})());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('awaits cooperative iterator cleanup before finishing after early consumer exit', async () => {
    let releaseCleanup = (): void => {};
    const cleanupReleased = new Promise<void>((resolve) => {
      releaseCleanup = resolve;
    });
    let returnStarted = false;
    let returnSettled = false;

    const providerIterator: AsyncIterator<unknown> = {
      next: async () => ({
        done: false,
        value: chunkEvent('first'),
      }),
      return: async () => {
        returnStarted = true;
        await cleanupReleased;
        returnSettled = true;
        return { done: true, value: undefined };
      },
    };
    mockSendMessageStream.mockResolvedValue(streamIterable(providerIterator));

    let consumerFinished = false;
    const consumer = (async () => {
      for await (const _event of turn.run(
        [{ text: 'test' }],
        new AbortController().signal,
      )) {
        break;
      }
      consumerFinished = true;
    })();

    // Wait until iterator.return() has been called — that proves the break
    // triggered the generator finally block and cleanup started — rather than
    // assuming one flushEventLoop call reached cleanup.
    await waitForCondition(() => returnStarted);

    // The consumer must NOT have finished: the cooperative cleanup is still
    // pending on the deferred release.
    expect(consumerFinished).toBe(false);
    expect(returnSettled).toBe(false);

    releaseCleanup();
    await consumer;

    expect(consumerFinished).toBe(true);
    expect(returnSettled).toBe(true);
  });

  it('awaits cooperative iterator cleanup before finishing on normal stream completion', async () => {
    let releaseCleanup = (): void => {};
    const cleanupReleased = new Promise<void>((resolve) => {
      releaseCleanup = resolve;
    });
    let returnStarted = false;
    let returnSettled = false;

    const providerIterator: AsyncIterator<unknown> = {
      next: async () => ({
        done: true,
        value: undefined,
      }),
      return: async () => {
        returnStarted = true;
        await cleanupReleased;
        returnSettled = true;
        return { done: true, value: undefined };
      },
    };
    mockSendMessageStream.mockResolvedValue(streamIterable(providerIterator));

    let consumerFinished = false;
    const consumer = (async () => {
      const events: ServerAgentStreamEvent[] = [];
      for await (const event of turn.run(
        [{ text: 'test' }],
        new AbortController().signal,
      )) {
        events.push(event);
      }
      consumerFinished = true;
    })();

    // Wait until iterator.return() has been called — that proves normal
    // completion triggered cleanup — rather than assuming one flushEventLoop
    // call reached cleanup.
    await waitForCondition(() => returnStarted);

    // Normal completion still must wait for cooperative cleanup.
    expect(consumerFinished).toBe(false);
    expect(returnSettled).toBe(false);

    releaseCleanup();
    await consumer;

    expect(consumerFinished).toBe(true);
    expect(returnSettled).toBe(true);
  });

  it('preserves bounded cleanup timeout for a noncooperative iterator', async () => {
    let returnCalled = false;
    const providerIterator: AsyncIterator<unknown> = {
      next: async () => ({ done: false, value: chunkEvent('first') }),
      return: () => {
        returnCalled = true;
        return new Promise<IteratorResult<unknown>>(() => {});
      },
    };
    mockSendMessageStream.mockResolvedValue(streamIterable(providerIterator));

    const events: ServerAgentStreamEvent[] = [];
    const start = Date.now();
    for await (const event of turn.run(
      [{ text: 'test' }],
      new AbortController().signal,
    )) {
      events.push(event);
      break;
    }
    const elapsed = Date.now() - start;

    expect(events).toContainEqual({
      type: AgentEventType.Content,
      value: 'first',
      traceId: undefined,
    });
    expect(returnCalled).toBe(true);
    // The bounded cleanup timeout is 1s. The margin absorbs scheduling jitter
    // on a loaded CI runner while still failing a regression that adds another
    // whole second to every turn.
    expect(elapsed).toBeLessThan(2_500);
  });
});
