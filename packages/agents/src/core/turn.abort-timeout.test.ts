/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ServerAgentStreamEvent } from './turn.js';
import { Turn, AgentEventType, DEFAULT_AGENT_ID } from './turn.js';
import { reportError } from '@vybestack/llxprt-code-core/utils/errorReporting.js';
import type { ChatSession } from './chatSession.js';
import { StreamEventType } from './chatSession.js';
import type { ContentBlock } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { type MockedChatInstance, mockChunk } from './turn-test-helpers.js';

const { mockSendMessageStream, mockGetHistory } = vi.hoisted(() => ({
  mockSendMessageStream: vi.fn(),
  mockGetHistory: vi.fn(),
}));

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

      await vi.advanceTimersByTimeAsync(100);
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

      await vi.advanceTimersByTimeAsync(testTimeoutMs + 1);
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
