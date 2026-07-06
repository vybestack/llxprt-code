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
import type { Part } from '@google/genai';
import { AgentClient } from './client.js';
import type { ContentGenerator } from '@vybestack/llxprt-code-core/core/contentGenerator.js';
import type { ChatSession } from './chatSession.js';
import { AgentEventType, PerformCompressionResult } from './turn.js';
import { uiTelemetryService } from '@vybestack/llxprt-code-core/telemetry/uiTelemetry.js';
import { tokenLimit } from '@vybestack/llxprt-code-core/core/tokenLimits.js';
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

describe('Gemini Client — preflight compression recovery (issue 2402)', () => {
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

    it('should recover via automatic compression and proceed instead of bailing on a small overflow (issue 2402)', async () => {
      const MOCKED_TOKEN_LIMIT = 1000;
      vi.mocked(tokenLimit).mockReturnValue(MOCKED_TOKEN_LIMIT);

      const lastPromptTokenCount = 900;
      vi.mocked(uiTelemetryService.getLastPromptTokenCount).mockReturnValue(
        lastPromptTokenCount,
      );

      // Initial preflight baseline (900) is over the limit → triggers
      // recovery; the post-compression projected baseline (100) fits.
      const mockChat: Partial<ChatSession> = {
        addHistory: vi.fn(),
        getHistory: vi.fn().mockReturnValue([]),
        getLastPromptTokenCount: vi.fn().mockReturnValue(900),
        getProjectedPromptBaseline: vi.fn().mockReturnValue(100),
        performCompression: vi
          .fn()
          .mockResolvedValue(PerformCompressionResult.COMPRESSED),
      };
      client['chat'] = mockChat as ChatSession;

      const mockGenerator: Partial<ContentGenerator> = {
        countTokens: vi.fn().mockResolvedValue({ totalTokens: 0 }),
      };
      client['contentGenerator'] = mockGenerator as ContentGenerator;

      const longText = 'a'.repeat(400);
      const request: Part[] = [{ text: longText }];

      const mockStream = (async function* () {
        yield { type: AgentEventType.Content, value: 'ok' };
      })();
      mockTurnRunFn.mockReturnValue(mockStream);

      const stream = client.sendMessageStream(
        request,
        new AbortController().signal,
        'prompt-id-overflow-recovered',
      );
      const events = await fromAsync(stream);

      expect(events).not.toContainEqual(
        expect.objectContaining({
          type: AgentEventType.ContextWindowWillOverflow,
        }),
      );
      expect(mockTurnRunFn).toHaveBeenCalled();
      // The recovery is an automatic compression, so it must be reported as
      // 'auto' (matching the downstream hard-limit paths), not 'manual'.
      expect(mockChat.performCompression).toHaveBeenCalledWith(
        'prompt-id-overflow-recovered',
        { bypassCooldown: true, trigger: 'auto' },
      );
    });

    it('should bail with ContextWindowWillOverflow when compression fails (issue 2402)', async () => {
      const MOCKED_TOKEN_LIMIT = 1000;
      vi.mocked(tokenLimit).mockReturnValue(MOCKED_TOKEN_LIMIT);

      const lastPromptTokenCount = 900;
      vi.mocked(uiTelemetryService.getLastPromptTokenCount).mockReturnValue(
        lastPromptTokenCount,
      );

      const mockChat: Partial<ChatSession> = {
        addHistory: vi.fn(),
        getHistory: vi.fn().mockReturnValue([]),
        getLastPromptTokenCount: vi.fn().mockReturnValue(lastPromptTokenCount),
        performCompression: vi
          .fn()
          .mockResolvedValue(PerformCompressionResult.FAILED),
      };
      client['chat'] = mockChat as ChatSession;

      const mockGenerator: Partial<ContentGenerator> = {
        countTokens: vi.fn().mockResolvedValue({ totalTokens: 0 }),
      };
      client['contentGenerator'] = mockGenerator as ContentGenerator;

      const longText = 'a'.repeat(400);
      const request: Part[] = [{ text: longText }];
      const estimatedRequestTokenCount = Math.floor(longText.length / 4);
      const remainingTokenCount = MOCKED_TOKEN_LIMIT - lastPromptTokenCount;

      const stream = client.sendMessageStream(
        request,
        new AbortController().signal,
        'prompt-id-overflow-compression-failed',
      );
      const events = await fromAsync(stream);

      expect(events).toContainEqual({
        type: AgentEventType.ContextWindowWillOverflow,
        value: {
          estimatedRequestTokenCount,
          remainingTokenCount,
        },
      });
      expect(mockTurnRunFn).not.toHaveBeenCalled();
    });

    it('should still bail when compression does not reduce enough (issue 2402)', async () => {
      const MOCKED_TOKEN_LIMIT = 1000;
      vi.mocked(tokenLimit).mockReturnValue(MOCKED_TOKEN_LIMIT);

      const lastPromptTokenCount = 900;
      vi.mocked(uiTelemetryService.getLastPromptTokenCount).mockReturnValue(
        lastPromptTokenCount,
      );

      const mockChat: Partial<ChatSession> = {
        addHistory: vi.fn(),
        getHistory: vi.fn().mockReturnValue([]),
        getLastPromptTokenCount: vi.fn().mockReturnValue(lastPromptTokenCount),
        // Partial reduction (900 → 950) but not enough: newRemaining = 50,
        // estimated 100 > 50 * 0.95 → still overflows → bail.
        getProjectedPromptBaseline: vi.fn().mockReturnValue(950),
        performCompression: vi
          .fn()
          .mockResolvedValue(PerformCompressionResult.COMPRESSED),
      };
      client['chat'] = mockChat as ChatSession;

      const mockGenerator: Partial<ContentGenerator> = {
        countTokens: vi.fn().mockResolvedValue({ totalTokens: 0 }),
      };
      client['contentGenerator'] = mockGenerator as ContentGenerator;

      const longText = 'a'.repeat(400);
      const request: Part[] = [{ text: longText }];
      const estimatedRequestTokenCount = Math.floor(longText.length / 4);
      const remainingTokenCount = MOCKED_TOKEN_LIMIT - lastPromptTokenCount;

      const stream = client.sendMessageStream(
        request,
        new AbortController().signal,
        'prompt-id-overflow-compression-insufficient',
      );
      const events = await fromAsync(stream);

      expect(events).toContainEqual({
        type: AgentEventType.ContextWindowWillOverflow,
        value: {
          estimatedRequestTokenCount,
          remainingTokenCount,
        },
      });
      expect(mockTurnRunFn).not.toHaveBeenCalled();
    });

    it('should bail when performCompression throws during recovery (issue 2402)', async () => {
      const MOCKED_TOKEN_LIMIT = 1000;
      vi.mocked(tokenLimit).mockReturnValue(MOCKED_TOKEN_LIMIT);

      const lastPromptTokenCount = 900;
      vi.mocked(uiTelemetryService.getLastPromptTokenCount).mockReturnValue(
        lastPromptTokenCount,
      );

      const mockChat: Partial<ChatSession> = {
        addHistory: vi.fn(),
        getHistory: vi.fn().mockReturnValue([]),
        getLastPromptTokenCount: vi.fn().mockReturnValue(lastPromptTokenCount),
        performCompression: vi.fn().mockRejectedValue(new Error('boom')),
      };
      client['chat'] = mockChat as ChatSession;

      const mockGenerator: Partial<ContentGenerator> = {
        countTokens: vi.fn().mockResolvedValue({ totalTokens: 0 }),
      };
      client['contentGenerator'] = mockGenerator as ContentGenerator;

      const longText = 'a'.repeat(400);
      const request: Part[] = [{ text: longText }];
      const estimatedRequestTokenCount = Math.floor(longText.length / 4);
      const remainingTokenCount = MOCKED_TOKEN_LIMIT - lastPromptTokenCount;

      const stream = client.sendMessageStream(
        request,
        new AbortController().signal,
        'prompt-id-overflow-compression-throws',
      );
      const events = await fromAsync(stream);

      expect(events).toContainEqual({
        type: AgentEventType.ContextWindowWillOverflow,
        value: {
          estimatedRequestTokenCount,
          remainingTokenCount,
        },
      });
      expect(mockTurnRunFn).not.toHaveBeenCalled();
    });

    it('should bail when compression is skipped because history is empty (issue 2402)', async () => {
      // SKIPPED_EMPTY: there is nothing to compress, so the baseline is
      // unchanged and the request still overflows. Must not falsely recover.
      const MOCKED_TOKEN_LIMIT = 1000;
      vi.mocked(tokenLimit).mockReturnValue(MOCKED_TOKEN_LIMIT);

      const lastPromptTokenCount = 900;
      vi.mocked(uiTelemetryService.getLastPromptTokenCount).mockReturnValue(
        lastPromptTokenCount,
      );

      const mockChat: Partial<ChatSession> = {
        addHistory: vi.fn(),
        getHistory: vi.fn().mockReturnValue([]),
        getLastPromptTokenCount: vi.fn().mockReturnValue(lastPromptTokenCount),
        // Nothing compressed → baseline unchanged → still overflows → bail.
        getProjectedPromptBaseline: vi
          .fn()
          .mockReturnValue(lastPromptTokenCount),
        performCompression: vi
          .fn()
          .mockResolvedValue(PerformCompressionResult.SKIPPED_EMPTY),
      };
      client['chat'] = mockChat as ChatSession;

      const mockGenerator: Partial<ContentGenerator> = {
        countTokens: vi.fn().mockResolvedValue({ totalTokens: 0 }),
      };
      client['contentGenerator'] = mockGenerator as ContentGenerator;

      const longText = 'a'.repeat(400);
      const request: Part[] = [{ text: longText }];
      const estimatedRequestTokenCount = Math.floor(longText.length / 4);
      const remainingTokenCount = MOCKED_TOKEN_LIMIT - lastPromptTokenCount;

      const stream = client.sendMessageStream(
        request,
        new AbortController().signal,
        'prompt-id-overflow-skipped-empty',
      );
      const events = await fromAsync(stream);

      expect(events).toContainEqual({
        type: AgentEventType.ContextWindowWillOverflow,
        value: { estimatedRequestTokenCount, remainingTokenCount },
      });
      expect(mockTurnRunFn).not.toHaveBeenCalled();
    });

    it('should proceed when compression drives remaining capacity non-positive, deferring to the downstream path (issue 2402)', async () => {
      // After compression the baseline exceeds the limit (newRemaining <= 0).
      // Recovery returns true so the normal send/enforcement path resolves it,
      // mirroring the negative-remaining guard (issue #2139).
      const MOCKED_TOKEN_LIMIT = 1000;
      vi.mocked(tokenLimit).mockReturnValue(MOCKED_TOKEN_LIMIT);

      const lastPromptTokenCount = 900;
      vi.mocked(uiTelemetryService.getLastPromptTokenCount).mockReturnValue(
        lastPromptTokenCount,
      );

      // Initial preflight baseline (900) overflows; the post-compression
      // projected baseline (1005) exceeds the 1000-token limit, making
      // remaining capacity negative → defer to downstream (issue #2139).
      const mockChat: Partial<ChatSession> = {
        addHistory: vi.fn(),
        getHistory: vi.fn().mockReturnValue([]),
        getLastPromptTokenCount: vi.fn().mockReturnValue(900),
        getProjectedPromptBaseline: vi.fn().mockReturnValue(1005),
        performCompression: vi
          .fn()
          .mockResolvedValue(PerformCompressionResult.COMPRESSED),
      };
      client['chat'] = mockChat as ChatSession;

      const mockGenerator: Partial<ContentGenerator> = {
        countTokens: vi.fn().mockResolvedValue({ totalTokens: 0 }),
      };
      client['contentGenerator'] = mockGenerator as ContentGenerator;

      const longText = 'a'.repeat(400);
      const request: Part[] = [{ text: longText }];

      const mockStream = (async function* () {
        yield { type: AgentEventType.Content, value: 'ok' };
      })();
      mockTurnRunFn.mockReturnValue(mockStream);

      const stream = client.sendMessageStream(
        request,
        new AbortController().signal,
        'prompt-id-overflow-defer',
      );
      const events = await fromAsync(stream);

      expect(events).not.toContainEqual(
        expect.objectContaining({
          type: AgentEventType.ContextWindowWillOverflow,
        }),
      );
      expect(mockTurnRunFn).toHaveBeenCalled();
    });
  });
});
