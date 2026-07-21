/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for the two-phase first-response watchdog driven by
 * provider liveness (issue #2607). A raw lifecycle SSE signal (e.g.
 * response.created) proves the provider/transport is alive even before any
 * semantic IContent; observing it must disarm the default-on first-response
 * guard so a healthy reasoning stream is not killed for lacking first
 * semantic content.
 *
 * Modeled on turn.preRequestTimeout.test.ts (fake-timer + hoisted-mock
 * patterns). No mock theater: real Turn + real timers where feasible.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type {
  ServerAgentStreamEvent,
  ServerStreamIdleTimeoutEvent,
} from './turn.js';
import { Turn, AgentEventType, DEFAULT_AGENT_ID } from './turn.js';
import type { ChatSession } from './chatSession.js';
import { StreamEventType } from './chatSession.js';
import { type MockedChatInstance, mockChunk } from './turn-test-helpers.js';

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
      analyzeResponseOutcome: actual.analyzeResponseOutcome,
    };
  },
);

type Part = { text: string };

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
    'prompt-id-liveness',
    DEFAULT_AGENT_ID,
    'test',
  );
  mockGetHistory.mockReturnValue([]);
  return { turn, mockChatInstance };
}

function failsafe(ms: number): { promise: Promise<never>; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const promise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Test exceeded failsafe deadline of ${ms}ms`)),
      ms,
    );
  });
  promise.catch(() => {});
  return { promise, cancel: () => clearTimeout(timer) };
}

describe('Turn - provider-liveness two-phase watchdog (issue #2607)', () => {
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

  it('a provider liveness ping before the first-response threshold disarms phase A when inter-chunk idle is disabled (0)', async () => {
    // first-response guard is small (30ms); a liveness ping arrives at 10ms;
    // then semantic content arrives at 60ms (AFTER the 30ms first-response
    // bound would have fired). Because liveness disarmed phase A and idle=0
    // means phase B is unbounded, NO timeout fires.
    vi.useRealTimers();
    const { turn } = buildTurn(30, 0);

    let releaseLiveness!: () => void;
    const livenessGate = new Promise<void>((resolve) => {
      releaseLiveness = resolve;
    });
    let releaseContent!: () => void;
    const contentGate = new Promise<void>((resolve) => {
      releaseContent = resolve;
    });

    mockSendMessageStream.mockImplementation(
      (params: {
        config?: {
          onStreamLiveness?: (event: {
            sourceEvent: string;
            sseObserved: boolean;
          }) => void;
        };
      }) => {
        const listener = params.config?.onStreamLiveness;
        const stream = (async function* () {
          await new Promise((resolve) => setTimeout(resolve, 10));
          listener?.({ sourceEvent: 'response.created', sseObserved: true });
          releaseLiveness();
          await contentGate;
          yield {
            type: StreamEventType.CHUNK,
            value: mockChunk({ text: 'Hello' }),
          };
        })();
        return Promise.resolve(stream);
      },
    );

    const events: ServerAgentStreamEvent[] = [];
    const runPromise = (async () => {
      for await (const event of turn.run(
        [{ text: 'Hi' }] as unknown as Part[],
        new AbortController().signal,
      )) {
        events.push(event);
      }
    })();

    const guard = failsafe(2000);
    await Promise.race([livenessGate, guard.promise]);
    // Liveness observed at ~10ms. Wait until AFTER the 30ms first-response
    // bound would have fired, then release content.
    await new Promise((resolve) => setTimeout(resolve, 60));
    releaseContent();

    await Promise.race([runPromise, guard.promise]);
    guard.cancel();

    expect(
      events.find((e) => e.type === AgentEventType.StreamIdleTimeout),
    ).toBeUndefined();
    expect(events.some((e) => e.type === AgentEventType.Content)).toBe(true);
  });

  it('no liveness: a stalled first .next() still fires the default first-response timeout', async () => {
    // Confirms the default-on bound still fires when NO liveness and NO content
    // arrive (genuinely absent provider response stays bounded).
    const { turn } = buildTurn(20);

    mockSendMessageStream.mockResolvedValue(
      (async function* () {
        await new Promise<void>(() => {});
        yield {
          type: StreamEventType.CHUNK,
          value: mockChunk({ text: 'never' }),
        };
      })(),
    );

    const events: ServerAgentStreamEvent[] = [];
    const runPromise = (async () => {
      for await (const event of turn.run(
        [{ text: 'Hi' }] as unknown as Part[],
        new AbortController().signal,
      )) {
        events.push(event);
      }
    })();

    await vi.advanceTimersByTimeAsync(25);
    await vi.runAllTimersAsync();
    await runPromise;

    expect(
      events.find((e) => e.type === AgentEventType.StreamIdleTimeout),
    ).toBeDefined();
  });

  it('liveness observed then semantic content after DEFAULT_STREAM_FIRST_RESPONSE_TIMEOUT_MS does NOT fire', async () => {
    // The headline issue-2607 scenario: liveness disarms phase A; the model
    // thinks for a long time (longer than the original 300000ms bound) then
    // emits content. With idle=0 (default), this must NOT time out.
    vi.useRealTimers();
    // Use a tiny first-response env so the test is fast, but assert the
    // content arrives well after that bound thanks to liveness.
    process.env.LLXPRT_STREAM_FIRST_RESPONSE_TIMEOUT_MS = '50';

    const { turn } = buildTurn(undefined, 0);

    let releaseContent!: () => void;
    const contentGate = new Promise<void>((resolve) => {
      releaseContent = resolve;
    });

    mockSendMessageStream.mockImplementation(
      (params: {
        config?: {
          onStreamLiveness?: (event: {
            sourceEvent: string;
            sseObserved: boolean;
          }) => void;
        };
      }) => {
        const listener = params.config?.onStreamLiveness;
        const stream = (async function* () {
          await new Promise((resolve) => setTimeout(resolve, 5));
          listener?.({ sourceEvent: 'response.created', sseObserved: true });
          await contentGate;
          yield {
            type: StreamEventType.CHUNK,
            value: mockChunk({ text: 'Finally' }),
          };
        })();
        return Promise.resolve(stream);
      },
    );

    const events: ServerAgentStreamEvent[] = [];
    const runPromise = (async () => {
      for await (const event of turn.run(
        [{ text: 'Hi' }] as unknown as Part[],
        new AbortController().signal,
      )) {
        events.push(event);
      }
    })();

    // Wait well past the 50ms first-response bound, then release content.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(
      events.find((e) => e.type === AgentEventType.StreamIdleTimeout),
    ).toBeUndefined();
    releaseContent();

    const guard = failsafe(2000);
    await Promise.race([runPromise, guard.promise]);
    guard.cancel();

    expect(
      events.find((e) => e.type === AgentEventType.StreamIdleTimeout),
    ).toBeUndefined();
    expect(events.some((e) => e.type === AgentEventType.Content)).toBe(true);
  });

  it('opt-in post-liveness inter-chunk idle timeout DOES fire precisely after a liveness ping then silence', async () => {
    // Liveness disarms phase A, then phase B (inter-chunk idle) governs. With
    // a small idle timeout, a silence after liveness (no content) must fire.
    vi.useRealTimers();
    process.env.LLXPRT_STREAM_FIRST_RESPONSE_TIMEOUT_MS = '50';
    const { turn } = buildTurn(undefined, 40);

    mockSendMessageStream.mockImplementation(
      (params: {
        config?: {
          onStreamLiveness?: (event: {
            sourceEvent: string;
            sseObserved: boolean;
          }) => void;
        };
      }) => {
        const listener = params.config?.onStreamLiveness;
        const stream = (async function* () {
          await new Promise((resolve) => setTimeout(resolve, 5));
          listener?.({ sourceEvent: 'response.created', sseObserved: true });
          await new Promise<void>(() => {});
          yield {
            type: StreamEventType.CHUNK,
            value: mockChunk({ text: 'never' }),
          };
        })();
        return Promise.resolve(stream);
      },
    );

    const events: ServerAgentStreamEvent[] = [];
    const runPromise = (async () => {
      for await (const event of turn.run(
        [{ text: 'Hi' }] as unknown as Part[],
        new AbortController().signal,
      )) {
        events.push(event);
      }
    })();

    const guard = failsafe(2000);
    await Promise.race([runPromise, guard.promise]);
    guard.cancel();

    const timeoutEvents = events.filter(
      (event): event is ServerStreamIdleTimeoutEvent =>
        event.type === AgentEventType.StreamIdleTimeout,
    );
    expect(timeoutEvents).toHaveLength(1);
    expect(timeoutEvents[0].value.error.message).toContain(
      'Inter-chunk stream-idle',
    );
  });

  it('a second liveness ping rearms the phase B inter-chunk idle timer (rearm)', async () => {
    vi.useRealTimers();
    process.env.LLXPRT_STREAM_FIRST_RESPONSE_TIMEOUT_MS = '50';
    const { turn } = buildTurn(undefined, 60);

    let releaseContent!: () => void;
    const contentGate = new Promise<void>((resolve) => {
      releaseContent = resolve;
    });

    mockSendMessageStream.mockImplementation(
      (params: {
        config?: {
          onStreamLiveness?: (event: {
            sourceEvent: string;
            sseObserved: boolean;
          }) => void;
        };
      }) => {
        const listener = params.config?.onStreamLiveness;
        const stream = (async function* () {
          await new Promise((resolve) => setTimeout(resolve, 5));
          listener?.({ sourceEvent: 'response.created', sseObserved: true });
          // Wait 40ms (under the 60ms idle bound), then ping again (rearm).
          await new Promise((resolve) => setTimeout(resolve, 40));
          listener?.({
            sourceEvent: 'response.in_progress',
            sseObserved: true,
          });
          // Now wait for content release.
          await contentGate;
          yield {
            type: StreamEventType.CHUNK,
            value: mockChunk({ text: 'Hello' }),
          };
        })();
        return Promise.resolve(stream);
      },
    );

    const events: ServerAgentStreamEvent[] = [];
    const runPromise = (async () => {
      for await (const event of turn.run(
        [{ text: 'Hi' }] as unknown as Part[],
        new AbortController().signal,
      )) {
        events.push(event);
      }
    })();

    // After both pings (5 + 40 = 45ms), wait 50ms more (total 95ms). Without
    // rearm, the idle timer (armed at ~5ms, 60ms bound) would have fired at
    // ~65ms. With rearm at ~45ms, it would fire at ~105ms. Release content at
    // 80ms so it arrives before the rearmed bound.
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(
      events.find((e) => e.type === AgentEventType.StreamIdleTimeout),
    ).toBeUndefined();
    releaseContent();

    const guard = failsafe(2000);
    await Promise.race([runPromise, guard.promise]);
    guard.cancel();

    expect(
      events.find((e) => e.type === AgentEventType.StreamIdleTimeout),
    ).toBeUndefined();
    expect(events.some((e) => e.type === AgentEventType.Content)).toBe(true);
  });

  it('parent abort during a post-liveness wait yields UserCancelled, not a timeout', async () => {
    vi.useRealTimers();
    process.env.LLXPRT_STREAM_FIRST_RESPONSE_TIMEOUT_MS = '50';
    const { turn } = buildTurn(undefined, 60_000);

    const abortController = new AbortController();
    mockSendMessageStream.mockImplementation(
      (params: {
        config?: {
          abortSignal?: AbortSignal;
          onStreamLiveness?: (event: {
            sourceEvent: string;
            sseObserved: boolean;
          }) => void;
        };
      }) => {
        const providerSignal = params.config?.abortSignal;
        const listener = params.config?.onStreamLiveness;
        if (!(providerSignal instanceof AbortSignal)) {
          throw new Error('Test setup error: missing abortSignal');
        }
        const stream = (async function* () {
          await new Promise((resolve) => setTimeout(resolve, 5));
          listener?.({ sourceEvent: 'response.created', sseObserved: true });
          // Now block until the provider signal aborts.
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
    const runPromise = (async () => {
      for await (const event of turn.run(
        [{ text: 'Hi' }] as unknown as Part[],
        abortController.signal,
      )) {
        events.push(event);
      }
    })();

    await new Promise((resolve) => setTimeout(resolve, 20));
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

  it('a completed first turn does not leak its watchdog into a second turn (fresh timer per turn)', async () => {
    // The tool-continuation lifecycle invariant: each Turn.run arms a fresh
    // watchdog; a prior turn's liveness/timer state never carries over.
    vi.useRealTimers();
    process.env.LLXPRT_STREAM_FIRST_RESPONSE_TIMEOUT_MS = '50';

    const { turn } = buildTurn(undefined, 0);

    // A mock that emits a liveness ping after livenessDelay, then content after
    // an additional contentDelay. The listener is captured from the
    // sendMessageStream params so the Turn's onStreamLiveness callback is
    // actually invoked.
    const makeStreamImpl =
      (livenessDelay: number, contentDelay: number, text: string) =>
      (
        params: {
          config?: {
            onStreamLiveness?: (event: {
              sourceEvent: string;
              sseObserved: boolean;
            }) => void;
          };
        } | null,
      ) => {
        const listener = params?.config?.onStreamLiveness;
        const stream = (async function* () {
          await new Promise((resolve) => setTimeout(resolve, livenessDelay));
          listener?.({ sourceEvent: 'response.created', sseObserved: true });
          await new Promise((resolve) => setTimeout(resolve, contentDelay));
          yield {
            type: StreamEventType.CHUNK,
            value: mockChunk({ text }),
          };
        })();
        return Promise.resolve(stream);
      };

    // First turn: liveness at 5ms, content at 20ms.
    mockSendMessageStream.mockImplementationOnce(
      makeStreamImpl(5, 15, 'first'),
    );
    const firstEvents: ServerAgentStreamEvent[] = [];
    const firstRun = (async () => {
      for await (const event of turn.run(
        [{ text: 'Hi' }] as unknown as Part[],
        new AbortController().signal,
      )) {
        firstEvents.push(event);
      }
    })();
    const guard1 = failsafe(2000);
    await Promise.race([firstRun, guard1.promise]);
    guard1.cancel();
    expect(firstEvents.some((e) => e.type === AgentEventType.Content)).toBe(
      true,
    );

    // Second turn (continuation): liveness at 5ms, content at 200ms (AFTER the
    // 50ms first-response bound). If the first turn's watchdog leaked, this
    // would erroneously fire. A fresh watchdog armed at run-start, disarmed by
    // liveness at 5ms, allows the 200ms content.
    mockSendMessageStream.mockImplementationOnce(
      makeStreamImpl(5, 195, 'second'),
    );
    const secondEvents: ServerAgentStreamEvent[] = [];
    const secondRun = (async () => {
      for await (const event of turn.run(
        [{ text: 'again' }] as unknown as Part[],
        new AbortController().signal,
      )) {
        secondEvents.push(event);
      }
    })();
    const guard2 = failsafe(3000);
    await Promise.race([secondRun, guard2.promise]);
    guard2.cancel();

    expect(
      secondEvents.find((e) => e.type === AgentEventType.StreamIdleTimeout),
    ).toBeUndefined();
    expect(secondEvents.some((e) => e.type === AgentEventType.Content)).toBe(
      true,
    );
  });

  it('disabled path (first-response=0): liveness is never needed and content flows unbounded', async () => {
    vi.useRealTimers();
    const { turn } = buildTurn(0, 0);

    let releaseContent!: () => void;
    const contentGate = new Promise<void>((resolve) => {
      releaseContent = resolve;
    });

    mockSendMessageStream.mockImplementation(() => {
      const stream = (async function* () {
        await contentGate;
        yield {
          type: StreamEventType.CHUNK,
          value: mockChunk({ text: 'Finally' }),
        };
      })();
      return Promise.resolve(stream);
    });

    const events: ServerAgentStreamEvent[] = [];
    const runPromise = (async () => {
      for await (const event of turn.run(
        [{ text: 'Hi' }] as unknown as Part[],
        new AbortController().signal,
      )) {
        events.push(event);
      }
    })();

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(
      events.find((e) => e.type === AgentEventType.StreamIdleTimeout),
    ).toBeUndefined();
    releaseContent();

    const guard = failsafe(2000);
    await Promise.race([runPromise, guard.promise]);
    guard.cancel();

    expect(events.some((e) => e.type === AgentEventType.Content)).toBe(true);
  });

  it('diagnostics: a first-response timeout message identifies the guard, threshold, and config source', async () => {
    process.env.LLXPRT_STREAM_FIRST_RESPONSE_TIMEOUT_MS = '20';
    const { turn } = buildTurn();

    mockSendMessageStream.mockReturnValue(new Promise(() => {}));

    const events: ServerAgentStreamEvent[] = [];
    const runPromise = (async () => {
      for await (const event of turn.run(
        [{ text: 'Hi' }] as unknown as Part[],
        new AbortController().signal,
      )) {
        events.push(event);
      }
    })();

    await vi.advanceTimersByTimeAsync(25);
    await vi.runAllTimersAsync();
    await runPromise;

    const timeoutEvent = events.find(
      (e) => e.type === AgentEventType.StreamIdleTimeout,
    ) as { value: { error: { message: string } } } | undefined;

    expect(timeoutEvent).toBeDefined();
    expect(timeoutEvent?.value.error.message).toContain('First-response');
    expect(timeoutEvent?.value.error.message).toContain('threshold 20ms');
    expect(timeoutEvent?.value.error.message).toContain('from env');
  });

  it('diagnostics: an inter-chunk timeout message identifies the guard, threshold, and config source', async () => {
    const { turn } = buildTurn(0, 20);

    mockSendMessageStream.mockResolvedValue(
      (async function* () {
        yield {
          type: StreamEventType.CHUNK,
          value: mockChunk({ text: 'progress' }),
        };
        await new Promise<void>(() => {});
      })(),
    );

    const events: ServerAgentStreamEvent[] = [];
    const runPromise = (async () => {
      for await (const event of turn.run(
        [{ text: 'Hi' }] as unknown as Part[],
        new AbortController().signal,
      )) {
        events.push(event);
      }
    })();

    await vi.advanceTimersByTimeAsync(25);
    await vi.runAllTimersAsync();
    await runPromise;

    const timeoutEvent = events.find(
      (e) => e.type === AgentEventType.StreamIdleTimeout,
    ) as { value: { error: { message: string } } } | undefined;

    expect(timeoutEvent).toBeDefined();
    expect(timeoutEvent?.value.error.message).toContain(
      'Inter-chunk stream-idle',
    );
    expect(timeoutEvent?.value.error.message).toContain('threshold 20ms');
  });
});
