/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * sendMessageStream tests: automatic compression recovery for preflight
 * context-overflow (issue #2402).
 * Sibling to client.sendMessageStream-overflow.test.ts (split to avoid
 * file-level max-lines).
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from '../testApi.js';
import type { ContentBlock } from '@vybestack/llxprt-code-core/llm-types/index.js';
import { AgentClient } from './client.js';
import type { ContentGenerator } from '@vybestack/llxprt-code-core/core/contentGenerator.js';
import { ChatSession } from './chatSession.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { AgentEventType, PerformCompressionResult } from './turn.js';
import { uiTelemetryService } from '@vybestack/llxprt-code-core/telemetry/uiTelemetry.js';
import {
  buildRuntimeContext,
  buildMockContentGenerator,
  makeUserMessage,
  makeAiText,
} from './__tests__/chatSession-density-helpers.js';
import { tokenLimit } from '@vybestack/llxprt-code-core/core/tokenLimits.js';
import {
  fromAsync,
  setupAgentClient,
  type MockResponseShape,
} from './client-test-helpers.js';

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
vi.mock('@vybestack/llxprt-code-core/telemetry/uiTelemetry.js', () => ({
  uiTelemetryService: {
    setLastPromptTokenCount: vi.fn(),
    getLastPromptTokenCount: vi.fn(),
  },
}));

// All scenarios share the same token geometry: a 1000-token limit with a
// 900-token preflight baseline, leaving 100 tokens of capacity. A 400-char
// request estimates to ~100 tokens (100 > 100 * 0.95 = 95 → overflow).
const MOCKED_TOKEN_LIMIT = 1000;
const PREFLIGHT_BASELINE = 900;
const OVERFLOW_REQUEST_CHARS = 400;
const THRESHOLD = 0.95;

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

function buildOverflowScenario(
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
    getContextLimit: vi.fn(() => tokenLimit()),
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

describe('AgentClient — finalized-envelope enforcement handoff (issues 2402, 2755)', () => {
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
      mockTurnRunFn.mockImplementation(() =>
        (async function* () {
          yield { type: AgentEventType.Content, value: 'ok' };
        })(),
      );
    });

    it('should recover via automatic compression and proceed instead of bailing on a small overflow (issue 2402)', async () => {
      const { request } = buildOverflowScenario(client, {
        postCompressionBaseline: 100,
        compressionResult: PerformCompressionResult.COMPRESSED,
      });

      const events = await fromAsync(
        client.sendMessageStream(
          request,
          new AbortController().signal,
          'prompt-id-overflow-recovered',
        ),
      );

      expect(events).toContainEqual(
        expect.objectContaining({ type: AgentEventType.Content, value: 'ok' }),
      );
      expect(events).not.toContainEqual(
        expect.objectContaining({
          type: AgentEventType.ContextWindowWillOverflow,
        }),
      );
    });

    it('should defer compression failure handling to finalized provider enforcement (issue 2402)', async () => {
      const handle = buildOverflowScenario(client, {
        compressionResult: new Error('boom'),
      });

      const events = await fromAsync(
        client.sendMessageStream(
          handle.request,
          new AbortController().signal,
          'prompt-id-overflow-compression-throws',
        ),
      );

      const overflowEvents = events.filter(
        (e) => e.type === AgentEventType.ContextWindowWillOverflow,
      );
      expect(overflowEvents).toHaveLength(0);
      expect(events.some((e) => e.type === AgentEventType.Content)).toBe(true);
    });

    it('should defer empty-history compression handling to finalized provider enforcement (issue 2402)', async () => {
      const handle = buildOverflowScenario(client, {
        postCompressionBaseline: PREFLIGHT_BASELINE,
        compressionResult: PerformCompressionResult.SKIPPED_EMPTY,
        enforcementError: new Error('unrecoverable'),
      });

      const events = await fromAsync(
        client.sendMessageStream(
          handle.request,
          new AbortController().signal,
          'prompt-id-overflow-skipped-empty',
        ),
      );

      const overflowEvents = events.filter(
        (e) => e.type === AgentEventType.ContextWindowWillOverflow,
      );
      expect(overflowEvents).toHaveLength(0);
      expect(events.some((e) => e.type === AgentEventType.Content)).toBe(true);
    });

    it('should recover via context-window enforcement when ordinary compression is a no-op (issue 2755 A1)', async () => {
      const ENFORCEMENT_TOKEN_LIMIT = 10_000;
      (tokenLimit as Mock<typeof tokenLimit>).mockReturnValue(
        ENFORCEMENT_TOKEN_LIMIT,
      );

      const historyService = new HistoryService();
      const fillText = 'x'.repeat(12_000);
      historyService.add(makeUserMessage(fillText), 'test-model');
      historyService.add(makeAiText(fillText), 'test-model');
      historyService.add(makeUserMessage(fillText), 'test-model');
      await historyService.waitForTokenUpdates();

      const runtimeContext = buildRuntimeContext(historyService, {
        compressionStrategy: 'one-shot',
        contextLimit: ENFORCEMENT_TOKEN_LIMIT,
      });

      const realChat = new ChatSession(
        runtimeContext,
        buildMockContentGenerator(),
        { maxOutputTokens: 100 },
        [],
      );
      client['chat'] = realChat;
      client['contentGenerator'] = {
        countTokens: vi.fn().mockResolvedValue({ totalTokens: 0 }),
      } as Partial<ContentGenerator> as ContentGenerator;

      mockTurnRunFn.mockReturnValue(
        (async function* () {
          yield { type: AgentEventType.Content, value: 'ok' };
        })(),
      );

      const request: ContentBlock[] = [
        { type: 'text', text: 'x'.repeat(4_000) },
      ];

      const events = await fromAsync(
        client.sendMessageStream(
          request,
          new AbortController().signal,
          'prompt-id-enforcement-recover-noop',
        ),
      );

      expect(events).toContainEqual(
        expect.objectContaining({ type: AgentEventType.Content, value: 'ok' }),
      );
      expect(events).not.toContainEqual(
        expect.objectContaining({
          type: AgentEventType.ContextWindowWillOverflow,
        }),
      );
      expect(realChat.getHistory().length).toBe(3);
    });

    it('should recover via enforcement when compression succeeded but was insufficient (issue 2755 A2)', async () => {
      const { request } = buildOverflowScenario(client, {
        postCompressionBaseline: 950,
        compressionResult: PerformCompressionResult.COMPRESSED,
        postEnforcementBaseline: 100,
      });

      const events = await fromAsync(
        client.sendMessageStream(
          request,
          new AbortController().signal,
          'prompt-id-enforcement-recover-insufficient',
        ),
      );

      expect(events).toContainEqual(
        expect.objectContaining({ type: AgentEventType.Content, value: 'ok' }),
      );
      expect(events).not.toContainEqual(
        expect.objectContaining({
          type: AgentEventType.ContextWindowWillOverflow,
        }),
      );
    });

    it('should recover via enforcement even when ordinary compression returns FAILED (issue 2755 A1 FAILED fallback)', async () => {
      const { request } = buildOverflowScenario(client, {
        postCompressionBaseline: PREFLIGHT_BASELINE,
        compressionResult: PerformCompressionResult.FAILED,
        postEnforcementBaseline: 100,
      });

      const events = await fromAsync(
        client.sendMessageStream(
          request,
          new AbortController().signal,
          'prompt-id-enforcement-recover-failed',
        ),
      );

      expect(events).toContainEqual(
        expect.objectContaining({ type: AgentEventType.Content, value: 'ok' }),
      );
      expect(events).not.toContainEqual(
        expect.objectContaining({
          type: AgentEventType.ContextWindowWillOverflow,
        }),
      );
    });

    it('should defer unrecoverable enforcement to the finalized provider seam (issue 2755 A3)', async () => {
      const handle = buildOverflowScenario(client, {
        postCompressionBaseline: 950,
        compressionResult: PerformCompressionResult.COMPRESSED,
        enforcementError: new Error('unrecoverable'),
      });

      const events = await fromAsync(
        client.sendMessageStream(
          handle.request,
          new AbortController().signal,
          'prompt-id-enforcement-unrecoverable',
        ),
      );

      const overflowEvents = events.filter(
        (e) => e.type === AgentEventType.ContextWindowWillOverflow,
      );
      expect(overflowEvents).toHaveLength(0);
      expect(events.some((e) => e.type === AgentEventType.Content)).toBe(true);
    });

    it('should defer insufficient-compression enforcement to the finalized provider seam (issue 2755 A7)', async () => {
      const handle = buildOverflowScenario(client, {
        postCompressionBaseline: 950,
        compressionResult: PerformCompressionResult.COMPRESSED,
        postEnforcementBaseline: 950,
      });

      const events = await fromAsync(
        client.sendMessageStream(
          handle.request,
          new AbortController().signal,
          'prompt-id-enforcement-still-too-large',
        ),
      );

      const overflowEvents = events.filter(
        (e) => e.type === AgentEventType.ContextWindowWillOverflow,
      );
      expect(overflowEvents).toHaveLength(0);
      expect(events.some((e) => e.type === AgentEventType.Content)).toBe(true);
    });

    it('should defer negative-remaining enforcement to the finalized provider seam (issue 2755 A3)', async () => {
      const handle = buildOverflowScenario(client, {
        postCompressionBaseline: MOCKED_TOKEN_LIMIT + 50,
        compressionResult: PerformCompressionResult.COMPRESSED,
        postEnforcementBaseline: MOCKED_TOKEN_LIMIT + 50,
      });

      const events = await fromAsync(
        client.sendMessageStream(
          handle.request,
          new AbortController().signal,
          'prompt-id-negative-remaining',
        ),
      );

      const overflowEvents = events.filter(
        (e) => e.type === AgentEventType.ContextWindowWillOverflow,
      );
      expect(overflowEvents).toHaveLength(0);
      expect(events.some((e) => e.type === AgentEventType.Content)).toBe(true);
    });

    it('should defer overflow detection to finalized provider enforcement for consecutive turns with cleared counts (issue 2755 A4)', async () => {
      (tokenLimit as Mock<typeof tokenLimit>).mockReturnValue(
        MOCKED_TOKEN_LIMIT,
      );
      (
        uiTelemetryService.getLastPromptTokenCount as Mock<
          typeof uiTelemetryService.getLastPromptTokenCount
        >
      ).mockReturnValue(0);

      const currentBaseline = PREFLIGHT_BASELINE;

      const mockChat: Partial<ChatSession> = {
        addHistory: vi.fn(),
        getHistory: vi.fn().mockReturnValue([]),
        getLastPromptTokenCount: vi.fn().mockReturnValue(0),
        getProjectedPromptBaseline: vi
          .fn()
          .mockImplementation(() => currentBaseline),
        getContextLimit: vi.fn(() => tokenLimit()),
        performCompression: vi
          .fn()
          .mockImplementation(() =>
            Promise.resolve(PerformCompressionResult.NOOP),
          ),
        enforceContextWindow: vi
          .fn()
          .mockRejectedValue(new Error('unrecoverable')),
      };
      client['chat'] = mockChat as ChatSession;
      client['contentGenerator'] = {
        countTokens: vi.fn().mockResolvedValue({ totalTokens: 0 }),
      } as Partial<ContentGenerator> as ContentGenerator;

      const longText = 'a'.repeat(OVERFLOW_REQUEST_CHARS);
      const request: ContentBlock[] = [{ type: 'text', text: longText }];
      const signal = new AbortController().signal;

      const events1 = await fromAsync(
        client.sendMessageStream(request, signal, 'prompt-id-first-turn'),
      );

      const overflowEvents1 = events1.filter(
        (e) => e.type === AgentEventType.ContextWindowWillOverflow,
      );
      expect(overflowEvents1).toHaveLength(0);
      expect(events1.some((e) => e.type === AgentEventType.Content)).toBe(true);

      const events2 = await fromAsync(
        client.sendMessageStream(request, signal, 'prompt-id-second-turn'),
      );

      const overflowEvents2 = events2.filter(
        (e) => e.type === AgentEventType.ContextWindowWillOverflow,
      );
      expect(overflowEvents2).toHaveLength(0);
    });

    it('should leave configured-limit parity to finalized provider enforcement (issue 2755 A7)', async () => {
      const injectedLimit = 842;

      client = (
        await setupAgentClient({
          mockChatCreateFn,
          mockGenerateContentFn,
          mockEmbedContentFn,
        })
      ).client;
      (tokenLimit as Mock<typeof tokenLimit>).mockReturnValue(
        MOCKED_TOKEN_LIMIT,
      );
      (
        client as unknown as {
          todoContinuationService: { todoToolsAvailable: boolean };
        }
      ).todoContinuationService.todoToolsAvailable = true;

      const baselineForRecovery = 750;
      const currentBaseline = baselineForRecovery;

      const mockChat: Partial<ChatSession> = {
        addHistory: vi.fn(),
        getHistory: vi.fn().mockReturnValue([]),
        getLastPromptTokenCount: vi.fn().mockReturnValue(0),
        getProjectedPromptBaseline: vi
          .fn()
          .mockImplementation(() => currentBaseline),
        getContextLimit: vi.fn().mockReturnValue(injectedLimit),
        performCompression: vi
          .fn()
          .mockImplementation(() =>
            Promise.resolve(PerformCompressionResult.COMPRESSED),
          ),
        enforceContextWindow: vi
          .fn()
          .mockRejectedValue(new Error('unrecoverable')),
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

      const requestCharsForParity = 540;

      const events = await fromAsync(
        client.sendMessageStream(
          [{ type: 'text', text: 'a'.repeat(requestCharsForParity) }],
          new AbortController().signal,
          'prompt-id-parity',
        ),
      );

      const overflowEvents = events.filter(
        (e) => e.type === AgentEventType.ContextWindowWillOverflow,
      );
      expect(overflowEvents).toHaveLength(0);
      expect(events.some((e) => e.type === AgentEventType.Content)).toBe(true);
    });

    it('should proceed exactly at the threshold boundary where estimated equals remaining * 0.95 (issue 2755 A7 exact threshold)', async () => {
      (tokenLimit as Mock<typeof tokenLimit>).mockReturnValue(
        MOCKED_TOKEN_LIMIT,
      );

      const fitBaseline = 500;
      const requestChars = Math.floor(
        (MOCKED_TOKEN_LIMIT - fitBaseline) * THRESHOLD * 4,
      );
      const exactEstimate = Math.floor(requestChars / 4);

      let currentBaseline = PREFLIGHT_BASELINE;

      const mockChat: Partial<ChatSession> = {
        addHistory: vi.fn(),
        getHistory: vi.fn().mockReturnValue([]),
        getLastPromptTokenCount: vi.fn().mockReturnValue(PREFLIGHT_BASELINE),
        getProjectedPromptBaseline: vi
          .fn()
          .mockImplementation(() => currentBaseline),
        getContextLimit: vi.fn(() => tokenLimit()),
        performCompression: vi.fn().mockImplementation(() => {
          currentBaseline = fitBaseline;
          return Promise.resolve(PerformCompressionResult.COMPRESSED);
        }),
        enforceContextWindow: vi.fn().mockResolvedValue(undefined),
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

      const events = await fromAsync(
        client.sendMessageStream(
          [{ type: 'text', text: 'a'.repeat(requestChars) }],
          new AbortController().signal,
          'prompt-id-threshold-exact',
        ),
      );

      const fitRemaining = MOCKED_TOKEN_LIMIT - fitBaseline;
      expect(exactEstimate).toBe(Math.floor(fitRemaining * THRESHOLD));
      expect(events).toContainEqual(
        expect.objectContaining({ type: AgentEventType.Content, value: 'ok' }),
      );
      expect(events).not.toContainEqual(
        expect.objectContaining({
          type: AgentEventType.ContextWindowWillOverflow,
        }),
      );
    });

    it('should surface the deferred finalized-envelope overflow exactly once with metadata and no preflight duplicate (issue 2755 A3 surfacing)', async () => {
      // The provider is the authority on overflow. When the finalized provider
      // envelope overflows, the Turn maps it to a single
      // ContextWindowWillOverflow event. The client must propagate exactly that
      // one event (with its metadata) and NOT add its own preflight overflow.
      const providerEstimatedTokens = 1200;
      const providerRemainingTokens = 1000;
      const { request } = buildOverflowScenario(client, {
        postCompressionBaseline: 950,
        compressionResult: PerformCompressionResult.COMPRESSED,
        enforcementError: new Error('unrecoverable'),
      });
      mockTurnRunFn.mockImplementation(() =>
        (async function* () {
          yield {
            type: AgentEventType.ContextWindowWillOverflow,
            value: {
              estimatedRequestTokenCount: providerEstimatedTokens,
              remainingTokenCount: providerRemainingTokens,
            },
          };
        })(),
      );

      const events = await fromAsync(
        client.sendMessageStream(
          request,
          new AbortController().signal,
          'prompt-id-deferred-overflow-surfaces',
        ),
      );

      const overflowEvents = events.filter(
        (e) => e.type === AgentEventType.ContextWindowWillOverflow,
      );
      expect(overflowEvents).toHaveLength(1);
      expect(overflowEvents[0]).toStrictEqual({
        type: AgentEventType.ContextWindowWillOverflow,
        value: {
          estimatedRequestTokenCount: providerEstimatedTokens,
          remainingTokenCount: providerRemainingTokens,
        },
      });
      // No recovery content was produced once the provider overflowed.
      expect(events.some((e) => e.type === AgentEventType.Content)).toBe(false);
    });
  });
});
