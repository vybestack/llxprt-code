/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * sendMessageStream tests: task-list retries, IDE context, MaxSessionTurns.
 * Sibling to client.test.ts (split to avoid file-level max-lines disable).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Part, PartListUnion } from '@google/genai';
import { AgentClient } from './client.js';
import type { ContentGenerator } from '@vybestack/llxprt-code-core/core/contentGenerator.js';
import type { ChatSession } from './chatSession.js';
import { GeminiEventType, Turn } from './turn.js';
import { ideContext } from '@vybestack/llxprt-code-ide-integration';
import { TodoReminderService } from '@vybestack/llxprt-code-core/services/todo-reminder-service.js';
import { fromAsync, setupGeminiClient } from './client-test-helpers.js';

// Mock prompts module before imports
vi.mock('@vybestack/llxprt-code-core/core/prompts.js', () => ({
  getCoreSystemPromptAsync: vi.fn(() =>
    Promise.resolve('Test system instruction'),
  ),
  getCoreSystemPrompt: vi.fn(() => 'Test system instruction'),
  getCompressionPrompt: vi.fn(() => 'Test compression prompt'),
  initializePromptSystem: vi.fn(() => Promise.resolve(undefined)),
}));

// Mock clientToolGovernance module so tests can control tool name/governance returns
vi.mock('./clientToolGovernance.js', () => ({
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
} = vi.hoisted(() => ({
  mockChatCreateFn: vi.fn(),
  mockGenerateContentFn: vi.fn(),
  mockEmbedContentFn: vi.fn(),
  mockTurnRunFn: vi.fn(),
}));

const {
  todoStoreReadMock,
  todoStoreReadPausedMock,
  todoStoreWritePausedMock,
  mockTodoStoreConstructor,
} = vi.hoisted(() => {
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
});

vi.mock('@google/genai');
vi.mock('@vybestack/llxprt-code-core/services/complexity-analyzer.js', () => ({
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
}));

vi.mock(
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
vi.mock('@vybestack/llxprt-code-tools', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@vybestack/llxprt-code-tools')>();
  return {
    ...actual,
    LocalTodoStore: mockTodoStoreConstructor,
  };
});
vi.mock('./turn', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./turn.js')>();
  class MockTurn {
    pendingToolCalls = [];
    run = mockTurnRunFn;
    constructor() {}
  }
  return {
    ...actual,
    Turn: MockTurn,
  };
});

vi.mock('@vybestack/llxprt-code-core/config/config.js');
vi.mock('@vybestack/llxprt-code-core/utils/getFolderStructure.js', () => ({
  getFolderStructure: vi.fn().mockResolvedValue('Mock Folder Structure'),
}));
vi.mock('@vybestack/llxprt-code-core/utils/errorReporting.js', () => ({
  reportError: vi.fn(),
}));
vi.mock(
  '@vybestack/llxprt-code-core/utils/generateContentResponseUtilities.js',
  () => ({
    getResponseText: (result: GenerateContentResponse) =>
      result.candidates?.[0]?.content?.parts
        ?.map((part) => part.text)
        .join('') ?? undefined,
  }),
);
vi.mock('@vybestack/llxprt-code-core/telemetry/index.js', () => ({
  logApiRequest: vi.fn(),
  logApiResponse: vi.fn(),
  logApiError: vi.fn(),
}));
vi.mock('@vybestack/llxprt-code-core/utils/retry.js', () => ({
  retryWithBackoff: vi.fn((apiCall) => apiCall()),
}));
vi.mock('@vybestack/llxprt-code-ide-integration', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('@vybestack/llxprt-code-ide-integration')
    >();
  return {
    ...actual,
    ideContext: {
      ...actual.ideContext,
      getIdeContext: vi.fn(),
      subscribeToIdeContext: vi.fn(),
      setIdeContext: vi.fn(),
      clearIdeContext: vi.fn(),
    },
  };
});
vi.mock('@vybestack/llxprt-code-core/core/tokenLimits.js', () => ({
  tokenLimit: vi.fn(),
}));
vi.mock('@vybestack/llxprt-code-core/telemetry/uiTelemetry.js', () => ({
  uiTelemetryService: {
    setLastPromptTokenCount: vi.fn(),
    getLastPromptTokenCount: vi.fn(),
  },
}));

describe('Gemini Client (client.ts)', () => {
  let client: AgentClient;

  beforeEach(async () => {
    const ctx = await setupGeminiClient({
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

  afterEach(() => {
    client.dispose();
    vi.restoreAllMocks();
  });

  describe('sendMessageStream', () => {
    beforeEach(() => {
      (
        client as unknown as {
          todoContinuationService: { todoToolsAvailable: boolean };
        }
      ).todoContinuationService.todoToolsAvailable = true;
    });

    it('retries once when no tool work and todos unchanged', async () => {
      const reminderService = new TodoReminderService();
      const followUpReminderText =
        '---\nSystem Note: You still have unfinished todos. Continue the required work.\n---';
      vi.mocked(reminderService.getUpdateActiveTodoReminder).mockReturnValue(
        followUpReminderText,
      );
      vi.mocked(reminderService.getEscalatedActiveTodoReminder).mockReturnValue(
        followUpReminderText,
      );
      const svcForRetry = (
        client as unknown as {
          todoContinuationService: {
            todoReminderService: TodoReminderService;
            todoToolsAvailable: boolean;
          };
        }
      ).todoContinuationService;
      svcForRetry.todoReminderService =
        reminderService as unknown as TodoReminderService;
      svcForRetry.todoToolsAvailable = true;

      todoStoreReadMock.mockResolvedValue([
        {
          id: 'todo-1',
          content: 'Complete the task',
          status: 'pending',
        },
      ]);

      const forwardedRequests: Part[][] = [];
      mockTurnRunFn.mockReset();
      mockTurnRunFn.mockImplementation((req: PartListUnion) => {
        forwardedRequests.push(req as Part[]);
        return (async function* () {
          yield {
            type: GeminiEventType.Content,
            value: 'Just thinking about it',
          };
          yield {
            type: GeminiEventType.Finished,
            value: { reason: 'STOP' },
          };
        })();
      });

      vi.spyOn(client['config'], 'getIdeMode').mockReturnValue(false);

      const mockChat: Partial<ChatSession> = {
        addHistory: vi.fn(),
        getHistory: vi.fn().mockReturnValue([]),
        getLastPromptTokenCount: vi.fn().mockReturnValue(0),
      };
      client['chat'] = mockChat as ChatSession;

      const mockGenerator: Partial<ContentGenerator> = {
        countTokens: vi.fn().mockResolvedValue({ totalTokens: 0 }),
      };
      client['contentGenerator'] = mockGenerator as ContentGenerator;

      const stream = client.sendMessageStream(
        [{ text: 'Get started' }],
        new AbortController().signal,
        'prompt-no-tools',
      );
      await fromAsync(stream);

      expect(mockTurnRunFn).toHaveBeenCalledTimes(3);
      expect(forwardedRequests.length).toBe(3);

      const secondRequest = forwardedRequests[1];
      const reminderPart = secondRequest.find(
        (part) =>
          typeof part === 'object' &&
          'text' in part &&
          typeof part.text === 'string' &&
          part.text.includes('System Note'),
      );
      expect(reminderPart).toBeDefined();
    });

    it('does not retry with pending todos when paused for the current prompt', async () => {
      todoStoreReadMock.mockResolvedValue([
        {
          id: 'todo-1',
          content: 'Blocked task',
          status: 'pending',
        },
      ]);
      todoStoreReadPausedMock.mockResolvedValue(true);
      client['lastPromptId'] = 'prompt-paused-current';

      const forwardedRequests: Part[][] = [];
      mockTurnRunFn.mockReset();
      mockTurnRunFn.mockImplementation((req: PartListUnion) => {
        forwardedRequests.push(req as Part[]);
        return (async function* () {
          yield {
            type: GeminiEventType.Content,
            value: 'Waiting for user input',
          };
          yield {
            type: GeminiEventType.Finished,
            value: { reason: 'STOP' },
          };
        })();
      });

      vi.spyOn(client['config'], 'getIdeMode').mockReturnValue(false);

      const mockChat: Partial<ChatSession> = {
        addHistory: vi.fn(),
        getHistory: vi.fn().mockReturnValue([]),
        getLastPromptTokenCount: vi.fn().mockReturnValue(0),
      };
      client['chat'] = mockChat as ChatSession;

      const mockGenerator: Partial<ContentGenerator> = {
        countTokens: vi.fn().mockResolvedValue({ totalTokens: 0 }),
      };
      client['contentGenerator'] = mockGenerator as ContentGenerator;

      const stream = client.sendMessageStream(
        [{ text: 'Continue the task' }],
        new AbortController().signal,
        'prompt-paused-current',
      );
      await fromAsync(stream);

      expect(mockTurnRunFn).toHaveBeenCalledTimes(1);
      expect(todoStoreWritePausedMock).not.toHaveBeenCalled();
      expect(forwardedRequests).toHaveLength(1);
      expect(JSON.stringify(forwardedRequests[0])).not.toContain('System Note');
    });

    it('clears paused state at the start of a new prompt', async () => {
      mockTurnRunFn.mockReset();
      mockTurnRunFn.mockImplementation(() =>
        (async function* () {
          yield {
            type: GeminiEventType.Content,
            value: 'Started new work',
          };
          yield {
            type: GeminiEventType.Finished,
            value: { reason: 'STOP' },
          };
        })(),
      );

      vi.spyOn(client['config'], 'getIdeMode').mockReturnValue(false);

      const mockChat: Partial<ChatSession> = {
        addHistory: vi.fn(),
        getHistory: vi.fn().mockReturnValue([]),
        getLastPromptTokenCount: vi.fn().mockReturnValue(0),
      };
      client['chat'] = mockChat as ChatSession;

      const mockGenerator: Partial<ContentGenerator> = {
        countTokens: vi.fn().mockResolvedValue({ totalTokens: 0 }),
      };
      client['contentGenerator'] = mockGenerator as ContentGenerator;

      const stream = client.sendMessageStream(
        [{ text: 'New request' }],
        new AbortController().signal,
        'prompt-new-after-pause',
      );
      await fromAsync(stream);

      expect(todoStoreWritePausedMock).toHaveBeenCalledWith(false);
    });

    it('does not retry after todo_pause', async () => {
      const reminderService = new TodoReminderService();
      vi.mocked(reminderService.getUpdateActiveTodoReminder).mockReturnValue(
        '---\nSystem Note: Update the active todo before replying.\n---',
      );
      const svcForPause = (
        client as unknown as {
          todoContinuationService: {
            todoReminderService: TodoReminderService;
            todoToolsAvailable: boolean;
          };
        }
      ).todoContinuationService;
      svcForPause.todoReminderService =
        reminderService as unknown as TodoReminderService;
      svcForPause.todoToolsAvailable = true;

      todoStoreReadMock.mockResolvedValue([
        {
          id: 'todo-1',
          content: 'Blocked task',
          status: 'pending',
        },
      ]);

      mockTurnRunFn.mockReset();
      mockTurnRunFn.mockImplementation(() =>
        (async function* () {
          yield {
            type: GeminiEventType.ToolCallRequest,
            value: {
              name: 'todo_pause',
              args: { reason: 'Need more information' },
            },
          };
          yield {
            type: GeminiEventType.ToolCallResponse,
            value: {
              callId: 'pause-1',
              responseParts: [
                {
                  functionResponse: {
                    name: 'todo_pause',
                    id: 'pause-1',
                    response: {},
                  },
                } as unknown as Part,
              ],
              resultDisplay: undefined,
              error: undefined,
              errorType: undefined,
            },
          };
          yield {
            type: GeminiEventType.Content,
            value: 'I need more info',
          };
          yield {
            type: GeminiEventType.Finished,
            value: { reason: 'STOP' },
          };
        })(),
      );

      vi.spyOn(client['config'], 'getIdeMode').mockReturnValue(false);

      const mockChat: Partial<ChatSession> = {
        addHistory: vi.fn(),
        getHistory: vi.fn().mockReturnValue([]),
        getLastPromptTokenCount: vi.fn().mockReturnValue(0),
      };
      client['chat'] = mockChat as ChatSession;

      const mockGenerator: Partial<ContentGenerator> = {
        countTokens: vi.fn().mockResolvedValue({ totalTokens: 0 }),
      };
      client['contentGenerator'] = mockGenerator as ContentGenerator;

      const stream = client.sendMessageStream(
        [{ text: 'Work on the task' }],
        new AbortController().signal,
        'prompt-pause',
      );
      const events = await fromAsync(stream);

      expect(mockTurnRunFn).toHaveBeenCalledTimes(1);
      expect(events.some((e) => e.type === GeminiEventType.Content)).toBe(true);
      expect(events.some((e) => e.type === GeminiEventType.Finished)).toBe(
        true,
      );
    });

    it('should add context if ideMode is enabled and there are open files but no active file', async () => {
      // Arrange
      vi.mocked(ideContext.getIdeContext).mockReturnValue({
        workspaceState: {
          openFiles: [
            {
              path: '/path/to/recent/file1.ts',
              timestamp: Date.now(),
            },
            {
              path: '/path/to/recent/file2.ts',
              timestamp: Date.now(),
            },
          ],
        },
      });

      vi.spyOn(client['config'], 'getIdeMode').mockReturnValue(true);

      const mockStream = (async function* () {
        yield { type: 'content', value: 'Hello' };
      })();
      mockTurnRunFn.mockReturnValue(mockStream);

      const mockChat: Partial<ChatSession> = {
        addHistory: vi.fn(),
        getHistory: vi.fn().mockReturnValue([]),
        getLastPromptTokenCount: vi.fn().mockReturnValue(0),
      };
      client['chat'] = mockChat as ChatSession;

      const mockGenerator: Partial<ContentGenerator> = {
        countTokens: vi.fn().mockResolvedValue({ totalTokens: 0 }),
        generateContent: mockGenerateContentFn,
      };
      client['contentGenerator'] = mockGenerator as ContentGenerator;

      const initialRequest = [{ text: 'Hi' }];

      // Act
      const stream = client.sendMessageStream(
        initialRequest,
        new AbortController().signal,
        'prompt-id-ide',
      );
      for await (const _ of stream) {
        // consume stream
      }

      // Verify that the IDE context was included correctly for files without active file
      const addHistoryCalls = vi.mocked(mockChat.addHistory).mock.calls;
      const contextCall = addHistoryCalls.find((call) =>
        JSON.stringify(call[0]).includes('editor context'),
      );
      expect(contextCall).toBeDefined();
      expect(JSON.stringify(contextCall![0])).toContain('recent/file1.ts');
      expect(JSON.stringify(contextCall![0])).toContain('recent/file2.ts');
    });

    it('should return the turn instance after the stream is complete', async () => {
      // Arrange
      const mockStream = (async function* () {
        yield { type: 'content', value: 'Hello' };
      })();
      mockTurnRunFn.mockReturnValue(mockStream);

      const mockChat: Partial<ChatSession> = {
        addHistory: vi.fn(),
        getHistory: vi.fn().mockReturnValue([]),
        getLastPromptTokenCount: vi.fn().mockReturnValue(0),
      };
      client['chat'] = mockChat as ChatSession;

      const mockGenerator: Partial<ContentGenerator> = {
        countTokens: vi.fn().mockResolvedValue({ totalTokens: 0 }),
        generateContent: vi.fn(),
        generateContentStream: vi.fn(),
        embedContent: vi.fn(),
      };
      client['contentGenerator'] = mockGenerator as ContentGenerator;

      // Act
      const stream = client.sendMessageStream(
        [{ text: 'Hi' }],
        new AbortController().signal,
        'prompt-id-1',
      );

      // Consume the stream manually to get the final return value.
      let finalResult: Turn | undefined;
      for (;;) {
        const result = await stream.next();
        if (result.done === true) {
          finalResult = result.value;
          break;
        }
      }

      // Assert
      expect(finalResult).toBeInstanceOf(Turn);
    });

    it('should yield MaxSessionTurns and stop when session turn limit is reached', async () => {
      // Arrange
      const MAX_SESSION_TURNS = 5;
      vi.spyOn(client['config'], 'getMaxSessionTurns').mockReturnValue(
        MAX_SESSION_TURNS,
      );

      const mockStream = (async function* () {
        yield { type: 'content', value: 'Hello' };
      })();
      mockTurnRunFn.mockReturnValue(mockStream);

      const mockChat: Partial<ChatSession> = {
        addHistory: vi.fn(),
        getHistory: vi.fn().mockReturnValue([]),
        getLastPromptTokenCount: vi.fn().mockReturnValue(0),
      };
      client['chat'] = mockChat as ChatSession;

      const mockGenerator: Partial<ContentGenerator> = {
        countTokens: vi.fn().mockResolvedValue({ totalTokens: 0 }),
      };
      client['contentGenerator'] = mockGenerator as ContentGenerator;

      // Act & Assert
      // Run up to the limit
      for (let i = 0; i < MAX_SESSION_TURNS; i++) {
        const stream = client.sendMessageStream(
          [{ text: 'Hi' }],
          new AbortController().signal,
          'prompt-id-4',
        );
        // consume stream
        for await (const _event of stream) {
          // do nothing
        }
      }

      // This call should exceed the limit
      const stream = client.sendMessageStream(
        [{ text: 'Hi' }],
        new AbortController().signal,
        'prompt-id-5',
      );

      const events = [];
      for await (const event of stream) {
        events.push(event);
      }

      // Verify that the max session turns limit was respected
      expect(events).toStrictEqual([
        {
          type: GeminiEventType.ModelInfo,
          value: {
            model: 'test-model',
            providerName: 'backend',
            profileName: null,
            displayLabel: 'test-model',
          },
        },
        { type: GeminiEventType.MaxSessionTurns },
      ]);
    });
  });
});
