/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ServerAgentStreamEvent } from './turn.js';
import { Turn, AgentEventType, DEFAULT_AGENT_ID } from './turn.js';
import type { ChatSession } from './chatSession.js';
import { StreamEventType } from './chatSession.js';
import type { ContentBlock } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  type MockedChatInstance,
  findFinishedEvent,
  mockChunk,
} from './turn-test-helpers.js';

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
      const chunk1 = mockChunk({ text: 'Debug 1' });
      const chunk2 = mockChunk({
        toolCalls: [{ name: 'debugTool' }],
      });
      const mockResponseStream = (async function* () {
        yield { type: StreamEventType.CHUNK, value: chunk1 };
        yield { type: StreamEventType.CHUNK, value: chunk2 };
      })();
      mockSendMessageStream.mockResolvedValue(mockResponseStream);
      const reqParts: ContentBlock[] = [{ type: 'text', text: 'Hi' }];
      for await (const _ of turn.run(reqParts, new AbortController().signal)) {
        // consume stream
      }
      const debugResponses = turn.getDebugResponses();
      // Debug responses are neutral ModelStreamChunks whose content.blocks
      // mirror the streamed parts.
      expect(debugResponses).toHaveLength(2);
      expect(debugResponses[0].content.blocks).toStrictEqual([
        { type: 'text', text: 'Debug 1' },
      ]);
      expect(debugResponses[1].content.blocks).toStrictEqual([
        {
          type: 'tool_call',
          id: '',
          name: 'debugTool',
          parameters: {},
        },
      ]);
    });

    describe('Finished event outcome', () => {
      it('should include outcome with hadVisibleOutput true for text-only response', async () => {
        const mockResponseStream = (async function* () {
          yield {
            type: StreamEventType.CHUNK,
            value: mockChunk({
              text: 'Hello world',
              finishReason: 'STOP',
            }),
          };
        })();
        mockSendMessageStream.mockResolvedValue(mockResponseStream);

        const events: ServerAgentStreamEvent[] = [];
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
            value: mockChunk({
              thought: 'internal reasoning',
              finishReason: 'STOP',
            }),
          };
        })();
        mockSendMessageStream.mockResolvedValue(mockResponseStream);

        const events: ServerAgentStreamEvent[] = [];
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
            value: mockChunk({
              toolCalls: [{ name: 'read_file', args: { path: '/tmp/x' } }],
              finishReason: 'STOP',
            }),
          };
        })();
        mockSendMessageStream.mockResolvedValue(mockResponseStream);

        const events: ServerAgentStreamEvent[] = [];
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
            value: mockChunk({ text: 'Hello world' }),
          };
          yield {
            type: StreamEventType.CHUNK,
            value: mockChunk({ finishReason: 'STOP' }),
          };
        })();
        mockSendMessageStream.mockResolvedValue(mockResponseStream);

        const events: ServerAgentStreamEvent[] = [];
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
            value: mockChunk({ thought: 'internal reasoning' }),
          };
          yield {
            type: StreamEventType.CHUNK,
            value: mockChunk({ finishReason: 'STOP' }),
          };
        })();
        mockSendMessageStream.mockResolvedValue(mockResponseStream);

        const events: ServerAgentStreamEvent[] = [];
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
            value: mockChunk({
              toolCalls: [{ name: 'read_file', args: { path: '/tmp/x' } }],
            }),
          };
          yield {
            type: StreamEventType.CHUNK,
            value: mockChunk({ finishReason: 'STOP' }),
          };
        })();
        mockSendMessageStream.mockResolvedValue(mockResponseStream);

        const events: ServerAgentStreamEvent[] = [];
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
            value: mockChunk({ text: 'discarded text' }),
          };
          yield { type: StreamEventType.RETRY };
          yield {
            type: StreamEventType.CHUNK,
            value: mockChunk({ thought: 'internal reasoning' }),
          };
          yield {
            type: StreamEventType.CHUNK,
            value: mockChunk({ finishReason: 'STOP' }),
          };
        })();
        mockSendMessageStream.mockResolvedValue(mockResponseStream);

        const events: ServerAgentStreamEvent[] = [];
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

      it('should emit whitespace-only text without counting it as visible output', async () => {
        const mockResponseStream = (async function* () {
          yield {
            type: StreamEventType.CHUNK,
            value: mockChunk({
              text: '   ',
              finishReason: 'STOP',
            }),
          };
        })();
        mockSendMessageStream.mockResolvedValue(mockResponseStream);

        const events: ServerAgentStreamEvent[] = [];
        for await (const event of turn.run(
          [{ text: 'Hi' }],
          new AbortController().signal,
        )) {
          events.push(event);
        }

        expect(events).toContainEqual({
          type: AgentEventType.Content,
          value: '   ',
          traceId: undefined,
        });
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
