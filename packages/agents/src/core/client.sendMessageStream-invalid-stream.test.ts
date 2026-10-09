/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * sendMessageStream tests: InvalidStream event continuation behavior.
 * Sibling to client.test.ts (split to avoid file-level max-lines disable).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'bun:test';
import type {
  ContentBlock,
  AgentMessageInput,
} from '@vybestack/llxprt-code-core/llm-types/index.js';
import { AgentClient } from './client.js';
import type { ContentGenerator } from '@vybestack/llxprt-code-core/core/contentGenerator.js';
import type { ChatSession } from './chatSession.js';
import { AgentEventType, Turn } from './turn.js';
import {
  fromAsync,
  setupAgentClient,
} from './__tests__/client-test-helpers.js';

const mockChatCreateFn = vi.fn();
const mockGenerateContentFn = vi.fn();
const mockEmbedContentFn = vi.fn();
const mockTurnRunFn = vi.fn();

let client: AgentClient;
async function setupInvalidStreamClient(): Promise<void> {
  mockTurnRunFn.mockReset();
  const ctx = await setupAgentClient(
    {
      mockChatCreateFn,
      mockGenerateContentFn,
      mockEmbedContentFn,
      createTurn: (chat, promptId, agentId, providerName) => {
        const turn = new Turn(chat, promptId, agentId, providerName);
        vi.spyOn(turn, 'run').mockImplementation(mockTurnRunFn);
        return turn;
      },
    },
    { useInjectedConfig: true },
  );
  client = ctx.client;
  (
    client as unknown as {
      todoContinuationService: { todoToolsAvailable: boolean };
    }
  ).todoContinuationService.todoToolsAvailable = false;
}

async function disposeInvalidStreamClient(): Promise<void> {
  await client.dispose();
  vi.restoreAllMocks();
}

describe('AgentClient (client.ts) - sendMessageStream - InvalidStream continuation', () => {
  beforeEach(setupInvalidStreamClient);
  afterEach(disposeInvalidStreamClient);
  it('should recursively call sendMessageStream with "Please continue." when InvalidStream event is received', async () => {
    vi.spyOn(client['config'], 'getContinueOnFailedApiCall').mockReturnValue(
      true,
    );
    // Arrange
    const mockStream1 = (async function* () {
      yield { type: AgentEventType.InvalidStream };
    })();
    const mockStream2 = (async function* () {
      yield { type: AgentEventType.Content, value: 'Continued content' };
    })();

    mockTurnRunFn
      .mockReturnValueOnce(mockStream1)
      .mockReturnValueOnce(mockStream2);

    const mockChat: Partial<ChatSession> = {
      addHistory: vi.fn(),
      getHistory: vi.fn().mockReturnValue([]),
      getLastPromptTokenCount: vi.fn().mockReturnValue(0),
      getProjectedPromptBaseline: vi.fn().mockReturnValue(0),
      getContextLimit: vi.fn().mockReturnValue(1000000),
    };
    client['chat'] = mockChat as ChatSession;

    const initialRequest: ContentBlock[] = [{ type: 'text', text: 'Hi' }];
    const promptId = 'prompt-id-invalid-stream';
    const signal = new AbortController().signal;

    // Act
    const stream = client.sendMessageStream(initialRequest, signal, promptId);
    const events = await fromAsync(stream);

    // Assert
    expect(events).toStrictEqual([
      {
        type: AgentEventType.ModelInfo,
        value: {
          model: 'test-model',
          providerName: 'gemini',
          profileName: null,
          displayLabel: 'test-model',
        },
      },
      { type: AgentEventType.InvalidStream },
      { type: AgentEventType.Content, value: 'Continued content' },
    ]);

    // Verify that turn.run was called twice
    expect(mockTurnRunFn).toHaveBeenCalledTimes(2);

    // First call with original request
    expect(mockTurnRunFn).toHaveBeenNthCalledWith(
      1,
      [
        {
          speaker: 'human',
          blocks: initialRequest,
        },
      ],
      expect.any(Object),
    );

    // Second call with "Please continue."
    expect(mockTurnRunFn).toHaveBeenNthCalledWith(
      2,
      [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'System: Please continue.' }],
        },
      ],
      expect.any(Object),
    );
  });
});

describe('AgentClient (client.ts) - InvalidStream after content', () => {
  beforeEach(setupInvalidStreamClient);
  afterEach(disposeInvalidStreamClient);

  it('does not retry InvalidStream after ordinary content was emitted', async () => {
    vi.spyOn(client['config'], 'getContinueOnFailedApiCall').mockReturnValue(
      true,
    );
    const mockStream = (async function* () {
      yield { type: AgentEventType.Content, value: 'Partial content' };
      yield { type: AgentEventType.InvalidStream };
    })();
    mockTurnRunFn.mockReturnValueOnce(mockStream);
    client['chat'] = {
      addHistory: vi.fn(),
      getHistory: vi.fn().mockReturnValue([]),
      getLastPromptTokenCount: vi.fn().mockReturnValue(0),
      getProjectedPromptBaseline: vi.fn().mockReturnValue(0),
      getContextLimit: vi.fn().mockReturnValue(1000000),
    } as unknown as ChatSession;

    const events = await fromAsync(
      client.sendMessageStream(
        [{ type: 'text', text: 'Hi' }],
        new AbortController().signal,
        'prompt-id-invalid-stream-after-content',
      ),
    );

    expect(events.slice(-2)).toStrictEqual([
      { type: AgentEventType.Content, value: 'Partial content' },
      { type: AgentEventType.InvalidStream },
    ]);
    expect(mockTurnRunFn).toHaveBeenCalledTimes(1);
  });
});

describe('AgentClient (client.ts) - InvalidStream with retry disabled', () => {
  beforeEach(setupInvalidStreamClient);
  afterEach(disposeInvalidStreamClient);

  it('should not recursively call sendMessageStream with "Please continue." when InvalidStream event is received and flag is false', async () => {
    vi.spyOn(client['config'], 'getContinueOnFailedApiCall').mockReturnValue(
      false,
    );
    // Arrange
    const mockStream1 = (async function* () {
      yield { type: AgentEventType.InvalidStream };
    })();

    mockTurnRunFn.mockReturnValueOnce(mockStream1);

    const mockChat: Partial<ChatSession> = {
      addHistory: vi.fn(),
      getHistory: vi.fn().mockReturnValue([]),
      getLastPromptTokenCount: vi.fn().mockReturnValue(0),
      getProjectedPromptBaseline: vi.fn().mockReturnValue(0),
      getContextLimit: vi.fn().mockReturnValue(1000000),
    };
    client['chat'] = mockChat as ChatSession;

    const initialRequest: ContentBlock[] = [{ type: 'text', text: 'Hi' }];
    const promptId = 'prompt-id-invalid-stream';
    const signal = new AbortController().signal;

    // Act
    const stream = client.sendMessageStream(initialRequest, signal, promptId);
    const events = await fromAsync(stream);

    // Assert
    expect(events).toStrictEqual([
      {
        type: AgentEventType.ModelInfo,
        value: {
          model: 'test-model',
          providerName: 'gemini',
          profileName: null,
          displayLabel: 'test-model',
        },
      },
      { type: AgentEventType.InvalidStream },
    ]);

    // Verify that turn.run was called only once
    expect(mockTurnRunFn).toHaveBeenCalledTimes(1);
  });
});

describe('AgentClient (client.ts) - thinking-only InvalidStream', () => {
  beforeEach(setupInvalidStreamClient);
  afterEach(disposeInvalidStreamClient);

  it('should not trigger thinking-only continuation after InvalidStream when flag is false', async () => {
    const { events, continuationRequestPresent, forwardedRequestCount } =
      await observeNotTriggerThinkingOnlyContinuationAfterInvalidStreamWhenFlagIsFalse();
    expect(mockTurnRunFn).toHaveBeenCalledTimes(1);
    expect({
      continuationRequestPresent,
      forwardedRequestCount,
    }).toStrictEqual({
      continuationRequestPresent: false,
      forwardedRequestCount: 1,
    });
    expect(events).toStrictEqual([
      {
        type: AgentEventType.ModelInfo,
        value: {
          model: 'test-model',
          providerName: 'gemini',
          profileName: null,
          displayLabel: 'test-model',
        },
      },
      {
        type: AgentEventType.Thought,
        value: {
          subject: 'Planning',
          description: 'I will do something',
        },
      },
      { type: AgentEventType.InvalidStream },
    ]);
  });
});

const observeNotTriggerThinkingOnlyContinuationAfterInvalidStreamWhenFlagIsFalse =
  async () => {
    vi.spyOn(client['config'], 'getContinueOnFailedApiCall').mockReturnValue(
      false,
    );

    const forwardedRequests: ContentBlock[][] = [];
    mockTurnRunFn.mockReset();
    mockTurnRunFn.mockImplementation((req: AgentMessageInput) => {
      forwardedRequests.push(req as ContentBlock[]);
      return (async function* () {
        yield {
          type: AgentEventType.Thought,
          value: {
            subject: 'Planning',
            description: 'I will do something',
          },
        };
        yield { type: AgentEventType.InvalidStream };
      })();
    });

    vi.spyOn(client['config'], 'getIdeMode').mockReturnValue(false);

    const mockChat: Partial<ChatSession> = {
      addHistory: vi.fn(),
      getHistory: vi.fn().mockReturnValue([]),
      getLastPromptTokenCount: vi.fn().mockReturnValue(0),
      getProjectedPromptBaseline: vi.fn().mockReturnValue(0),
      getContextLimit: vi.fn().mockReturnValue(1000000),
    };
    client['chat'] = mockChat as ChatSession;

    const mockGenerator: Partial<ContentGenerator> = {
      countTokens: vi.fn().mockResolvedValue({ totalTokens: 0 }),
    };
    client['contentGenerator'] = mockGenerator as ContentGenerator;

    const stream = client.sendMessageStream(
      [{ type: 'text', text: 'Do something' }],
      new AbortController().signal,
      'prompt-thinking-invalid-stream-no-continue',
    );
    const events = await fromAsync(stream);

    const continuationRequestPresent = forwardedRequests[0]?.some(
      (part) =>
        typeof part === 'object' &&
        'text' in part &&
        typeof part.text === 'string' &&
        part.text.includes('Continue and take the next concrete action now'),
    );
    return {
      events,
      continuationRequestPresent,
      forwardedRequestCount: forwardedRequests.length,
    };
  };

describe('AgentClient (client.ts) - repeated InvalidStream', () => {
  beforeEach(setupInvalidStreamClient);
  afterEach(disposeInvalidStreamClient);

  it('should stop recursing after one retry when InvalidStream events are repeatedly received', async () => {
    vi.spyOn(client['config'], 'getContinueOnFailedApiCall').mockReturnValue(
      true,
    );
    // Arrange
    // Always return a new invalid stream
    mockTurnRunFn.mockImplementation(() =>
      (async function* () {
        yield { type: AgentEventType.InvalidStream };
      })(),
    );

    const mockChat: Partial<ChatSession> = {
      addHistory: vi.fn(),
      getHistory: vi.fn().mockReturnValue([]),
      getLastPromptTokenCount: vi.fn().mockReturnValue(0),
      getProjectedPromptBaseline: vi.fn().mockReturnValue(0),
      getContextLimit: vi.fn().mockReturnValue(1000000),
    };
    client['chat'] = mockChat as ChatSession;

    const initialRequest: ContentBlock[] = [{ type: 'text', text: 'Hi' }];
    const promptId = 'prompt-id-infinite-invalid-stream';
    const signal = new AbortController().signal;

    // Act
    const stream = client.sendMessageStream(initialRequest, signal, promptId);
    const events = await fromAsync(stream);

    // Assert
    // We expect 1 ModelInfo + 2 InvalidStream events (original + 1 retry)
    expect(events.length).toBe(3);
    expect(events[0]?.type).toBe(AgentEventType.ModelInfo);
    expect(
      events.slice(1).every((e) => e.type === AgentEventType.InvalidStream),
    ).toBe(true);

    // Verify that turn.run was called twice
    expect(mockTurnRunFn).toHaveBeenCalledTimes(2);
  });
});
