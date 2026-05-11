/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable max-lines -- Phase 5: large behavioral coverage file retained together to avoid fragmenting related scenarios. */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type {
  ServerGeminiToolCallRequestEvent,
  ServerGeminiErrorEvent,
  ServerGeminiStreamEvent,
} from './turn.js';
import { Turn, GeminiEventType, DEFAULT_AGENT_ID } from './turn.js';
import type {
  GenerateContentResponse,
  Part,
  Content,
  FinishReason,
} from '@google/genai';
import { reportError } from '../utils/errorReporting.js';
import type { GeminiChat } from './geminiChat.js';
import { InvalidStreamError, StreamEventType } from './geminiChat.js';

const mockSendMessageStream = vi.fn();
const mockGetHistory = vi.fn();

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

vi.mock('../utils/errorReporting', () => ({
  reportError: vi.fn(),
}));

// Use the actual implementation from partUtils now that it's provided.
vi.mock('../utils/generateContentResponseUtilities', () => ({
  getResponseText: (resp: GenerateContentResponse) =>
    // Filter out thought parts - same as real implementation
    resp.candidates?.[0]?.content?.parts
      ?.filter((part) => (part as { thought?: boolean }).thought !== true)
      .map((part) => part.text)
      .join('') ?? undefined,
  getFunctionCalls: (resp: GenerateContentResponse) => resp.functionCalls ?? [],
}));

describe('Turn', () => {
  let turn: Turn;
  // Define a type for the mocked Chat instance for clarity
  type MockedChatInstance = {
    sendMessageStream: typeof mockSendMessageStream;
    getHistory: typeof mockGetHistory;
    getConfig: () =>
      | { getEphemeralSetting: (key: string) => unknown }
      | undefined;
  };
  let mockChatInstance: MockedChatInstance;

  beforeEach(() => {
    vi.resetAllMocks();
    mockChatInstance = {
      sendMessageStream: mockSendMessageStream,
      getHistory: mockGetHistory,
      getConfig: () => undefined,
    };
    turn = new Turn(
      mockChatInstance as unknown as GeminiChat,
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

  describe('constructor', () => {
    it('should initialize pendingToolCalls and debugResponses', () => {
      expect(turn.pendingToolCalls).toStrictEqual([]);
      expect(turn.getDebugResponses()).toStrictEqual([]);
    });
  });

  describe('run', () => {
    it('should yield content events for text parts', async () => {
      const mockResponseStream = (async function* () {
        yield {
          type: StreamEventType.CHUNK,
          value: {
            candidates: [{ content: { parts: [{ text: 'Hello' }] } }],
          } as GenerateContentResponse,
        };
        yield {
          type: StreamEventType.CHUNK,
          value: {
            candidates: [{ content: { parts: [{ text: ' world' }] } }],
          } as GenerateContentResponse,
        };
      })();
      mockSendMessageStream.mockResolvedValue(mockResponseStream);

      const events = [];
      const reqParts: Part[] = [{ text: 'Hi' }];
      for await (const event of turn.run(
        reqParts,
        new AbortController().signal,
      )) {
        events.push(event);
      }

      expect(mockSendMessageStream).toHaveBeenCalledWith(
        {
          message: reqParts,
          config: { abortSignal: expect.any(AbortSignal) },
        },
        'prompt-id-1',
      );

      expect(events).toStrictEqual([
        { type: GeminiEventType.Content, value: 'Hello', traceId: undefined },
        { type: GeminiEventType.Content, value: ' world', traceId: undefined },
      ]);
      expect(turn.getDebugResponses().length).toBe(2);
    });

    it('should yield tool_call_request events for function calls', async () => {
      const mockResponseStream = (async function* () {
        yield {
          type: StreamEventType.CHUNK,
          value: {
            functionCalls: [
              {
                id: 'fc1',
                name: 'tool1',
                args: { arg1: 'val1' },
                isClientInitiated: false,
              },
              {
                name: 'tool2',
                args: { arg2: 'val2' },
                isClientInitiated: false,
              }, // No ID
            ],
          } as unknown as GenerateContentResponse,
        };
      })();
      mockSendMessageStream.mockResolvedValue(mockResponseStream);

      const events = [];
      const reqParts: Part[] = [{ text: 'Use tools' }];
      for await (const event of turn.run(
        reqParts,
        new AbortController().signal,
      )) {
        events.push(event);
      }

      expect(events.length).toBe(2);
      const event1 = events[0] as ServerGeminiToolCallRequestEvent;
      expect(event1.type).toBe(GeminiEventType.ToolCallRequest);
      expect(event1.value).toStrictEqual(
        expect.objectContaining({
          callId: 'fc1',
          name: 'tool1',
          args: { arg1: 'val1' },
          isClientInitiated: false,
        }),
      );
      expect(turn.pendingToolCalls[0]).toStrictEqual(event1.value);

      const event2 = events[1] as ServerGeminiToolCallRequestEvent;
      expect(event2.type).toBe(GeminiEventType.ToolCallRequest);
      expect(event2.value).toStrictEqual(
        expect.objectContaining({
          name: 'tool2',
          args: { arg2: 'val2' },
          isClientInitiated: false,
        }),
      );
      expect(event2.value.callId).toStrictEqual(
        // eslint-disable-next-line sonarjs/regular-expr -- Static test regex reviewed for lint hardening; behavior preserved.
        expect.stringMatching(/^tool2-\d{13}-\w{10,}$/),
      );
      expect(turn.pendingToolCalls[1]).toStrictEqual(event2.value);
      expect(turn.getDebugResponses().length).toBe(1);
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

        // Set explicit timeout for this test
        mockChatInstance = {
          sendMessageStream: mockSendMessageStream,
          getHistory: mockGetHistory,
          getConfig: () => ({
            getEphemeralSetting: (key: string) => {
              if (key === 'stream-idle-timeout-ms') {
                return 30_000; // 30 second timeout
              }
              return undefined;
            },
          }),
        };
        turn = new Turn(
          mockChatInstance as unknown as GeminiChat,
          'prompt-id-1',
          DEFAULT_AGENT_ID,
          'test',
        );

        // Create a mock async generator with a spyable return method
        async function* mockGenerator() {
          try {
            yield {
              type: StreamEventType.CHUNK,
              value: {
                candidates: [{ content: { parts: [{ text: 'First part' }] } }],
              } as GenerateContentResponse,
            };
            // This will wait until aborted
            await new Promise<void>((resolve) => {
              abortController.signal.addEventListener(
                'abort',
                () => resolve(),
                {
                  once: true,
                },
              );
            });
            yield {
              type: StreamEventType.CHUNK,
              value: {
                candidates: [
                  {
                    content: {
                      parts: [
                        { text: 'Second part - should not be processed' },
                      ],
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
        // Wrap the generator to spy on return()
        const mockResponseStream = {
          [Symbol.asyncIterator]: () => ({
            next: () => generator.next(),
            return: returnSpy,
            throw: (e: unknown) => generator.throw(e),
          }),
        };

        mockSendMessageStream.mockResolvedValue(mockResponseStream);

        // Start consuming and abort after first chunk
        const events: ServerGeminiStreamEvent[] = [];
        const runPromise = (async () => {
          for await (const event of turn.run(
            [{ text: 'Test iterator cleanup' }],
            abortController.signal,
          )) {
            events.push(event);
            if (event.type === GeminiEventType.Content) {
              // Abort after first content event
              abortController.abort();
            }
          }
        })();

        // Advance timers to let the abort propagate
        await vi.advanceTimersByTimeAsync(100);
        await runPromise;

        // Verify that return() was called on the iterator
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

      // First call - will abort
      const events1: ServerGeminiStreamEvent[] = [];
      for await (const event of turn.run(
        [{ text: 'First call' }],
        abortController.signal,
      )) {
        events1.push(event);
      }

      expect(events1).toContainEqual({ type: GeminiEventType.UserCancelled });
      expect(callCount).toBe(1);

      // Second call with fresh abort controller - should NOT hang
      const freshController = new AbortController();
      const events2: ServerGeminiStreamEvent[] = [];

      // Use a timeout to detect if it hangs
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

    it('should yield InvalidStream event if sendMessageStream throws InvalidStreamError', async () => {
      const error = new InvalidStreamError(
        'Test invalid stream',
        'NO_FINISH_REASON',
      );
      mockSendMessageStream.mockRejectedValue(error);
      const reqParts: Part[] = [{ text: 'Trigger invalid stream' }];

      const events = [];
      for await (const event of turn.run(
        reqParts,
        new AbortController().signal,
      )) {
        events.push(event);
      }

      expect(events).toStrictEqual([{ type: GeminiEventType.InvalidStream }]);
      expect(turn.getDebugResponses().length).toBe(0);
      expect(reportError).not.toHaveBeenCalled(); // Should not report as error
    });

    it('should yield Error event and report if sendMessageStream throws', async () => {
      const error = new Error('API Error');
      mockSendMessageStream.mockRejectedValue(error);
      const reqParts: Part[] = [{ text: 'Trigger error' }];
      const historyContent: Content[] = [
        { role: 'model', parts: [{ text: 'Previous history' }] },
      ];
      mockGetHistory.mockReturnValue(historyContent);

      const events = [];
      for await (const event of turn.run(
        reqParts,
        new AbortController().signal,
      )) {
        events.push(event);
      }

      expect(events.length).toBe(1);
      const errorEvent = events[0] as ServerGeminiErrorEvent;
      expect(errorEvent.type).toBe(GeminiEventType.Error);
      expect(errorEvent.value).toStrictEqual({
        error: { message: 'API Error', status: undefined },
      });
      expect(turn.getDebugResponses().length).toBe(0);
      expect(reportError).toHaveBeenCalledWith(
        error,
        'Error when talking to test API',
        [...historyContent, reqParts],
        'Turn.run-sendMessageStream',
      );
    });

    it('should handle function calls with undefined name or args', async () => {
      const mockResponseStream = (async function* () {
        yield {
          type: StreamEventType.CHUNK,
          value: {
            candidates: [],
            functionCalls: [
              // Add `id` back to the mock to match what the code expects
              { id: 'fc1', name: undefined, args: { arg1: 'val1' } },
              { id: 'fc2', name: 'tool2', args: undefined },
              { id: 'fc3', name: undefined, args: undefined },
            ],
          },
        };
      })();
      mockSendMessageStream.mockResolvedValue(mockResponseStream);

      const events = [];
      for await (const event of turn.run(
        [{ text: 'Test undefined tool parts' }],
        new AbortController().signal,
      )) {
        events.push(event);
      }

      expect(events.length).toBe(3);

      // Assertions for each specific tool call event
      const event1 = events[0] as ServerGeminiToolCallRequestEvent;
      expect(event1.value).toMatchObject({
        callId: 'fc1',
        name: 'undefined_tool_name',
        args: { arg1: 'val1' },
      });

      const event2 = events[1] as ServerGeminiToolCallRequestEvent;
      expect(event2.value).toMatchObject({
        callId: 'fc2',
        name: 'tool2',
        args: {},
      });

      const event3 = events[2] as ServerGeminiToolCallRequestEvent;
      expect(event3.value).toMatchObject({
        callId: 'fc3',
        name: 'undefined_tool_name',
        args: {},
      });
    });

    it('should yield finished event when response has finish reason', async () => {
      const mockResponseStream = (async function* () {
        yield {
          type: StreamEventType.CHUNK,
          value: {
            candidates: [
              {
                content: { parts: [{ text: 'Partial response' }] },
                finishReason: 'STOP',
              },
            ],
            usageMetadata: {
              promptTokenCount: 17,
              candidatesTokenCount: 50,
              cachedContentTokenCount: 10,
              thoughtsTokenCount: 5,
              toolUsePromptTokenCount: 2,
            },
          } as GenerateContentResponse,
        };
      })();
      mockSendMessageStream.mockResolvedValue(mockResponseStream);

      const events = [];
      for await (const event of turn.run(
        [{ text: 'Test finish reason' }],
        new AbortController().signal,
      )) {
        events.push(event);
      }

      expect(events).toStrictEqual([
        {
          type: GeminiEventType.Content,
          value: 'Partial response',
          traceId: undefined,
        },
        {
          type: GeminiEventType.Finished,
          value: {
            reason: 'STOP',
            usageMetadata: {
              promptTokenCount: 17,
              candidatesTokenCount: 50,
              cachedContentTokenCount: 10,
              thoughtsTokenCount: 5,
              toolUsePromptTokenCount: 2,
            },
          },
        },
      ]);
    });

    it('should yield finished event for MAX_TOKENS finish reason', async () => {
      const mockResponseStream = (async function* () {
        yield {
          type: StreamEventType.CHUNK,
          value: {
            candidates: [
              {
                content: {
                  parts: [
                    { text: 'This is a long response that was cut off...' },
                  ],
                },
                finishReason: 'MAX_TOKENS',
              },
            ],
          },
        };
      })();
      mockSendMessageStream.mockResolvedValue(mockResponseStream);

      const events = [];
      const reqParts: Part[] = [{ text: 'Generate long text' }];
      for await (const event of turn.run(
        reqParts,
        new AbortController().signal,
      )) {
        events.push(event);
      }

      expect(events).toStrictEqual([
        {
          type: GeminiEventType.Content,
          value: 'This is a long response that was cut off...',
          traceId: undefined,
        },
        {
          type: GeminiEventType.Finished,
          value: { reason: 'MAX_TOKENS', usageMetadata: undefined },
        },
      ]);
    });

    it('should yield finished event for SAFETY finish reason', async () => {
      const mockResponseStream = (async function* () {
        yield {
          type: StreamEventType.CHUNK,
          value: {
            candidates: [
              {
                content: { parts: [{ text: 'Content blocked' }] },
                finishReason: 'SAFETY',
              },
            ],
          },
        };
      })();
      mockSendMessageStream.mockResolvedValue(mockResponseStream);

      const events = [];
      const reqParts: Part[] = [{ text: 'Test safety' }];
      for await (const event of turn.run(
        reqParts,
        new AbortController().signal,
      )) {
        events.push(event);
      }

      expect(events).toStrictEqual([
        {
          type: GeminiEventType.Content,
          value: 'Content blocked',
          traceId: undefined,
        },
        {
          type: GeminiEventType.Finished,
          value: { reason: 'SAFETY', usageMetadata: undefined },
        },
      ]);
    });

    it('should not yield finished event when there is no finish reason', async () => {
      const mockResponseStream = (async function* () {
        yield {
          type: StreamEventType.CHUNK,
          value: {
            candidates: [
              {
                content: {
                  parts: [{ text: 'Response without finish reason' }],
                },
                // No finishReason property
              },
            ],
          },
        };
      })();
      mockSendMessageStream.mockResolvedValue(mockResponseStream);

      const events = [];
      const reqParts: Part[] = [{ text: 'Test no finish reason' }];
      for await (const event of turn.run(
        reqParts,
        new AbortController().signal,
      )) {
        events.push(event);
      }

      expect(events).toStrictEqual([
        {
          type: GeminiEventType.Content,
          value: 'Response without finish reason',
          traceId: undefined,
        },
      ]);
      // No Finished event should be emitted
    });

    it('should handle multiple responses with different finish reasons', async () => {
      const mockResponseStream = (async function* () {
        yield {
          type: StreamEventType.CHUNK,
          value: {
            candidates: [
              {
                content: { parts: [{ text: 'First part' }] },
                // No finish reason on first response
              },
            ],
          },
        };
        yield {
          type: StreamEventType.CHUNK,
          value: {
            candidates: [
              {
                content: { parts: [{ text: 'Second part' }] },
                finishReason: 'OTHER',
              },
            ],
          },
        };
      })();
      mockSendMessageStream.mockResolvedValue(mockResponseStream);

      const events = [];
      const reqParts: Part[] = [{ text: 'Test multiple responses' }];
      for await (const event of turn.run(
        reqParts,
        new AbortController().signal,
      )) {
        events.push(event);
      }

      expect(events).toStrictEqual([
        {
          type: GeminiEventType.Content,
          value: 'First part',
          traceId: undefined,
        },
        {
          type: GeminiEventType.Content,
          value: 'Second part',
          traceId: undefined,
        },
        {
          type: GeminiEventType.Finished,
          value: { reason: 'OTHER', usageMetadata: undefined },
        },
      ]);
    });

    it('should not crash when cancelled request has malformed error', async () => {
      const abortController = new AbortController();

      const errorToThrow = {
        response: {
          data: undefined, // Malformed error data
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

    it('should yield a Retry event when it receives one from the chat stream', async () => {
      const mockResponseStream = (async function* () {
        yield { type: StreamEventType.RETRY };
        yield {
          type: StreamEventType.CHUNK,
          value: {
            candidates: [{ content: { parts: [{ text: 'Success' }] } }],
          },
        };
      })();
      mockSendMessageStream.mockResolvedValue(mockResponseStream);

      const events = [];
      for await (const event of turn.run([], new AbortController().signal)) {
        events.push(event);
      }

      expect(events).toStrictEqual([
        { type: GeminiEventType.Retry },
        { type: GeminiEventType.Content, value: 'Success', traceId: undefined },
      ]);
    });

    it('should yield StreamIdleTimeout when the stream goes idle after partial output with explicit timeout config', async () => {
      vi.useFakeTimers();
      try {
        const testTimeoutMs = 30_000; // 30 second timeout for this test
        const abortSignals: AbortSignal[] = [];

        // Create mock config that returns explicit timeout
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
          mockChatInstance as unknown as GeminiChat,
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
        const testTimeoutMs = 30_000; // 30 second timeout for this test
        let callCount = 0;
        const abortSignals: AbortSignal[] = [];

        // Create mock config that returns explicit timeout
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
          mockChatInstance as unknown as GeminiChat,
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
              // Simulate a hung HTTP stream that never completes
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

        // First call — will idle-timeout
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

        // Second call — should NOT deadlock on sendPromise
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

        // Advance time to let microtasks settle (no timeout needed for non-hanging stream)
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

    it('should yield content events with traceId', async () => {
      const mockResponseStream = (async function* () {
        yield {
          type: StreamEventType.CHUNK,
          value: {
            candidates: [{ content: { parts: [{ text: 'Hello' }] } }],
            responseId: 'trace-123',
          } as GenerateContentResponse,
        };
      })();
      mockSendMessageStream.mockResolvedValue(mockResponseStream);

      const events = [];
      for await (const event of turn.run(
        [{ text: 'Hi' }],
        new AbortController().signal,
      )) {
        events.push(event);
      }

      expect(events).toStrictEqual([
        { type: GeminiEventType.Content, value: 'Hello', traceId: 'trace-123' },
      ]);
    });

    it('should yield thought events with traceId', async () => {
      const mockResponseStream = (async function* () {
        yield {
          type: StreamEventType.CHUNK,
          value: {
            candidates: [
              {
                content: {
                  // thought must be boolean true, not a string - the filter checks !(part.thought)
                  parts: [{ text: '[Thought: thinking]', thought: true }],
                },
              },
            ],
            responseId: 'trace-456',
          } as unknown as GenerateContentResponse,
        };
      })();
      mockSendMessageStream.mockResolvedValue(mockResponseStream);

      const events = [];
      for await (const event of turn.run(
        [{ text: 'Hi' }],
        new AbortController().signal,
      )) {
        events.push(event);
      }

      expect(events).toStrictEqual([
        {
          type: GeminiEventType.Thought,
          value: { subject: '', description: '[Thought: thinking]' },
          traceId: 'trace-456',
        },
      ]);
    });
  });

  describe('getDebugResponses', () => {
    it('should return collected debug responses', async () => {
      const resp1 = {
        candidates: [{ content: { parts: [{ text: 'Debug 1' }] } }],
      } as unknown as GenerateContentResponse;
      const resp2 = {
        functionCalls: [{ name: 'debugTool' }],
      } as unknown as GenerateContentResponse;
      const mockResponseStream = (async function* () {
        yield { type: StreamEventType.CHUNK, value: resp1 };
        yield { type: StreamEventType.CHUNK, value: resp2 };
      })();
      mockSendMessageStream.mockResolvedValue(mockResponseStream);
      const reqParts: Part[] = [{ text: 'Hi' }];
      for await (const _ of turn.run(reqParts, new AbortController().signal)) {
        // consume stream
      }
      expect(turn.getDebugResponses()).toStrictEqual([resp1, resp2]);
    });
  });

  describe('hook execution control events', () => {
    it('should yield AgentExecutionStopped event and terminate when hook stops execution', async () => {
      const mockResponseStream = (async function* () {
        yield {
          type: StreamEventType.AGENT_EXECUTION_STOPPED,
          reason: 'Hook stopped execution',
        };
      })();
      mockSendMessageStream.mockResolvedValue(mockResponseStream);
      const reqParts: Part[] = [{ text: 'test message' }];
      const events: GeminiEventType[] = [];
      for await (const event of turn.run(
        reqParts,
        new AbortController().signal,
      )) {
        events.push(event.type);
      }
      expect(events).toStrictEqual([GeminiEventType.AgentExecutionStopped]);
    });

    it('should yield AgentExecutionBlocked event and continue processing', async () => {
      const resp = {
        candidates: [
          {
            content: { parts: [{ text: 'Synthetic response after block' }] },
            finishReason: 'STOP' as FinishReason,
          },
        ],
      } as GenerateContentResponse;
      const mockResponseStream = (async function* () {
        yield {
          type: StreamEventType.AGENT_EXECUTION_BLOCKED,
          reason: 'Hook blocked execution',
        };
        yield { type: StreamEventType.CHUNK, value: resp };
      })();
      mockSendMessageStream.mockResolvedValue(mockResponseStream);
      const reqParts: Part[] = [{ text: 'test message' }];
      const events: GeminiEventType[] = [];
      for await (const event of turn.run(
        reqParts,
        new AbortController().signal,
      )) {
        events.push(event.type);
      }
      expect(events).toContain(GeminiEventType.AgentExecutionBlocked);
      expect(events).toContain(GeminiEventType.Content);
      expect(events).toContain(GeminiEventType.Finished);
    });

    it('should include reason in AgentExecutionStopped event', async () => {
      const mockResponseStream = (async function* () {
        yield {
          type: StreamEventType.AGENT_EXECUTION_STOPPED,
          reason: 'Custom stop reason',
        };
      })();
      mockSendMessageStream.mockResolvedValue(mockResponseStream);
      const reqParts: Part[] = [{ text: 'test message' }];
      const events: ServerGeminiStreamEvent[] = [];
      for await (const event of turn.run(
        reqParts,
        new AbortController().signal,
      )) {
        events.push(event);
      }
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe(GeminiEventType.AgentExecutionStopped);
      expect((events[0] as { reason: string }).reason).toBe(
        'Custom stop reason',
      );
    });

    it('should include reason in AgentExecutionBlocked event', async () => {
      const mockResponseStream = (async function* () {
        yield {
          type: StreamEventType.AGENT_EXECUTION_BLOCKED,
          reason: 'Custom block reason',
        };
      })();
      mockSendMessageStream.mockResolvedValue(mockResponseStream);
      const reqParts: Part[] = [{ text: 'test message' }];
      const events: ServerGeminiStreamEvent[] = [];
      for await (const event of turn.run(
        reqParts,
        new AbortController().signal,
      )) {
        events.push(event);
      }
      expect(events.length).toBeGreaterThan(0);
      const blockedEvent = events.find(
        (e) => e.type === GeminiEventType.AgentExecutionBlocked,
      );
      expect(blockedEvent).toBeDefined();
      expect((blockedEvent as { reason: string }).reason).toBe(
        'Custom block reason',
      );
    });

    it('should propagate contextCleared=true in AgentExecutionStopped event', async () => {
      const mockResponseStream = (async function* () {
        yield {
          type: StreamEventType.AGENT_EXECUTION_STOPPED,
          reason: 'Hook stopped execution',
          contextCleared: true,
        };
      })();
      mockSendMessageStream.mockResolvedValue(mockResponseStream);
      const reqParts: Part[] = [{ text: 'test message' }];
      const events: ServerGeminiStreamEvent[] = [];
      for await (const event of turn.run(
        reqParts,
        new AbortController().signal,
      )) {
        events.push(event);
      }
      expect(events).toHaveLength(1);
      const stoppedEvent = events[0] as {
        type: string;
        reason: string;
        contextCleared?: boolean;
      };
      expect(stoppedEvent.type).toBe(GeminiEventType.AgentExecutionStopped);
      expect(stoppedEvent.reason).toBe('Hook stopped execution');
      expect(stoppedEvent.contextCleared).toBe(true);
    });

    it('should propagate contextCleared=true in AgentExecutionBlocked event', async () => {
      const resp = {
        candidates: [
          {
            content: { parts: [{ text: 'Response after block' }] },
            finishReason: 'STOP' as FinishReason,
          },
        ],
      } as GenerateContentResponse;
      const mockResponseStream = (async function* () {
        yield {
          type: StreamEventType.AGENT_EXECUTION_BLOCKED,
          reason: 'Hook blocked execution',
          contextCleared: true,
        };
        yield { type: StreamEventType.CHUNK, value: resp };
      })();
      mockSendMessageStream.mockResolvedValue(mockResponseStream);
      const reqParts: Part[] = [{ text: 'test message' }];
      const events: ServerGeminiStreamEvent[] = [];
      for await (const event of turn.run(
        reqParts,
        new AbortController().signal,
      )) {
        events.push(event);
      }
      const blockedEvent = events.find(
        (e) => e.type === GeminiEventType.AgentExecutionBlocked,
      ) as {
        type: string;
        reason: string;
        contextCleared?: boolean;
      };
      expect(blockedEvent).toBeDefined();
      expect(blockedEvent.reason).toBe('Hook blocked execution');
      expect(blockedEvent.contextCleared).toBe(true);
    });

    it('should propagate contextCleared=false when not set in AgentExecutionStopped', async () => {
      const mockResponseStream = (async function* () {
        yield {
          type: StreamEventType.AGENT_EXECUTION_STOPPED,
          reason: 'Hook stopped execution',
        };
      })();
      mockSendMessageStream.mockResolvedValue(mockResponseStream);
      const reqParts: Part[] = [{ text: 'test message' }];
      const events: ServerGeminiStreamEvent[] = [];
      for await (const event of turn.run(
        reqParts,
        new AbortController().signal,
      )) {
        events.push(event);
      }
      const stoppedEvent = events[0] as {
        type: string;
        reason: string;
        contextCleared?: boolean;
      };
      expect(stoppedEvent.type).toBe(GeminiEventType.AgentExecutionStopped);
      expect(stoppedEvent.contextCleared).toBeUndefined();
    });
  });

  describe('stream idle timeout behavioral tests', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      vi.useFakeTimers();
      process.env = { ...originalEnv };
      delete process.env.LLXPRT_STREAM_IDLE_TIMEOUT_MS;
    });

    afterEach(() => {
      vi.useRealTimers();
      vi.restoreAllMocks();
      process.env = originalEnv;
    });

    it('honors config setting: timeout fires after custom timeout value from getConfig()', async () => {
      const customTimeoutMs = 30_000; // 30 seconds
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
        mockChatInstance as unknown as GeminiChat,
        'prompt-id-1',
        DEFAULT_AGENT_ID,
        'test',
      );
      mockGetHistory.mockReturnValue([]);

      // Create a slow iterator that yields after 45 seconds (past the 30s timeout)
      const mockResponseStream = (async function* () {
        await vi.advanceTimersByTimeAsync(45_000);
        yield {
          type: StreamEventType.CHUNK,
          value: {
            candidates: [{ content: { parts: [{ text: 'Late response' }] } }],
          } as GenerateContentResponse,
        };
      })();
      mockSendMessageStream.mockResolvedValue(mockResponseStream);

      const events: ServerGeminiStreamEvent[] = [];
      const reqParts: Part[] = [{ text: 'Hi' }];
      const signal = new AbortController().signal;

      const iterator = turn.run(reqParts, signal);
      const runPromise = (async () => {
        for await (const event of iterator) {
          events.push(event);
        }
      })();

      // Advance just under the custom timeout - no timeout yet
      await vi.advanceTimersByTimeAsync(29_999);
      await Promise.resolve();
      expect(events).toHaveLength(0); // No events yet, no timeout

      // Advance past the custom timeout
      await vi.advanceTimersByTimeAsync(2);
      await Promise.resolve();

      // Run to completion
      await vi.runAllTimersAsync();
      await runPromise;

      // Should have a StreamIdleTimeout event
      const timeoutEvent = events.find(
        (e) => e.type === GeminiEventType.StreamIdleTimeout,
      );
      expect(timeoutEvent).toBeDefined();
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
        mockChatInstance as unknown as GeminiChat,
        'prompt-id-1',
        DEFAULT_AGENT_ID,
        'test',
      );
      mockGetHistory.mockReturnValue([]);

      // Fast iterator - yields within the timeout
      const mockResponseStream = (async function* () {
        yield {
          type: StreamEventType.CHUNK,
          value: {
            candidates: [{ content: { parts: [{ text: 'Fast response' }] } }],
          } as GenerateContentResponse,
        };
      })();
      mockSendMessageStream.mockResolvedValue(mockResponseStream);

      const events: ServerGeminiStreamEvent[] = [];
      const reqParts: Part[] = [{ text: 'Hi' }];
      const signal = new AbortController().signal;

      for await (const event of turn.run(reqParts, signal)) {
        events.push(event);
      }

      // No timeout event - just content
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe(GeminiEventType.Content);
      expect((events[0] as { value: string }).value).toBe('Fast response');
    });

    it('disabled path: no timeout when setting is 0, even after 30 minutes', async () => {
      const mockGetConfig = vi.fn().mockReturnValue({
        getEphemeralSetting: (key: string) => {
          if (key === 'stream-idle-timeout-ms') {
            return 0; // Disabled
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
        mockChatInstance as unknown as GeminiChat,
        'prompt-id-1',
        DEFAULT_AGENT_ID,
        'test',
      );
      mockGetHistory.mockReturnValue([]);

      // Iterator that never yields naturally
      let resolveIterator: () => void;
      const iteratorPromise = new Promise<void>((resolve) => {
        resolveIterator = resolve;
      });

      const mockResponseStream = (async function* () {
        await iteratorPromise;
        yield {
          type: StreamEventType.CHUNK,
          value: {
            candidates: [{ content: { parts: [{ text: 'Finally' }] } }],
          } as GenerateContentResponse,
        };
      })();
      mockSendMessageStream.mockResolvedValue(mockResponseStream);

      const events: ServerGeminiStreamEvent[] = [];
      const reqParts: Part[] = [{ text: 'Hi' }];
      const abortController = new AbortController();

      const runPromise = (async () => {
        for await (const event of turn.run(reqParts, abortController.signal)) {
          events.push(event);
        }
      })();

      // Advance 30 minutes - no timeout because watchdog is disabled
      await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
      await Promise.resolve();

      // No timeout events
      expect(
        events.find((e) => e.type === GeminiEventType.StreamIdleTimeout),
      ).toBeUndefined();

      // Resolve the iterator to let the test complete
      resolveIterator!();
      await vi.runAllTimersAsync();
      await runPromise;

      // Should have the content event, no timeout
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe(GeminiEventType.Content);
    });

    it('env var precedence: env var overrides config setting', async () => {
      const envTimeoutMs = 15_000; // 15 seconds
      const configTimeoutMs = 60_000; // 60 seconds (should be ignored)

      process.env.LLXPRT_STREAM_IDLE_TIMEOUT_MS = String(envTimeoutMs);

      const mockGetConfig = vi.fn().mockReturnValue({
        getEphemeralSetting: (key: string) => {
          if (key === 'stream-idle-timeout-ms') {
            return configTimeoutMs;
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
        mockChatInstance as unknown as GeminiChat,
        'prompt-id-1',
        DEFAULT_AGENT_ID,
        'test',
      );
      mockGetHistory.mockReturnValue([]);

      // Slow iterator - yields after 30 seconds (past the 15s env timeout)
      const mockResponseStream = (async function* () {
        await vi.advanceTimersByTimeAsync(30_000);
        yield {
          type: StreamEventType.CHUNK,
          value: {
            candidates: [{ content: { parts: [{ text: 'Late response' }] } }],
          } as GenerateContentResponse,
        };
      })();
      mockSendMessageStream.mockResolvedValue(mockResponseStream);

      const events: ServerGeminiStreamEvent[] = [];
      const reqParts: Part[] = [{ text: 'Hi' }];
      const signal = new AbortController().signal;

      const runPromise = (async () => {
        for await (const event of turn.run(reqParts, signal)) {
          events.push(event);
        }
      })();

      // Advance past the env timeout (15s), but before config timeout (60s)
      await vi.advanceTimersByTimeAsync(16_000);
      await Promise.resolve();

      // Run to completion
      await vi.runAllTimersAsync();
      await runPromise;

      // Should have a StreamIdleTimeout event at the env timeout (15s), not config (60s)
      const timeoutEvent = events.find(
        (e) => e.type === GeminiEventType.StreamIdleTimeout,
      );
      expect(timeoutEvent).toBeDefined();
    });

    it('default-off: no watchdog timer when no env var and no ephemeral setting', async () => {
      // Ensure no env var is set
      delete process.env.LLXPRT_STREAM_IDLE_TIMEOUT_MS;

      // Config returns undefined for the setting (default-off)
      const mockGetConfig = vi.fn().mockReturnValue({
        getEphemeralSetting: (key: string) => {
          if (key === 'stream-idle-timeout-ms') {
            return undefined; // Not set — default-off
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
        mockChatInstance as unknown as GeminiChat,
        'prompt-id-1',
        DEFAULT_AGENT_ID,
        'test',
      );
      mockGetHistory.mockReturnValue([]);

      // Iterator that never yields naturally (simulates a slow-thinking model)
      let resolveIterator: () => void;
      const iteratorPromise = new Promise<void>((resolve) => {
        resolveIterator = resolve;
      });

      const mockResponseStream = (async function* () {
        await iteratorPromise;
        yield {
          type: StreamEventType.CHUNK,
          value: {
            candidates: [{ content: { parts: [{ text: 'Finally' }] } }],
          } as GenerateContentResponse,
        };
      })();
      mockSendMessageStream.mockResolvedValue(mockResponseStream);

      const events: ServerGeminiStreamEvent[] = [];
      const reqParts: Part[] = [{ text: 'Hi' }];
      const abortController = new AbortController();

      const runPromise = (async () => {
        for await (const event of turn.run(reqParts, abortController.signal)) {
          events.push(event);
        }
      })();

      // Advance well past the old 10-minute default (600_000ms)
      // No timers should be scheduled because watchdog is disabled by default
      await vi.advanceTimersByTimeAsync(700_000);
      await Promise.resolve();

      // No timeout event should have been emitted
      expect(
        events.find((e) => e.type === GeminiEventType.StreamIdleTimeout),
      ).toBeUndefined();

      // Timer count should be 0 (no watchdog scheduled)
      expect(vi.getTimerCount()).toBe(0);

      // Resolve the iterator to let the test complete
      resolveIterator!();
      await vi.runAllTimersAsync();
      await runPromise;

      // Should have the content event, no timeout
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe(GeminiEventType.Content);
    });
  });
});
