/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ServerGeminiStreamEvent } from './turn.js';
import { Turn, GeminiEventType, DEFAULT_AGENT_ID } from './turn.js';
import type { GenerateContentResponse, Part } from '@google/genai';
import type { ChatSession } from './chatSession.js';
import { StreamEventType } from './chatSession.js';
import {
  type MockedChatInstance,
  findFinishedEvent,
} from './turn-test-helpers.js';

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

describe('Turn - debug responses and finished event outcome', () => {
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

    describe('Finished event outcome', () => {
      it('should include outcome with hadVisibleOutput true for text-only response', async () => {
        const mockResponseStream = (async function* () {
          yield {
            type: StreamEventType.CHUNK,
            value: {
              candidates: [
                {
                  content: { parts: [{ text: 'Hello world' }] },
                  finishReason: 'STOP',
                },
              ],
            } as GenerateContentResponse,
          };
        })();
        mockSendMessageStream.mockResolvedValue(mockResponseStream);

        const events: ServerGeminiStreamEvent[] = [];
        for await (const event of turn.run(
          [{ text: 'Hi' }],
          new AbortController().signal,
        )) {
          events.push(event);
        }

        const finishedEvent = findFinishedEvent(events);
        expect(finishedEvent).toBeDefined();
        expect(finishedEvent?.value.outcome).toStrictEqual({
          hadVisibleOutput: true,
          hadThinking: false,
          hadToolCalls: false,
        });
      });

      it('should include outcome with hadThinking true for thinking-only response', async () => {
        const mockResponseStream = (async function* () {
          yield {
            type: StreamEventType.CHUNK,
            value: {
              candidates: [
                {
                  content: {
                    parts: [{ text: 'internal reasoning', thought: true }],
                  },
                  finishReason: 'STOP',
                },
              ],
            } as unknown as GenerateContentResponse,
          };
        })();
        mockSendMessageStream.mockResolvedValue(mockResponseStream);

        const events: ServerGeminiStreamEvent[] = [];
        for await (const event of turn.run(
          [{ text: 'Think about it' }],
          new AbortController().signal,
        )) {
          events.push(event);
        }

        const finishedEvent = findFinishedEvent(events);
        expect(finishedEvent).toBeDefined();
        expect(finishedEvent?.value.outcome).toStrictEqual({
          hadVisibleOutput: false,
          hadThinking: true,
          hadToolCalls: false,
        });
      });

      it('should include outcome with hadToolCalls true for tool-call response', async () => {
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
                          name: 'read_file',
                          args: { path: '/tmp/x' },
                        },
                      },
                    ],
                  },
                  finishReason: 'STOP',
                },
              ],
            } as unknown as GenerateContentResponse,
          };
        })();
        mockSendMessageStream.mockResolvedValue(mockResponseStream);

        const events: ServerGeminiStreamEvent[] = [];
        for await (const event of turn.run(
          [{ text: 'Read a file' }],
          new AbortController().signal,
        )) {
          events.push(event);
        }

        const finishedEvent = findFinishedEvent(events);
        expect(finishedEvent).toBeDefined();
        expect(finishedEvent?.value.outcome).toStrictEqual({
          hadVisibleOutput: false,
          hadThinking: false,
          hadToolCalls: true,
        });
      });

      it('should include cumulative visible-output outcome when finish reason is in a later chunk', async () => {
        const mockResponseStream = (async function* () {
          yield {
            type: StreamEventType.CHUNK,
            value: {
              candidates: [{ content: { parts: [{ text: 'Hello world' }] } }],
            } as GenerateContentResponse,
          };
          yield {
            type: StreamEventType.CHUNK,
            value: {
              candidates: [{ content: { parts: [] }, finishReason: 'STOP' }],
            } as GenerateContentResponse,
          };
        })();
        mockSendMessageStream.mockResolvedValue(mockResponseStream);

        const events: ServerGeminiStreamEvent[] = [];
        for await (const event of turn.run(
          [{ text: 'Hi' }],
          new AbortController().signal,
        )) {
          events.push(event);
        }

        const finishedEvent = findFinishedEvent(events);
        expect(finishedEvent).toBeDefined();
        expect(finishedEvent?.value.outcome).toStrictEqual({
          hadVisibleOutput: true,
          hadThinking: false,
          hadToolCalls: false,
        });
      });

      it('should include cumulative thinking outcome when finish reason is in a later chunk', async () => {
        const mockResponseStream = (async function* () {
          yield {
            type: StreamEventType.CHUNK,
            value: {
              candidates: [
                {
                  content: {
                    parts: [{ text: 'internal reasoning', thought: true }],
                  },
                },
              ],
            } as unknown as GenerateContentResponse,
          };
          yield {
            type: StreamEventType.CHUNK,
            value: {
              candidates: [{ content: { parts: [] }, finishReason: 'STOP' }],
            } as GenerateContentResponse,
          };
        })();
        mockSendMessageStream.mockResolvedValue(mockResponseStream);

        const events: ServerGeminiStreamEvent[] = [];
        for await (const event of turn.run(
          [{ text: 'Think about it' }],
          new AbortController().signal,
        )) {
          events.push(event);
        }

        const finishedEvent = findFinishedEvent(events);
        expect(finishedEvent).toBeDefined();
        expect(finishedEvent?.value.outcome).toStrictEqual({
          hadVisibleOutput: false,
          hadThinking: true,
          hadToolCalls: false,
        });
      });

      it('should include cumulative tool-call outcome when finish reason is in a later chunk', async () => {
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
                          name: 'read_file',
                          args: { path: '/tmp/x' },
                        },
                      },
                    ],
                  },
                },
              ],
            } as unknown as GenerateContentResponse,
          };
          yield {
            type: StreamEventType.CHUNK,
            value: {
              candidates: [{ content: { parts: [] }, finishReason: 'STOP' }],
            } as GenerateContentResponse,
          };
        })();
        mockSendMessageStream.mockResolvedValue(mockResponseStream);

        const events: ServerGeminiStreamEvent[] = [];
        for await (const event of turn.run(
          [{ text: 'Read a file' }],
          new AbortController().signal,
        )) {
          events.push(event);
        }

        const finishedEvent = findFinishedEvent(events);
        expect(finishedEvent).toBeDefined();
        expect(finishedEvent?.value.outcome).toStrictEqual({
          hadVisibleOutput: false,
          hadThinking: false,
          hadToolCalls: true,
        });
      });

      it('should reset cumulative outcome after retry events', async () => {
        const mockResponseStream = (async function* () {
          yield {
            type: StreamEventType.CHUNK,
            value: {
              candidates: [
                { content: { parts: [{ text: 'discarded text' }] } },
              ],
            } as GenerateContentResponse,
          };
          yield { type: StreamEventType.RETRY };
          yield {
            type: StreamEventType.CHUNK,
            value: {
              candidates: [
                {
                  content: {
                    parts: [{ text: 'internal reasoning', thought: true }],
                  },
                },
              ],
            } as unknown as GenerateContentResponse,
          };
          yield {
            type: StreamEventType.CHUNK,
            value: {
              candidates: [{ content: { parts: [] }, finishReason: 'STOP' }],
            } as GenerateContentResponse,
          };
        })();
        mockSendMessageStream.mockResolvedValue(mockResponseStream);

        const events: ServerGeminiStreamEvent[] = [];
        for await (const event of turn.run(
          [{ text: 'Think about it' }],
          new AbortController().signal,
        )) {
          events.push(event);
        }

        const finishedEvent = findFinishedEvent(events);
        expect(finishedEvent).toBeDefined();
        expect(finishedEvent?.value.outcome).toStrictEqual({
          hadVisibleOutput: false,
          hadThinking: true,
          hadToolCalls: false,
        });
      });

      it('should not emit content for whitespace-only text', async () => {
        const mockResponseStream = (async function* () {
          yield {
            type: StreamEventType.CHUNK,
            value: {
              candidates: [
                {
                  content: { parts: [{ text: '   ' }] },
                  finishReason: 'STOP',
                },
              ],
            } as GenerateContentResponse,
          };
        })();
        mockSendMessageStream.mockResolvedValue(mockResponseStream);

        const events: ServerGeminiStreamEvent[] = [];
        for await (const event of turn.run(
          [{ text: 'Hi' }],
          new AbortController().signal,
        )) {
          events.push(event);
        }

        expect(
          events.some((event) => event.type === GeminiEventType.Content),
        ).toBe(false);
        const finishedEvent = findFinishedEvent(events);
        expect(finishedEvent).toBeDefined();
        expect(finishedEvent?.value.outcome).toStrictEqual({
          hadVisibleOutput: false,
          hadThinking: false,
          hadToolCalls: false,
        });
      });
    });
  });
});
