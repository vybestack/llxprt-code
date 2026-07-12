/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { vi } from 'vitest';
import type { ServerAgentStreamEvent } from './turn.ts?turn-hook-events-suite';
import {
  Turn,
  AgentEventType,
  DEFAULT_AGENT_ID,
} from './turn.ts?turn-hook-events-suite';
import type { ChatSession } from './chatSession.js';
import { StreamEventType } from './chatSession.js';
import {
  type MockedChatInstance,
  mockResponseToChunk,
} from './turn-test-helpers.js';

const mockSendMessageStream = vi.fn();
const mockGetHistory = vi.fn();

vi.mock('@vybestack/llxprt-code-core/utils/errorReporting.js', () => ({
  reportError: vi.fn(),
}));

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
    const events: AgentEventType[] = [];
    for await (const event of turn.run(
      reqParts,
      new AbortController().signal,
    )) {
      events.push(event.type);
    }
    expect(events).toStrictEqual([AgentEventType.AgentExecutionStopped]);
  });

  it('should yield AgentExecutionBlocked event and continue processing', async () => {
    const resp = {
      candidates: [
        {
          content: { parts: [{ text: 'Synthetic response after block' }] },
          finishReason: 'STOP',
        },
      ],
    } as GenerateContentResponse;
    const mockResponseStream = (async function* () {
      yield {
        type: StreamEventType.AGENT_EXECUTION_BLOCKED,
        reason: 'Hook blocked execution',
      };
      yield { type: StreamEventType.CHUNK, value: mockResponseToChunk(resp) };
    })();
    mockSendMessageStream.mockResolvedValue(mockResponseStream);
    const reqParts: Part[] = [{ text: 'test message' }];
    const events: AgentEventType[] = [];
    for await (const event of turn.run(
      reqParts,
      new AbortController().signal,
    )) {
      events.push(event.type);
    }
    expect(events).toContain(AgentEventType.AgentExecutionBlocked);
    expect(events).toContain(AgentEventType.Content);
    expect(events).toContain(AgentEventType.Finished);
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
    const events: ServerAgentStreamEvent[] = [];
    for await (const event of turn.run(
      reqParts,
      new AbortController().signal,
    )) {
      events.push(event);
    }
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe(AgentEventType.AgentExecutionStopped);
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
    const events: ServerAgentStreamEvent[] = [];
    for await (const event of turn.run(
      reqParts,
      new AbortController().signal,
    )) {
      events.push(event);
    }
    expect(events.length).toBeGreaterThan(0);
    const blockedEvent = events.find(
      (e) => e.type === AgentEventType.AgentExecutionBlocked,
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
    const events: ServerAgentStreamEvent[] = [];
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
    expect(stoppedEvent.type).toBe(AgentEventType.AgentExecutionStopped);
    expect(stoppedEvent.reason).toBe('Hook stopped execution');
    expect(stoppedEvent.contextCleared).toBe(true);
  });

  it('should propagate contextCleared=true in AgentExecutionBlocked event', async () => {
    const resp = {
      candidates: [
        {
          content: { parts: [{ text: 'Response after block' }] },
          finishReason: 'STOP',
        },
      ],
    } as GenerateContentResponse;
    const mockResponseStream = (async function* () {
      yield {
        type: StreamEventType.AGENT_EXECUTION_BLOCKED,
        reason: 'Hook blocked execution',
        contextCleared: true,
      };
      yield { type: StreamEventType.CHUNK, value: mockResponseToChunk(resp) };
    })();
    mockSendMessageStream.mockResolvedValue(mockResponseStream);
    const reqParts: Part[] = [{ text: 'test message' }];
    const events: ServerAgentStreamEvent[] = [];
    for await (const event of turn.run(
      reqParts,
      new AbortController().signal,
    )) {
      events.push(event);
    }
    const blockedEvent = events.find(
      (e) => e.type === AgentEventType.AgentExecutionBlocked,
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
    const events: ServerAgentStreamEvent[] = [];
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
    expect(stoppedEvent.type).toBe(AgentEventType.AgentExecutionStopped);
    expect(stoppedEvent.contextCleared).toBeUndefined();
  });
});
