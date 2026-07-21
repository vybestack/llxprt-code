/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for the whole-stream watchdog and run-scoped isolation
 * (issue #2607 findings 2, 3, 5). Extracted from turn.liveness.test.ts to
 * stay under the max-lines lint limit. These tests exercise real Turn + real
 * timers against mocked sendMessageStream boundaries — no mock interaction
 * assertions.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ServerAgentStreamEvent } from './turn.js';
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
    'prompt-id-watchdog',
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

describe('Turn - whole-stream watchdog & run-scoped isolation (issue #2607)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetAllMocks();
    process.env = { ...originalEnv };
    delete process.env.LLXPRT_STREAM_FIRST_RESPONSE_TIMEOUT_MS;
    delete process.env.LLXPRT_STREAM_IDLE_TIMEOUT_MS;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = originalEnv;
  });

  it('whole-stream liveness: first content, repeated liveness pings spanning longer than idle threshold, then more content => NO timeout', async () => {
    vi.useRealTimers();
    process.env.LLXPRT_STREAM_FIRST_RESPONSE_TIMEOUT_MS = '200';
    const { turn } = buildTurn(undefined, 30);

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
          yield {
            type: StreamEventType.CHUNK,
            value: mockChunk({ text: 'first' }),
          };
          for (let i = 0; i < 8; i++) {
            await new Promise((resolve) => setTimeout(resolve, 10));
            listener?.({
              sourceEvent: 'response.in_progress',
              sseObserved: true,
            });
          }
          yield {
            type: StreamEventType.CHUNK,
            value: mockChunk({ text: 'second' }),
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

    const guard = failsafe(3000);
    await Promise.race([runPromise, guard.promise]);
    guard.cancel();

    expect(
      events.find((e) => e.type === AgentEventType.StreamIdleTimeout),
    ).toBeUndefined();
    const contentEvents = events.filter(
      (e) => e.type === AgentEventType.Content,
    );
    expect(contentEvents.length).toBeGreaterThanOrEqual(2);
  });

  it('whole-stream liveness: after pings stop for the idle threshold => precise inter-chunk timeout', async () => {
    vi.useRealTimers();
    process.env.LLXPRT_STREAM_FIRST_RESPONSE_TIMEOUT_MS = '1000';
    const { turn } = buildTurn(undefined, 200);

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
          yield {
            type: StreamEventType.CHUNK,
            value: mockChunk({ text: 'first' }),
          };
          for (let i = 0; i < 3; i++) {
            await new Promise((resolve) => setTimeout(resolve, 20));
            listener?.({
              sourceEvent: 'response.in_progress',
              sseObserved: true,
            });
          }
          await new Promise<void>(() => {});
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

    const guard = failsafe(3000);
    await Promise.race([runPromise, guard.promise]);
    guard.cancel();

    expect(
      events.find((e) => e.type === AgentEventType.StreamIdleTimeout),
    ).toBeDefined();
  });

  it('two overlapping run calls cannot cross-contaminate timeout/source values (run-scoped isolation)', async () => {
    vi.useRealTimers();
    process.env.LLXPRT_STREAM_FIRST_RESPONSE_TIMEOUT_MS = '500';
    const { turn } = buildTurn(undefined, 60);

    let releaseB!: () => void;
    const gateB = new Promise<void>((resolve) => {
      releaseB = resolve;
    });
    const gateA = new Promise<void>(() => {});

    mockSendMessageStream.mockImplementationOnce(
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
          await gateA;
          yield {
            type: StreamEventType.CHUNK,
            value: mockChunk({ text: 'A' }),
          };
        })();
        return Promise.resolve(stream);
      },
    );

    mockSendMessageStream.mockImplementationOnce(
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
          await gateB;
          yield {
            type: StreamEventType.CHUNK,
            value: mockChunk({ text: 'B' }),
          };
        })();
        return Promise.resolve(stream);
      },
    );

    const eventsA: ServerAgentStreamEvent[] = [];
    const eventsB: ServerAgentStreamEvent[] = [];

    const runA = (async () => {
      for await (const event of turn.run(
        [{ text: 'A' }] as unknown as Part[],
        new AbortController().signal,
      )) {
        eventsA.push(event);
      }
    })();

    await new Promise((resolve) => setTimeout(resolve, 20));

    const runB = (async () => {
      for await (const event of turn.run(
        [{ text: 'B' }] as unknown as Part[],
        new AbortController().signal,
      )) {
        eventsB.push(event);
      }
    })();

    const guard = failsafe(3000);
    await Promise.race([runA, guard.promise]);
    guard.cancel();

    expect(
      eventsA.find((e) => e.type === AgentEventType.StreamIdleTimeout),
    ).toBeDefined();

    releaseB();
    const guard2 = failsafe(3000);
    await Promise.race([runB, guard2.promise]);
    guard2.cancel();

    expect(
      eventsB.find((e) => e.type === AgentEventType.StreamIdleTimeout),
    ).toBeUndefined();
    expect(eventsB.some((e) => e.type === AgentEventType.Content)).toBe(true);
  });

  it('tool lifecycle: tool call → completed result → continuation with liveness before delayed content does NOT false-timeout (issue #2607 finding 5)', async () => {
    vi.useRealTimers();
    process.env.LLXPRT_STREAM_FIRST_RESPONSE_TIMEOUT_MS = '50';
    const { turn } = buildTurn(undefined, 0);

    mockSendMessageStream.mockImplementationOnce(() => {
      const stream = (async function* () {
        yield {
          type: StreamEventType.CHUNK,
          value: mockChunk({
            toolCalls: [
              {
                id: 'call_1',
                name: 'run_shell_command',
                args: { command: 'echo hi' },
              },
            ],
            finishReason: 'tool_calls',
          }),
        };
      })();
      return Promise.resolve(stream);
    });

    mockSendMessageStream.mockImplementationOnce(
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
          await new Promise((resolve) => setTimeout(resolve, 5));
          listener?.({ sourceEvent: 'response.created', sseObserved: true });
          await new Promise((resolve) => setTimeout(resolve, 195));
          yield {
            type: StreamEventType.CHUNK,
            value: mockChunk({ text: 'continuation result' }),
          };
        })();
        return Promise.resolve(stream);
      },
    );

    const firstEvents: ServerAgentStreamEvent[] = [];
    const firstRun = (async () => {
      for await (const event of turn.run(
        [{ text: 'do something' }] as unknown as Part[],
        new AbortController().signal,
      )) {
        firstEvents.push(event);
      }
    })();
    const guard1 = failsafe(2000);
    await Promise.race([firstRun, guard1.promise]);
    guard1.cancel();

    expect(
      firstEvents.some((e) => e.type === AgentEventType.ToolCallRequest),
    ).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 100));

    const secondEvents: ServerAgentStreamEvent[] = [];
    const secondRun = (async () => {
      for await (const event of turn.run(
        [{ text: 'tool result' }] as unknown as Part[],
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
});
