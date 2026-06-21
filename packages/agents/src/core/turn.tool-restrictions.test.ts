/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type {
  ServerGeminiToolCallRequestEvent,
  ServerGeminiStreamEvent,
} from './turn.js';
import { Turn, GeminiEventType, DEFAULT_AGENT_ID } from './turn.js';
import type {
  GenerateContentResponse,
  Part,
  FinishReason,
} from '@google/genai';
import type { ChatSession } from './chatSession.js';
import { StreamEventType } from './chatSession.js';
import { attachHookRestrictedAllowedTools } from './hookToolRestrictions.js';
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
        value: attachHookRestrictedAllowedTools(
          {
            candidates: [
              {
                content: {
                  parts: [
                    {
                      functionCall: {
                        id: 'allowed-call',
                        name: 'read_file',
                        args: { file_path: 'file.txt' },
                      },
                    },
                    {
                      functionCall: {
                        id: 'blocked-call',
                        name: 'run_shell_command',
                        args: { command: 'echo blocked' },
                      },
                    },
                  ],
                },
              },
            ],
          } as unknown as GenerateContentResponse,
          ['read_file'],
        ),
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

    const toolEvents = events.filter(
      (event): event is ServerGeminiToolCallRequestEvent =>
        event.type === GeminiEventType.ToolCallRequest,
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
        value: attachHookRestrictedAllowedTools(
          {
            candidates: [
              {
                content: {
                  parts: [
                    {
                      functionCall: {
                        id: 'blocked-call',
                        name: 'read_file',
                        args: { file_path: 'file.txt' },
                      },
                    },
                  ],
                },
              },
            ],
          } as unknown as GenerateContentResponse,
          [],
        ),
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

    expect(
      events.some((event) => event.type === GeminiEventType.ToolCallRequest),
    ).toBe(false);
    expect(turn.pendingToolCalls).toStrictEqual([]);
  });

  it('should report no tool calls in finished outcome when all provider calls are hook-disallowed', async () => {
    const mockResponseStream = (async function* () {
      yield {
        type: StreamEventType.CHUNK,
        value: attachHookRestrictedAllowedTools(
          {
            candidates: [
              {
                content: {
                  parts: [
                    {
                      functionCall: {
                        id: 'blocked-call',
                        name: 'run_shell_command',
                        args: { command: 'echo blocked' },
                      },
                    },
                  ],
                },
                finishReason: 'STOP' as FinishReason,
              },
            ],
          } as unknown as GenerateContentResponse,
          ['read_file'],
        ),
      };
    })();
    mockSendMessageStream.mockResolvedValue(mockResponseStream);

    const events: ServerGeminiStreamEvent[] = [];
    for await (const event of turn.run(
      [{ text: 'Use a blocked tool' }],
      new AbortController().signal,
    )) {
      events.push(event);
    }

    expect(
      events.some((event) => event.type === GeminiEventType.ToolCallRequest),
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
    const topLevelCall = {
      id: 'top-level-call',
      name: 'read_file',
      args: { file_path: 'top.txt' },
    };
    const mockResponseStream = (async function* () {
      yield {
        type: StreamEventType.CHUNK,
        value: attachHookRestrictedAllowedTools(
          {
            candidates: [
              {
                content: {
                  parts: [
                    {
                      functionCall: {
                        id: 'part-call',
                        name: 'read_file',
                        args: { file_path: 'part.txt' },
                      },
                    },
                  ],
                },
              },
            ],
            functionCalls: [topLevelCall],
          } as unknown as GenerateContentResponse,
          ['read_file'],
        ),
      };
    })();
    mockSendMessageStream.mockResolvedValue(mockResponseStream);

    const events: ServerGeminiStreamEvent[] = [];
    for await (const event of turn.run(
      [{ text: 'Use allowed tools' }],
      new AbortController().signal,
    )) {
      events.push(event);
    }

    const toolEvents = events.filter(
      (event): event is ServerGeminiToolCallRequestEvent =>
        event.type === GeminiEventType.ToolCallRequest,
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
        value: attachHookRestrictedAllowedTools(
          {
            candidates: [
              {
                content: {
                  parts: [
                    {
                      functionCall: {
                        id: 'blocked-call',
                        name: 'run_shell_command',
                        args: { command: 'echo blocked' },
                      },
                    },
                  ],
                },
              },
            ],
          } as unknown as GenerateContentResponse,
          ['read_file'],
        ),
      };
      yield {
        type: StreamEventType.CHUNK,
        value: {
          candidates: [
            {
              content: {
                parts: [
                  {
                    functionCall: {
                      id: 'unrestricted-call',
                      name: 'run_shell_command',
                      args: { command: 'echo allowed' },
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

    const events: ServerGeminiStreamEvent[] = [];
    for await (const event of turn.run(
      [{ text: 'Use tools' }],
      new AbortController().signal,
    )) {
      events.push(event);
    }

    const toolEvents = events.filter(
      (event): event is ServerGeminiToolCallRequestEvent =>
        event.type === GeminiEventType.ToolCallRequest,
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
