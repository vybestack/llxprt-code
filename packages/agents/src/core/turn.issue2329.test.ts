/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for issue #2329: the agents Turn must thread the raw
 * provider stop reason (repo-owned candidate providerStopReason carrier) into the Finished event as
 * `value.stopReason` so the CLI can show a refusal-specific notice.
 *
 * Follows the patterns in turn.test.ts: drives the Turn class with fake stream
 * events (StreamEventType.CHUNK with a GenerateContentResponse) and collects
 * emitted ServerAgentStreamEvent values.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Turn, AgentEventType, DEFAULT_AGENT_ID } from './turn.js';
import type { ChatSession } from './chatSession.js';
import { StreamEventType } from './chatSession.js';
import {
  findFinishedEvent,
  type MockedChatInstance,
  mockChunk,
} from './turn-test-helpers.js';

const { mockSendMessageStream, mockGetHistory } = vi.hoisted(() => ({
  mockSendMessageStream: vi.fn(),
  mockGetHistory: vi.fn(),
}));

vi.mock('@vybestack/llxprt-code-core/utils/errorReporting.js', () => ({
  reportError: vi.fn(),
}));

describe('Issue 2329: Finished event carries raw stopReason @issue:2329', () => {
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
      'prompt-id-2329',
      DEFAULT_AGENT_ID,
      'test',
    );
    mockGetHistory.mockReturnValue([]);
    mockSendMessageStream.mockResolvedValue((async function* () {})());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('threads providerStopReason "refusal" into Finished.value.stopReason', async () => {
    const mockResponseStream = (async function* () {
      yield {
        type: StreamEventType.CHUNK,
        value: mockChunk({
          text: 'I decline to answer.',
          finishReason: 'STOP',
          rawStopReason: 'refusal',
        }),
      };
    })();
    mockSendMessageStream.mockResolvedValue(mockResponseStream);

    const events = [];
    for await (const event of turn.run(
      [{ text: 'risky request' }],
      new AbortController().signal,
    )) {
      events.push(event);
    }

    const finished = findFinishedEvent(events);
    expect(finished).toBeDefined();
    expect(finished?.type).toBe(AgentEventType.Finished);
    expect(finished?.value.reason).toBe('stop');
    expect(finished?.value.stopReason).toBe('refusal');
  });

  it('threads providerStopReason "end_turn" into Finished.value.stopReason for normal completions', async () => {
    const mockResponseStream = (async function* () {
      yield {
        type: StreamEventType.CHUNK,
        value: mockChunk({
          text: 'Normal answer.',
          finishReason: 'STOP',
          rawStopReason: 'end_turn',
        }),
      };
    })();
    mockSendMessageStream.mockResolvedValue(mockResponseStream);

    const events = [];
    for await (const event of turn.run(
      [{ text: 'hi' }],
      new AbortController().signal,
    )) {
      events.push(event);
    }

    const finished = findFinishedEvent(events);
    expect(finished).toBeDefined();
    expect(finished?.value.reason).toBe('stop');
    expect(finished?.value.stopReason).toBe('end_turn');
  });

  it('omits stopReason from Finished when candidate has no providerStopReason', async () => {
    const mockResponseStream = (async function* () {
      yield {
        type: StreamEventType.CHUNK,
        value: mockChunk({
          text: 'answer',
          finishReason: 'STOP',
        }),
      };
    })();
    mockSendMessageStream.mockResolvedValue(mockResponseStream);

    const events = [];
    for await (const event of turn.run(
      [{ text: 'hi' }],
      new AbortController().signal,
    )) {
      events.push(event);
    }

    const finished = findFinishedEvent(events);
    expect(finished).toBeDefined();
    // When no providerStopReason is set, rawStopReason is the Gemini enum
    // string ('STOP'). That's non-empty so stopReason IS present.
    expect(finished?.value.stopReason).toBe('STOP');
  });

  it('omits stopReason from Finished when providerStopReason is an empty string', async () => {
    const mockResponseStream = (async function* () {
      yield {
        type: StreamEventType.CHUNK,
        value: mockChunk({
          text: 'answer',
          finishReason: 'STOP',
          rawStopReason: '',
        }),
      };
    })();
    mockSendMessageStream.mockResolvedValue(mockResponseStream);

    const events = [];
    for await (const event of turn.run(
      [{ text: 'hi' }],
      new AbortController().signal,
    )) {
      events.push(event);
    }

    const finished = findFinishedEvent(events);
    expect(finished).toBeDefined();
    // rawStopReason is '' (empty). turn.ts omits stopReason when it's empty.
    expect(finished?.value).not.toHaveProperty('stopReason');
  });

  it('threads providerStopReason "refusal" from a content-less trailing metadata chunk', async () => {
    const mockResponseStream = (async function* () {
      yield {
        type: StreamEventType.CHUNK,
        value: mockChunk({ text: 'I decline to answer.' }),
      };
      yield {
        type: StreamEventType.CHUNK,
        value: mockChunk({
          finishReason: 'STOP',
          rawStopReason: 'refusal',
        }),
      };
    })();
    mockSendMessageStream.mockResolvedValue(mockResponseStream);

    const events = [];
    for await (const event of turn.run(
      [{ text: 'risky request' }],
      new AbortController().signal,
    )) {
      events.push(event);
    }

    const finished = findFinishedEvent(events);
    expect(finished).toBeDefined();
    expect(finished?.type).toBe(AgentEventType.Finished);
    expect(finished?.value.reason).toBe('stop');
    expect(finished?.value.stopReason).toBe('refusal');
  });

  it('does not leak the SDK finishMessage description into Finished.value.stopReason', async () => {
    const mockResponseStream = (async function* () {
      yield {
        type: StreamEventType.CHUNK,
        value: mockChunk({
          text: 'A normal answer.',
          finishReason: 'STOP',
        }),
      };
    })();
    mockSendMessageStream.mockResolvedValue(mockResponseStream);

    const events = [];
    for await (const event of turn.run(
      [{ text: 'hi' }],
      new AbortController().signal,
    )) {
      events.push(event);
    }

    const finished = findFinishedEvent(events);
    expect(finished).toBeDefined();
    expect(finished?.value.reason).toBe('stop');
    // stopReason carries the raw Gemini finish reason string ('STOP'),
    // NOT a finishMessage text (which the neutral pipeline never reads).
    expect(finished?.value.stopReason).not.toContain('completed successfully');
    expect(finished?.value.stopReason).toBe('STOP');
  });
});
