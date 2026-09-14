/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #3535 — Turn.handlePendingFunctionCall must never substitute the
 * literal `undefined_tool_name` for an absent or unnormalizable tool name.
 * These tests drive the real Turn against a mocked chat stream and assert the
 * emitted ToolCallRequestInfo names and synthetic call ids carry the raw name
 * (empty stays empty), never the fabricated literal.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'bun:test';
import type { ServerToolCallRequestEvent } from './turn.js';
import { Turn, AgentEventType, DEFAULT_AGENT_ID } from './turn.js';
import type { ModelStreamChunk } from '@vybestack/llxprt-code-core/llm-types/index.js';
import type {
  ContentBlock,
  IContent,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ChatSession } from './chatSession.js';
import { StreamEventType } from './chatSession.js';

const { mockSendMessageStream, mockGetHistory } = {
  mockSendMessageStream: vi.fn(),
  mockGetHistory: vi.fn(),
};

void vi.mock('@vybestack/llxprt-code-core/utils/errorReporting.js', () => ({
  reportError: vi.fn(),
}));

describe('Turn tool-call name passthrough (issue 3535)', () => {
  let turn: Turn;

  beforeEach(() => {
    vi.resetAllMocks();
    turn = new Turn(
      {
        sendMessageStream: mockSendMessageStream,
        getHistory: mockGetHistory,
        getConfig: () => undefined,
        getResolvedBaseUrl: () => undefined,
      } as unknown as ChatSession,
      'prompt-3535',
      DEFAULT_AGENT_ID,
      'test',
    );
    mockGetHistory.mockReturnValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mockStreamYielding(blocks: ContentBlock[]): void {
    const chunk: ModelStreamChunk = {
      content: { speaker: 'ai', blocks } as IContent,
    };
    mockSendMessageStream.mockResolvedValue(
      (async function* () {
        yield { type: StreamEventType.CHUNK, value: chunk };
      })(),
    );
  }

  async function collectToolCallEvents(): Promise<
    ServerToolCallRequestEvent[]
  > {
    const events: ServerToolCallRequestEvent[] = [];
    for await (const event of turn.run(
      [{ type: 'text', text: 'call something' }] as ContentBlock[],
      new AbortController().signal,
    )) {
      if (event.type === AgentEventType.ToolCallRequest) {
        events.push(event);
      }
    }
    return events;
  }

  it('emits an empty name for an absent tool name and never the fabricated literal', async () => {
    // The provider block carries NO name field at all.
    mockStreamYielding([
      {
        type: 'tool_call',
        id: '',
        parameters: {},
      } as unknown as ContentBlock,
    ]);

    const [event] = await collectToolCallEvents();
    expect(event).toBeDefined();
    expect(event.value.name).toBe('');
    expect(event.value.callId).not.toContain('undefined_tool_name');
    expect(JSON.stringify(event.value)).not.toContain('undefined_tool_name');
  });

  it('stringifies a non-string provider tool name without dropping the request', async () => {
    const block: ContentBlock = {
      type: 'tool_call',
      id: 'numeric-name',
      name: '',
      parameters: {},
    };
    Object.defineProperty(block, 'name', { value: 42 });
    mockStreamYielding([block]);

    const events = await collectToolCallEvents();

    expect(events).toHaveLength(1);
    expect(events[0].value.name).toBe('42');
    expect(events[0].value.callId).toBe('numeric-name');
  });

  it('passes an unnormalizable garbage name through raw', async () => {
    const garbage = 'not a tool!!';
    mockStreamYielding([
      { type: 'tool_call', id: 'garbage-1', name: garbage, parameters: {} },
    ]);

    const [event] = await collectToolCallEvents();
    expect(event).toBeDefined();
    expect(event.value.name).toBe(garbage);
    expect(event.value.callId).not.toContain('undefined_tool_name');
  });

  it('preserves a whitespace-only name as raw whitespace', async () => {
    const rawWhitespace = '   ';
    mockStreamYielding([
      { type: 'tool_call', id: 'ws-1', name: rawWhitespace, parameters: {} },
    ]);

    const [event] = await collectToolCallEvents();
    expect(event).toBeDefined();
    expect(event.value.name).toBe(rawWhitespace);
  });

  it('embeds the raw name segment in synthetic ids and never the fabricated literal', async () => {
    const garbage = 'not a tool!!';
    mockStreamYielding([
      { type: 'tool_call', id: '', name: garbage, parameters: {} },
      { type: 'tool_call', id: '', name: '   ', parameters: {} },
      {
        type: 'tool_call',
        id: '',
        parameters: {},
      } as unknown as ContentBlock,
    ]);

    const events = await collectToolCallEvents();
    expect(events).toHaveLength(3);

    // Garbage name: the raw name is the id prefix before `-<index>-<digest>`.
    expect(events[0].value.callId).toContain(garbage);
    expect(events[0].value.callId).toMatch(
      new RegExp(`^${garbage.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-0-`),
    );
    // Whitespace-only name: raw whitespace is the id prefix.
    expect(events[1].value.callId).toMatch(/^ {3}-1-/);
    // Absent name: the id starts with the empty name segment.
    expect(events[2].value.callId).toMatch(/^-2-/);

    for (const event of events) {
      expect(event.value.callId).not.toContain('undefined_tool_name');
    }
  });
});
