/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260707-AGENTNEUTRAL.P06
 * @requirement:REQ-INT-001
 * @pseudocode stream-processor-neutral, turnprocessor-turn-wrap
 *
 * Behavioral characterization tests for the stream pipeline. These tests
 * pin OBSERVABLE agent-loop behavior BEFORE the neutral migration so the
 * migration slices (P07-P09) can verify they preserve behavior.
 *
 * Uses REAL agent-loop machinery (Turn, ChatSession mock). Mocks ONLY the
 * provider AsyncIterable via the existing turn-test-helpers.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Turn, AgentEventType, DEFAULT_AGENT_ID } from '../turn.js';
import type { ServerAgentStreamEvent } from '../turn.js';
import type { ChatSession } from '../chatSession.js';
import { StreamEventType } from '../chatSession.js';
import {
  type MockedChatInstance,
  mockChunk,
  findFinishedEvent,
} from '../turn-test-helpers.js';

const { mockSendMessageStream, mockGetHistory } = vi.hoisted(() => ({
  mockSendMessageStream: vi.fn(),
  mockGetHistory: vi.fn(),
}));

vi.mock('@vybestack/llxprt-code-core/utils/errorReporting.js', () => ({
  reportError: vi.fn(),
}));

describe('Stream Pipeline Characterization', () => {
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
      'char-prompt-1',
      DEFAULT_AGENT_ID,
      'test',
    );
    mockGetHistory.mockReturnValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * BEHAVIOR: Stream yields Content events for text, then a Finished event.
   */
  describe('event ordering — text content then finished', () => {
    it('yields Content event(s) followed by Finished', async () => {
      mockSendMessageStream.mockResolvedValue(
        (async function* () {
          yield {
            type: StreamEventType.CHUNK,
            value: mockChunk({ text: 'Hello world' }),
          };
          yield {
            type: StreamEventType.CHUNK,
            value: mockChunk({
              text: 'Hello world',
              finishReason: 'STOP',
              usage: {
                promptTokens: 10,
                completionTokens: 5,
                totalTokens: 15,
              },
            }),
          };
        })(),
      );

      const events: ServerAgentStreamEvent[] = [];
      const reqParts: Array<{ text: string }> = [{ text: 'Hi' }];
      for await (const event of turn.run(
        reqParts,
        new AbortController().signal,
      )) {
        events.push(event);
      }

      const contentEvents = events.filter(
        (e) => e.type === AgentEventType.Content,
      );
      const finishedEvents = events.filter(
        (e) => e.type === AgentEventType.Finished,
      );

      expect(contentEvents.length).toBeGreaterThan(0);
      expect(finishedEvents.length).toBe(1);

      const contentIdx = events.findIndex(
        (e) => e.type === AgentEventType.Content,
      );
      const finishedIdx = events.findIndex(
        (e) => e.type === AgentEventType.Finished,
      );
      expect(contentIdx).toBeLessThan(finishedIdx);
    });
  });

  /**
   * BEHAVIOR: Finished event carries a reason.
   */
  describe('finished event — reason', () => {
    it('Finished event carries a reason string', async () => {
      mockSendMessageStream.mockResolvedValue(
        (async function* () {
          yield {
            type: StreamEventType.CHUNK,
            value: mockChunk({
              text: 'done',
              finishReason: 'STOP',
            }),
          };
        })(),
      );

      const events: ServerAgentStreamEvent[] = [];
      const reqParts: Array<{ text: string }> = [{ text: 'Hi' }];
      for await (const event of turn.run(
        reqParts,
        new AbortController().signal,
      )) {
        events.push(event);
      }

      const finished = findFinishedEvent(events);
      expect(finished).toBeDefined();
      expect(finished!.value.reason).toBeDefined();
    });
  });

  /**
   * BEHAVIOR: Tool call yields ToolCallRequest event.
   */
  describe('tool call — ToolCallRequest event', () => {
    it('yields ToolCallRequest for function call parts', async () => {
      mockSendMessageStream.mockResolvedValue(
        (async function* () {
          yield {
            type: StreamEventType.CHUNK,
            value: mockChunk({
              toolCalls: [{ name: 'test_tool', args: { input: 'value' } }],
              finishReason: 'STOP',
            }),
          };
        })(),
      );

      const events: ServerAgentStreamEvent[] = [];
      const reqParts: Array<{ text: string }> = [{ text: 'Hi' }];
      for await (const event of turn.run(
        reqParts,
        new AbortController().signal,
      )) {
        events.push(event);
      }

      const toolCallEvents = events.filter(
        (e) => e.type === AgentEventType.ToolCallRequest,
      );
      expect(toolCallEvents.length).toBeGreaterThan(0);
    });
  });

  /**
   * BEHAVIOR: Thought parts do not crash the pipeline.
   */
  describe('thought content', () => {
    it('handles thought parts without crashing', async () => {
      mockSendMessageStream.mockResolvedValue(
        (async function* () {
          yield {
            type: StreamEventType.CHUNK,
            value: mockChunk({
              thought: 'Let me think...',
              text: 'Answer',
              finishReason: 'STOP',
            }),
          };
        })(),
      );

      const events: ServerAgentStreamEvent[] = [];
      const reqParts: Array<{ text: string }> = [{ text: 'Hi' }];
      for await (const event of turn.run(
        reqParts,
        new AbortController().signal,
      )) {
        events.push(event);
      }

      const thoughtEvents = events.filter(
        (event) => event.type === AgentEventType.Thought,
      );
      expect(thoughtEvents.length).toBeGreaterThan(0);

      const finished = findFinishedEvent(events);
      expect(finished).toBeDefined();
    });
  });

  /**
   * BEHAVIOR: Empty stream completes without crashing.
   */
  describe('empty stream', () => {
    it('completes iteration without error when stream has no content', async () => {
      mockSendMessageStream.mockResolvedValue(
        (async function* () {
          // Empty stream
        })(),
      );

      const events: ServerAgentStreamEvent[] = [];
      const reqParts: Array<{ text: string }> = [{ text: 'Hi' }];
      // Should not throw
      for await (const event of turn.run(
        reqParts,
        new AbortController().signal,
      )) {
        events.push(event);
      }
      // Empty provider stream completes without yielding any events.
      expect(events).toHaveLength(0);
    });
  });

  /**
   * BEHAVIOR: pendingToolCalls populated after tool call.
   */
  describe('pendingToolCalls', () => {
    it('has pendingToolCalls after a function call part', async () => {
      mockSendMessageStream.mockResolvedValue(
        (async function* () {
          yield {
            type: StreamEventType.CHUNK,
            value: mockChunk({
              toolCalls: [{ name: 'test_tool', args: {} }],
              finishReason: 'STOP',
            }),
          };
        })(),
      );

      const reqParts: Array<{ text: string }> = [{ text: 'Hi' }];
      for await (const _event of turn.run(
        reqParts,
        new AbortController().signal,
      )) {
        // consume
      }

      expect(turn.pendingToolCalls).toHaveLength(1);
      expect(turn.pendingToolCalls[0].name).toBe('test_tool');
      expect(turn.pendingToolCalls[0].args).toStrictEqual({});
    });
  });
});
