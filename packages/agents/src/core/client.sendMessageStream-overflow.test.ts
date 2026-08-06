/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * sendMessageStream tests: context window overflow, InvalidStream continuation.
 * Sibling to client.test.ts (split to avoid file-level max-lines disable).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from '../testApi.js';
import type {
  ContentBlock,
  AgentMessageInput,
} from '@vybestack/llxprt-code-core/llm-types/index.js';
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
vi.mock('./turn', (importOriginal) => {
  const result = importOriginal() as
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
vi.mock(
  '@vybestack/llxprt-code-core/core/tokenLimits.js',
  async (importOriginal) => {
    const actual = await importOriginal();
    const tokenLimit = vi.fn();
    return {
      ...actual,
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
  },
);
vi.mock('@vybestack/llxprt-code-core/telemetry/uiTelemetry.js', () => ({
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
    const baselineFns = (
      n: number,
    ): Pick<
      ChatSession,
      | 'getLastPromptTokenCount'
      | 'getProjectedPromptBaseline'
      | 'getContextLimit'
    > => ({
      getLastPromptTokenCount: vi.fn().mockReturnValue(n),
      getProjectedPromptBaseline: vi.fn().mockReturnValue(n),
      getContextLimit: vi.fn(() => tokenLimit()),
    });

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

    it('should defer overflow decisions to finalized provider enforcement', async () => {
      // Arrange
      const MOCKED_TOKEN_LIMIT = 1000;
      vi.mocked(tokenLimit).mockReturnValue(MOCKED_TOKEN_LIMIT);

      // Set last prompt token count
      const lastPromptTokenCount = 900;
      vi.mocked(uiTelemetryService.getLastPromptTokenCount).mockReturnValue(
        lastPromptTokenCount,
      );

      // Mock the chat to return the lastPromptTokenCount
      const mockChat: Partial<ChatSession> = {
        addHistory: vi.fn(),
        getHistory: vi.fn().mockReturnValue([]),
        ...baselineFns(lastPromptTokenCount),
        performCompression: vi
          .fn()
          .mockResolvedValue(PerformCompressionResult.FAILED),
      };
      client['chat'] = mockChat as ChatSession;

      const mockGenerator: Partial<ContentGenerator> = {
        countTokens: vi.fn().mockResolvedValue({ totalTokens: 0 }),
      };
      client['contentGenerator'] = mockGenerator as ContentGenerator;

      // Remaining = 100. Threshold (95%) = 95.
      // We need a request > 95 tokens.
      // A string of length 400 is roughly 100 tokens.
      const longText = 'a'.repeat(400);
      const request = [{ type: 'text' as const, text: longText }];
      // Client preflight must not make the authoritative overflow decision.

      // Act
      const stream = client.sendMessageStream(
        request,
        new AbortController().signal,
        'prompt-id-overflow',
      );

      const events = await fromAsync(stream);

      // Assert
      expect(events).not.toContainEqual(
        expect.objectContaining({
          type: AgentEventType.ContextWindowWillOverflow,
        }),
      );
      // The turn reaches provider-level finalized-envelope enforcement.
      expect(mockTurnRunFn).toHaveBeenCalled();
      // Legacy client-side compression recovery is no longer consulted.
      expect(mockChat.performCompression).not.toHaveBeenCalled();
    });

    it('should NOT emit ContextWindowWillOverflow when remaining capacity is already negative (issue 2139)', async () => {
      // Arrange — simulate a provider/profile switch where the prior session's
      // lastPromptTokenCount exceeds the switched model's limit. Remaining is
      // therefore negative, and the preflight guard must NOT short-circuit;
      // the normal send/compression/enforcement path should attempt to resolve
      // the overflow with the switched model's tokenizer.
      const MOCKED_TOKEN_LIMIT = 200000;
      vi.mocked(tokenLimit).mockReturnValue(MOCKED_TOKEN_LIMIT);

      // e.g. 249,442 stored tokens against a 200,000-token model.
      const lastPromptTokenCount = 249442;
      vi.mocked(uiTelemetryService.getLastPromptTokenCount).mockReturnValue(
        lastPromptTokenCount,
      );

      const mockChat: Partial<ChatSession> = {
        addHistory: vi.fn(),
        getHistory: vi.fn().mockReturnValue([]),
        ...baselineFns(lastPromptTokenCount),
        convertPartListUnionToIContent: vi
          .fn()
          .mockReturnValue({ speaker: 'human', blocks: [] }),
        estimatePendingTokens: vi.fn().mockResolvedValue(0),
      };
      client['chat'] = mockChat as ChatSession;

      const mockGenerator: Partial<ContentGenerator> = {
        countTokens: vi.fn().mockResolvedValue({ totalTokens: 0 }),
      };
      client['contentGenerator'] = mockGenerator as ContentGenerator;

      // A small "continue" request — remaining is -49,442.
      const request: ContentBlock[] = [{ type: 'text', text: 'continue' }];

      const mockStream = (async function* () {
        yield { type: AgentEventType.Content, value: 'ok' };
      })();
      mockTurnRunFn.mockReturnValue(mockStream);

      // Act
      const stream = client.sendMessageStream(
        request,
        new AbortController().signal,
        'prompt-id-negative-remaining',
      );
      const events = await fromAsync(stream);

      // Assert — no bogus overflow; the turn proceeds.
      expect(events).not.toContainEqual(
        expect.objectContaining({
          type: AgentEventType.ContextWindowWillOverflow,
        }),
      );
      expect(mockTurnRunFn).toHaveBeenCalled();
    });

    it('should NOT emit ContextWindowWillOverflow for a functionResponse-only continuation when remaining is negative (issue 2139)', async () => {
      // Arrange — after a tool call completes, the continuation request is a
      // bare functionResponse part. The negative-remaining short-circuit must
      // defer to the send path rather than tripping a bogus guard.
      const MOCKED_TOKEN_LIMIT = 200000;
      vi.mocked(tokenLimit).mockReturnValue(MOCKED_TOKEN_LIMIT);

      const lastPromptTokenCount = 249442;
      vi.mocked(uiTelemetryService.getLastPromptTokenCount).mockReturnValue(
        lastPromptTokenCount,
      );

      const mockChat: Partial<ChatSession> = {
        addHistory: vi.fn(),
        getHistory: vi.fn().mockReturnValue([]),
        ...baselineFns(lastPromptTokenCount),
        convertPartListUnionToIContent: vi.fn().mockReturnValue({
          speaker: 'tool',
          blocks: [],
        }),
        estimatePendingTokens: vi.fn().mockResolvedValue(0),
      };
      client['chat'] = mockChat as ChatSession;

      const mockGenerator: Partial<ContentGenerator> = {
        countTokens: vi.fn().mockResolvedValue({ totalTokens: 0 }),
      };
      client['contentGenerator'] = mockGenerator as ContentGenerator;

      // Pure tool_response continuation — 0 tokens by text estimate.
      const request: ContentBlock[] = [
        {
          type: 'tool_response',
          callId: 'someTool',
          toolName: 'someTool',
          result: { result: 'done' },
        },
      ];

      const mockStream = (async function* () {
        yield { type: AgentEventType.Content, value: 'ok' };
      })();
      mockTurnRunFn.mockReturnValue(mockStream);

      // Act
      const stream = client.sendMessageStream(
        request,
        new AbortController().signal,
        'prompt-id-tool-response-continuation',
      );
      const events = await fromAsync(stream);

      // Assert — the 0-token guard must not block the continuation.
      expect(events).not.toContainEqual(
        expect.objectContaining({
          type: AgentEventType.ContextWindowWillOverflow,
        }),
      );
      expect(mockTurnRunFn).toHaveBeenCalled();
    });

    it('should defer model-aware tokenization to finalized provider enforcement when remaining capacity is positive', async () => {
      // Arrange — legacy client preflight must not invoke generic tokenization.
      const MOCKED_TOKEN_LIMIT = 10000;
      vi.mocked(tokenLimit).mockReturnValue(MOCKED_TOKEN_LIMIT);
      const lastPromptTokenCount = 1000;
      vi.mocked(uiTelemetryService.getLastPromptTokenCount).mockReturnValue(
        lastPromptTokenCount,
      );

      const estimateSpy = vi.fn();
      const mockChat: Partial<ChatSession> = {
        addHistory: vi.fn(),
        getHistory: vi.fn().mockReturnValue([]),
        ...baselineFns(lastPromptTokenCount),
        estimatePendingTokens: estimateSpy,
      };
      client['chat'] = mockChat as ChatSession;

      const mockStream = (async function* () {
        yield { type: AgentEventType.Content, value: 'ok' };
      })();
      mockTurnRunFn.mockReturnValue(mockStream);

      const request = [{ type: 'text' as const, text: 'continue' }];

      // Act
      const stream = client.sendMessageStream(
        request,
        new AbortController().signal,
        'prompt-id-tokenizer-positive-remaining',
      );
      await fromAsync(stream);

      // Assert — estimation occurs against the provider's finalized envelope.
      expect(estimateSpy).not.toHaveBeenCalled();
      // The turn proceeds to authoritative enforcement.
      expect(mockTurnRunFn).toHaveBeenCalled();
    });

    it('should NOT invoke the tokenizer when remaining capacity is already negative (issue 2139)', async () => {
      // Arrange — proves the negative-remaining short-circuit avoids the
      // tokenizer-backed sizing path entirely (it returns before sizing).
      const MOCKED_TOKEN_LIMIT = 200000;
      vi.mocked(tokenLimit).mockReturnValue(MOCKED_TOKEN_LIMIT);
      const lastPromptTokenCount = 249442;
      vi.mocked(uiTelemetryService.getLastPromptTokenCount).mockReturnValue(
        lastPromptTokenCount,
      );

      const convertSpy = vi.fn();
      const estimateSpy = vi.fn();
      const mockChat: Partial<ChatSession> = {
        addHistory: vi.fn(),
        getHistory: vi.fn().mockReturnValue([]),
        ...baselineFns(lastPromptTokenCount),
        convertPartListUnionToIContent: convertSpy,
        estimatePendingTokens: estimateSpy,
      };
      client['chat'] = mockChat as ChatSession;

      const mockStream = (async function* () {
        yield { type: AgentEventType.Content, value: 'ok' };
      })();
      mockTurnRunFn.mockReturnValue(mockStream);

      // Act
      const stream = client.sendMessageStream(
        [{ type: 'text', text: 'continue' }],
        new AbortController().signal,
        'prompt-id-tokenizer-skipped-negative',
      );
      const events = await fromAsync(stream);

      // Assert — preflight deferred to the send path; tokenizer never called.
      expect(convertSpy).not.toHaveBeenCalled();
      expect(estimateSpy).not.toHaveBeenCalled();
      expect(events).not.toContainEqual(
        expect.objectContaining({
          type: AgentEventType.ContextWindowWillOverflow,
        }),
      );
      expect(mockTurnRunFn).toHaveBeenCalled();
    });

    it('should defer functionResponse sizing to finalized provider enforcement when no tokenizer is available', async () => {
      // Arrange — a minimal chat double without tokenizer methods must still proceed
      // to finalized provider enforcement.
      const MOCKED_TOKEN_LIMIT = 1000;
      vi.mocked(tokenLimit).mockReturnValue(MOCKED_TOKEN_LIMIT);
      const lastPromptTokenCount = 0;
      vi.mocked(uiTelemetryService.getLastPromptTokenCount).mockReturnValue(
        lastPromptTokenCount,
      );

      const mockChat: Partial<ChatSession> = {
        addHistory: vi.fn(),
        getHistory: vi.fn().mockReturnValue([]),
        ...baselineFns(lastPromptTokenCount),
      };
      client['chat'] = mockChat as ChatSession;

      const mockStream = (async function* () {
        yield { type: AgentEventType.Content, value: 'ok' };
      })();
      mockTurnRunFn.mockReturnValue(mockStream);

      // Build a tool_response payload large enough that its JSON/4 exceeds
      // the 95% threshold of the full limit (1000 * 0.95 = 950 tokens).
      const largeResult = 'x'.repeat(4000);
      const request = [
        {
          type: 'tool_response' as const,
          callId: 'someTool',
          toolName: 'someTool',
          result: { result: largeResult },
        },
      ];

      // Act
      const stream = client.sendMessageStream(
        request,
        new AbortController().signal,
        'prompt-id-structured-fallback-fn-response',
      );
      const events = await fromAsync(stream);

      // Assert — client preflight does not size the raw tool response.
      const overflow = events.find(
        (e) => e.type === AgentEventType.ContextWindowWillOverflow,
      );
      expect(overflow).toBeUndefined();
      // Provider projection owns the authoritative count.
      expect(mockTurnRunFn).toHaveBeenCalled();
    });

    it('should not invoke the legacy client tokenizer during preflight when it would throw (issue 2402)', async () => {
      // Arrange — the client tokenizer would throw if invoked during preflight.
      const MOCKED_TOKEN_LIMIT = 1000;
      vi.mocked(tokenLimit).mockReturnValue(MOCKED_TOKEN_LIMIT);
      const lastPromptTokenCount = 0;
      vi.mocked(uiTelemetryService.getLastPromptTokenCount).mockReturnValue(
        lastPromptTokenCount,
      );

      const mockChat: Partial<ChatSession> = {
        addHistory: vi.fn(),
        getHistory: vi.fn().mockReturnValue([]),
        ...baselineFns(lastPromptTokenCount),
        estimatePendingTokens: vi
          .fn()
          .mockRejectedValue(new Error('tokenizer unavailable')),
      };
      client['chat'] = mockChat as ChatSession;

      const request = [
        {
          type: 'tool_response' as const,
          callId: 'someTool',
          toolName: 'someTool',
          result: { result: 'x'.repeat(4000) },
        },
      ];

      // Act
      const stream = client.sendMessageStream(
        request,
        new AbortController().signal,
        'prompt-id-conversion-fallback',
      );
      const events = await fromAsync(stream);

      // Assert — client preflight neither invokes the tokenizer nor emits overflow.
      const overflow = events.find(
        (e) => e.type === AgentEventType.ContextWindowWillOverflow,
      );
      expect(overflow).toBeUndefined();
      expect(mockTurnRunFn).toHaveBeenCalled();
    });

    it('should not let inlineData/fileData binary payloads inflate the preflight estimate (issue 2402)', async () => {
      // Arrange — large binary payloads must not inflate the fallback estimate.
      const MOCKED_TOKEN_LIMIT = 1000;
      vi.mocked(tokenLimit).mockReturnValue(MOCKED_TOKEN_LIMIT);
      const lastPromptTokenCount = 0;
      vi.mocked(uiTelemetryService.getLastPromptTokenCount).mockReturnValue(
        lastPromptTokenCount,
      );

      const mockChat: Partial<ChatSession> = {
        addHistory: vi.fn(),
        getHistory: vi.fn().mockReturnValue([]),
        ...baselineFns(lastPromptTokenCount),
      };
      client['chat'] = mockChat as ChatSession;

      const mockStream = (async function* () {
        yield { type: AgentEventType.Content, value: 'ok' };
      })();
      mockTurnRunFn.mockReturnValue(mockStream);

      const request: ContentBlock[] = [
        { type: 'text', text: 'short' }, // 5 chars → 1 token
        {
          type: 'media',
          mimeType: 'application/pdf',
          data: 'A'.repeat(11 * 1024 * 1024), // ignored
          encoding: 'base64',
        },
      ];

      // Act
      const stream = client.sendMessageStream(
        request,
        new AbortController().signal,
        'prompt-id-structured-fallback-ignore-binary',
      );
      const events = await fromAsync(stream);

      // Assert — no overflow despite the huge (ignored) inlineData payload.
      expect(events).not.toContainEqual(
        expect.objectContaining({
          type: AgentEventType.ContextWindowWillOverflow,
        }),
      );
      expect(mockTurnRunFn).toHaveBeenCalled();
    });

    it('should defer sticky-model limit enforcement to the finalized provider envelope', async () => {
      const STICKY_MODEL_LIMIT = 1000;
      client['currentSequenceModel'] = 'gemini-1.5-flash';
      vi.mocked(tokenLimit).mockReturnValue(STICKY_MODEL_LIMIT);
      const lastPromptTokenCount = 900;
      vi.mocked(uiTelemetryService.getLastPromptTokenCount).mockReturnValue(
        lastPromptTokenCount,
      );
      const mockChat: Partial<ChatSession> = {
        addHistory: vi.fn(),
        getHistory: vi.fn().mockReturnValue([]),
        ...baselineFns(lastPromptTokenCount),
      };
      client['chat'] = mockChat as ChatSession;

      const mockGenerator: Partial<ContentGenerator> = {
        countTokens: vi.fn().mockResolvedValue({ totalTokens: 0 }),
      };
      client['contentGenerator'] = mockGenerator as ContentGenerator;

      // Remaining (sticky) = 100. Threshold (95%) = 95.
      // We need a request > 95 tokens.
      const longText = 'a'.repeat(400);
      const request = [{ type: 'text' as const, text: longText }];
      // Client preflight must not make the authoritative overflow decision.

      // Act
      const stream = client.sendMessageStream(
        request,
        new AbortController().signal,
        'test-session-id', // Use the same ID as the session to keep stickiness
      );

      const events = await fromAsync(stream);

      // Assert
      // Provider-level enforcement owns the sticky model's context limit.
      expect(events).not.toContainEqual(
        expect.objectContaining({
          type: AgentEventType.ContextWindowWillOverflow,
        }),
      );
      expect(mockChat.getContextLimit).not.toHaveBeenCalled();
      expect(mockTurnRunFn).toHaveBeenCalled();
    });

    it('should forward large binary requests to provider enforcement without client overflow preflight', async () => {
      // Arrange
      const MOCKED_TOKEN_LIMIT = 1000000; // 1M tokens
      vi.mocked(tokenLimit).mockReturnValue(MOCKED_TOKEN_LIMIT);

      const lastPromptTokenCount = 10000;
      const mockChat: Partial<ChatSession> = {
        ...baselineFns(lastPromptTokenCount),
        getHistory: vi.fn().mockReturnValue([]),
      };
      client['chat'] = mockChat as ChatSession;

      // Simulate a PDF file with large base64 data (11MB when encoded).
      // The client forwards binary-bearing requests without estimating them;
      // finalized-envelope enforcement belongs to the provider send seam.
      const largePdfBase64 = 'A'.repeat(11 * 1024 * 1024);
      const request: ContentBlock[] = [
        { type: 'text', text: 'Please analyze this PDF document' }, // ~35 chars = ~8 tokens
        {
          type: 'media',
          mimeType: 'application/pdf',
          data: largePdfBase64,
          encoding: 'base64',
        },
      ];

      // Mock Turn.run to simulate successful processing
      const mockStream = (async function* () {
        yield { type: 'content', value: 'Analysis complete' };
      })();
      mockTurnRunFn.mockReturnValue(mockStream);

      // Act
      const stream = client.sendMessageStream(
        request,
        new AbortController().signal,
        'prompt-id-pdf-test',
      );

      const events = await fromAsync(stream);

      // Assert: the client did not run a legacy overflow preflight.
      expect(events).not.toContainEqual(
        expect.objectContaining({
          type: AgentEventType.ContextWindowWillOverflow,
        }),
      );

      expect(mockTurnRunFn).toHaveBeenCalled();
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
        getHistory: vi.fn().mockReturnValue([]),
        ...baselineFns(0),
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
        getHistory: vi.fn().mockReturnValue([]),
        ...baselineFns(0),
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
        getHistory: vi.fn().mockReturnValue([]),
        ...baselineFns(0),
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
        getHistory: vi.fn().mockReturnValue([]),
        ...baselineFns(0),
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
