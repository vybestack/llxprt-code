/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { advanceTimersByTimeAsync } from '@vybestack/llxprt-code-test-utils';
import { describe, it, expect, vi, beforeEach, afterEach } from 'bun:test';
import type { ServerAgentStreamEvent } from './turn.js';
import { Turn, AgentEventType, DEFAULT_AGENT_ID } from './turn.js';
import { reportError } from '@vybestack/llxprt-code-core/utils/errorReporting.js';
import type { ChatSession } from './chatSession.js';
import { StreamEventType, type StreamEvent } from './chatSession.js';
import type { StreamLivenessListener } from '@vybestack/llxprt-code-core/utils/streamIdleTimeout.js';
import type { ContentBlock } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { type MockedChatInstance, mockChunk } from './turn-test-helpers.js';
import { flushEventLoop } from '../test-utils/eventLoop.js';

const { mockSendMessageStream, mockGetHistory } = {
  mockSendMessageStream: vi.fn(),
  mockGetHistory: vi.fn(),
};

function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    signal.addEventListener('abort', () => resolve(), { once: true });
  });
}

function rejectWhenAborted(signal: AbortSignal): Promise<never> {
  if (signal.aborted) {
    return Promise.reject(new DOMException('Aborted', 'AbortError'));
  }
  return new Promise<never>((_resolve, reject) => {
    signal.addEventListener(
      'abort',
      () => reject(new DOMException('Aborted', 'AbortError')),
      { once: true },
    );
  });
}

void vi.mock('@vybestack/llxprt-code-core/utils/errorReporting.js', () => ({
  reportError: vi.fn(),
}));

const actual = {
  ...(await import(
    '@vybestack/llxprt-code-core/utils/generateContentResponseUtilities.js'
  )),
};
void vi.mock(
  '@vybestack/llxprt-code-core/utils/generateContentResponseUtilities.js',
  () => ({
    // analyzeResponseOutcome now operates on ContentBlock[]; delegate to the
    // real implementation so thinking/tool_call/text detection is correct.
    analyzeResponseOutcome: actual.analyzeResponseOutcome,
  }),
);

describe('Turn run - abort and idle timeout', () => {
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

  it('should yield UserCancelled event if signal is aborted', async () => {
    const abortController = new AbortController();
    const mockResponseStream = (async function* () {
      yield {
        type: StreamEventType.CHUNK,
        value: mockChunk({ text: 'First part' }),
      };
      abortController.abort();
      yield {
        type: StreamEventType.CHUNK,
        value: mockChunk({
          text: 'Second part - should not be processed',
        }),
      };
    })();
    mockSendMessageStream.mockResolvedValue(mockResponseStream);

    const events = [];
    const reqParts: ContentBlock[] = [{ type: 'text', text: 'Test abort' }];
    for await (const event of turn.run(reqParts, abortController.signal)) {
      events.push(event);
    }
    expect(events).toStrictEqual([
      {
        type: AgentEventType.Content,
        value: 'First part',
        traceId: undefined,
      },
      { type: AgentEventType.UserCancelled },
    ]);
    expect(turn.getDebugResponses().length).toBe(1);
  });

  it('should call return() on stream iterator when aborted', async () => {
    vi.useFakeTimers();
    try {
      const abortController = new AbortController();
      const returnSpy = vi.fn().mockResolvedValue(undefined);

      mockChatInstance = {
        sendMessageStream: mockSendMessageStream,
        getHistory: mockGetHistory,
        getConfig: () => ({
          getEphemeralSetting: (key: string) => {
            if (key === 'stream-idle-timeout-ms') {
              return 30_000;
            }
            return undefined;
          },
        }),
      };
      turn = new Turn(
        mockChatInstance as unknown as ChatSession,
        'prompt-id-1',
        DEFAULT_AGENT_ID,
        'test',
      );

      async function* mockGenerator() {
        try {
          yield {
            type: StreamEventType.CHUNK,
            value: mockChunk({ text: 'First part' }),
          };
          await waitForAbort(abortController.signal);
          yield {
            type: StreamEventType.CHUNK,
            value: mockChunk({
              text: 'Second part - should not be processed',
            }),
          };
        } finally {
          // This ensures return() is called when iterator is closed
        }
      }

      const generator = mockGenerator();
      const mockResponseStream = {
        [Symbol.asyncIterator]: () => ({
          next: () => generator.next(),
          return: returnSpy,
          throw: (e: unknown) => generator.throw(e),
        }),
      };

      mockSendMessageStream.mockResolvedValue(mockResponseStream);

      const events: ServerAgentStreamEvent[] = [];
      const runPromise = (async () => {
        for await (const event of turn.run(
          [{ text: 'Test iterator cleanup' }],
          abortController.signal,
        )) {
          events.push(event);
          if (event.type === AgentEventType.Content) {
            abortController.abort();
          }
        }
      })();

      // Drain the event loop so the async consumer processes the first chunk
      // and aborts the controller. waitForCondition cannot be used here
      // because abortController.abort() is called synchronously inside the
      // for-await body — the for-await loop must make at least one iteration,
      // which requires a macrotask yield, not a microtask drain.
      await flushEventLoop();
      await advanceTimersByTimeAsync(100);
      await runPromise;

      expect(returnSpy).toHaveBeenCalled();
      expect(events).toContainEqual({ type: AgentEventType.UserCancelled });
    } finally {
      vi.useRealTimers();
    }
  });

  it('should allow subsequent calls after abort (sendPromise resolved)', async () => {
    const abortController = new AbortController();
    let callCount = 0;

    const createMockStream = (shouldAbort = false) =>
      (async function* () {
        if (shouldAbort) {
          yield {
            type: StreamEventType.CHUNK,
            value: mockChunk({ text: 'Partial' }),
          };
          abortController.abort();
          await new Promise((resolve) => setTimeout(resolve, 10));
          yield {
            type: StreamEventType.CHUNK,
            value: mockChunk({ text: 'Ignored' }),
          };
        } else {
          yield {
            type: StreamEventType.CHUNK,
            value: mockChunk({ text: 'Second call success' }),
          };
        }
      })();

    mockSendMessageStream.mockImplementation(() => {
      callCount++;
      return createMockStream(callCount === 1);
    });

    const events1: ServerAgentStreamEvent[] = [];
    for await (const event of turn.run(
      [{ text: 'First call' }],
      abortController.signal,
    )) {
      events1.push(event);
    }

    expect(events1).toContainEqual({ type: AgentEventType.UserCancelled });
    expect(callCount).toBe(1);

    const freshController = new AbortController();
    const events2: ServerAgentStreamEvent[] = [];

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error('Second call timed out')),
        5000,
      );
    });

    const runPromise = (async () => {
      for await (const event of turn.run(
        [{ text: 'Second call' }],
        freshController.signal,
      )) {
        events2.push(event);
      }
    })();

    try {
      await Promise.race([runPromise, timeoutPromise]);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }

    expect(callCount).toBe(2);
    expect(events2).toContainEqual({
      type: AgentEventType.Content,
      value: 'Second call success',
    });
  });

  it('should not crash when cancelled request has malformed error', async () => {
    const abortController = new AbortController();

    const errorToThrow = {
      response: {
        data: undefined,
      },
    };

    mockSendMessageStream.mockImplementation(async () => {
      abortController.abort();
      throw errorToThrow;
    });

    const events = [];
    const reqParts: ContentBlock[] = [
      { type: 'text', text: 'Test malformed error handling' },
    ];

    for await (const event of turn.run(reqParts, abortController.signal)) {
      events.push(event);
    }

    expect(events).toStrictEqual([{ type: AgentEventType.UserCancelled }]);

    expect(reportError).not.toHaveBeenCalled();
  });

  it('should yield StreamIdleTimeout when the stream goes idle after partial output with explicit timeout config', async () => {
    vi.useFakeTimers();
    try {
      const testTimeoutMs = 30_000;
      const abortSignals: AbortSignal[] = [];

      mockChatInstance = {
        sendMessageStream: mockSendMessageStream,
        getHistory: mockGetHistory,
        getConfig: () => ({
          getEphemeralSetting: (key: string) => {
            if (key === 'stream-idle-timeout-ms') {
              return testTimeoutMs;
            }
            return undefined;
          },
        }),
      };
      turn = new Turn(
        mockChatInstance as unknown as ChatSession,
        'prompt-id-1',
        DEFAULT_AGENT_ID,
        'test',
      );

      mockSendMessageStream.mockImplementation(async (params) => {
        const config = params as {
          config?: { abortSignal?: AbortSignal };
        };
        const providerSignal = config.config?.abortSignal;
        if (providerSignal === undefined) {
          throw new Error('Provider abort signal is required');
        }
        abortSignals.push(providerSignal);
        return (async function* () {
          yield {
            type: StreamEventType.CHUNK,
            value: mockChunk({ text: 'First part' }),
          };
          await rejectWhenAborted(providerSignal);
        })();
      });

      const eventsPromise = (async () => {
        const events: ServerAgentStreamEvent[] = [];
        for await (const event of turn.run(
          [{ text: 'Test idle timeout' }],
          new AbortController().signal,
        )) {
          events.push(event);
        }
        return events;
      })();

      // Drain the event loop so the async consumer processes the first chunk
      // and the provider signal is captured. waitForCondition cannot be used
      // here because the provider signal is pushed inside the mock's async
      // generator body, which requires a macrotask yield to enter.
      await flushEventLoop();
      await advanceTimersByTimeAsync(testTimeoutMs + 1);
      const events = await eventsPromise;

      expect(events).toStrictEqual([
        {
          type: AgentEventType.Content,
          value: 'First part',
          traceId: undefined,
        },
        {
          type: AgentEventType.StreamIdleTimeout,
          value: {
            error: {
              message:
                'Inter-chunk stream-idle timeout: no response received within the allowed time (threshold 30000ms) from stream-idle-timeout-ms.',
              status: undefined,
            },
          },
        },
      ]);
      expect(abortSignals).toHaveLength(1);
      expect(abortSignals[0]?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ─── Issue #3236: abort settles provider reads that ignore the signal ──────

function captureProcessFailures(): { captured: unknown[]; stop: () => void } {
  const captured: unknown[] = [];
  const onUnhandledRejection = (reason: unknown): void => {
    captured.push(reason);
  };
  const onUncaughtException = (error: unknown): void => {
    captured.push(error);
  };
  process.on('unhandledRejection', onUnhandledRejection);
  process.on('uncaughtException', onUncaughtException);
  return {
    captured,
    stop: () => {
      process.off('unhandledRejection', onUnhandledRejection);
      process.off('uncaughtException', onUncaughtException);
    },
  };
}

interface StallingStreamHarness {
  readonly stream: AsyncIterable<StreamEvent>;
  /** Resolves once the never-settling read has been entered. */
  readonly stallEntered: Promise<void>;
  readonly returnSpy: ReturnType<typeof vi.fn>;
  resolveStalledRead(result: IteratorResult<StreamEvent>): void;
  rejectStalledRead(reason?: unknown): void;
}

/**
 * A provider iterator whose read after the first `chunksBeforeStall` chunks
 * NEVER settles on its own — it ignores the abort signal exactly like the
 * non-cooperative transports behind issue #3236. The test settles the
 * abandoned read explicitly afterwards to prove a late settlement can
 * neither escape as an unhandled rejection nor emit additional events.
 */
function createStallingStream(
  chunksBeforeStall: number,
): StallingStreamHarness {
  let readCount = 0;
  let resolveStalled:
    | ((result: IteratorResult<StreamEvent>) => void)
    | undefined;
  let rejectStalled: ((reason?: unknown) => void) | undefined;
  let markStallEntered: () => void = () => {};
  const stallEntered = new Promise<void>((resolve) => {
    markStallEntered = resolve;
  });
  const returnSpy = vi.fn(
    (): Promise<IteratorResult<StreamEvent>> =>
      Promise.resolve({ value: undefined, done: true }),
  );
  const iterator: AsyncIterator<StreamEvent> = {
    next: (): Promise<IteratorResult<StreamEvent>> => {
      readCount += 1;
      if (readCount <= chunksBeforeStall) {
        return Promise.resolve({
          done: false,
          value: {
            type: StreamEventType.CHUNK,
            value: mockChunk({ text: `part ${readCount}` }),
          },
        });
      }
      markStallEntered();
      return new Promise<IteratorResult<StreamEvent>>((resolve, reject) => {
        resolveStalled = resolve;
        rejectStalled = reject;
      });
    },
    return: returnSpy,
  };
  return {
    stream: { [Symbol.asyncIterator]: () => iterator },
    stallEntered,
    returnSpy,
    resolveStalledRead: (result) => resolveStalled?.(result),
    rejectStalledRead: (reason) => rejectStalled?.(reason),
  };
}

function runTurnCollecting(
  turn: Turn,
  signal: AbortSignal,
): { events: ServerAgentStreamEvent[]; done: Promise<void> } {
  const events: ServerAgentStreamEvent[] = [];
  const done = (async () => {
    for await (const event of turn.run([{ text: 'test query' }], signal)) {
      events.push(event);
    }
  })();
  return { events, done };
}

function singleCancelledEventCount(events: ServerAgentStreamEvent[]): number {
  return events.filter((event) => event.type === AgentEventType.UserCancelled)
    .length;
}

/**
 * Wraps an AbortSignal's addEventListener/removeEventListener so tests can
 * observe how many 'abort' listeners are currently registered.
 */
function instrumentAbortListeners(signal: AbortSignal): {
  pendingAbortListenerCount: () => number;
} {
  const pending = new Set<EventListener>();
  // Bound AbortSignal.addEventListener is generic over event-map keys; the
  // plain-string delegate below needs the degenerately-typed binding.
  const originalAdd = signal.addEventListener.bind(signal) as (
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ) => void;
  const originalRemove = signal.removeEventListener.bind(signal) as (
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ) => void;
  signal.addEventListener = (
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ): void => {
    if (type === 'abort' && typeof listener === 'function') {
      pending.add(listener);
    }
    originalAdd(type, listener, options);
  };
  signal.removeEventListener = (
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ): void => {
    if (type === 'abort' && typeof listener === 'function') {
      pending.delete(listener);
    }
    originalRemove(type, listener, options);
  };
  return { pendingAbortListenerCount: () => pending.size };
}

/**
 * Builds the issue #3236 test Turn over the shared stream mocks, with an
 * optional ephemeral-settings source. Keeps config-key and Turn-constructor
 * drift in one place across the tests below.
 */
function makeTurnWithConfig(
  getEphemeralSetting?: (key: string) => unknown,
): Turn {
  const chatInstance: MockedChatInstance = {
    sendMessageStream: mockSendMessageStream,
    getHistory: mockGetHistory,
    getConfig: () =>
      getEphemeralSetting === undefined ? undefined : { getEphemeralSetting },
  };
  return new Turn(
    chatInstance as unknown as ChatSession,
    'prompt-id-1',
    DEFAULT_AGENT_ID,
    'test',
  );
}

describe('Turn run — abort settles provider reads that ignore the abort signal (issue #3236)', () => {
  let turn: Turn;

  beforeEach(() => {
    vi.resetAllMocks();
    turn = makeTurnWithConfig();
    mockGetHistory.mockReturnValue([]);
    mockSendMessageStream.mockResolvedValue((async function* () {})());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('settles a default-config abort mid-read with exactly one UserCancelled, and a late chunk changes nothing', async () => {
    const failures = captureProcessFailures();
    try {
      const abortController = new AbortController();
      const stalled = createStallingStream(1);
      mockSendMessageStream.mockResolvedValue(stalled.stream);

      const { events, done } = runTurnCollecting(turn, abortController.signal);

      await stalled.stallEntered;
      // Default config: the inter-chunk watchdog is disabled, so this read is
      // unbounded unless the turn races it against abort. No timers advance.
      abortController.abort();

      await done;

      expect(events).toStrictEqual([
        { type: AgentEventType.Content, value: 'part 1', traceId: undefined },
        { type: AgentEventType.UserCancelled },
      ]);
      expect(singleCancelledEventCount(events)).toBe(1);

      // The abandoned read settles late with another chunk: no additional
      // events, no unhandled rejection, turn state unchanged.
      stalled.resolveStalledRead({
        done: false,
        value: {
          type: StreamEventType.CHUNK,
          value: mockChunk({ text: 'late chunk' }),
        },
      });
      await flushEventLoop();
      expect(events).toHaveLength(2);
      expect(singleCancelledEventCount(events)).toBe(1);
      expect(failures.captured).toHaveLength(0);
    } finally {
      failures.stop();
    }
  });

  it('emits no unhandled rejection when the abandoned read later rejects', async () => {
    const failures = captureProcessFailures();
    try {
      const abortController = new AbortController();
      const stalled = createStallingStream(1);
      mockSendMessageStream.mockResolvedValue(stalled.stream);

      const { events, done } = runTurnCollecting(turn, abortController.signal);

      await stalled.stallEntered;
      abortController.abort();
      await done;

      expect(events).toStrictEqual([
        { type: AgentEventType.Content, value: 'part 1', traceId: undefined },
        { type: AgentEventType.UserCancelled },
      ]);

      stalled.rejectStalledRead(new Error('late provider failure'));
      await flushEventLoop();
      expect(events).toHaveLength(2);
      expect(singleCancelledEventCount(events)).toBe(1);
      expect(failures.captured).toHaveLength(0);
    } finally {
      failures.stop();
    }
  });

  it('abort wins the watchdog-active read without waiting for the inter-chunk guard to fire', async () => {
    turn = makeTurnWithConfig((key) =>
      key === 'stream-idle-timeout-ms' ? 30_000 : undefined,
    );

    const abortController = new AbortController();
    const stalled = createStallingStream(1);
    mockSendMessageStream.mockResolvedValue(stalled.stream);

    const { events, done } = runTurnCollecting(turn, abortController.signal);

    await stalled.stallEntered;
    // Real timers, deliberately NOT advanced: with the 30s inter-chunk guard
    // armed, completion can only come from the abort racing the pending
    // read. Had the watchdog fired instead, the terminal event would be
    // StreamIdleTimeout, not UserCancelled.
    abortController.abort();
    await done;

    expect(events).toStrictEqual([
      { type: AgentEventType.Content, value: 'part 1', traceId: undefined },
      { type: AgentEventType.UserCancelled },
    ]);
    expect(singleCancelledEventCount(events)).toBe(1);
  });

  it('aborts the first unbounded read when the watchdog is fully disabled', async () => {
    const failures = captureProcessFailures();
    try {
      turn = makeTurnWithConfig((key) =>
        key === 'stream-first-response-timeout-ms' ? 0 : undefined,
      );

      const abortController = new AbortController();
      const stalled = createStallingStream(0);
      mockSendMessageStream.mockResolvedValue(stalled.stream);

      const { events, done } = runTurnCollecting(turn, abortController.signal);

      await stalled.stallEntered;
      // First-response and inter-chunk guards are both disabled, so the very
      // first read is unbounded unless the turn races it against abort.
      abortController.abort();
      await done;

      expect(events).toStrictEqual([{ type: AgentEventType.UserCancelled }]);

      stalled.rejectStalledRead(new DOMException('Aborted', 'AbortError'));
      await flushEventLoop();
      expect(failures.captured).toHaveLength(0);
    } finally {
      failures.stop();
    }
  });

  it('aborts the default-config watchdog-active FIRST read with exactly one UserCancelled', async () => {
    const failures = captureProcessFailures();
    try {
      const abortController = new AbortController();
      // chunksBeforeStall 0: the very first next() never settles, so the
      // acquisition sits in the watchdog-active branch under the default
      // 5-minute first-response guard.
      const stalled = createStallingStream(0);
      mockSendMessageStream.mockResolvedValue(stalled.stream);

      const { events, done } = runTurnCollecting(turn, abortController.signal);

      await stalled.stallEntered;
      // No timers advance: with the first-response guard armed, only the
      // parent abort can settle the acquisition race.
      abortController.abort();
      await done;

      expect(events).toStrictEqual([{ type: AgentEventType.UserCancelled }]);
      expect(singleCancelledEventCount(events)).toBe(1);

      stalled.rejectStalledRead(new Error('late provider failure'));
      await flushEventLoop();
      expect(singleCancelledEventCount(events)).toBe(1);
      expect(failures.captured).toHaveLength(0);
    } finally {
      failures.stop();
    }
  });

  it('abort still settles when provider liveness disarms the first-response guard mid-acquisition', async () => {
    const abortController = new AbortController();
    const stalled = createStallingStream(0);
    mockSendMessageStream.mockImplementation(async (params) => {
      const config = params as {
        config?: { onStreamLiveness?: StreamLivenessListener };
      };
      // Liveness before any chunk disarms phase A; the inter-chunk guard
      // stays disabled under default config, so nothing but the parent
      // abort can ever settle the first read.
      config.config?.onStreamLiveness?.({
        sourceEvent: 'response.created',
        sseObserved: true,
      });
      return stalled.stream;
    });

    const { events, done } = runTurnCollecting(turn, abortController.signal);

    await stalled.stallEntered;
    abortController.abort();
    await done;

    expect(events).toStrictEqual([{ type: AgentEventType.UserCancelled }]);
    expect(singleCancelledEventCount(events)).toBe(1);
  });

  it('settles immediately when abort fires during acquisition, before the first read is raced', async () => {
    const failures = captureProcessFailures();
    try {
      const abortController = new AbortController();
      const stalled = createStallingStream(0);
      mockSendMessageStream.mockImplementation(async () => {
        // Cancel while the sendMessageStream handshake is still pending: the
        // very first read is never raced against anything, so only the
        // pre-aborted fast path inside raceReadWithAbort can settle the turn
        // (issue #3236 production window: user cancels before first chunk).
        abortController.abort();
        return stalled.stream;
      });

      const { events, done } = runTurnCollecting(turn, abortController.signal);
      await done;

      expect(events).toStrictEqual([{ type: AgentEventType.UserCancelled }]);
      expect(singleCancelledEventCount(events)).toBe(1);

      // The sunk first read settles late with a rejection: no unhandled
      // rejection, no additional events.
      await stalled.stallEntered;
      stalled.rejectStalledRead(new Error('late provider failure'));
      await flushEventLoop();
      expect(singleCancelledEventCount(events)).toBe(1);
      expect(failures.captured).toHaveLength(0);
    } finally {
      failures.stop();
    }
  });

  it('emits exactly one UserCancelled when the provider rejects the read right after abort wins', async () => {
    const failures = captureProcessFailures();
    try {
      const abortController = new AbortController();
      const stalled = createStallingStream(1);
      mockSendMessageStream.mockResolvedValue(stalled.stream);

      const { events, done } = runTurnCollecting(turn, abortController.signal);

      await stalled.stallEntered;
      abortController.abort();
      // The transport rejects the pending read a microtask after the abort
      // race wins — this must neither duplicate the terminal event nor
      // surface an error event.
      queueMicrotask(() =>
        stalled.rejectStalledRead(new DOMException('Aborted', 'AbortError')),
      );

      await done;

      expect(events).toStrictEqual([
        { type: AgentEventType.Content, value: 'part 1', traceId: undefined },
        { type: AgentEventType.UserCancelled },
      ]);
      await flushEventLoop();
      expect(failures.captured).toHaveLength(0);
    } finally {
      failures.stop();
    }
  });

  it('still closes the abort-ignoring iterator via return() after the abort race wins', async () => {
    const abortController = new AbortController();
    const stalled = createStallingStream(1);
    mockSendMessageStream.mockResolvedValue(stalled.stream);

    const { events, done } = runTurnCollecting(turn, abortController.signal);

    await stalled.stallEntered;
    abortController.abort();
    await done;

    expect(events).toContainEqual({ type: AgentEventType.UserCancelled });
    expect(stalled.returnSpy).toHaveBeenCalled();
  });

  it('a many-chunk stream still aborts with exactly one UserCancelled', async () => {
    const abortController = new AbortController();
    const stalled = createStallingStream(5);
    mockSendMessageStream.mockResolvedValue(stalled.stream);

    const { events, done } = runTurnCollecting(turn, abortController.signal);

    await stalled.stallEntered;
    abortController.abort();
    await done;

    expect(singleCancelledEventCount(events)).toBe(1);
    expect(
      events.filter((event) => event.type === AgentEventType.Content),
    ).toHaveLength(5);
    expect(events[events.length - 1]).toStrictEqual({
      type: AgentEventType.UserCancelled,
    });
  });

  it('a clean stream completes normally through the abort race', async () => {
    const abortController = new AbortController();
    const stalled = createStallingStream(3);
    mockSendMessageStream.mockResolvedValue(stalled.stream);

    const { events, done } = runTurnCollecting(turn, abortController.signal);

    await stalled.stallEntered;
    stalled.resolveStalledRead({ value: undefined, done: true });
    await done;

    expect(events).toStrictEqual([
      { type: AgentEventType.Content, value: 'part 1', traceId: undefined },
      { type: AgentEventType.Content, value: 'part 2', traceId: undefined },
      { type: AgentEventType.Content, value: 'part 3', traceId: undefined },
    ]);
    expect(singleCancelledEventCount(events)).toBe(0);
  });

  it('removes per-read abort listeners once a clean multi-chunk stream completes', async () => {
    const abortController = new AbortController();
    const instrumented = instrumentAbortListeners(abortController.signal);
    const stalled = createStallingStream(3);
    mockSendMessageStream.mockResolvedValue(stalled.stream);

    const { events, done } = runTurnCollecting(turn, abortController.signal);

    await stalled.stallEntered;
    // Reads 1-3 settled cleanly: only the turn's parent hook plus the ONE
    // listener for the in-flight read remain registered — earlier reads
    // removed theirs.
    expect(instrumented.pendingAbortListenerCount()).toBe(2);

    stalled.resolveStalledRead({ value: undefined, done: true });
    await done;

    expect(events).toHaveLength(3);
    expect(singleCancelledEventCount(events)).toBe(0);
    // Clean completion removed every 'abort' listener — no leak, even
    // though the signal never fired.
    expect(instrumented.pendingAbortListenerCount()).toBe(0);
  });
});
