/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ServerToolCallRequestEvent, ServerErrorEvent } from './turn.js';
import { Turn, AgentEventType, DEFAULT_AGENT_ID } from './turn.js';
import type {
  ContentBlock,
  IContent,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { reportError } from '@vybestack/llxprt-code-core/utils/errorReporting.js';
import type { ChatSession } from './chatSession.js';
import { InvalidStreamError, StreamEventType } from './chatSession.js';
import { type MockedChatInstance, mockChunk } from './turn-test-helpers.js';

const { mockSendMessageStream, mockGetHistory } = vi.hoisted(() => ({
  mockSendMessageStream: vi.fn(),
  mockGetHistory: vi.fn(),
}));

vi.mock('@vybestack/llxprt-code-core/utils/errorReporting.js', () => ({
  reportError: vi.fn(),
}));

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
          value: mockChunk({ text: 'Hello' }),
        };
        yield {
          type: StreamEventType.CHUNK,
          value: mockChunk({ text: ' world' }),
        };
      })();
      mockSendMessageStream.mockResolvedValue(mockResponseStream);

      const events = [];
      const reqParts: ContentBlock[] = [{ text: 'Hi' }];
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
        { type: AgentEventType.Content, value: 'Hello', traceId: undefined },
        { type: AgentEventType.Content, value: ' world', traceId: undefined },
      ]);
      expect(turn.getDebugResponses().length).toBe(2);
    });

    it('should yield content events for newline-only chunks after visible text', async () => {
      const mockResponseStream = (async function* () {
        yield {
          type: StreamEventType.CHUNK,
          value: mockChunk({ text: 'LLXPRT2208_ALPHA' }),
        };
        yield {
          type: StreamEventType.CHUNK,
          value: mockChunk({ text: '\n\n' }),
        };
        yield {
          type: StreamEventType.CHUNK,
          value: mockChunk({ text: 'Alpha paragraph one.' }),
        };
      })();
      mockSendMessageStream.mockResolvedValue(mockResponseStream);

      const events = [];
      const reqParts: ContentBlock[] = [{ text: 'Hi' }];
      for await (const event of turn.run(
        reqParts,
        new AbortController().signal,
      )) {
        events.push(event);
      }

      expect(events).toStrictEqual([
        {
          type: AgentEventType.Content,
          value: 'LLXPRT2208_ALPHA',
          traceId: undefined,
        },
        { type: AgentEventType.Content, value: '\n\n', traceId: undefined },
        {
          type: AgentEventType.Content,
          value: 'Alpha paragraph one.',
          traceId: undefined,
        },
      ]);
    });

    it('should yield content events for leading newline-only chunks', async () => {
      const mockResponseStream = (async function* () {
        yield {
          type: StreamEventType.CHUNK,
          value: mockChunk({ text: '\n\n' }),
        };
        yield {
          type: StreamEventType.CHUNK,
          value: mockChunk({ text: 'LLXPRT2208_ALPHA' }),
        };
      })();
      mockSendMessageStream.mockResolvedValue(mockResponseStream);

      const events = [];
      const reqParts: ContentBlock[] = [{ text: 'Hi' }];
      for await (const event of turn.run(
        reqParts,
        new AbortController().signal,
      )) {
        events.push(event);
      }

      expect(events).toStrictEqual([
        { type: AgentEventType.Content, value: '\n\n', traceId: undefined },
        {
          type: AgentEventType.Content,
          value: 'LLXPRT2208_ALPHA',
          traceId: undefined,
        },
      ]);
    });
    it('should yield tool_call_request events for function calls', async () => {
      const mockResponseStream = (async function* () {
        yield {
          type: StreamEventType.CHUNK,
          value: mockChunk({
            toolCalls: [
              { id: 'fc1', name: 'tool1', args: { arg1: 'val1' } },
              { name: 'tool2', args: { arg2: 'val2' } },
            ],
          }),
        };
      })();
      mockSendMessageStream.mockResolvedValue(mockResponseStream);

      const events = [];
      const reqParts: ContentBlock[] = [{ text: 'Use tools' }];
      for await (const event of turn.run(
        reqParts,
        new AbortController().signal,
      )) {
        events.push(event);
      }

      expect(events.length).toBe(2);
      const event1 = events[0] as ServerToolCallRequestEvent;
      expect(event1.type).toBe(AgentEventType.ToolCallRequest);
      expect(event1.value).toStrictEqual(
        expect.objectContaining({
          callId: 'fc1',
          name: 'tool1',
          args: { arg1: 'val1' },
          isClientInitiated: false,
        }),
      );
      expect(turn.pendingToolCalls[0]).toStrictEqual(event1.value);

      const event2 = events[1] as ServerToolCallRequestEvent;
      expect(event2.type).toBe(AgentEventType.ToolCallRequest);
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
      const reqParts: ContentBlock[] = [{ text: 'Trigger invalid stream' }];

      const events = [];
      for await (const event of turn.run(
        reqParts,
        new AbortController().signal,
      )) {
        events.push(event);
      }

      expect(events).toStrictEqual([{ type: AgentEventType.InvalidStream }]);
      expect(turn.getDebugResponses().length).toBe(0);
      expect(reportError).not.toHaveBeenCalled();
    });

    it('should yield Error event and report if sendMessageStream throws', async () => {
      const error = new Error('API Error');
      mockSendMessageStream.mockRejectedValue(error);
      const reqParts: ContentBlock[] = [{ text: 'Trigger error' }];
      const historyContent: IContent[] = [
        { speaker: 'ai', blocks: [{ type: 'text', text: 'Previous history' }] },
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
      const errorEvent = events[0] as ServerErrorEvent;
      expect(errorEvent.type).toBe(AgentEventType.Error);
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
          value: mockChunk({
            toolCalls: [
              { id: 'fc1', name: undefined, args: { arg1: 'val1' } },
              { id: 'fc2', name: 'tool2', args: undefined },
              { id: 'fc3', name: undefined, args: undefined },
            ],
          }),
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

      const event1 = events[0] as ServerToolCallRequestEvent;
      expect(event1.value).toMatchObject({
        callId: 'fc1',
        name: 'undefined_tool_name',
        args: { arg1: 'val1' },
      });

      const event2 = events[1] as ServerToolCallRequestEvent;
      expect(event2.value).toMatchObject({
        callId: 'fc2',
        name: 'tool2',
        args: {},
      });

      const event3 = events[2] as ServerToolCallRequestEvent;
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
          value: mockChunk({
            text: 'Partial response',
            finishReason: 'STOP',
            usage: {
              promptTokens: 17,
              completionTokens: 50,
              cachedTokens: 10,
              reasoningTokens: 5,
            },
          }),
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
          type: AgentEventType.Content,
          value: 'Partial response',
          traceId: undefined,
        },
        {
          type: AgentEventType.Finished,
          value: {
            reason: 'stop',
            stopReason: 'STOP',
            usageMetadata: {
              promptTokens: 17,
              completionTokens: 50,
              totalTokens: 0,
              cachedTokens: 10,
              reasoningTokens: 5,
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
          value: mockChunk({
            text: 'This is a long response that was cut off...',
            finishReason: 'MAX_TOKENS',
          }),
        };
      })();
      mockSendMessageStream.mockResolvedValue(mockResponseStream);

      const events = [];
      const reqParts: ContentBlock[] = [{ text: 'Generate long text' }];
      for await (const event of turn.run(
        reqParts,
        new AbortController().signal,
      )) {
        events.push(event);
      }

      expect(events).toStrictEqual([
        {
          type: AgentEventType.Content,
          value: 'This is a long response that was cut off...',
          traceId: undefined,
        },
        {
          type: AgentEventType.Finished,
          value: {
            reason: 'max_tokens',
            stopReason: 'MAX_TOKENS',
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
          value: mockChunk({
            text: 'Content blocked',
            finishReason: 'SAFETY',
          }),
        };
      })();
      mockSendMessageStream.mockResolvedValue(mockResponseStream);

      const events = [];
      const reqParts: ContentBlock[] = [{ text: 'Test safety' }];
      for await (const event of turn.run(
        reqParts,
        new AbortController().signal,
      )) {
        events.push(event);
      }

      expect(events).toStrictEqual([
        {
          type: AgentEventType.Content,
          value: 'Content blocked',
          traceId: undefined,
        },
        {
          type: AgentEventType.Finished,
          value: {
            reason: 'safety',
            stopReason: 'SAFETY',
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
          value: mockChunk({
            text: 'Response without finish reason',
          }),
        };
      })();
      mockSendMessageStream.mockResolvedValue(mockResponseStream);

      const events = [];
      const reqParts: ContentBlock[] = [{ text: 'Test no finish reason' }];
      for await (const event of turn.run(
        reqParts,
        new AbortController().signal,
      )) {
        events.push(event);
      }

      expect(events).toStrictEqual([
        {
          type: AgentEventType.Content,
          value: 'Response without finish reason',
          traceId: undefined,
        },
      ]);
    });

    it('should handle multiple responses with different finish reasons', async () => {
      const mockResponseStream = (async function* () {
        yield {
          type: StreamEventType.CHUNK,
          value: mockChunk({ text: 'First part' }),
        };
        yield {
          type: StreamEventType.CHUNK,
          value: mockChunk({ text: 'Second part', finishReason: 'OTHER' }),
        };
      })();
      mockSendMessageStream.mockResolvedValue(mockResponseStream);

      const events = [];
      const reqParts: ContentBlock[] = [{ text: 'Test multiple responses' }];
      for await (const event of turn.run(
        reqParts,
        new AbortController().signal,
      )) {
        events.push(event);
      }

      expect(events).toStrictEqual([
        {
          type: AgentEventType.Content,
          value: 'First part',
          traceId: undefined,
        },
        {
          type: AgentEventType.Content,
          value: 'Second part',
          traceId: undefined,
        },
        {
          type: AgentEventType.Finished,
          value: {
            reason: 'other',
            stopReason: 'OTHER',
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
          value: mockChunk({ text: 'Success' }),
        };
      })();
      mockSendMessageStream.mockResolvedValue(mockResponseStream);

      const events = [];
      for await (const event of turn.run([], new AbortController().signal)) {
        events.push(event);
      }

      expect(events).toStrictEqual([
        { type: AgentEventType.Retry },
        { type: AgentEventType.Content, value: 'Success', traceId: undefined },
      ]);
    });

    it('should yield content events with traceId', async () => {
      const mockResponseStream = (async function* () {
        yield {
          type: StreamEventType.CHUNK,
          value: mockChunk({ text: 'Hello', responseId: 'trace-123' }),
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
        { type: AgentEventType.Content, value: 'Hello', traceId: 'trace-123' },
      ]);
    });

    it('should yield thought events with traceId', async () => {
      const mockResponseStream = (async function* () {
        yield {
          type: StreamEventType.CHUNK,
          value: mockChunk({
            thought: '[Thought: thinking]',
            responseId: 'trace-456',
          }),
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
          type: AgentEventType.Thought,
          value: { subject: '', description: '[Thought: thinking]' },
          traceId: 'trace-456',
        },
      ]);
    });
  });
});
