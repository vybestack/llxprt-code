/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  advanceTimersByTimeAsync,
  runAllTimersAsync,
} from '@vybestack/llxprt-code-test-utils';
import { describe, it, expect, vi, beforeEach, afterEach } from 'bun:test';
import type { ServerAgentStreamEvent } from './turn.js';
import { Turn, AgentEventType, DEFAULT_AGENT_ID } from './turn.js';
import type { ChatSession } from './chatSession.js';
import { StreamEventType } from './chatSession.js';
import type { ContentBlock } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { type MockedChatInstance, mockChunk } from './turn-test-helpers.js';
import {
  waitForCondition,
  waitForConditionInRealTime,
  delayRealTime,
} from '../test-utils/eventLoop.js';

const { mockSendMessageStream, mockGetHistory } = {
  mockSendMessageStream: vi.fn(),
  mockGetHistory: vi.fn(),
};

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

describe('Turn - stream idle timeout behavioral tests', () => {
  let turn: Turn;
  let mockChatInstance: MockedChatInstance;
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    process.env = { ...originalEnv };
    delete process.env.LLXPRT_STREAM_IDLE_TIMEOUT_MS;
    delete process.env.LLXPRT_STREAM_FIRST_RESPONSE_TIMEOUT_MS;
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
    vi.useRealTimers();
    vi.restoreAllMocks();
    process.env = originalEnv;
  });

  it('honors config setting: timeout fires after custom timeout value from getConfig()', async () => {
    const customTimeoutMs = 30_000;
    const mockGetConfig = vi.fn().mockReturnValue({
      getEphemeralSetting: (key: string) => {
        if (key === 'stream-idle-timeout-ms') {
          return customTimeoutMs;
        }
        // Disable the first-response watchdog so this test isolates the
        // inter-chunk idle watchdog (the first chunk arrives immediately,
        // then an inter-chunk gap exceeds the timeout).
        if (key === 'stream-first-response-timeout-ms') {
          return 0;
        }
        return undefined;
      },
    });

    mockChatInstance = {
      sendMessageStream: mockSendMessageStream,
      getHistory: mockGetHistory,
      getConfig: mockGetConfig,
    } as unknown as MockedChatInstance;

    turn = new Turn(
      mockChatInstance as unknown as ChatSession,
      'prompt-id-1',
      DEFAULT_AGENT_ID,
      'test',
    );
    mockGetHistory.mockReturnValue([]);

    // Controllable gate: the generator pauses until the gate resolves,
    // modeling a finite inter-chunk gap. The test resolves the gate after
    // the idle timeout fires to verify the late output is suppressed.
    let resolveGate: () => void;
    const gate = new Promise<void>((resolve) => {
      resolveGate = resolve;
    });

    const mockResponseStream = (async function* () {
      yield {
        type: StreamEventType.CHUNK,
        value: mockChunk({ text: 'First chunk' }),
      };
      // Inter-chunk gap that exceeds the 30s inter-chunk idle timeout.
      await gate;
      yield {
        type: StreamEventType.CHUNK,
        value: mockChunk({ text: 'Late response' }),
      };
    })();
    mockSendMessageStream.mockResolvedValue(mockResponseStream);

    const events: ServerAgentStreamEvent[] = [];
    const reqParts: ContentBlock[] = [{ type: 'text', text: 'Hi' }];
    const signal = new AbortController().signal;

    const iterator = turn.run(reqParts, signal);
    const runPromise = (async () => {
      for await (const event of iterator) {
        events.push(event);
      }
    })();

    // Let the consumer process the first chunk through Turn.run's internal
    // pipeline before advancing fake time.
    expect(await waitForCondition(() => events.length >= 1)).toBe(true);
    vi.advanceTimersByTime(29_999);
    // First chunk arrived immediately (Content), but the inter-chunk idle
    // timeout (30s gap before the second chunk) has not yet elapsed.
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe(AgentEventType.Content);

    await advanceTimersByTimeAsync(2);

    await runAllTimersAsync();
    await runPromise;

    const timeoutEvent = events.find(
      (e) => e.type === AgentEventType.StreamIdleTimeout,
    );
    expect(timeoutEvent).toBeDefined();
    // The late "Late response" chunk must NOT appear — the iterator cleans up
    // after the idle timeout so the gate resolution is harmless but the late
    // output is suppressed.
    resolveGate!();
    // `runPromise` has already resolved (the idle timeout ended the iterator),
    // so a microtask turn is enough for the gate resolution to propagate.
    await Promise.resolve();
    expect(events).not.toContainEqual(
      expect.objectContaining({ value: 'Late response' }),
    );
    expect(mockGetConfig).toHaveBeenCalled();
  });

  it('honors config setting: no timeout when iterator yields within custom timeout', async () => {
    const customTimeoutMs = 30_000;
    const mockGetConfig = vi.fn().mockReturnValue({
      getEphemeralSetting: (key: string) => {
        if (key === 'stream-idle-timeout-ms') {
          return customTimeoutMs;
        }
        return undefined;
      },
    });

    mockChatInstance = {
      sendMessageStream: mockSendMessageStream,
      getHistory: mockGetHistory,
      getConfig: mockGetConfig,
    } as unknown as MockedChatInstance;

    turn = new Turn(
      mockChatInstance as unknown as ChatSession,
      'prompt-id-1',
      DEFAULT_AGENT_ID,
      'test',
    );
    mockGetHistory.mockReturnValue([]);

    const mockResponseStream = (async function* () {
      yield {
        type: StreamEventType.CHUNK,
        value: mockChunk({ text: 'Fast response' }),
      };
    })();
    mockSendMessageStream.mockResolvedValue(mockResponseStream);

    const events: ServerAgentStreamEvent[] = [];
    const reqParts: ContentBlock[] = [{ type: 'text', text: 'Hi' }];
    const signal = new AbortController().signal;

    for await (const event of turn.run(reqParts, signal)) {
      events.push(event);
    }

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe(AgentEventType.Content);
    expect((events[0] as { value: string }).value).toBe('Fast response');
  });

  it('disabled path: no timeout when setting is 0, even after 30 minutes', async () => {
    const mockGetConfig = vi.fn().mockReturnValue({
      getEphemeralSetting: (key: string) => {
        if (key === 'stream-idle-timeout-ms') {
          return 0;
        }
        // Also disable the first-response watchdog so this test isolates the
        // inter-chunk-disabled path (a stream whose first chunk is delayed
        // must not time out when both watchdogs are disabled).
        if (key === 'stream-first-response-timeout-ms') {
          return 0;
        }
        return undefined;
      },
    });

    mockChatInstance = {
      sendMessageStream: mockSendMessageStream,
      getHistory: mockGetHistory,
      getConfig: mockGetConfig,
    } as unknown as MockedChatInstance;

    turn = new Turn(
      mockChatInstance as unknown as ChatSession,
      'prompt-id-1',
      DEFAULT_AGENT_ID,
      'test',
    );
    mockGetHistory.mockReturnValue([]);

    let resolveIterator: () => void;
    let iteratorEntered = false;
    const iteratorPromise = new Promise<void>((resolve) => {
      resolveIterator = resolve;
    });

    const mockResponseStream = (async function* () {
      iteratorEntered = true;
      await iteratorPromise;
      yield {
        type: StreamEventType.CHUNK,
        value: mockChunk({ text: 'Finally' }),
      };
    })();
    mockSendMessageStream.mockResolvedValue(mockResponseStream);

    const events: ServerAgentStreamEvent[] = [];
    const reqParts: ContentBlock[] = [{ type: 'text', text: 'Hi' }];
    const abortController = new AbortController();

    const runPromise = (async () => {
      for await (const event of turn.run(reqParts, abortController.signal)) {
        events.push(event);
      }
    })();

    // The consumer must actually be parked inside the stream before the clock
    // moves, otherwise the advance races the pipeline start. A real event-loop
    // yield is only reliable while the fake clock is still, so it has to happen
    // here rather than after the advance.
    expect(await waitForCondition(() => iteratorEntered)).toBe(true);

    // Advance synchronously. The async variant drains the promise chain as it
    // steps, and this stream is deliberately parked on a promise that never
    // settles, which hangs it on Linux. Nothing is expected to fire here, so
    // there is no timer continuation to wait for.
    vi.advanceTimersByTime(30 * 60 * 1000);

    expect(
      events.find((e) => e.type === AgentEventType.StreamIdleTimeout),
    ).toBeUndefined();

    // Hand the completion phase back to real timers and give it genuine
    // event-loop ticks. `runAllTimersAsync` must not be used here — it never
    // returns under Bun on Linux for this pipeline.
    vi.useRealTimers();
    resolveIterator!();
    await delayRealTime(10);
    await runPromise;

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe(AgentEventType.Content);
  });

  it('env var precedence: env var overrides config setting', async () => {
    // Real timers with small real durations. Bun's fake timers deadlock when
    // this pipeline is drained to completion, and the behaviour under test is
    // "which of the two configured durations is used", which does not need a
    // fake clock: the config value is two orders of magnitude larger, so only
    // the env-driven one can fire inside the wait below.
    vi.useRealTimers();
    const envTimeoutMs = 50;
    const configTimeoutMs = 20_000;

    process.env.LLXPRT_STREAM_IDLE_TIMEOUT_MS = String(envTimeoutMs);

    const mockGetConfig = vi.fn().mockReturnValue({
      getEphemeralSetting: (key: string) => {
        if (key === 'stream-idle-timeout-ms') {
          return configTimeoutMs;
        }
        // Disable the first-response watchdog so this test isolates the
        // inter-chunk idle env-var precedence (first chunk arrives fast,
        // then an inter-chunk gap exceeds the env-driven inter-chunk timeout).
        if (key === 'stream-first-response-timeout-ms') {
          return 0;
        }
        return undefined;
      },
    });

    mockChatInstance = {
      sendMessageStream: mockSendMessageStream,
      getHistory: mockGetHistory,
      getConfig: mockGetConfig,
    } as unknown as MockedChatInstance;

    turn = new Turn(
      mockChatInstance as unknown as ChatSession,
      'prompt-id-1',
      DEFAULT_AGENT_ID,
      'test',
    );
    mockGetHistory.mockReturnValue([]);

    // The inter-chunk gap is a stall the test releases, not a promise that
    // never settles. An async generator suspended on an await that never
    // resolves cannot be returned, so the consuming `for await` could never
    // unwind and the run would hang even after the watchdog fired.
    let gapReached = false;
    let releaseGap: () => void;
    const gapPromise = new Promise<void>((resolve) => {
      releaseGap = resolve;
    });
    const mockResponseStream = (async function* () {
      yield {
        type: StreamEventType.CHUNK,
        value: mockChunk({ text: 'First chunk' }),
      };
      gapReached = true;
      // Inter-chunk gap exceeding the env-driven timeout: the stream produces
      // nothing until the test releases it, so the watchdog must fire first.
      await gapPromise;
      yield {
        type: StreamEventType.CHUNK,
        value: mockChunk({ text: 'Late response' }),
      };
    })();
    mockSendMessageStream.mockResolvedValue(mockResponseStream);

    const events: ServerAgentStreamEvent[] = [];
    const reqParts: ContentBlock[] = [{ type: 'text', text: 'Hi' }];
    const signal = new AbortController().signal;

    let runSettled = false;
    const runPromise = (async () => {
      for await (const event of turn.run(reqParts, signal)) {
        events.push(event);
      }
    })().finally(() => {
      runSettled = true;
    });

    // Let the pipeline start on real event-loop ticks before waiting on it.
    await delayRealTime(10);

    // The stream stalls after its first chunk, so the env-driven 50ms watchdog
    // fires. Were the 20s config value being used instead, no timeout event
    // would arrive and this wait would fail.
    expect(await waitForConditionInRealTime(() => gapReached)).toBe(true);
    expect(
      await waitForConditionInRealTime(() =>
        events.some((e) => e.type === AgentEventType.StreamIdleTimeout),
      ),
    ).toBe(true);

    // Release the stall so the generator can unwind, then let the run finish.
    // The real-timer delay is load-bearing: unwinding needs genuine event-loop
    // ticks, and a microtask or setImmediate yield alone was not enough on the
    // CI runner — the run simply never settled.
    releaseGap!();
    await delayRealTime(10);
    await runPromise;
    expect(runSettled).toBe(true);
  });

  it('default-off: no watchdog timer when no env var and no ephemeral setting', async () => {
    delete process.env.LLXPRT_STREAM_IDLE_TIMEOUT_MS;

    const mockGetConfig = vi.fn().mockReturnValue({
      getEphemeralSetting: (key: string) => {
        if (key === 'stream-idle-timeout-ms') {
          return undefined;
        }
        // Explicitly disable the first-response watchdog so this test isolates
        // the inter-chunk default-off contract. (By default first-response is
        // ON at 5 min; disabling it here lets the stream's delayed first chunk
        // flow unbounded, which is what the inter-chunk default-off path tests.)
        if (key === 'stream-first-response-timeout-ms') {
          return 0;
        }
        return undefined;
      },
    });

    mockChatInstance = {
      sendMessageStream: mockSendMessageStream,
      getHistory: mockGetHistory,
      getConfig: mockGetConfig,
    } as unknown as MockedChatInstance;

    turn = new Turn(
      mockChatInstance as unknown as ChatSession,
      'prompt-id-1',
      DEFAULT_AGENT_ID,
      'test',
    );
    mockGetHistory.mockReturnValue([]);

    let resolveIterator: () => void;
    let iteratorEntered = false;
    const iteratorPromise = new Promise<void>((resolve) => {
      resolveIterator = resolve;
    });

    const mockResponseStream = (async function* () {
      iteratorEntered = true;
      await iteratorPromise;
      yield {
        type: StreamEventType.CHUNK,
        value: mockChunk({ text: 'Finally' }),
      };
    })();
    mockSendMessageStream.mockResolvedValue(mockResponseStream);

    const events: ServerAgentStreamEvent[] = [];
    const reqParts: ContentBlock[] = [{ type: 'text', text: 'Hi' }];
    const abortController = new AbortController();

    let runSettled = false;
    const runPromise = (async () => {
      for await (const event of turn.run(reqParts, abortController.signal)) {
        events.push(event);
      }
    })().finally(() => {
      runSettled = true;
    });

    // Park inside the stream before the clock moves; a real event-loop yield is
    // only reliable while the fake clock is still.
    expect(await waitForCondition(() => iteratorEntered)).toBe(true);

    // The core assertion: with neither source configuring a duration, no
    // watchdog timer is registered at all, which the fake clock's timer count
    // exposes directly.
    //
    // Fake timers are installed here rather than relied on from beforeEach: an
    // earlier test in this file switches to real timers, and under Bun the
    // beforeEach call does not re-arm them, so getTimerCount would throw
    // "Fake timers are not active" — which then left the stalled stream
    // unreleased and hung the run.
    vi.useFakeTimers();
    expect(vi.getTimerCount()).toBe(0);

    // Then hold the stall open in real time to show nothing fires. The fake
    // clock is not used for this: draining the pipeline to completion under
    // Bun's fake timers deadlocks.
    vi.useRealTimers();
    await delayRealTime(250);

    expect(
      events.find((e) => e.type === AgentEventType.StreamIdleTimeout),
    ).toBeUndefined();
    expect(runSettled).toBe(false);

    // The real-timer delay is load-bearing: delivering the chunk and unwinding
    // need genuine event-loop ticks, and a microtask or setImmediate yield
    // alone was not enough on the CI runner.
    resolveIterator!();
    await delayRealTime(10);
    await runPromise;

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe(AgentEventType.Content);
  });
});
