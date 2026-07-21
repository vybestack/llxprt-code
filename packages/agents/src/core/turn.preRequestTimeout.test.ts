/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ServerAgentStreamEvent, StructuredError } from './turn.js';
import { Turn, AgentEventType, DEFAULT_AGENT_ID } from './turn.js';
import type { ChatSession, StreamEvent } from './chatSession.js';
import { StreamEventType } from './chatSession.js';
import { type MockedChatInstance, mockChunk } from './turn-test-helpers.js';
import { DEFAULT_STREAM_FIRST_RESPONSE_TIMEOUT_MS } from '@vybestack/llxprt-code-core/utils/streamIdleTimeout.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { createRuntimeConfigStub } from '@vybestack/llxprt-code-core/test-utils/runtime.js';
import type {
  GenerateChatOptions,
  IProvider,
} from '@vybestack/llxprt-code-providers';
import {
  LoadBalancingProvider,
  ProviderManager,
} from '@vybestack/llxprt-code-providers';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';

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

type TurnStreamIterator = AsyncIterator<StreamEvent>;

/** A stream whose first .next() never resolves (acquisition resolves fine). */
function createStreamWithStalledFirstNext(): AsyncGenerator<StreamEvent> {
  return (async function* () {
    await new Promise<void>(() => {});
    yield { type: StreamEventType.CHUNK, value: mockChunk({ text: 'never' }) };
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
    await vi.advanceTimersByTimeAsync(
      DEFAULT_STREAM_FIRST_RESPONSE_TIMEOUT_MS - 1,
    );
    await Promise.resolve();
    expect(events).toHaveLength(0);
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

  it('prefers a provider 429 observed during retry over a racing first-response timeout', async () => {
    const { turn } = buildTurn(20);
    const rateLimitError: StructuredError = {
      message: 'Rate limited by provider',
      status: 429,
      category: 'rate_limit',
    };
    mockSendMessageStream.mockImplementation(
      (params: {
        config: {
          onProviderError: (error: StructuredError) => void;
        };
      }) =>
        Promise.resolve({
          [Symbol.asyncIterator]: () => ({
            next: () => {
              queueMicrotask(() =>
                params.config.onProviderError(rateLimitError),
              );
              return new Promise<IteratorResult<never>>(() => {});
            },
          }),
        }),
    );

    const events: ServerAgentStreamEvent[] = [];
    const runPromise = (async () => {
      for await (const event of turn.run(
        [{ text: 'Hi' }],
        new AbortController().signal,
      )) {
        events.push(event);
      }
    })();

    await vi.advanceTimersByTimeAsync(25);
    await vi.runAllTimersAsync();
    await runPromise;

    expect(events).toContainEqual({
      type: AgentEventType.Error,
      value: { error: rateLimitError },
    });
    expect(
      events.some((event) => event.type === AgentEventType.StreamIdleTimeout),
    ).toBe(false);
  });
  it('keeps observed provider failures scoped to one run', async () => {
    const { turn } = buildTurn(20);
    const rateLimitError: StructuredError = {
      message: 'First request was rate limited',
      status: 429,
      category: 'rate_limit',
    };
    mockSendMessageStream
      .mockImplementationOnce(
        (params: {
          config: {
            onProviderError: (error: StructuredError) => void;
          };
        }) => {
          params.config.onProviderError(rateLimitError);
          return Promise.resolve(createStreamWithStalledFirstNext());
        },
      )
      .mockResolvedValueOnce(createStreamWithStalledFirstNext());

    const firstEvents: ServerAgentStreamEvent[] = [];
    const firstRun = (async () => {
      for await (const event of turn.run(
        [{ text: 'first' }],
        new AbortController().signal,
      )) {
        firstEvents.push(event);
      }
    })();
    await vi.advanceTimersByTimeAsync(25);
    await vi.runAllTimersAsync();
    await firstRun;

    const secondEvents: ServerAgentStreamEvent[] = [];
    const secondRun = (async () => {
      for await (const event of turn.run(
        [{ text: 'second' }],
        new AbortController().signal,
      )) {
        secondEvents.push(event);
      }
    })();
    await vi.advanceTimersByTimeAsync(25);
    await vi.runAllTimersAsync();
    await secondRun;

    expect({ firstEvents, secondEvents }).toStrictEqual({
      firstEvents: [
        {
          type: AgentEventType.Error,
          value: { error: rateLimitError },
        },
      ],
      secondEvents: [
        {
          type: AgentEventType.StreamIdleTimeout,
          value: {
            error: {
              message:
                'First-response timeout: no response received within the allowed time (threshold 20ms) from stream-first-response-timeout-ms.',
              status: undefined,
            },
          },
        },
      ],
    });
  });

  it('retains an LB-observed 429 when the failover backend stalls until Turn timeout', async () => {
    const { turn } = buildTurn(20);
    const settings = new SettingsService();
    const providerConfig = createRuntimeConfigStub(settings);
    const providerManager = new ProviderManager({
      settingsService: settings,
      config: providerConfig,
    });
    providerManager.getProviderByName = (name: string) =>
      name === 'delegate' ? delegate : undefined;
    let transports = 0;
    let secondTransportStarted!: () => void;
    const secondTransport = new Promise<void>((resolve) => {
      secondTransportStarted = resolve;
    });
    const delegate: IProvider = {
      name: 'delegate',
      async *generateChatCompletion(
        options: GenerateChatOptions,
      ): AsyncGenerator<IContent> {
        transports++;
        if (transports === 1) {
          const error = new Error('provider rate limit') as Error & {
            status: number;
          };
          error.status = 429;
          throw error;
        }
        secondTransportStarted();
        const signal = options.metadata?.abortSignal;
        if (!(signal instanceof AbortSignal)) throw new Error('missing signal');
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true },
          );
        });
        yield* [];
      },
      getModels: async () => [],
      getDefaultModel: () => 'model',
      getServerTools: () => [],
      invokeServerTool: async () => undefined,
    };
    providerManager.registerProvider(delegate);
    const lb = new LoadBalancingProvider(
      {
        profileName: 'turn-timeout-lb',
        strategy: 'failover',
        subProfiles: [
          { name: 'first', providerName: 'delegate', modelId: 'model' },
          { name: 'second', providerName: 'delegate', modelId: 'model' },
        ],
        lbProfileEphemeralSettings: { timeout_ms: 0 },
      },
      providerManager,
    );
    mockSendMessageStream.mockImplementation(
      async (params: {
        config: {
          abortSignal: AbortSignal;
          onProviderError: (error: StructuredError) => void;
        };
      }) => {
        const source = lb.generateChatCompletion({
          contents: [],
          onProviderError: params.config.onProviderError,
          metadata: { abortSignal: params.config.abortSignal },
        });
        return (async function* () {
          for await (const _chunk of source) {
            yield {
              type: StreamEventType.CHUNK,
              value: mockChunk({ text: 'unexpected' }),
            };
          }
        })();
      },
    );

    const events: ServerAgentStreamEvent[] = [];
    const runPromise = (async () => {
      for await (const event of turn.run(
        [{ text: 'Hi' }],
        new AbortController().signal,
      )) {
        events.push(event);
      }
    })();
    await vi.advanceTimersByTimeAsync(0);
    await secondTransport;
    await vi.advanceTimersByTimeAsync(25);
    await vi.runAllTimersAsync();
    await runPromise;

    expect(transports).toBe(2);
    expect(events).toContainEqual({
      type: AgentEventType.Error,
      value: {
        error: expect.objectContaining({
          status: 429,
          category: 'rate_limit',
        }),
      },
    });
  });

  it('reports a genuine idle timeout after content instead of a stale observed 429', async () => {
    const { turn } = buildTurn(100, 20);
    const rateLimitError: StructuredError = {
      message: 'Transient provider rate limit',
      status: 429,
      category: 'rate_limit',
    };
    mockSendMessageStream.mockImplementation(
      (params: {
        config: { onProviderError: (error: StructuredError) => void };
      }) => {
        params.config.onProviderError(rateLimitError);
        return Promise.resolve(
          (async function* () {
            yield {
              type: StreamEventType.CHUNK,
              value: mockChunk({ text: 'progress' }),
            };
            await new Promise<void>(() => {});
          })(),
        );
      },
    );

    const events: ServerAgentStreamEvent[] = [];
    const runPromise = (async () => {
      for await (const event of turn.run(
        [{ text: 'Hi' }],
        new AbortController().signal,
      )) {
        events.push(event);
      }
    })();

    await vi.advanceTimersByTimeAsync(25);
    await vi.runAllTimersAsync();
    await runPromise;

    expect(events.some((event) => event.type === AgentEventType.Content)).toBe(
      true,
    );
    expect(events.at(-1)?.type).toBe(AgentEventType.StreamIdleTimeout);
    expect(
      events.some(
        (event) =>
          event.type === AgentEventType.Error &&
          event.value.error.status === 429,
      ),
    ).toBe(false);
  });

  it('resource cleanup: when the timeout wins but the first .next() resolves LATE, the acquired iterator is closed (no provider connection leak)', async () => {
    const { turn } = buildTurn(20);
    let releaseFirstNext!: () => void;
    const firstNextGate = new Promise<void>((resolve) => {
      releaseFirstNext = resolve;
    });
    let signalReturnCalled!: () => void;
    const returnCalledPromise = new Promise<void>((resolve) => {
      signalReturnCalled = resolve;
    });
    const cleanup = { returnCalled: false };
    const leakyIterator: TurnStreamIterator = {
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
    await vi.advanceTimersByTimeAsync(25);
    await vi.runAllTimersAsync();
    await runPromise;
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

  it('invokes iterator return promptly when first next never settles', async () => {
    const { turn } = buildTurn(20);
    let returnCalls = 0;
    const iterator: TurnStreamIterator = {
      next: () => new Promise(() => {}),
      async return() {
        returnCalls++;
        return { done: true, value: undefined };
      },
    };
    mockSendMessageStream.mockResolvedValue({
      [Symbol.asyncIterator]: () => iterator,
    });

    const events: ServerAgentStreamEvent[] = [];
    const runPromise = (async () => {
      for await (const event of turn.run(
        [{ text: 'Hi' }],
        new AbortController().signal,
      )) {
        events.push(event);
      }
    })();

    await vi.advanceTimersByTimeAsync(25);
    await vi.runAllTimersAsync();
    await runPromise;

    expect(returnCalls).toBe(1);
    expect(events.at(-1)?.type).toBe(AgentEventType.StreamIdleTimeout);
  });

  it('late acquisition cleanup: timeout wins BEFORE acquisition completes and iterator hangs in next() → return() called on acquisition (issue #2607 finding A)', async () => {
    const { turn } = buildTurn(20);
    let releaseAcquisition!: () => void;
    const acquisitionGate = new Promise<void>((resolve) => {
      releaseAcquisition = resolve;
    });
    let signalReturnCalled!: () => void;
    const returnCalledPromise = new Promise<void>((resolve) => {
      signalReturnCalled = resolve;
    });
    const cleanup = { returnCalled: false };
    const iterator: TurnStreamIterator = {
      next: () => new Promise<IteratorResult<never>>(() => {}),
      async return() {
        cleanup.returnCalled = true;
        signalReturnCalled();
        return { done: true, value: undefined };
      },
    };
    mockSendMessageStream.mockImplementation(() =>
      acquisitionGate.then(() => ({ [Symbol.asyncIterator]: () => iterator })),
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
    releaseAcquisition();
    const guard = failsafe(2000);
    await Promise.race([returnCalledPromise, guard.promise]);
    guard.cancel();
    expect(cleanup.returnCalled).toBe(true);
    expect(events.at(-1)?.type).toBe(AgentEventType.StreamIdleTimeout);
  });

  it('first non-semantic RETRY does not disarm first-response guard: never-resolving next() still emits First-response StreamIdleTimeout (issue #2607 finding B)', async () => {
    const { turn } = buildTurn(20, 0);
    let firstNextTaken = false;
    const iterator: TurnStreamIterator = {
      next: () => {
        if (!firstNextTaken) {
          firstNextTaken = true;
          return Promise.resolve({
            done: false,
            value: { type: StreamEventType.RETRY },
          });
        }
        return new Promise<IteratorResult<never>>(() => {});
      },
      async return() {
        return { done: true, value: undefined };
      },
    };
    mockSendMessageStream.mockResolvedValue({
      [Symbol.asyncIterator]: () => iterator,
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
    await vi.advanceTimersByTimeAsync(25);
    await vi.runAllTimersAsync();
    await runPromise;
    const timeoutEvent = events.find(
      (e) => e.type === AgentEventType.StreamIdleTimeout,
    );
    expect(timeoutEvent).toBeDefined();
    expect(timeoutEvent?.value.error.message).toContain('First-response');
  });

  it('resource cleanup (disabled path): when first-response is DISABLED (0) and the first .next() throws, the acquired iterator is closed (no leak)', async () => {
    const { turn } = buildTurn(0);

    let returnCalled = false;
    const firstNextFailure = Object.assign(new Error('first next failed'), {
      status: 502,
      category: 'server_error',
    });
    const cleanupFailure = Object.assign(new Error('cleanup failed'), {
      status: 504,
      category: 'network',
    });
    const throwingIterator: TurnStreamIterator = {
      async next(): Promise<never> {
        throw firstNextFailure;
      },
      async return() {
        returnCalled = true;
        throw cleanupFailure;
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
    expect(returnCalled).toBe(true);
    expect(events).toContainEqual({
      type: AgentEventType.Error,
      value: {
        error: expect.objectContaining({
          status: 502,
          category: 'server_error',
        }),
      },
    });
    expect(
      events.some(
        (event) =>
          event.type === AgentEventType.Error &&
          event.value.error.status === 504,
      ),
    ).toBe(false);
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
    vi.useRealTimers();
    const { turn } = buildTurn(30);
    const mockResponseStream = (async function* () {
      await new Promise((resolve) => setTimeout(resolve, 10));
      yield { type: StreamEventType.CHUNK, value: mockChunk({ text: 'Hel' }) };
      await new Promise((resolve) => setTimeout(resolve, 60));
      yield { type: StreamEventType.CHUNK, value: mockChunk({ text: 'lo' }) };
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
    // REAL timers + LARGE first-response timeout (60s) so only parent-abort can
    // unblock the wait via the provider abortSignal.
    vi.useRealTimers();
    const { turn } = buildTurn(60_000);

    mockSendMessageStream.mockImplementation(
      (params: { config: { abortSignal: AbortSignal } }) => {
        const providerSignal = params.config.abortSignal;
        if (!(providerSignal instanceof AbortSignal)) {
          throw new Error('sendMessageStream missing config.abortSignal');
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
              {
                once: true,
              },
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

    // Let the generator reach the first-response wait before aborting.
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
