/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * sendMessageStream tests: 413 error retry behavior.
 * Sibling to client.test.ts (split to avoid file-level max-lines disable).
 */

import { automock } from '@vybestack/llxprt-code-test-utils';
import { describe, it, expect, vi, beforeEach, afterEach } from '../testApi.js';
import { AgentClient } from './client.js';
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
const actual = { ...(await import('@vybestack/llxprt-code-tools')) };
vi.mock('@vybestack/llxprt-code-tools', () => {
  return {
    ...actual,
    LocalTodoStore: mockTodoStoreConstructor,
  };
});
const __actual = { ...(await import('./turn')) };
vi.mock('./turn', () => {
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

vi.mock('@vybestack/llxprt-code-core/config/config.js', () =>
  automock(realConfigModule),
);
vi.mock('@vybestack/llxprt-code-core/utils/getFolderStructure.js', () => ({
  getFolderStructure: vi.fn().mockResolvedValue('Mock Folder Structure'),
}));
vi.mock('@vybestack/llxprt-code-core/utils/errorReporting.js', () => ({
  reportError: vi.fn(),
}));
vi.mock(
  '@vybestack/llxprt-code-core/utils/generateContentResponseUtilities.js',
  () => ({
    getResponseText: (result: MockResponseShape) =>
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
const actual3 = { ...(await import('@vybestack/llxprt-code-ide-integration')) };
vi.mock('@vybestack/llxprt-code-ide-integration', () => {
  return {
    ...actual3,
    ideContext: {
      ...actual3.ideContext,
      getIdeContext: vi.fn(),
      subscribeToIdeContext: vi.fn(),
      setIdeContext: vi.fn(),
      clearIdeContext: vi.fn(),
    },
  };
});
const actual4 = {
  ...(await import('@vybestack/llxprt-code-core/core/tokenLimits.js')),
};
vi.mock('@vybestack/llxprt-code-core/core/tokenLimits.js', () => {
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
vi.mock('@vybestack/llxprt-code-core/telemetry/uiTelemetry.js', () => ({
  uiTelemetryService: {
    setLastPromptTokenCount: vi.fn(),
    getLastPromptTokenCount: vi.fn(),
  },
}));

describe('Agent Client (client.ts)', () => {
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

    it('should retry with tool-name message when 413 error is received', async () => {
      vi.spyOn(client['config'], 'getContinueOnFailedApiCall').mockReturnValue(
        true,
      );
      // Arrange: first stream yields a 413 error, second yields content
      const mockStream1 = (async function* () {
        yield {
          type: AgentEventType.Error,
          value: {
            error: { message: 'Payload too large', status: 413 },
          },
        };
      })();
      const mockStream2 = (async function* () {
        yield { type: AgentEventType.Content, value: 'Retried content' };
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

      // Include tool_response blocks to test tool name extraction
      const initialRequest = [
        { type: 'text', text: 'Hi' },
        {
          type: 'tool_response',
          callId: 'read_file',
          toolName: 'read_file',
          result: { content: 'large content...' },
        },
        {
          type: 'tool_response',
          callId: 'search_file',
          toolName: 'search_file',
          result: { content: 'more large content...' },
        },
      ];
      const promptId = 'prompt-id-413-retry';
      const signal = new AbortController().signal;

      // Act
      const stream = client.sendMessageStream(initialRequest, signal, promptId);
      const events = await fromAsync(stream);

      // Assert: model_info, then error event and retried content
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
          type: AgentEventType.Error,
          value: {
            error: { message: 'Payload too large', status: 413 },
          },
        },
        { type: AgentEventType.Content, value: 'Retried content' },
      ]);

      // turn.run should be called twice
      expect(mockTurnRunFn).toHaveBeenCalledTimes(2);

      // Second call should include the 413 system message with tool names
      expect(mockTurnRunFn).toHaveBeenNthCalledWith(
        2,
        [
          {
            speaker: 'human',
            blocks: [
              {
                type: 'text',
                text: 'System: The previous tool calls produced a response that was too large (HTTP 413). The tools involved were: read_file, search_file. Please retry with fewer or more focused queries.',
              },
            ],
          },
        ],
        expect.any(Object),
      );
    });

    it('does not retry a 413 after ordinary content was already emitted', async () => {
      vi.spyOn(client['config'], 'getContinueOnFailedApiCall').mockReturnValue(
        true,
      );
      const mockStream = (async function* () {
        yield { type: AgentEventType.Content, value: 'Partial content' };
        yield {
          type: AgentEventType.Error,
          value: {
            error: { message: 'Payload too large', status: 413 },
          },
        };
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
          'prompt-id-413-after-content',
        ),
      );

      expect(events.slice(-2)).toStrictEqual([
        { type: AgentEventType.Content, value: 'Partial content' },
        {
          type: AgentEventType.Error,
          value: {
            error: { message: 'Payload too large', status: 413 },
          },
        },
      ]);
      expect(mockTurnRunFn).toHaveBeenCalledTimes(1);
    });

    it.each([
      {
        name: '413 error',
        terminalEvent: {
          type: AgentEventType.Error,
          value: {
            error: { message: 'Payload too large', status: 413 },
          },
        },
      },
      {
        name: 'InvalidStream',
        terminalEvent: { type: AgentEventType.InvalidStream },
      },
    ])(
      'does not retry after a $name follows a tool call',
      async ({ terminalEvent }) => {
        vi.spyOn(
          client['config'],
          'getContinueOnFailedApiCall',
        ).mockReturnValue(true);
        const toolCallEvent = {
          type: AgentEventType.ToolCallRequest,
          value: {
            callId: 'call-1',
            name: 'read_file',
            args: { file_path: 'README.md' },
            isClientInitiated: false,
            prompt_id: 'prompt-id-after-tool-call',
          },
        };
        const mockStream = (async function* () {
          yield toolCallEvent;
          yield terminalEvent;
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
            'prompt-id-after-tool-call',
          ),
        );

        expect(events.slice(-2)).toStrictEqual([toolCallEvent, terminalEvent]);
        expect(mockTurnRunFn).toHaveBeenCalledTimes(1);
      },
    );

    it('should not retry on 413 when getContinueOnFailedApiCall returns false', async () => {
      vi.spyOn(client['config'], 'getContinueOnFailedApiCall').mockReturnValue(
        false,
      );
      // Arrange
      const mockStream1 = (async function* () {
        yield {
          type: AgentEventType.Error,
          value: {
            error: { message: 'Payload too large', status: 413 },
          },
        };
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

      const initialRequest = [{ text: 'Hi' }];
      const promptId = 'prompt-id-413-no-retry';
      const signal = new AbortController().signal;

      // Act
      const stream = client.sendMessageStream(initialRequest, signal, promptId);
      const events = await fromAsync(stream);

      // Assert: model_info, then only the error event, no retry
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
          type: AgentEventType.Error,
          value: {
            error: { message: 'Payload too large', status: 413 },
          },
        },
      ]);

      // turn.run should be called only once
      expect(mockTurnRunFn).toHaveBeenCalledTimes(1);
    });

    it('should stop recursing after one retry when 413 errors are repeatedly received', async () => {
      vi.spyOn(client['config'], 'getContinueOnFailedApiCall').mockReturnValue(
        true,
      );
      // Arrange: always return a 413 error
      mockTurnRunFn.mockImplementation(() =>
        (async function* () {
          yield {
            type: AgentEventType.Error,
            value: {
              error: { message: 'Payload too large', status: 413 },
            },
          };
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

      const initialRequest = [{ text: 'Hi' }];
      const promptId = 'prompt-id-413-infinite';
      const signal = new AbortController().signal;

      // Act
      const stream = client.sendMessageStream(initialRequest, signal, promptId);
      const events = await fromAsync(stream);

      // Assert: 1 ModelInfo + exactly 2 Error events (original + 1 retry), no infinite loop
      expect(events.length).toBe(3);
      expect(events[0]?.type).toBe(AgentEventType.ModelInfo);
      expect(
        events
          .slice(1)
          .every(
            (e) =>
              e.type === AgentEventType.Error &&
              (e.value as { error: { status?: number } }).error.status === 413,
          ),
      ).toBe(true);

      // turn.run should be called exactly twice
      expect(mockTurnRunFn).toHaveBeenCalledTimes(2);
    });
  });
});
