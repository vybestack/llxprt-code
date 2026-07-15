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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ContentBlock } from '@vybestack/llxprt-code-core/llm-types/index.js';
import { AgentClient } from './client.js';
import type { ContentGenerator } from '@vybestack/llxprt-code-core/core/contentGenerator.js';
import type { ChatSession } from './chatSession.js';
import { AgentEventType, PerformCompressionResult } from './turn.js';
import { uiTelemetryService } from '@vybestack/llxprt-code-core/telemetry/uiTelemetry.js';
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
vi.mock('@vybestack/llxprt-code-core/core/tokenLimits.js', () => {
  const tokenLimit = vi.fn();
  return {
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

// All scenarios share the same token geometry: a 1000-token limit with a
// 900-token preflight baseline, leaving 100 tokens of capacity. A 400-char
// request estimates to ~100 tokens (100 > 100 * 0.95 = 95 → overflow).
const MOCKED_TOKEN_LIMIT = 1000;
const PREFLIGHT_BASELINE = 900;
const OVERFLOW_REQUEST_CHARS = 400;

interface OverflowScenario {
  /** Post-compression projected baseline; omit when recovery never rechecks. */
  projectedBaseline?: number;
  /** Compression outcome: a result enum value, or an Error to reject with. */
  compressionResult: PerformCompressionResult | Error;
  /** Whether the turn should proceed (sets up a content stream on Turn.run). */
  proceeds: boolean;
}

interface OverflowScenarioHandle {
  mockChat: Partial<ChatSession>;
  request: ContentBlock[];
  estimatedRequestTokenCount: number;
  remainingTokenCount: number;
}

/** Builds the shared mockChat/generator/request scaffolding for one scenario. */
function buildOverflowScenario(
  client: AgentClient,
  scenario: OverflowScenario,
): OverflowScenarioHandle {
  vi.mocked(tokenLimit).mockReturnValue(MOCKED_TOKEN_LIMIT);
  vi.mocked(uiTelemetryService.getLastPromptTokenCount).mockReturnValue(
    PREFLIGHT_BASELINE,
  );

  const mockChat: Partial<ChatSession> = {
    addHistory: vi.fn(),
    getHistory: vi.fn().mockReturnValue([]),
    getLastPromptTokenCount: vi.fn().mockReturnValue(PREFLIGHT_BASELINE),
    performCompression:
      scenario.compressionResult instanceof Error
        ? vi.fn().mockRejectedValue(scenario.compressionResult)
        : vi.fn().mockResolvedValue(scenario.compressionResult),
  };
  if (scenario.projectedBaseline !== undefined) {
    mockChat.getProjectedPromptBaseline = vi
      .fn()
      .mockReturnValue(scenario.projectedBaseline);
  }
  client['chat'] = mockChat as ChatSession;
  client['contentGenerator'] = {
    countTokens: vi.fn().mockResolvedValue({ totalTokens: 0 }),
  } as Partial<ContentGenerator> as ContentGenerator;

  if (scenario.proceeds) {
    mockTurnRunFn.mockReturnValue(
      (async function* () {
        yield { type: AgentEventType.Content, value: 'ok' };
      })(),
    );
  }

  const longText = 'a'.repeat(OVERFLOW_REQUEST_CHARS);
  return {
    mockChat,
    request: [{ type: 'text' as const, text: longText }],
    estimatedRequestTokenCount: Math.floor(longText.length / 4),
    remainingTokenCount: MOCKED_TOKEN_LIMIT - PREFLIGHT_BASELINE,
  };
}

describe('AgentClient — preflight compression recovery (issue 2402)', () => {
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

    it('should recover via automatic compression and proceed instead of bailing on a small overflow (issue 2402)', async () => {
      // Initial preflight baseline (900) overflows; the post-compression
      // projected baseline (100) fits, so the turn proceeds.
      const { mockChat, request } = buildOverflowScenario(client, {
        projectedBaseline: 100,
        compressionResult: PerformCompressionResult.COMPRESSED,
        proceeds: true,
      });

      const events = await fromAsync(
        client.sendMessageStream(
          request,
          new AbortController().signal,
          'prompt-id-overflow-recovered',
        ),
      );

      expect(events).not.toContainEqual(
        expect.objectContaining({
          type: AgentEventType.ContextWindowWillOverflow,
        }),
      );
      expect(mockTurnRunFn).toHaveBeenCalled();
      // The recovery is an automatic compression, reported as 'auto' (matching
      // the downstream hard-limit paths), not 'manual'.
      expect(mockChat.performCompression).toHaveBeenCalledWith(
        'prompt-id-overflow-recovered',
        { bypassCooldown: true, trigger: 'auto' },
      );
    });

    it('should bail with ContextWindowWillOverflow when compression fails (issue 2402)', async () => {
      const handle = buildOverflowScenario(client, {
        compressionResult: PerformCompressionResult.FAILED,
        proceeds: false,
      });

      const events = await fromAsync(
        client.sendMessageStream(
          handle.request,
          new AbortController().signal,
          'prompt-id-overflow-compression-failed',
        ),
      );

      expect(events).toContainEqual({
        type: AgentEventType.ContextWindowWillOverflow,
        value: {
          estimatedRequestTokenCount: handle.estimatedRequestTokenCount,
          remainingTokenCount: handle.remainingTokenCount,
        },
      });
      expect(mockTurnRunFn).not.toHaveBeenCalled();
    });

    it('should still bail when compression does not reduce enough (issue 2402)', async () => {
      // Partial reduction (900 → 950) but not enough: newRemaining = 50,
      // estimated 100 > 50 * 0.95 → still overflows → bail.
      const handle = buildOverflowScenario(client, {
        projectedBaseline: 950,
        compressionResult: PerformCompressionResult.COMPRESSED,
        proceeds: false,
      });

      const events = await fromAsync(
        client.sendMessageStream(
          handle.request,
          new AbortController().signal,
          'prompt-id-overflow-compression-insufficient',
        ),
      );

      expect(events).toContainEqual({
        type: AgentEventType.ContextWindowWillOverflow,
        value: {
          estimatedRequestTokenCount: handle.estimatedRequestTokenCount,
          remainingTokenCount: handle.remainingTokenCount,
        },
      });
      expect(mockTurnRunFn).not.toHaveBeenCalled();
    });

    it('should bail when performCompression throws during recovery (issue 2402)', async () => {
      const handle = buildOverflowScenario(client, {
        compressionResult: new Error('boom'),
        proceeds: false,
      });

      const events = await fromAsync(
        client.sendMessageStream(
          handle.request,
          new AbortController().signal,
          'prompt-id-overflow-compression-throws',
        ),
      );

      expect(events).toContainEqual({
        type: AgentEventType.ContextWindowWillOverflow,
        value: {
          estimatedRequestTokenCount: handle.estimatedRequestTokenCount,
          remainingTokenCount: handle.remainingTokenCount,
        },
      });
      expect(mockTurnRunFn).not.toHaveBeenCalled();
    });

    it('should bail when compression is skipped because history is empty (issue 2402)', async () => {
      // SKIPPED_EMPTY: nothing to compress → baseline unchanged → still
      // overflows. Must not falsely recover.
      const handle = buildOverflowScenario(client, {
        projectedBaseline: PREFLIGHT_BASELINE,
        compressionResult: PerformCompressionResult.SKIPPED_EMPTY,
        proceeds: false,
      });

      const events = await fromAsync(
        client.sendMessageStream(
          handle.request,
          new AbortController().signal,
          'prompt-id-overflow-skipped-empty',
        ),
      );

      expect(events).toContainEqual({
        type: AgentEventType.ContextWindowWillOverflow,
        value: {
          estimatedRequestTokenCount: handle.estimatedRequestTokenCount,
          remainingTokenCount: handle.remainingTokenCount,
        },
      });
      expect(mockTurnRunFn).not.toHaveBeenCalled();
    });

    it('should proceed when compression drives remaining capacity non-positive, deferring to the downstream path (issue 2402)', async () => {
      // After compression the projected baseline (1005) exceeds the 1000-token
      // limit, making remaining capacity negative → defer to downstream,
      // mirroring the negative-remaining guard (issue #2139).
      buildOverflowScenario(client, {
        projectedBaseline: 1005,
        compressionResult: PerformCompressionResult.COMPRESSED,
        proceeds: true,
      });
      const request: ContentBlock[] = [
        { type: 'text', text: 'a'.repeat(OVERFLOW_REQUEST_CHARS) },
      ];

      const events = await fromAsync(
        client.sendMessageStream(
          request,
          new AbortController().signal,
          'prompt-id-overflow-defer',
        ),
      );

      expect(events).not.toContainEqual(
        expect.objectContaining({
          type: AgentEventType.ContextWindowWillOverflow,
        }),
      );
      expect(mockTurnRunFn).toHaveBeenCalled();
    });
  });
});
