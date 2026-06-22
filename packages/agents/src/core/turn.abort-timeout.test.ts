/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ServerGeminiStreamEvent } from './turn.js';
import { Turn, GeminiEventType, DEFAULT_AGENT_ID } from './turn.js';
import type { GenerateContentResponse, Part } from '@google/genai';
import { reportError } from '@vybestack/llxprt-code-core/utils/errorReporting.js';
import type { ChatSession } from './chatSession.js';
import { StreamEventType } from './chatSession.js';
import { type MockedChatInstance } from './turn-test-helpers.js';

const { mockSendMessageStream, mockGetHistory } = vi.hoisted(() => ({
  mockSendMessageStream: vi.fn(),
  mockGetHistory: vi.fn(),
}));

vi.mock('@google/genai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@google/genai')>();
  const MockChat = vi.fn().mockImplementation(() => ({
    sendMessageStream: mockSendMessageStream,
    getHistory: mockGetHistory,
  }));
  return {
    ...actual,
    Chat: MockChat,
  };
});

vi.mock('@vybestack/llxprt-code-core/utils/errorReporting.js', () => ({
  reportError: vi.fn(),
}));

vi.mock(
  '@vybestack/llxprt-code-core/utils/generateContentResponseUtilities.js',
  () => ({
    getResponseText: (resp: GenerateContentResponse) =>
      resp.candidates?.[0]?.content?.parts
        ?.filter((part) => (part as { thought?: boolean }).thought !== true)
        .map((part) => part.text)
        .join('') ?? undefined,
    getFunctionCalls: (resp: GenerateContentResponse) =>
      resp.functionCalls ?? [],
    getFunctionCallsFromParts: (parts: Part[]) => {
      const functionCalls = parts
        .filter((part) => part.functionCall !== undefined)
        .map((part) => part.functionCall!);
      return functionCalls.length > 0 ? functionCalls : undefined;
    },
    analyzeResponseOutcome: (parts: Part[]) => {
      let hasVisibleText = false;
      let hasThinking = false;
      let hasToolCalls = false;
      for (const part of parts) {
        const isThinking = (part as { thought?: boolean }).thought === true;
        if (isThinking) hasThinking = true;
        if (part.functionCall !== undefined) hasToolCalls = true;
        if (
          !isThinking &&
          typeof part.text === 'string' &&
          part.text.trim() !== ''
        )
          hasVisibleText = true;
      }
      return {
        hasVisibleText,
        hasThinking,
        hasToolCalls,
        isActionable: hasVisibleText || hasToolCalls,
      };
    },
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
        value: {
          candidates: [{ content: { parts: [{ text: 'First part' }] } }],
        } as GenerateContentResponse,
      };
      abortController.abort();
      yield {
        type: StreamEventType.CHUNK,
        value: {
          candidates: [
            {
              content: {
                parts: [{ text: 'Second part - should not be processed' }],
              },
            },
          ],
        } as GenerateContentResponse,
      };
    })();
    mockSendMessageStream.mockResolvedValue(mockResponseStream);

    const events = [];
    const reqParts: Part[] = [{ text: 'Test abort' }];
    for await (const event of turn.run(reqParts, abortController.signal)) {
      events.push(event);
    }
    expect(events).toStrictEqual([
      {
        type: GeminiEventType.Content,
        value: 'First part',
        traceId: undefined,
      },
      { type: GeminiEventType.UserCancelled },
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
            value: {
              candidates: [{ content: { parts: [{ text: 'First part' }] } }],
            } as GenerateContentResponse,
          };
          await new Promise<void>((resolve) => {
            abortController.signal.addEventListener('abort', () => resolve(), {
              once: true,
            });
          });
          yield {
            type: StreamEventType.CHUNK,
            value: {
              candidates: [
                {
                  content: {
                    parts: [{ text: 'Second part - should not be processed' }],
                  },
                },
              ],
            } as GenerateContentResponse,
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

      const events: ServerGeminiStreamEvent[] = [];
      const runPromise = (async () => {
        for await (const event of turn.run(
          [{ text: 'Test iterator cleanup' }],
          abortController.signal,
        )) {
          events.push(event);
          if (event.type === GeminiEventType.Content) {
            abortController.abort();
          }
        }
      })();

      await vi.advanceTimersByTimeAsync(100);
      await runPromise;

      expect(returnSpy).toHaveBeenCalled();
      expect(events).toContainEqual({ type: GeminiEventType.UserCancelled });
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
            value: {
              candidates: [{ content: { parts: [{ text: 'Partial' }] } }],
            } as GenerateContentResponse,
          };
          abortController.abort();
          await new Promise((resolve) => setTimeout(resolve, 10));
          yield {
            type: StreamEventType.CHUNK,
            value: {
              candidates: [{ content: { parts: [{ text: 'Ignored' }] } }],
            } as GenerateContentResponse,
          };
        } else {
          yield {
            type: StreamEventType.CHUNK,
            value: {
              candidates: [
                { content: { parts: [{ text: 'Second call success' }] } },
              ],
            } as GenerateContentResponse,
          };
        }
      })();

    mockSendMessageStream.mockImplementation(() => {
      callCount++;
      return createMockStream(callCount === 1);
    });

    const events1: ServerGeminiStreamEvent[] = [];
    for await (const event of turn.run(
      [{ text: 'First call' }],
      abortController.signal,
    )) {
      events1.push(event);
    }

    expect(events1).toContainEqual({ type: GeminiEventType.UserCancelled });
    expect(callCount).toBe(1);

    const freshController = new AbortController();
    const events2: ServerGeminiStreamEvent[] = [];

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
      type: GeminiEventType.Content,
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
    const reqParts: Part[] = [{ text: 'Test malformed error handling' }];

    for await (const event of turn.run(reqParts, abortController.signal)) {
      events.push(event);
    }

    expect(events).toStrictEqual([{ type: GeminiEventType.UserCancelled }]);

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

      const mockResponseStream = (async function* () {
        yield {
          type: StreamEventType.CHUNK,
          value: {
            candidates: [{ content: { parts: [{ text: 'First part' }] } }],
          } as GenerateContentResponse,
        };
        await new Promise<void>(() => {});
      })();

      mockSendMessageStream.mockImplementation(async (params) => {
        const config = params as {
          config?: { abortSignal?: AbortSignal };
        };
        if (config.config?.abortSignal) {
          abortSignals.push(config.config.abortSignal);
        }
        return mockResponseStream;
      });

      const eventsPromise = (async () => {
        const events: ServerGeminiStreamEvent[] = [];
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
          type: GeminiEventType.Content,
          value: 'First part',
          traceId: undefined,
        },
        {
          type: GeminiEventType.StreamIdleTimeout,
          value: {
            error: {
              message:
                'Stream idle timeout: no response received within the allowed time.',
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

  it('should allow subsequent calls after idle timeout (sendPromise deadlock prevention)', async () => {
    vi.useFakeTimers();
    try {
      const testTimeoutMs = 30_000;
      let callCount = 0;
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

      const createMockStream = (shouldHang: boolean) =>
        (async function* () {
          yield {
            type: StreamEventType.CHUNK,
            value: {
              candidates: [
                {
                  content: {
                    parts: [{ text: shouldHang ? 'Hanging' : 'OK' }],
                  },
                },
              ],
            } as GenerateContentResponse,
          };
          if (shouldHang) {
            await new Promise<void>(() => {});
          }
        })();

      mockSendMessageStream.mockImplementation(async (params) => {
        callCount++;
        const config = params as {
          config?: { abortSignal?: AbortSignal };
        };
        if (config.config?.abortSignal) {
          abortSignals.push(config.config.abortSignal);
        }
        return createMockStream(callCount === 1);
      });

      const events1Promise = (async () => {
        const events: ServerGeminiStreamEvent[] = [];
        for await (const event of turn.run(
          [{ text: 'First call (will timeout)' }],
          new AbortController().signal,
        )) {
          events.push(event);
        }
        return events;
      })();

      await vi.advanceTimersByTimeAsync(testTimeoutMs + 1);
      const events1 = await events1Promise;

      expect(events1).toContainEqual(
        expect.objectContaining({ type: GeminiEventType.StreamIdleTimeout }),
      );
      expect(callCount).toBe(1);

      const events2Promise = (async () => {
        const events: ServerGeminiStreamEvent[] = [];
        for await (const event of turn.run(
          [{ text: 'Second call (should work)' }],
          new AbortController().signal,
        )) {
          events.push(event);
        }
        return events;
      })();

      await vi.advanceTimersByTimeAsync(100);
      const events2 = await events2Promise;

      expect(callCount).toBe(2);
      expect(events2).toContainEqual({
        type: GeminiEventType.Content,
        value: 'OK',
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
