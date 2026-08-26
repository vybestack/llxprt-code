/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * sendMessageStream tests: thinking-only output auto-continuation.
 * Sibling to client.test.ts (split to avoid file-level max-lines disable).
 */

import { automock } from '@vybestack/llxprt-code-test-utils';
import { describe, it, expect, vi, beforeEach, afterEach } from 'bun:test';
import type {
  AgentMessageInput,
  IContent,
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

    it('should auto-continue when model generates thinking-only output', async () => {
      const forwardedRequests: IContent[][] = [];
      let callCount = 0;
      mockTurnRunFn.mockReset();
      mockTurnRunFn.mockImplementation((req: AgentMessageInput) => {
        forwardedRequests.push(req as IContent[]);
        callCount++;
        if (callCount === 1) {
          return (async function* () {
            yield {
              type: AgentEventType.Thought,
              value: {
                subject: 'Planning',
                description: 'I will do something',
              },
            };
            yield {
              type: AgentEventType.Finished,
              value: { reason: 'STOP' },
            };
          })();
        }
        return (async function* () {
          yield {
            type: AgentEventType.Content,
            value: 'Here is the result',
          };
          yield {
            type: AgentEventType.Finished,
            value: { reason: 'STOP' },
          };
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
        'prompt-thinking-only',
      );
      const events = await fromAsync(stream);

      expect(mockTurnRunFn).toHaveBeenCalledTimes(2);
      expect(forwardedRequests.length).toBe(2);

      const secondRequest = forwardedRequests[1];
      const continuationPart = secondRequest
        .flatMap((content) => ('blocks' in content ? content.blocks : []))
        .find((block) => {
          if (block.type !== 'text') {
            return false;
          }
          return block.text.includes(
            'Continue and take the next concrete action now',
          );
        });
      expect(continuationPart).toBeDefined();

      expect(events.some((e) => e.type === AgentEventType.Thought)).toBe(true);
      expect(
        events.some(
          (e) =>
            e.type === AgentEventType.Content &&
            e.value === 'Here is the result',
        ),
      ).toBe(true);
    });

    it('should not auto-continue when model generates thinking plus content', async () => {
      mockTurnRunFn.mockReset();
      mockTurnRunFn.mockImplementation(() =>
        (async function* () {
          yield {
            type: AgentEventType.Thought,
            value: { subject: 'Planning', description: 'I will do something' },
          };
          yield {
            type: AgentEventType.Content,
            value: 'Here is the result',
          };
          yield {
            type: AgentEventType.Finished,
            value: { reason: 'STOP' },
          };
        })(),
      );

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
        'prompt-thinking-content',
      );
      await fromAsync(stream);

      expect(mockTurnRunFn).toHaveBeenCalledTimes(1);
    });

    it('should not auto-continue when model generates thinking plus tool calls', async () => {
      mockTurnRunFn.mockReset();
      mockTurnRunFn.mockImplementation(() =>
        (async function* () {
          yield {
            type: AgentEventType.Thought,
            value: { subject: 'Planning', description: 'I will do something' },
          };
          yield {
            type: AgentEventType.ToolCallRequest,
            value: {
              name: 'some_tool',
              args: {},
            },
          };
          yield {
            type: AgentEventType.Finished,
            value: { reason: 'STOP' },
          };
        })(),
      );

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
        'prompt-thinking-tools',
      );
      await fromAsync(stream);

      expect(mockTurnRunFn).toHaveBeenCalledTimes(1);
    });

    it('should respect MAX_RETRIES for thinking-only continuation', async () => {
      mockTurnRunFn.mockReset();
      mockTurnRunFn.mockImplementation(() =>
        (async function* () {
          yield {
            type: AgentEventType.Thought,
            value: { subject: 'Planning', description: 'Still thinking' },
          };
          yield {
            type: AgentEventType.Finished,
            value: { reason: 'STOP' },
          };
        })(),
      );

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
        'prompt-thinking-max-retries',
      );
      const events = await fromAsync(stream);

      // MAX_RETRIES is 3, so: initial call + 2 retries = 3 calls
      expect(mockTurnRunFn).toHaveBeenCalledTimes(3);
      // Should eventually return with Finished event
      expect(events.some((e) => e.type === AgentEventType.Finished)).toBe(true);
    });
  });
});
