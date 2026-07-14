/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type {
  ServerToolCallRequestEvent,
  ServerAgentStreamEvent,
} from './turn.js';
import { Turn, AgentEventType, DEFAULT_AGENT_ID } from './turn.js';
import type { ContentBlock } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ChatSession } from './chatSession.js';
import { StreamEventType } from './chatSession.js';

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

describe('Turn run - hook tool restrictions', () => {
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

  it('should not yield tool_call_request events for hook-disallowed function calls', async () => {
    const mockResponseStream = (async function* () {
      yield {
        type: StreamEventType.CHUNK,
        value: mockChunk({
          toolCalls: [
            {
              id: 'allowed-call',
              name: 'read_file',
              args: { file_path: 'file.txt' },
            },
            {
              id: 'blocked-call',
              name: 'run_shell_command',
              args: { command: 'echo blocked' },
            },
          ],
          hookRestrictions: { allowedToolNames: ['read_file'] },
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

    const toolEvents = events.filter(
      (event): event is ServerToolCallRequestEvent =>
        event.type === AgentEventType.ToolCallRequest,
    );
    expect(toolEvents).toHaveLength(1);
    expect(toolEvents[0].value).toStrictEqual(
      expect.objectContaining({
        callId: 'allowed-call',
        name: 'read_file',
        args: { file_path: 'file.txt' },
        isClientInitiated: false,
      }),
    );
    expect(turn.pendingToolCalls).toStrictEqual([toolEvents[0].value]);
  });

  it('should not yield tool_call_request events when hook allows no functions', async () => {
    const mockResponseStream = (async function* () {
      yield {
        type: StreamEventType.CHUNK,
        value: mockChunk({
          toolCalls: [
            {
              id: 'blocked-call',
              name: 'read_file',
              args: { file_path: 'file.txt' },
            },
          ],
          hookRestrictions: { allowedToolNames: [] },
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

    expect(
      events.some((event) => event.type === AgentEventType.ToolCallRequest),
    ).toBe(false);
    expect(turn.pendingToolCalls).toStrictEqual([]);
  });

  it('should report no tool calls in finished outcome when all provider calls are hook-disallowed', async () => {
    const mockResponseStream = (async function* () {
      yield {
        type: StreamEventType.CHUNK,
        value: mockChunk({
          toolCalls: [
            {
              id: 'blocked-call',
              name: 'run_shell_command',
              args: { command: 'echo blocked' },
            },
          ],
          finishReason: 'STOP',
          hookRestrictions: { allowedToolNames: ['read_file'] },
        }),
      };
    })();
    mockSendMessageStream.mockResolvedValue(mockResponseStream);

    const events: ServerAgentStreamEvent[] = [];
    for await (const event of turn.run(
      [{ text: 'Use a blocked tool' }],
      new AbortController().signal,
    )) {
      events.push(event);
    }

    expect(
      events.some((event) => event.type === AgentEventType.ToolCallRequest),
    ).toBe(false);
    const finishedEvent = findFinishedEvent(events);
    expect(finishedEvent).toBeDefined();
    expect(finishedEvent?.value.outcome).toStrictEqual({
      hadVisibleOutput: false,
      hadThinking: false,
      hadToolCalls: false,
    });
  });

  it('should include allowed top-level function calls when candidate parts also contain function calls', async () => {
    const mockResponseStream = (async function* () {
      yield {
        type: StreamEventType.CHUNK,
        value: mockChunk({
          toolCalls: [
            {
              id: 'part-call',
              name: 'read_file',
              args: { file_path: 'part.txt' },
            },
          ],
          hookRestrictions: { allowedToolNames: ['read_file'] },
        }),
      };
      // Second chunk carries the top-level call as a content block
      yield {
        type: StreamEventType.CHUNK,
        value: mockChunk({
          toolCalls: [
            {
              id: 'top-level-call',
              name: 'read_file',
              args: { file_path: 'top.txt' },
            },
          ],
          hookRestrictions: { allowedToolNames: ['read_file'] },
        }),
      };
    })();
    mockSendMessageStream.mockResolvedValue(mockResponseStream);

    const events: ServerAgentStreamEvent[] = [];
    for await (const event of turn.run(
      [{ text: 'Use allowed tools' }],
      new AbortController().signal,
    )) {
      events.push(event);
    }

    const toolEvents = events.filter(
      (event): event is ServerToolCallRequestEvent =>
        event.type === AgentEventType.ToolCallRequest,
    );
    expect(toolEvents.map((event) => event.value.name)).toStrictEqual([
      'read_file',
      'read_file',
    ]);
    expect(toolEvents.map((event) => event.value.callId)).toStrictEqual([
      'part-call',
      'top-level-call',
    ]);
  });

  it('should not inherit hook restrictions from a previous response', async () => {
    const mockResponseStream = (async function* () {
      yield {
        type: StreamEventType.CHUNK,
        value: mockChunk({
          toolCalls: [
            {
              id: 'blocked-call',
              name: 'run_shell_command',
              args: { command: 'echo blocked' },
            },
          ],
          hookRestrictions: { allowedToolNames: ['read_file'] },
        }),
      };
      yield {
        type: StreamEventType.CHUNK,
        value: mockChunk({
          toolCalls: [
            {
              id: 'unrestricted-call',
              name: 'run_shell_command',
              args: { command: 'echo allowed' },
            },
          ],
        }),
      };
    })();
    mockSendMessageStream.mockResolvedValue(mockResponseStream);

    const events: ServerAgentStreamEvent[] = [];
    for await (const event of turn.run(
      [{ text: 'Use tools' }],
      new AbortController().signal,
    )) {
      events.push(event);
    }

    const toolEvents = events.filter(
      (event): event is ServerToolCallRequestEvent =>
        event.type === AgentEventType.ToolCallRequest,
    );
    expect(toolEvents).toHaveLength(1);
    expect(toolEvents[0].value).toStrictEqual(
      expect.objectContaining({
        callId: 'unrestricted-call',
        name: 'run_shell_command',
        args: { command: 'echo allowed' },
      }),
    );
  });
});
