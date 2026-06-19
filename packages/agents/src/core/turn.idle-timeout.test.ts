/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ServerGeminiStreamEvent } from './turn.js';
import { Turn, GeminiEventType, DEFAULT_AGENT_ID } from './turn.js';
import type { GenerateContentResponse, Part } from '@google/genai';
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

describe('Turn - stream idle timeout behavioral tests', () => {
  let turn: Turn;
  let mockChatInstance: MockedChatInstance;
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    process.env = { ...originalEnv };
    delete process.env.LLXPRT_STREAM_IDLE_TIMEOUT_MS;
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
    vi.useRealTimers();
    vi.restoreAllMocks();
    process.env = originalEnv;
  });

  it('honors config setting: timeout fires after custom timeout value from getConfig()', async () => {
    const customTimeoutMs = 30_000;
    const mockGetConfig = vi.fn().mockReturnValue({
      getEphemeralSetting: (key: string) => {
        if (key === 'stream-idle-timeout-ms') {
          return customTimeoutMs;
        }
        return undefined;
      },
    });

    mockChatInstance = {
      sendMessageStream: mockSendMessageStream,
      getHistory: mockGetHistory,
      getConfig: mockGetConfig,
    } as unknown as MockedChatInstance;

    turn = new Turn(
      mockChatInstance as unknown as ChatSession,
      'prompt-id-1',
      DEFAULT_AGENT_ID,
      'test',
    );
    mockGetHistory.mockReturnValue([]);

    const mockResponseStream = (async function* () {
      await vi.advanceTimersByTimeAsync(45_000);
      yield {
        type: StreamEventType.CHUNK,
        value: {
          candidates: [{ content: { parts: [{ text: 'Late response' }] } }],
        } as GenerateContentResponse,
      };
    })();
    mockSendMessageStream.mockResolvedValue(mockResponseStream);

    const events: ServerGeminiStreamEvent[] = [];
    const reqParts: Part[] = [{ text: 'Hi' }];
    const signal = new AbortController().signal;

    const iterator = turn.run(reqParts, signal);
    const runPromise = (async () => {
      for await (const event of iterator) {
        events.push(event);
      }
    })();

    await vi.advanceTimersByTimeAsync(29_999);
    await Promise.resolve();
    expect(events).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(2);
    await Promise.resolve();

    await vi.runAllTimersAsync();
    await runPromise;

    const timeoutEvent = events.find(
      (e) => e.type === GeminiEventType.StreamIdleTimeout,
    );
    expect(timeoutEvent).toBeDefined();
    expect(mockGetConfig).toHaveBeenCalled();
  });

  it('honors config setting: no timeout when iterator yields within custom timeout', async () => {
    const customTimeoutMs = 30_000;
    const mockGetConfig = vi.fn().mockReturnValue({
      getEphemeralSetting: (key: string) => {
        if (key === 'stream-idle-timeout-ms') {
          return customTimeoutMs;
        }
        return undefined;
      },
    });

    mockChatInstance = {
      sendMessageStream: mockSendMessageStream,
      getHistory: mockGetHistory,
      getConfig: mockGetConfig,
    } as unknown as MockedChatInstance;

    turn = new Turn(
      mockChatInstance as unknown as ChatSession,
      'prompt-id-1',
      DEFAULT_AGENT_ID,
      'test',
    );
    mockGetHistory.mockReturnValue([]);

    const mockResponseStream = (async function* () {
      yield {
        type: StreamEventType.CHUNK,
        value: {
          candidates: [{ content: { parts: [{ text: 'Fast response' }] } }],
        } as GenerateContentResponse,
      };
    })();
    mockSendMessageStream.mockResolvedValue(mockResponseStream);

    const events: ServerGeminiStreamEvent[] = [];
    const reqParts: Part[] = [{ text: 'Hi' }];
    const signal = new AbortController().signal;

    for await (const event of turn.run(reqParts, signal)) {
      events.push(event);
    }

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe(GeminiEventType.Content);
    expect((events[0] as { value: string }).value).toBe('Fast response');
  });

  it('disabled path: no timeout when setting is 0, even after 30 minutes', async () => {
    const mockGetConfig = vi.fn().mockReturnValue({
      getEphemeralSetting: (key: string) => {
        if (key === 'stream-idle-timeout-ms') {
          return 0;
        }
        return undefined;
      },
    });

    mockChatInstance = {
      sendMessageStream: mockSendMessageStream,
      getHistory: mockGetHistory,
      getConfig: mockGetConfig,
    } as unknown as MockedChatInstance;

    turn = new Turn(
      mockChatInstance as unknown as ChatSession,
      'prompt-id-1',
      DEFAULT_AGENT_ID,
      'test',
    );
    mockGetHistory.mockReturnValue([]);

    let resolveIterator: () => void;
    const iteratorPromise = new Promise<void>((resolve) => {
      resolveIterator = resolve;
    });

    const mockResponseStream = (async function* () {
      await iteratorPromise;
      yield {
        type: StreamEventType.CHUNK,
        value: {
          candidates: [{ content: { parts: [{ text: 'Finally' }] } }],
        } as GenerateContentResponse,
      };
    })();
    mockSendMessageStream.mockResolvedValue(mockResponseStream);

    const events: ServerGeminiStreamEvent[] = [];
    const reqParts: Part[] = [{ text: 'Hi' }];
    const abortController = new AbortController();

    const runPromise = (async () => {
      for await (const event of turn.run(reqParts, abortController.signal)) {
        events.push(event);
      }
    })();

    await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
    await Promise.resolve();

    expect(
      events.find((e) => e.type === GeminiEventType.StreamIdleTimeout),
    ).toBeUndefined();

    resolveIterator!();
    await vi.runAllTimersAsync();
    await runPromise;

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe(GeminiEventType.Content);
  });

  it('env var precedence: env var overrides config setting', async () => {
    const envTimeoutMs = 15_000;
    const configTimeoutMs = 60_000;

    process.env.LLXPRT_STREAM_IDLE_TIMEOUT_MS = String(envTimeoutMs);

    const mockGetConfig = vi.fn().mockReturnValue({
      getEphemeralSetting: (key: string) => {
        if (key === 'stream-idle-timeout-ms') {
          return configTimeoutMs;
        }
        return undefined;
      },
    });

    mockChatInstance = {
      sendMessageStream: mockSendMessageStream,
      getHistory: mockGetHistory,
      getConfig: mockGetConfig,
    } as unknown as MockedChatInstance;

    turn = new Turn(
      mockChatInstance as unknown as ChatSession,
      'prompt-id-1',
      DEFAULT_AGENT_ID,
      'test',
    );
    mockGetHistory.mockReturnValue([]);

    const mockResponseStream = (async function* () {
      await vi.advanceTimersByTimeAsync(30_000);
      yield {
        type: StreamEventType.CHUNK,
        value: {
          candidates: [{ content: { parts: [{ text: 'Late response' }] } }],
        } as GenerateContentResponse,
      };
    })();
    mockSendMessageStream.mockResolvedValue(mockResponseStream);

    const events: ServerGeminiStreamEvent[] = [];
    const reqParts: Part[] = [{ text: 'Hi' }];
    const signal = new AbortController().signal;

    const runPromise = (async () => {
      for await (const event of turn.run(reqParts, signal)) {
        events.push(event);
      }
    })();

    await vi.advanceTimersByTimeAsync(16_000);
    await Promise.resolve();

    await vi.runAllTimersAsync();
    await runPromise;

    const timeoutEvent = events.find(
      (e) => e.type === GeminiEventType.StreamIdleTimeout,
    );
    expect(timeoutEvent).toBeDefined();
  });

  it('default-off: no watchdog timer when no env var and no ephemeral setting', async () => {
    delete process.env.LLXPRT_STREAM_IDLE_TIMEOUT_MS;

    const mockGetConfig = vi.fn().mockReturnValue({
      getEphemeralSetting: (key: string) => {
        if (key === 'stream-idle-timeout-ms') {
          return undefined;
        }
        return undefined;
      },
    });

    mockChatInstance = {
      sendMessageStream: mockSendMessageStream,
      getHistory: mockGetHistory,
      getConfig: mockGetConfig,
    } as unknown as MockedChatInstance;

    turn = new Turn(
      mockChatInstance as unknown as ChatSession,
      'prompt-id-1',
      DEFAULT_AGENT_ID,
      'test',
    );
    mockGetHistory.mockReturnValue([]);

    let resolveIterator: () => void;
    const iteratorPromise = new Promise<void>((resolve) => {
      resolveIterator = resolve;
    });

    const mockResponseStream = (async function* () {
      await iteratorPromise;
      yield {
        type: StreamEventType.CHUNK,
        value: {
          candidates: [{ content: { parts: [{ text: 'Finally' }] } }],
        } as GenerateContentResponse,
      };
    })();
    mockSendMessageStream.mockResolvedValue(mockResponseStream);

    const events: ServerGeminiStreamEvent[] = [];
    const reqParts: Part[] = [{ text: 'Hi' }];
    const abortController = new AbortController();

    const runPromise = (async () => {
      for await (const event of turn.run(reqParts, abortController.signal)) {
        events.push(event);
      }
    })();

    await vi.advanceTimersByTimeAsync(700_000);
    await Promise.resolve();

    expect(
      events.find((e) => e.type === GeminiEventType.StreamIdleTimeout),
    ).toBeUndefined();

    expect(vi.getTimerCount()).toBe(0);

    resolveIterator!();
    await vi.runAllTimersAsync();
    await runPromise;

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe(GeminiEventType.Content);
  });
});
