/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * sendMessageStream tests: InvalidStream event continuation behavior.
 * Sibling to client.test.ts (split to avoid file-level max-lines disable).
 */

import { automock } from '@vybestack/llxprt-code-test-utils';
import { describe, it, expect, vi, beforeEach, afterEach } from 'bun:test';
import type {
  ContentBlock,
  AgentMessageInput,
} from '@vybestack/llxprt-code-core/llm-types/index.js';
import { AgentClient } from './client.js';
import type { ContentGenerator } from '@vybestack/llxprt-code-core/core/contentGenerator.js';
import type { ChatSession } from './chatSession.js';
import { AgentEventType } from './turn.js';
import {
  fromAsync,
  setupAgentClient,
  type MockResponseShape,
} from './client-test-helpers.js';

// Mock prompts module before imports
const realConfigModule = {
  ...(await import('@vybestack/llxprt-code-core/config/config.js')),
};

void vi.mock('@vybestack/llxprt-code-core/core/prompts.js', () => ({
  getCoreSystemPromptAsync: vi.fn(() =>
    Promise.resolve('Test system instruction'),
  ),
  getCoreSystemPrompt: vi.fn(() => 'Test system instruction'),
  getCompressionPrompt: vi.fn(() => 'Test compression prompt'),
  initializePromptSystem: vi.fn(() => Promise.resolve(undefined)),
}));

// Mock clientToolGovernance module so tests can control tool name/governance returns
void vi.mock('./clientToolGovernance.js', () => ({
  getToolGovernanceEphemerals: vi.fn(() => undefined),
  readToolList: vi.fn((v: unknown) =>
    Array.isArray(v)
      ? (v as unknown[]).filter(
          (e): e is string => typeof e === 'string' && e.trim().length > 0,
        )
      : [],
  ),
  buildToolDeclarationsFromView: vi.fn(() => []),
  getEnabledToolNamesForPrompt: vi.fn(() => []),
  shouldIncludeSubagentDelegationForConfig: vi.fn(() => Promise.resolve(false)),
}));

// --- Mocks (hoisted so vi.mock factories can reference them) ---
const {
  mockChatCreateFn,
  mockGenerateContentFn,
  mockEmbedContentFn,
  mockTurnRunFn,
} = {
  mockChatCreateFn: vi.fn(),
  mockGenerateContentFn: vi.fn(),
  mockEmbedContentFn: vi.fn(),
  mockTurnRunFn: vi.fn(),
};

const {
  todoStoreReadMock,
  todoStoreReadPausedMock,
  todoStoreWritePausedMock,
  mockTodoStoreConstructor,
} = (() => {
  const readMock = vi.fn();
  const readPausedMock = vi.fn();
  const writePausedMock = vi.fn();
  const constructorMock = vi.fn().mockImplementation(() => ({
    readTodos: readMock,
    readPausedState: readPausedMock,
    writePausedState: writePausedMock,
  }));
  return {
    todoStoreReadMock: readMock,
    todoStoreReadPausedMock: readPausedMock,
    todoStoreWritePausedMock: writePausedMock,
    mockTodoStoreConstructor: constructorMock,
  };
})();

void vi.mock(
  '@vybestack/llxprt-code-core/services/complexity-analyzer.js',
  () => ({
    ComplexityAnalyzer: vi.fn().mockImplementation(() => ({
      analyzeComplexity: vi.fn().mockReturnValue({
        complexityScore: 0.2,
        isComplex: false,
        detectedTasks: [],
        sequentialIndicators: [],
        questionCount: 0,
        shouldSuggestTodos: false,
      }),
    })),
  }),
);

void vi.mock(
  '@vybestack/llxprt-code-core/services/todo-reminder-service.js',
  () => ({
    TodoReminderService: vi.fn().mockImplementation(() => ({
      getComplexTaskSuggestion: vi.fn(),
      getEscalatedComplexTaskSuggestion: vi.fn(),
      getCreateListReminder: vi.fn(),
      getUpdateActiveTodoReminder: vi.fn(),
    })),
  }),
);
const actual = { ...(await import('@vybestack/llxprt-code-tools')) };
void vi.mock('@vybestack/llxprt-code-tools', () => ({
  ...actual,
  LocalTodoStore: mockTodoStoreConstructor,
}));
const __actual = { ...(await import('./turn')) };
void vi.mock('./turn', () => {
  const result = __actual as
    | typeof import('./turn.js')
    | Promise<typeof import('./turn.js')>;
  class MockTurn {
    pendingToolCalls: unknown[] = [];
    run = mockTurnRunFn;
    constructor() {}
  }
  if (result instanceof Promise) {
    return result.then((actual) => ({
      ...actual,
      Turn: MockTurn,
    }));
  }
  return {
    ...result,
    Turn: MockTurn,
  };
});

void vi.mock('@vybestack/llxprt-code-core/config/config.js', () =>
  automock(realConfigModule),
);
void vi.mock('@vybestack/llxprt-code-core/utils/getFolderStructure.js', () => ({
  getFolderStructure: vi.fn().mockResolvedValue('Mock Folder Structure'),
}));
void vi.mock('@vybestack/llxprt-code-core/utils/errorReporting.js', () => ({
  reportError: vi.fn(),
}));
void vi.mock(
  '@vybestack/llxprt-code-core/utils/generateContentResponseUtilities.js',
  () => ({
    getResponseText: (result: MockResponseShape) =>
      result.candidates?.[0]?.content?.parts
        ?.map((part) => part.text)
        .join('') ?? undefined,
  }),
);
void vi.mock('@vybestack/llxprt-code-core/telemetry/index.js', () => ({
  logApiRequest: vi.fn(),
  logApiResponse: vi.fn(),
  logApiError: vi.fn(),
}));
void vi.mock('@vybestack/llxprt-code-core/utils/retry.js', () => ({
  retryWithBackoff: vi.fn((apiCall) => apiCall()),
}));
const actual3 = { ...(await import('@vybestack/llxprt-code-ide-integration')) };
void vi.mock('@vybestack/llxprt-code-ide-integration', () => ({
  ...actual3,
  ideContext: {
    ...actual3.ideContext,
    getIdeContext: vi.fn(),
    subscribeToIdeContext: vi.fn(),
    setIdeContext: vi.fn(),
    clearIdeContext: vi.fn(),
  },
}));
const actual4 = {
  ...(await import('@vybestack/llxprt-code-core/core/tokenLimits.js')),
};
void vi.mock('@vybestack/llxprt-code-core/core/tokenLimits.js', () => {
  const tokenLimit = vi.fn();
  return {
    ...actual4,
    tokenLimit,
    resolveEffectiveContextLimit: vi.fn(
      (model: string, userCtx?: number, provCtx?: number) => {
        const ok = (v: unknown): v is number =>
          typeof v === 'number' && Number.isFinite(v) && v > 0;
        if (ok(userCtx)) return userCtx;
        if (ok(provCtx)) return provCtx;
        return tokenLimit(model);
      },
    ),
  };
});
void vi.mock('@vybestack/llxprt-code-core/telemetry/uiTelemetry.js', () => ({
  uiTelemetryService: {
    setLastPromptTokenCount: vi.fn(),
    getLastPromptTokenCount: vi.fn(),
  },
}));

describe('AgentClient (client.ts)', () => {
  let client: AgentClient;

  beforeEach(async () => {
    const ctx = await setupAgentClient({
      mockChatCreateFn,
      mockGenerateContentFn,
      mockEmbedContentFn,
    });
    client = ctx.client;

    mockTodoStoreConstructor.mockImplementation(() => ({
      readTodos: todoStoreReadMock,
      readPausedState: todoStoreReadPausedMock,
      writePausedState: todoStoreWritePausedMock,
    }));
    todoStoreReadMock.mockResolvedValue([]);
    todoStoreReadPausedMock.mockResolvedValue(false);
    todoStoreWritePausedMock.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await client.dispose();
    vi.restoreAllMocks();
  });

  describe('sendMessageStream - InvalidStream continuation', () => {
    beforeEach(() => {
      (
        client as unknown as {
          todoContinuationService: { todoToolsAvailable: boolean };
        }
      ).todoContinuationService.todoToolsAvailable = false;
    });

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

      const initialRequest = [{ type: 'text', text: 'Hi' }];
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
          [{ text: 'Hi' }],
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

      const initialRequest = [{ type: 'text', text: 'Hi' }];
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

    it('should not trigger thinking-only continuation after InvalidStream when flag is false', async () => {
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

      todoStoreReadMock.mockResolvedValue([]);

      const stream = client.sendMessageStream(
        [{ type: 'text', text: 'Do something' }],
        new AbortController().signal,
        'prompt-thinking-invalid-stream-no-continue',
      );
      const events = await fromAsync(stream);

      expect(mockTurnRunFn).toHaveBeenCalledTimes(1);
      expect(forwardedRequests).toHaveLength(1);
      expect(
        forwardedRequests[0]?.some(
          (part) =>
            typeof part === 'object' &&
            'text' in part &&
            typeof part.text === 'string' &&
            part.text.includes(
              'Continue and take the next concrete action now',
            ),
        ),
      ).toBe(false);
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

      const initialRequest = [{ type: 'text', text: 'Hi' }];
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
});
