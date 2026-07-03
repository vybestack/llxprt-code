/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for issue #2329: the agents Turn must thread the raw
 * provider stop reason (candidate.finishMessage) into the Finished event as
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

  it('threads finishMessage "refusal" into Finished.value.stopReason', async () => {
    const mockResponseStream = (async function* () {
      yield {
        type: StreamEventType.CHUNK,
        value: {
          candidates: [
            {
              content: { parts: [{ text: 'I decline to answer.' }] },
              finishReason: 'SAFETY',
              finishMessage: 'refusal',
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
    expect(finished?.value.reason).toBe('SAFETY');
    expect(finished?.value.stopReason).toBe('refusal');
  });

  it('threads finishMessage "end_turn" into Finished.value.stopReason for normal completions', async () => {
    const mockResponseStream = (async function* () {
      yield {
        type: StreamEventType.CHUNK,
        value: {
          candidates: [
            {
              content: { parts: [{ text: 'Normal answer.' }] },
              finishReason: 'STOP',
              finishMessage: 'end_turn',
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

  it('omits stopReason from Finished when candidate has no finishMessage', async () => {
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
});
