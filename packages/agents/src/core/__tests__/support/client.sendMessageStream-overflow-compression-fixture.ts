/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi, type Mock } from 'bun:test';
import type { ContentBlock } from '@vybestack/llxprt-code-core/llm-types/index.js';
import type { AgentClient } from '../../client.js';
import type { ContentGenerator } from '@vybestack/llxprt-code-core/core/contentGenerator.js';
import type { ChatSession } from '../../chatSession.js';
import { AgentEventType, type PerformCompressionResult } from '../../turn.js';
import { uiTelemetryService } from '@vybestack/llxprt-code-core/telemetry/uiTelemetry.js';
import { tokenLimit } from '@vybestack/llxprt-code-core/core/tokenLimits.js';
import {
  setupAgentClient,
  type MockResponseShape,
} from '../client-test-helpers.js';

// Mock clientToolGovernance module so tests can control tool name/governance returns
const realClientToolGovernance = {
  ...(await import('../../clientToolGovernance.js')),
};
void vi.mock('../../clientToolGovernance.js', () => ({
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
export {
  mockChatCreateFn,
  mockGenerateContentFn,
  mockEmbedContentFn,
  mockTurnRunFn,
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

const realTodoReminderModule = {
  ...(await import(
    '@vybestack/llxprt-code-core/services/todo-reminder-service.js'
  )),
};
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
const __actual = { ...(await import('../../turn.js')) };
class MockTurn {
  pendingToolCalls: unknown[] = [];
  run = mockTurnRunFn;
  constructor() {}
}
void vi.mock('../../turn.js', () => ({ ...__actual, Turn: MockTurn }));

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
const actualRetry = {
  ...(await import('@vybestack/llxprt-code-core/utils/retry.js')),
};
const mockRetry = () => ({
  retryWithBackoff: vi.fn((apiCall: () => unknown) => apiCall()),
});
void vi.mock('@vybestack/llxprt-code-core/utils/retry.js', mockRetry);
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
      (
        model: string,
        userCtx?: number,
        provCtx?: number,
        resolveTok?: (model: string) => number,
      ) => {
        const ok = (v: unknown): v is number =>
          typeof v === 'number' && Number.isFinite(v) && v > 0;
        if (ok(userCtx)) return userCtx;
        if (ok(provCtx)) return provCtx;
        if (resolveTok) return resolveTok(model);
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

// All scenarios share the same token geometry: a 1000-token limit with a
// 900-token preflight baseline, leaving 100 tokens of capacity. A 400-char
// request estimates to ~100 tokens (100 > 100 * 0.95 = 95 → overflow).
export const MOCKED_TOKEN_LIMIT = 1000;
export const PREFLIGHT_BASELINE = 900;
export const OVERFLOW_REQUEST_CHARS = 400;
export const THRESHOLD = 0.95;

interface OverflowScenario {
  compressionResult: PerformCompressionResult | Error;
  postCompressionBaseline?: number;
  postEnforcementBaseline?: number;
  enforcementError?: Error;
  initialProjectedBaseline?: number;
  lastPromptTokenCount?: number;
}

interface OverflowScenarioHandle {
  request: ContentBlock[];
  estimatedRequestTokenCount: number;
  remainingTokenCount: number;
}

export function buildOverflowScenario(
  client: AgentClient,
  scenario: OverflowScenario,
): OverflowScenarioHandle {
  (tokenLimit as Mock<typeof tokenLimit>).mockReturnValue(MOCKED_TOKEN_LIMIT);

  const initialBaseline =
    scenario.initialProjectedBaseline ?? PREFLIGHT_BASELINE;
  const observedCount = scenario.lastPromptTokenCount ?? initialBaseline;
  (
    uiTelemetryService.getLastPromptTokenCount as Mock<
      typeof uiTelemetryService.getLastPromptTokenCount
    >
  ).mockReturnValue(observedCount);

  let currentBaseline = initialBaseline;

  const mockChat: Partial<ChatSession> = {
    addHistory: vi.fn(),
    getHistory: vi.fn().mockReturnValue([]),
    getLastPromptTokenCount: vi.fn().mockReturnValue(observedCount),
    getProjectedPromptBaseline: vi
      .fn()
      .mockImplementation(() => currentBaseline),
    getContextLimit: vi.fn(() => tokenLimit('test-model')),
    performCompression:
      scenario.compressionResult instanceof Error
        ? vi.fn().mockRejectedValue(scenario.compressionResult)
        : vi.fn().mockImplementation(() => {
            if (scenario.postCompressionBaseline !== undefined) {
              currentBaseline = scenario.postCompressionBaseline;
            }
            return Promise.resolve(
              scenario.compressionResult as PerformCompressionResult,
            );
          }),
    enforceContextWindow: scenario.enforcementError
      ? vi.fn().mockRejectedValue(scenario.enforcementError)
      : vi.fn().mockImplementation(() => {
          if (scenario.postEnforcementBaseline !== undefined) {
            currentBaseline = scenario.postEnforcementBaseline;
          }
          return Promise.resolve();
        }),
  };
  client['chat'] = mockChat as ChatSession;
  client['contentGenerator'] = {
    countTokens: vi.fn().mockResolvedValue({ totalTokens: 0 }),
  } as Partial<ContentGenerator> as ContentGenerator;

  mockTurnRunFn.mockReturnValue(
    (async function* () {
      yield { type: AgentEventType.Content, value: 'ok' };
    })(),
  );

  const longText = 'a'.repeat(OVERFLOW_REQUEST_CHARS);
  return {
    request: [{ type: 'text' as const, text: longText }],
    estimatedRequestTokenCount: Math.floor(longText.length / 4),
    remainingTokenCount: MOCKED_TOKEN_LIMIT - initialBaseline,
  };
}

export let client: AgentClient;

export function setClient(nextClient: AgentClient): void {
  client = nextClient;
}

export function restoreTokenLimit(): void {
  void vi.mock('../../clientToolGovernance.js', () => realClientToolGovernance);
  void vi.mock('@vybestack/llxprt-code-tools', () => actual);
  void vi.mock(
    '@vybestack/llxprt-code-core/services/todo-reminder-service.js',
    () => realTodoReminderModule,
  );
  (tokenLimit as Mock<typeof tokenLimit>).mockImplementation(
    actual4.tokenLimit,
  );
  void vi.mock('../../turn.js', () => __actual);
  void vi.mock('@vybestack/llxprt-code-core/utils/retry.js', () => actualRetry);
}

export async function initializeClient(): Promise<void> {
  void vi.mock('../../turn.js', () => ({ ...__actual, Turn: MockTurn }));
  void vi.mock('@vybestack/llxprt-code-core/utils/retry.js', mockRetry);
  const ctx = await setupAgentClient(
    { mockChatCreateFn, mockGenerateContentFn, mockEmbedContentFn },
    { useInjectedConfig: true },
  );
  client = ctx.client;

  mockTodoStoreConstructor.mockImplementation(() => ({
    readTodos: todoStoreReadMock,
    readPausedState: todoStoreReadPausedMock,
    writePausedState: todoStoreWritePausedMock,
  }));
  todoStoreReadMock.mockResolvedValue([]);
  todoStoreReadPausedMock.mockResolvedValue(false);
  todoStoreWritePausedMock.mockResolvedValue(undefined);
}

export async function disposeClient(): Promise<void> {
  await client.dispose();
  vi.restoreAllMocks();
}

export function initializeStream(): void {
  (
    client as unknown as {
      todoContinuationService: { todoToolsAvailable: boolean };
    }
  ).todoContinuationService.todoToolsAvailable = true;
  mockTurnRunFn.mockImplementation(() =>
    (async function* () {
      yield { type: AgentEventType.Content, value: 'ok' };
    })(),
  );
}
