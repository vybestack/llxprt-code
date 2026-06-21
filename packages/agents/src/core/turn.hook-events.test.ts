/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ServerGeminiStreamEvent } from './turn.js';
import { Turn, GeminiEventType, DEFAULT_AGENT_ID } from './turn.js';
import type {
  GenerateContentResponse,
  Part,
  FinishReason,
} from '@google/genai';
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

describe('Turn - hook execution control events', () => {
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
    expect((events[0] as { reason: string }).reason).toBe('Custom stop reason');
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
