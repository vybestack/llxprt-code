/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * AgentClient BeforeAgent hook result handling.
 * Sibling to client.test.ts (split to avoid file-level max-lines disable).
 */

import { automock } from '@vybestack/llxprt-code-test-utils';
import { describe, it, expect, vi, beforeEach, afterEach } from 'bun:test';
import type { AgentMessageInput } from '@vybestack/llxprt-code-core/llm-types/index.js';
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

  describe('BeforeAgent hook result handling', () => {
    it('should yield Error event and return early when BeforeAgent hook returns blocking decision', async () => {
      // This test verifies Gap 1: BeforeAgent hook blocking behavior
      // Currently the hook result is IGNORED - this test should FAIL initially

      // Import and mock the hook trigger
      const lifecycleHookTriggers = await import(
        '@vybestack/llxprt-code-core/core/lifecycleHookTriggers.js'
      );
      const mockTriggerBeforeAgentHook = vi.spyOn(
        lifecycleHookTriggers,
        'triggerBeforeAgentHook',
      );

      // Create a mock BeforeAgentHookOutput that blocks execution
      const { BeforeAgentHookOutput } = await import(
        '@vybestack/llxprt-code-core/hooks/types.js'
      );
      const blockingOutput = new BeforeAgentHookOutput({
        decision: 'block',
        reason: 'Blocked by test hook',
      });

      mockTriggerBeforeAgentHook.mockResolvedValue(blockingOutput);

      // Setup minimal mocks for client
      const mockStream = (async function* () {
        yield { type: AgentEventType.Content, value: 'Should not reach here' };
      })();
      mockTurnRunFn.mockReturnValue(mockStream);

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

      // Act
      const stream = client.sendMessageStream(
        [{ text: 'Test prompt' }],
        new AbortController().signal,
        'prompt-before-agent-block',
      );
      const events = await fromAsync(stream);

      // Assert
      // Should yield an Error event with the blocking reason
      const errorEvent = events.find((e) => e.type === AgentEventType.Error);
      expect(errorEvent).toBeDefined();
      expect(errorEvent?.value.error.message).toContain(
        'BeforeAgent hook blocked',
      );
      expect(errorEvent?.value.error.message).toContain('Blocked by test hook');

      // Turn.run should NOT have been called because we blocked early
      expect(mockTurnRunFn).not.toHaveBeenCalled();
    });

    it('should append additional context from BeforeAgent hook to request', async () => {
      // This test verifies Gap 1: BeforeAgent hook additional context
      // Currently the hook result is IGNORED - this test should FAIL initially

      // Import and mock the hook trigger
      const lifecycleHookTriggers = await import(
        '@vybestack/llxprt-code-core/core/lifecycleHookTriggers.js'
      );
      const mockTriggerBeforeAgentHook = vi.spyOn(
        lifecycleHookTriggers,
        'triggerBeforeAgentHook',
      );

      // Create a mock BeforeAgentHookOutput that provides additional context
      const { BeforeAgentHookOutput } = await import(
        '@vybestack/llxprt-code-core/hooks/types.js'
      );
      const contextOutput = new BeforeAgentHookOutput({
        continue: true,
        hookSpecificOutput: {
          hookEventName: 'BeforeAgent',
          additionalContext: 'Additional context from hook',
        },
      });

      mockTriggerBeforeAgentHook.mockResolvedValue(contextOutput);

      // Track what request was passed to turn.run
      const capturedRequests: AgentMessageInput[] = [];
      const mockStream = (async function* () {
        yield { type: AgentEventType.Content, value: 'Response' };
        yield { type: AgentEventType.Finished, value: { reason: 'STOP' } };
      })();
      mockTurnRunFn.mockImplementation((req: AgentMessageInput) => {
        capturedRequests.push(req);
        return mockStream;
      });

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

      // Disable IDE mode to simplify test
      vi.spyOn(client['config'], 'getIdeMode').mockReturnValue(false);

      // Act
      const stream = client.sendMessageStream(
        [{ text: 'Original prompt' }],
        new AbortController().signal,
        'prompt-before-agent-context',
      );
      await fromAsync(stream);

      // Assert
      // The request should include the additional context
      expect(capturedRequests.length).toBeGreaterThan(0);
      const request = capturedRequests[0];
      const requestContents = Array.isArray(request) ? request : [request];
      const hasAdditionalContext = requestContents.some(
        (content) =>
          'blocks' in content &&
          content.blocks.some(
            (block) =>
              block.type === 'text' &&
              block.text === 'Additional context from hook',
          ),
      );
      expect(hasAdditionalContext).toBe(true);
    });
  });
});
