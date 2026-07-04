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
 * emitted ServerGeminiStreamEvent values.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { GenerateContentResponse, Part } from '@google/genai';
import { Turn, GeminiEventType, DEFAULT_AGENT_ID } from './turn.js';
import type { ChatSession } from './chatSession.js';
import { StreamEventType } from './chatSession.js';
import {
  findFinishedEvent,
  type MockedChatInstance,
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

// Inline duplicate of generateContentResponseUtilitiesMock() from
// turn-test-helpers.ts. The shared helper cannot be referenced here because
// vi.mock factories are hoisted above ES imports, and turn-test-helpers.ts
// imports from ./turn.js (which itself imports this mocked module), creating
// a load-time circular dependency that deadlocks the dynamic import. This
// matches the same inline pattern used by turn.test.ts.
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
        value: {
          candidates: [
            {
              content: { parts: [{ text: 'I decline to answer.' }] },
              finishReason: 'STOP',
              providerStopReason: 'refusal',
            },
          ],
        } as GenerateContentResponse,
      };
    })();
    mockSendMessageStream.mockResolvedValue(mockResponseStream);

    const events = [];
    const reqParts: Part[] = [{ text: 'risky request' }];
    for await (const event of turn.run(
      reqParts,
      new AbortController().signal,
    )) {
      events.push(event);
    }

    const finished = findFinishedEvent(events);
    expect(finished).toBeDefined();
    expect(finished?.type).toBe(GeminiEventType.Finished);
    expect(finished?.value.reason).toBe('STOP');
    expect(finished?.value.stopReason).toBe('refusal');
  });

  it('threads providerStopReason "end_turn" into Finished.value.stopReason for normal completions', async () => {
    const mockResponseStream = (async function* () {
      yield {
        type: StreamEventType.CHUNK,
        value: {
          candidates: [
            {
              content: { parts: [{ text: 'Normal answer.' }] },
              finishReason: 'STOP',
              providerStopReason: 'end_turn',
            },
          ],
        } as GenerateContentResponse,
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
    expect(finished?.value.reason).toBe('STOP');
    expect(finished?.value.stopReason).toBe('end_turn');
  });

  it('omits stopReason from Finished when candidate has no providerStopReason', async () => {
    const mockResponseStream = (async function* () {
      yield {
        type: StreamEventType.CHUNK,
        value: {
          candidates: [
            {
              content: { parts: [{ text: 'answer' }] },
              finishReason: 'STOP',
            },
          ],
        } as GenerateContentResponse,
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
    expect(finished?.value.stopReason).toBeUndefined();
  });

  it('omits stopReason from Finished when providerStopReason is an empty string', async () => {
    const mockResponseStream = (async function* () {
      yield {
        type: StreamEventType.CHUNK,
        value: {
          candidates: [
            {
              content: { parts: [{ text: 'answer' }] },
              finishReason: 'STOP',
              providerStopReason: '',
            },
          ],
        } as GenerateContentResponse,
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
    expect(finished?.value).not.toHaveProperty('stopReason');
  });

  it('threads providerStopReason "refusal" from a content-less trailing metadata chunk', async () => {
    // Models the real streaming shape: Anthropic delivers visible text on an
    // initial chunk with no finishReason, then emits a SEPARATE trailing
    // metadata-only chunk carrying the terminal stop reason/message
    // (content-less, parts: []). The Turn must surface the refusal from that
    // final chunk.
    const mockResponseStream = (async function* () {
      yield {
        type: StreamEventType.CHUNK,
        value: {
          candidates: [
            {
              content: { parts: [{ text: 'I decline to answer.' }] },
            },
          ],
        } as GenerateContentResponse,
      };
      yield {
        type: StreamEventType.CHUNK,
        value: {
          candidates: [
            {
              content: { parts: [] },
              finishReason: 'STOP',
              providerStopReason: 'refusal',
            },
          ],
        } as GenerateContentResponse,
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
    expect(finished?.type).toBe(GeminiEventType.Finished);
    expect(finished?.value.reason).toBe('STOP');
    expect(finished?.value.stopReason).toBe('refusal');
  });

  it('does not leak the SDK finishMessage description into Finished.value.stopReason', async () => {
    // The SDK's native Candidate.finishMessage is a human-readable finish
    // description. A native Gemini response may populate it with descriptive
    // text; that text must never be misinterpreted as a machine stop-reason
    // signal. Only the repo-owned providerStopReason carrier feeds stopReason.
    const mockResponseStream = (async function* () {
      yield {
        type: StreamEventType.CHUNK,
        value: {
          candidates: [
            {
              content: { parts: [{ text: 'A normal answer.' }] },
              finishReason: 'STOP',
              finishMessage: 'The model completed successfully.',
            },
          ],
        } as GenerateContentResponse,
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
    expect(finished?.value.reason).toBe('STOP');
    expect(finished?.value).not.toHaveProperty('stopReason');
  });
});
