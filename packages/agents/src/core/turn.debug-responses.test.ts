/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'bun:test';
import type { ServerAgentStreamEvent } from './turn.js';
import { TurnDebugResponses } from './turnDebugResponses.js';
import type { ModelStreamChunk } from '@vybestack/llxprt-code-core/llm-types/index.js';
import {
  Turn,
  AgentEventType,
  DEFAULT_AGENT_ID,
  MAX_DEBUG_RESPONSE_CHUNKS,
} from './turn.js';
import type { ChatSession } from './chatSession.js';
import { StreamEventType } from './chatSession.js';
import type { ContentBlock } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  type MockedChatInstance,
  findFinishedEvent,
  mockChunk,
} from './turn-test-helpers.js';

const { mockSendMessageStream, mockGetHistory } = {
  mockSendMessageStream: vi.fn(),
  mockGetHistory: vi.fn(),
};

void vi.mock('@vybestack/llxprt-code-core/utils/errorReporting.js', () => ({
  reportError: vi.fn(),
}));

const actual = {
  ...(await import(
    '@vybestack/llxprt-code-core/utils/generateContentResponseUtilities.js'
  )),
};
void vi.mock(
  '@vybestack/llxprt-code-core/utils/generateContentResponseUtilities.js',
  () => ({
    // analyzeResponseOutcome now operates on ContentBlock[]; delegate to the
    // real implementation so thinking/tool_call/text detection is correct.
    analyzeResponseOutcome: actual.analyzeResponseOutcome,
  }),
);

function countRetainedThinkingCharacters(
  responses: readonly ModelStreamChunk[],
): number {
  return responses.reduce(
    (total, response) =>
      total +
      response.content.blocks.reduce(
        (chunkTotal, block) =>
          chunkTotal + (block.type === 'thinking' ? block.thought.length : 0),
        0,
      ),
    0,
  );
}

describe('Turn - debug responses and finished event outcome', () => {
  let turn: Turn;
  let mockChatInstance: MockedChatInstance;

  beforeEach(() => {
    vi.resetAllMocks();
    mockChatInstance = {
      sendMessageStream: mockSendMessageStream,
      getHistory: mockGetHistory,
      getConfig: () => undefined,
      getResolvedBaseUrl: () => undefined,
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

    it('retains cumulative thinking in linear space by stream identity', async () => {
      const deltaCount = 128;
      const mockResponseStream = (async function* () {
        for (let index = 1; index <= deltaCount; index++) {
          const chunk = mockChunk({
            thought: 'x'.repeat(index),
            isHidden: false,
          });
          yield {
            type: StreamEventType.CHUNK,
            value: {
              ...chunk,
              content: {
                ...chunk.content,
                blocks: [
                  {
                    type: 'thinking' as const,
                    thought: 'x'.repeat(index),
                    sourceField: 'thinking',
                    streamId: 'reasoning-span-1',
                    streamStatus: 'delta' as const,
                  },
                ],
              },
            },
          };
        }
      })();
      mockSendMessageStream.mockResolvedValue(mockResponseStream);

      for await (const _ of turn.run(
        [{ type: 'text', text: 'Think' }],
        new AbortController().signal,
      )) {
        // consume stream
      }

      const debugResponses = turn.getDebugResponses();
      expect({
        retainedChunks: debugResponses.length,
        retainedCharacters: countRetainedThinkingCharacters(debugResponses),
      }).toStrictEqual({
        retainedChunks: 1,
        retainedCharacters: deltaCount,
      });
    });

    it('keeps the newest thinking state when the appended chunk is what trips the trim', () => {
      // Exercised directly against TurnDebugResponses so the boundary is exact.
      // At the high-water mark nothing is doomed yet, but this chunk carries a
      // continuation AND a sibling, so the sibling is appended and trim runs in
      // the same push. Judging pending drops from the pre-append length writes
      // the replacement into the region trim is about to discard. Measured: the
      // previous arithmetic retains no thought at all here.
      const think = (thought: string) => ({
        type: 'thinking' as const,
        thought,
        sourceField: 'thinking',
        streamId: 'boundary-span',
        streamStatus: 'delta' as const,
      });
      const text = (value: string) => ({ type: 'text' as const, text: value });
      const record = (
        responses: TurnDebugResponses,
        blocks: ContentBlock[],
      ) => {
        responses.push(
          { content: { blocks } } as unknown as ModelStreamChunk,
          blocks,
        );
      };

      const responses = new TurnDebugResponses();
      record(responses, [think('early')]);
      for (let i = 0; i < MAX_DEBUG_RESPONSE_CHUNKS * 2 - 1; i++) {
        record(responses, [text(`filler-${i}`)]);
      }
      expect(responses.length).toBe(MAX_DEBUG_RESPONSE_CHUNKS * 2);

      record(responses, [think('NEWEST'), text('sibling')]);

      const thoughts = responses.retained.flatMap((chunk) =>
        chunk.content.blocks
          .filter((block) => block.type === 'thinking')
          .map((block) => (block as { thought: string }).thought),
      );
      expect(thoughts).toStrictEqual(['NEWEST']);
      expect(responses.length).toBe(MAX_DEBUG_RESPONSE_CHUNKS);
    });

    it('keeps the newest state of a thinking span that trims on the same chunk', async () => {
      // A continued span is replaced at its recorded position, then trimming
      // runs. If the recorded position sits in the half about to be dropped,
      // the newest state of that span is written straight into the discarded
      // region and lost, while its sibling text survives. Collapse and trim are
      // otherwise only tested apart, so this interaction slips through.
      const chunkCount = MAX_DEBUG_RESPONSE_CHUNKS * 2;
      const thinkingChunk = (thought: string) => {
        const chunk = mockChunk({ thought, isHidden: false });
        return {
          ...chunk,
          content: {
            ...chunk.content,
            blocks: [
              {
                type: 'thinking' as const,
                thought,
                sourceField: 'thinking',
                streamId: 'reasoning-span-1',
                streamStatus: 'delta' as const,
              },
            ],
          },
        };
      };
      const mockResponseStream = (async function* () {
        yield { type: StreamEventType.CHUNK, value: thinkingChunk('early') };
        for (let index = 0; index < chunkCount; index++) {
          yield {
            type: StreamEventType.CHUNK,
            value: mockChunk({ text: `filler-${index}` }),
          };
        }
        yield { type: StreamEventType.CHUNK, value: thinkingChunk('FINAL') };
      })();
      mockSendMessageStream.mockResolvedValue(mockResponseStream);

      for await (const _ of turn.run(
        [{ type: 'text', text: 'Continue' }],
        new AbortController().signal,
      )) {
        // consume stream
      }

      const blocks = turn
        .getDebugResponses()
        .flatMap((chunk) => chunk.content.blocks);
      const thoughts = blocks.filter((block) => block.type === 'thinking');

      expect(thoughts).toHaveLength(1);
      expect(thoughts[0]).toMatchObject({ thought: 'FINAL' });
    });

    it('retains only the recent diagnostic chunks during a non-thinking runaway', async () => {
      // Must exceed the trim high-water mark (twice MAX_DEBUG_RESPONSE_CHUNKS),
      // otherwise the stream ends before any trimming is due and the test
      // passes without exercising the bound at all.
      const chunkCount = MAX_DEBUG_RESPONSE_CHUNKS * 3;
      const mockResponseStream = (async function* () {
        for (let index = 0; index < chunkCount; index++) {
          yield {
            type: StreamEventType.CHUNK,
            value: mockChunk({ text: `chunk-${index}` }),
          };
        }
      })();
      mockSendMessageStream.mockResolvedValue(mockResponseStream);

      for await (const _ of turn.run(
        [{ type: 'text', text: 'Continue' }],
        new AbortController().signal,
      )) {
        // consume stream
      }

      const debugResponses = turn.getDebugResponses();
      // Bounded well below the stream length, and bounded in absolute terms so
      // a larger stream cannot grow retention further.
      expect(debugResponses.length).toBeLessThan(chunkCount);
      expect(debugResponses.length).toBeLessThanOrEqual(
        MAX_DEBUG_RESPONSE_CHUNKS * 2,
      );
      // The newest chunk must survive: a diagnostic buffer that drops the most
      // recent output is useless for diagnosing what just happened.
      expect(
        debugResponses[debugResponses.length - 1]?.content.blocks,
      ).toStrictEqual([{ type: 'text', text: `chunk-${chunkCount - 1}` }]);
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
