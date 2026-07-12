/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ServerAgentStreamEvent } from './turn.js';
import { Turn, AgentEventType, DEFAULT_AGENT_ID } from './turn.js';
import type { ChatSession } from './chatSession.js';
import { StreamEventType } from './chatSession.js';
import type { ModelStreamChunk } from '@vybestack/llxprt-code-core/llm-types/index.js';
import { type MockedChatInstance, mockChunk } from './turn-test-helpers.js';
import { DEFAULT_STREAM_FIRST_RESPONSE_TIMEOUT_MS } from '@vybestack/llxprt-code-core/utils/streamIdleTimeout.js';

const { mockSendMessageStream, mockGetHistory } = vi.hoisted(() => ({
  mockSendMessageStream: vi.fn(),
  mockGetHistory: vi.fn(),
}));

vi.mock('@vybestack/llxprt-code-core/utils/errorReporting.js', () => ({
  reportError: vi.fn(),
}));

vi.mock(
  '@vybestack/llxprt-code-core/utils/generateContentResponseUtilities.js',
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import('@vybestack/llxprt-code-core/utils/generateContentResponseUtilities.js')
      >();
    return {
      // analyzeResponseOutcome now operates on ContentBlock[]; delegate to the
      // real implementation so thinking/tool_call/text detection is correct.
      analyzeResponseOutcome: actual.analyzeResponseOutcome,
    };
  },
);

/**
 * Build a Turn with a config that supports BOTH the first-response timeout
 * (stream-first-response-timeout-ms) and the inter-chunk idle timeout
 * (stream-idle-timeout-ms), so tests can set them independently.
 */
function buildTurn(
  firstResponseMs?: number,
  idleMs?: number,
): {
  turn: Turn;
  mockChatInstance: MockedChatInstance;
} {
  const mockGetConfig = vi.fn().mockReturnValue({
    getEphemeralSetting: (key: string) => {
      if (key === 'stream-first-response-timeout-ms') {
        return firstResponseMs;
      }
      if (key === 'stream-idle-timeout-ms') {
        return idleMs;
      }
      return undefined;
    },
  });

  const mockChatInstance = {
    sendMessageStream: mockSendMessageStream,
    getHistory: mockGetHistory,
    getConfig: mockGetConfig,
  } as unknown as MockedChatInstance;

  const turn = new Turn(
    mockChatInstance as unknown as ChatSession,
    'prompt-id-first-response',
    DEFAULT_AGENT_ID,
    'test',
  );
  mockGetHistory.mockReturnValue([]);
  return { turn, mockChatInstance };
}

/** A failsafe that rejects after a deadline so a regression hangs the test, not the suite. */
function failsafe(ms: number): { promise: Promise<never>; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const promise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Test exceeded failsafe deadline of ${ms}ms`)),
      ms,
    );
  });
  // Swallow the rejection if it is never observed (e.g. a caller forgets to
  // race it or to call cancel()), so a leaked timeout cannot surface as an
  // unhandled rejection under strict Node modes.
  promise.catch(() => {});
  return { promise, cancel: () => clearTimeout(timer) };
}

/** A stream whose first .next() never resolves (acquisition resolves fine). */
function createStreamWithStalledFirstNext(): AsyncGenerator<{
  type: StreamEventType;
  value: ModelStreamChunk;
}> {
  return (async function* () {
    await new Promise<void>(() => {});
    yield {
      type: StreamEventType.CHUNK,
      value: mockChunk({ text: 'never' }),
    };
  })();
}

describe('Turn - first-response timeout (issue #2379)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    process.env = { ...originalEnv };
    delete process.env.LLXPRT_STREAM_FIRST_RESPONSE_TIMEOUT_MS;
    delete process.env.LLXPRT_STREAM_IDLE_TIMEOUT_MS;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    process.env = originalEnv;
  });

  it('DEFAULT-ON regression: with NO first-response setting/env, a stream whose first .next() never resolves yields terminal StreamIdleTimeout after DEFAULT_STREAM_FIRST_RESPONSE_TIMEOUT_MS', async () => {
    // buildTurn() with NO args: first-response returns undefined → resolver falls to default 300000
    const { turn } = buildTurn();

    mockSendMessageStream.mockResolvedValue(createStreamWithStalledFirstNext());

    const events: ServerAgentStreamEvent[] = [];
    const reqParts: Part[] = [{ text: 'Hi' }];
    const signal = new AbortController().signal;

    const iterator = turn.run(reqParts, signal);
    const runPromise = (async () => {
      for await (const event of iterator) {
        events.push(event);
      }
    })();

    // Before the default timeout: no events, generator still pending.
    await vi.advanceTimersByTimeAsync(
      DEFAULT_STREAM_FIRST_RESPONSE_TIMEOUT_MS - 1,
    );
    await Promise.resolve();
    expect(events).toHaveLength(0);

    // Advance past the default first-response timeout (300000ms). Drain all
    // pending timers/microtasks so the rejection deterministically propagates
    // through handleRunError before we await the consumer loop.
    await vi.advanceTimersByTimeAsync(2);
    await vi.runAllTimersAsync();
    await runPromise;

    const timeoutEvent = events.find(
      (e) => e.type === AgentEventType.StreamIdleTimeout,
    );
    expect(timeoutEvent).toBeDefined();
    expect(events.some((e) => e.type === AgentEventType.Error)).toBe(false);
  });

  it('DEFAULT-ON regression (real-timer failsafe): never-resolving first .next() surfaces StreamIdleTimeout under the failsafe deadline', async () => {
    vi.useRealTimers();
    // Use a tiny env override so the real-timer test finishes quickly while
    // still proving the DEFAULT-ON path fires (no ephemeral setting needed).
    process.env.LLXPRT_STREAM_FIRST_RESPONSE_TIMEOUT_MS = '50';
    const { turn } = buildTurn();

    mockSendMessageStream.mockResolvedValue(createStreamWithStalledFirstNext());

    const events: ServerAgentStreamEvent[] = [];
    const reqParts: Part[] = [{ text: 'Hi' }];
    const signal = new AbortController().signal;

    const guard = failsafe(2000);
    await Promise.race([
      (async () => {
        for await (const event of turn.run(reqParts, signal)) {
          events.push(event);
        }
      })(),
      guard.promise,
    ]);
    guard.cancel();

    const timeoutEvent = events.find(
      (e) => e.type === AgentEventType.StreamIdleTimeout,
    );
    expect(timeoutEvent).toBeDefined();
  });

  it('never-resolving ACQUISITION (sendMessageStream promise never resolves) with a small explicit first-response timeout → terminal StreamIdleTimeout', async () => {
    const { turn } = buildTurn(20);

    mockSendMessageStream.mockReturnValue(new Promise(() => {}));

    const events: ServerAgentStreamEvent[] = [];
    const reqParts: Part[] = [{ text: 'Hi' }];
    const signal = new AbortController().signal;

    const iterator = turn.run(reqParts, signal);
    const runPromise = (async () => {
      for await (const event of iterator) {
        events.push(event);
      }
    })();

    await vi.advanceTimersByTimeAsync(25);
    await vi.runAllTimersAsync();
    await runPromise;

    expect(
      events.find((e) => e.type === AgentEventType.StreamIdleTimeout),
    ).toBeDefined();
    expect(events.some((e) => e.type === AgentEventType.Error)).toBe(false);
  });

  it('never-resolving FIRST .next() (acquisition resolves, first chunk never arrives) with a small explicit first-response timeout → terminal StreamIdleTimeout', async () => {
    // This proves the first-response bound covers the first .next(), not just acquisition.
    const { turn } = buildTurn(20);

    mockSendMessageStream.mockResolvedValue(createStreamWithStalledFirstNext());

    const events: ServerAgentStreamEvent[] = [];
    const reqParts: Part[] = [{ text: 'Hi' }];
    const signal = new AbortController().signal;

    const iterator = turn.run(reqParts, signal);
    const runPromise = (async () => {
      for await (const event of iterator) {
        events.push(event);
      }
    })();

    await vi.advanceTimersByTimeAsync(25);
    await vi.runAllTimersAsync();
    await runPromise;

    expect(
      events.find((e) => e.type === AgentEventType.StreamIdleTimeout),
    ).toBeDefined();
    expect(events.some((e) => e.type === AgentEventType.Error)).toBe(false);
  });

  it('resource cleanup: when the timeout wins but the first .next() resolves LATE, the acquired iterator is closed (no provider connection leak)', async () => {
    // Race edge case: timeoutController.abort() is asynchronous, so the
    // in-flight first .next() can still resolve successfully a moment AFTER the
    // timeout has already won the race. The losing (late-resolving) iterator
    // must be closed via return() so the provider connection is not leaked.
    const { turn } = buildTurn(20);

    let releaseFirstNext!: () => void;
    const firstNextGate = new Promise<void>((resolve) => {
      releaseFirstNext = resolve;
    });
    // Deterministic sync point: the mock's return() resolves this promise, so
    // the test can await the exact moment cleanup fires instead of polling an
    // arbitrary number of microtask hops.
    let signalReturnCalled!: () => void;
    const returnCalledPromise = new Promise<void>((resolve) => {
      signalReturnCalled = resolve;
    });
    const cleanup = { returnCalled: false };

    const leakyIterator: AsyncIterator<{
      type: StreamEventType;
      value: ModelStreamChunk;
    }> = {
      async next() {
        await firstNextGate;
        return {
          done: false,
          value: {
            type: StreamEventType.CHUNK,
            value: mockChunk({ text: 'late' }),
          },
        };
      },
      async return() {
        cleanup.returnCalled = true;
        signalReturnCalled();
        return { done: true, value: undefined };
      },
    };
    mockSendMessageStream.mockResolvedValue({
      [Symbol.asyncIterator]: () => leakyIterator,
    });

    const events: ServerAgentStreamEvent[] = [];
    const reqParts: Part[] = [{ text: 'Hi' }];
    const signal = new AbortController().signal;

    const runPromise = (async () => {
      for await (const event of turn.run(reqParts, signal)) {
        events.push(event);
      }
    })();

    // Let the timeout win the race first.
    await vi.advanceTimersByTimeAsync(25);
    await vi.runAllTimersAsync();
    await runPromise;

    // Release the late first .next() so the losing promise resolves AFTER the
    // timeout already settled the race, then await the deterministic sync point
    // (bounded by the suite failsafe) so a regression that never closes the
    // iterator fails loudly instead of passing.
    releaseFirstNext();
    const guard = failsafe(2000);
    await Promise.race([returnCalledPromise, guard.promise]);
    guard.cancel();

    expect(
      events.find((e) => e.type === AgentEventType.StreamIdleTimeout),
    ).toBeDefined();
    // The late-resolving iterator MUST have been closed to release the provider
    // connection.
    expect(cleanup.returnCalled).toBe(true);
  });

  it('resource cleanup (disabled path): when first-response is DISABLED (0) and the first .next() throws, the acquired iterator is closed (no leak)', async () => {
    const { turn } = buildTurn(0);

    let returnCalled = false;
    const throwingIterator: AsyncIterator<{
      type: StreamEventType;
      value: ModelStreamChunk;
    }> = {
      async next(): Promise<never> {
        throw new Error('first next failed');
      },
      async return() {
        returnCalled = true;
        return { done: true, value: undefined };
      },
    };
    mockSendMessageStream.mockResolvedValue({
      [Symbol.asyncIterator]: () => throwingIterator,
    });

    const events: ServerAgentStreamEvent[] = [];
    const reqParts: Part[] = [{ text: 'Hi' }];
    const signal = new AbortController().signal;

    for await (const event of turn.run(reqParts, signal)) {
      events.push(event);
    }

    // The failing iterator MUST have been closed to release the provider
    // connection, and the error surfaces terminally (not a timeout).
    expect(returnCalled).toBe(true);
    expect(events.some((e) => e.type === AgentEventType.Error)).toBe(true);
  });

  it('control: first-response DISABLED (0) with a normal fast stream → events flow, no timeout', async () => {
    const { turn } = buildTurn(0);

    const mockResponseStream = (async function* () {
      yield {
        type: StreamEventType.CHUNK,
        value: mockChunk({ text: 'Hello' }),
      };
    })();
    mockSendMessageStream.mockResolvedValue(mockResponseStream);

    const events: ServerAgentStreamEvent[] = [];
    const reqParts: Part[] = [{ text: 'Hi' }];
    const signal = new AbortController().signal;

    for await (const event of turn.run(reqParts, signal)) {
      events.push(event);
    }

    expect(
      events.find((e) => e.type === AgentEventType.StreamIdleTimeout),
    ).toBeUndefined();
    expect(events.some((e) => e.type === AgentEventType.Content)).toBe(true);
  });

  it('regression: a HEALTHY stream where the first chunk arrives quickly, then a LATER inter-chunk gap LARGER than the first-response timeout does NOT trip anything (inter-chunk idle is default-off)', async () => {
    // first-response timeout is tiny (30ms), first chunk arrives at 10ms (before it),
    // then a later inter-chunk gap of 60ms (> first-response) must NOT trip anything
    // because the first-response timer is cancelled after the first chunk and the
    // inter-chunk idle watchdog is default-off (0). This is the key proof that
    // first-response ≠ inter-chunk.
    vi.useRealTimers();
    const { turn } = buildTurn(30);

    const mockResponseStream = (async function* () {
      await new Promise((resolve) => setTimeout(resolve, 10));
      yield {
        type: StreamEventType.CHUNK,
        value: mockChunk({ text: 'Hel' }),
      };
      await new Promise((resolve) => setTimeout(resolve, 60));
      yield {
        type: StreamEventType.CHUNK,
        value: mockChunk({ text: 'lo' }),
      };
    })();
    mockSendMessageStream.mockResolvedValue(mockResponseStream);

    const events: ServerAgentStreamEvent[] = [];
    const reqParts: Part[] = [{ text: 'Hi' }];
    const signal = new AbortController().signal;

    const guard = failsafe(2000);
    await Promise.race([
      (async () => {
        for await (const event of turn.run(reqParts, signal)) {
          events.push(event);
        }
      })(),
      guard.promise,
    ]);
    guard.cancel();

    expect(
      events.find((e) => e.type === AgentEventType.StreamIdleTimeout),
    ).toBeUndefined();
    expect(
      events.find((e) => e.type === AgentEventType.UserCancelled),
    ).toBeUndefined();
    expect(events.some((e) => e.type === AgentEventType.Content)).toBe(true);
  });

  it('abort: parent signal abort during first-response wait → UserCancelled, not a timeout', async () => {
    // Use REAL timers with a LARGE first-response timeout (60s) that cannot fire
    // within this test, so the ONLY mechanism that can unblock the wait is the
    // parent-abort propagating through the provider's abortSignal. This gives
    // the test teeth: if the parent-abort wiring (run() -> timeoutController ->
    // provider abortSignal) breaks, the wait never settles and the failsafe
    // trips instead of a spurious pass from the timeout firing.
    vi.useRealTimers();
    const { turn } = buildTurn(60_000);

    // Acquisition resolves; the first .next() only settles when the provided
    // abortSignal aborts, at which point it rejects with an AbortError — exactly
    // how a provider reacts to abortSignal cancellation mid-first-response.
    mockSendMessageStream.mockImplementation(
      (params: { config: { abortSignal: AbortSignal } }) => {
        const providerSignal = params.config.abortSignal;
        if (!(providerSignal instanceof AbortSignal)) {
          throw new Error(
            'Test setup error: sendMessageStream did not receive config.abortSignal',
          );
        }
        const stream = (async function* () {
          await new Promise<void>((_resolve, reject) => {
            if (providerSignal.aborted) {
              reject(new Error('aborted'));
              return;
            }
            providerSignal.addEventListener(
              'abort',
              () => reject(new Error('aborted')),
              { once: true },
            );
          });
          yield {
            type: StreamEventType.CHUNK,
            value: mockChunk({ text: 'never' }),
          };
        })();
        return Promise.resolve(stream);
      },
    );

    const events: ServerAgentStreamEvent[] = [];
    const reqParts: Part[] = [{ text: 'Hi' }];
    const abortController = new AbortController();

    const iterator = turn.run(reqParts, abortController.signal);
    const runPromise = (async () => {
      for await (const event of iterator) {
        events.push(event);
      }
    })();

    // Let the generator body start and reach the first-response wait (past the
    // pre-flight signal.aborted check) BEFORE aborting, so the abort is
    // genuinely observed DURING the wait.
    await new Promise((resolve) => setTimeout(resolve, 10));
    abortController.abort();

    const guard = failsafe(2000);
    await Promise.race([runPromise, guard.promise]);
    guard.cancel();

    expect(
      events.find((e) => e.type === AgentEventType.UserCancelled),
    ).toBeDefined();
    expect(
      events.find((e) => e.type === AgentEventType.StreamIdleTimeout),
    ).toBeUndefined();
  });

  it('failsafe: a never-resolving sendMessageStream with first-response enabled does not hang the suite (real timers)', async () => {
    vi.useRealTimers();
    const { turn } = buildTurn(20);

    mockSendMessageStream.mockReturnValue(new Promise(() => {}));

    const events: ServerAgentStreamEvent[] = [];
    const reqParts: Part[] = [{ text: 'Hi' }];
    const signal = new AbortController().signal;

    const guard = failsafe(2000);
    await Promise.race([
      (async () => {
        for await (const event of turn.run(reqParts, signal)) {
          events.push(event);
        }
      })(),
      guard.promise,
    ]);
    guard.cancel();

    const timeoutEvent = events.find(
      (e) => e.type === AgentEventType.StreamIdleTimeout,
    );
    expect(timeoutEvent).toBeDefined();
  });
});
