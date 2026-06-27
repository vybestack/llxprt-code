/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type {
  ServerGeminiToolCallRequestEvent,
  ServerGeminiErrorEvent,
} from './turn.js';
import { Turn, GeminiEventType, DEFAULT_AGENT_ID } from './turn.js';
import type { GenerateContentResponse, Part, Content } from '@google/genai';
import { reportError } from '@vybestack/llxprt-code-core/utils/errorReporting.js';
import type { ChatSession } from './chatSession.js';
import { InvalidStreamError, StreamEventType } from './chatSession.js';
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

describe('Turn', () => {
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

    it('should yield content events for newline-only chunks after visible text', async () => {
      const mockResponseStream = (async function* () {
        yield {
          type: StreamEventType.CHUNK,
          value: {
            candidates: [
              { content: { parts: [{ text: 'LLXPRT2208_ALPHA' }] } },
            ],
          } as GenerateContentResponse,
        };
        yield {
          type: StreamEventType.CHUNK,
          value: {
            candidates: [{ content: { parts: [{ text: '\n\n' }] } }],
          } as GenerateContentResponse,
        };
        yield {
          type: StreamEventType.CHUNK,
          value: {
            candidates: [
              { content: { parts: [{ text: 'Alpha paragraph one.' }] } },
            ],
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

      expect(events).toStrictEqual([
        {
          type: GeminiEventType.Content,
          value: 'LLXPRT2208_ALPHA',
          traceId: undefined,
        },
        { type: GeminiEventType.Content, value: '\n\n', traceId: undefined },
        {
          type: GeminiEventType.Content,
          value: 'Alpha paragraph one.',
          traceId: undefined,
        },
      ]);
    });

    it('should yield content events for leading newline-only chunks', async () => {
      const mockResponseStream = (async function* () {
        yield {
          type: StreamEventType.CHUNK,
          value: {
            candidates: [{ content: { parts: [{ text: '\n\n' }] } }],
          } as GenerateContentResponse,
        };
        yield {
          type: StreamEventType.CHUNK,
          value: {
            candidates: [
              { content: { parts: [{ text: 'LLXPRT2208_ALPHA' }] } },
            ],
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

      expect(events).toStrictEqual([
        { type: GeminiEventType.Content, value: '\n\n', traceId: undefined },
        {
          type: GeminiEventType.Content,
          value: 'LLXPRT2208_ALPHA',
          traceId: undefined,
        },
      ]);
    });
    it('should yield tool_call_request events for function calls', async () => {
      const mockResponseStream = (async function* () {
        yield {
          type: StreamEventType.CHUNK,
          value: {
            candidates: [
              {
                content: {
                  parts: [
                    {
                      functionCall: {
                        id: 'fc1',
                        name: 'tool1',
                        args: { arg1: 'val1' },
                      },
                    },
                    {
                      functionCall: {
                        name: 'tool2',
                        args: { arg2: 'val2' },
                      },
                    },
                  ],
                },
              },
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
      expect(event2.value.callId).toStrictEqual('tool2-1-ecb6737fd951388d');
      expect(turn.pendingToolCalls[1]).toStrictEqual(event2.value);
      expect(turn.getDebugResponses().length).toBe(1);
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
      expect(reportError).not.toHaveBeenCalled();
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
            candidates: [
              {
                content: {
                  parts: [
                    {
                      functionCall: {
                        id: 'fc1',
                        name: undefined,
                        args: { arg1: 'val1' },
                      },
                    },
                    {
                      functionCall: {
                        id: 'fc2',
                        name: 'tool2',
                        args: undefined,
                      },
                    },
                    {
                      functionCall: {
                        id: 'fc3',
                        name: undefined,
                        args: undefined,
                      },
                    },
                  ],
                },
              },
            ],
          } as unknown as GenerateContentResponse,
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
            outcome: {
              hadVisibleOutput: true,
              hadThinking: false,
              hadToolCalls: false,
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
          value: {
            reason: 'MAX_TOKENS',
            usageMetadata: undefined,
            outcome: {
              hadVisibleOutput: true,
              hadThinking: false,
              hadToolCalls: false,
            },
          },
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
          value: {
            reason: 'SAFETY',
            usageMetadata: undefined,
            outcome: {
              hadVisibleOutput: true,
              hadThinking: false,
              hadToolCalls: false,
            },
          },
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
    });

    it('should handle multiple responses with different finish reasons', async () => {
      const mockResponseStream = (async function* () {
        yield {
          type: StreamEventType.CHUNK,
          value: {
            candidates: [
              {
                content: { parts: [{ text: 'First part' }] },
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
          value: {
            reason: 'OTHER',
            usageMetadata: undefined,
            outcome: {
              hadVisibleOutput: true,
              hadThinking: false,
              hadToolCalls: false,
            },
          },
        },
      ]);
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
});
