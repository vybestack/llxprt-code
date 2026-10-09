/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * sendMessageStream tests: context window overflow, InvalidStream continuation.
 * Sibling to client.test.ts (split to avoid file-level max-lines disable).
 */

import { automock } from '@vybestack/llxprt-code-test-utils';
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  afterAll,
  type Mock,
} from 'bun:test';
import type { ContentBlock } from '@vybestack/llxprt-code-core/llm-types/index.js';
import { AgentClient } from './client.js';
import * as overflowCases from './client.sendMessageStream-overflow-fixture.js';
import {
  installOverflowMockChat,
  installZeroCountGenerator,
} from './client-send-stream-test-helpers.js';
import { AgentEventType } from './turn.js';
import { uiTelemetryService } from '@vybestack/llxprt-code-core/telemetry/uiTelemetry.js';
import { tokenLimit } from '@vybestack/llxprt-code-core/core/tokenLimits.js';
import {
  fromAsync,
  setupAgentClient,
  type MockResponseShape,
} from './__tests__/client-test-helpers.js';

// Mock prompts module before imports
const realConfigModule = {
  ...(await import('@vybestack/llxprt-code-core/config/config.js')),
};
const realRetryModule = {
  ...(await import('@vybestack/llxprt-code-core/utils/retry.js')),
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
const realClientToolGovernance = {
  ...(await import('./clientToolGovernance.js')),
};
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

let client: AgentClient;

/** Makes the mocked Turn yield a single Content "ok" event. */
const yieldOkStream = (): void => {
  mockTurnRunFn.mockReturnValue(
    (async function* () {
      yield { type: AgentEventType.Content, value: 'ok' };
    })(),
  );
};

function registerOverflowSuite(): void {
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
    it(
      'should defer overflow decisions to finalized provider enforcement',
      testShouldDeferOverflowDecisionsToFinalizedProviderEnforcement1,
    );
    it(
      'should NOT emit ContextWindowWillOverflow when remaining capacity is already negative (issue 2139)',
      testShouldNOTEmitContextWindowWillOverflowWhenRemainingCapacityI2,
    );
    it(
      'should NOT emit ContextWindowWillOverflow for a functionResponse-only continuation when remaining is negative (issue 2139)',
      testShouldNOTEmitContextWindowWillOverflowForAFunctionResponseOn3,
    );
    it(
      'should defer model-aware tokenization to finalized provider enforcement when remaining capacity is positive',
      testShouldDeferModelAwareTokenizationToFinalizedProviderEnforcem4,
    );
    it(
      'should NOT invoke the tokenizer when remaining capacity is already negative (issue 2139)',
      testShouldNOTInvokeTheTokenizerWhenRemainingCapacityIsAlreadyNeg5,
    );
    it(
      'should defer functionResponse sizing to finalized provider enforcement when no tokenizer is available',
      testShouldDeferFunctionResponseSizingToFinalizedProviderEnforcem6,
    );
    it(
      'should not invoke the legacy client tokenizer during preflight when it would throw (issue 2402)',
      testShouldNotInvokeTheLegacyClientTokenizerDuringPreflightWhenIt7,
    );
    it(
      'should not let inlineData/fileData binary payloads inflate the preflight estimate (issue 2402)',
      testShouldNotLetInlineDataFileDataBinaryPayloadsInflateThePrefli8,
    );
    it(
      'should defer sticky-model limit enforcement to the finalized provider envelope',
      testShouldDeferStickyModelLimitEnforcementToTheFinalizedProvider9,
    );
    it(
      'should forward large binary requests to provider enforcement without client overflow preflight',
      testShouldForwardLargeBinaryRequestsToProviderEnforcementWithout10,
    );
    it(
      'should recursively call sendMessageStream with "Please continue." when InvalidStream event is received',
      testShouldRecursivelyCallSendMessageStreamWithPleaseContinueWhen11,
    );
    it(
      'should not recursively call sendMessageStream with "Please continue." when InvalidStream event is received and flag is false',
      testShouldNotRecursivelyCallSendMessageStreamWithPleaseContinueW12,
    );
    it(
      'should not trigger thinking-only continuation after InvalidStream when flag is false',
      testShouldNotTriggerThinkingOnlyContinuationAfterInvalidStreamWh13,
    );
    it(
      'should stop recursing after one retry when InvalidStream events are repeatedly received',
      testShouldStopRecursingAfterOneRetryWhenInvalidStreamEventsAreRe14,
    );
  });
}

describe('AgentClient (client.ts)', () => {
  afterAll(() => {
    void vi.mock('./clientToolGovernance.js', () => realClientToolGovernance);
    void vi.mock('@vybestack/llxprt-code-tools', () => actual);
    void vi.mock(
      '@vybestack/llxprt-code-core/services/todo-reminder-service.js',
      () => realTodoReminderModule,
    );
    void vi.mock('./turn', () => __actual);
    void vi.mock(
      '@vybestack/llxprt-code-core/config/config.js',
      () => realConfigModule,
    );
    void vi.mock(
      '@vybestack/llxprt-code-core/utils/retry.js',
      () => realRetryModule,
    );
  });
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
  registerOverflowSuite();
});
async function testShouldDeferOverflowDecisionsToFinalizedProviderEnforcement1(): Promise<void> {
  const { events, mockChat } =
    await overflowCases.testShouldDeferOverflowDecisionsToFinalizedProviderEnforcement1(
      client,
      mockTurnRunFn,
    );
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
}

async function testShouldNOTEmitContextWindowWillOverflowWhenRemainingCapacityI2(): Promise<void> {
  const { events } =
    await overflowCases.testShouldNOTEmitContextWindowWillOverflowWhenRemainingCapacityI2(
      client,
      mockTurnRunFn,
      yieldOkStream,
    );
  // Assert — no bogus overflow; the turn proceeds.
  expect(events).not.toContainEqual(
    expect.objectContaining({
      type: AgentEventType.ContextWindowWillOverflow,
    }),
  );
  expect(mockTurnRunFn).toHaveBeenCalled();
}

async function testShouldNOTEmitContextWindowWillOverflowForAFunctionResponseOn3(): Promise<void> {
  const { events } =
    await overflowCases.testShouldNOTEmitContextWindowWillOverflowForAFunctionResponseOn3(
      client,
      mockTurnRunFn,
      yieldOkStream,
    );
  // Assert — the 0-token guard must not block the continuation.
  expect(events).not.toContainEqual(
    expect.objectContaining({
      type: AgentEventType.ContextWindowWillOverflow,
    }),
  );
  expect(mockTurnRunFn).toHaveBeenCalled();
}

async function testShouldDeferModelAwareTokenizationToFinalizedProviderEnforcem4(): Promise<void> {
  const { estimateSpy } =
    await overflowCases.testShouldDeferModelAwareTokenizationToFinalizedProviderEnforcem4(
      client,
      mockTurnRunFn,
      yieldOkStream,
    );
  // Assert — estimation occurs against the provider's finalized envelope.
  expect(estimateSpy).not.toHaveBeenCalled();
  // The turn proceeds to authoritative enforcement.
  expect(mockTurnRunFn).toHaveBeenCalled();
}

async function testShouldNOTInvokeTheTokenizerWhenRemainingCapacityIsAlreadyNeg5(): Promise<void> {
  const { convertSpy, estimateSpy, events } =
    await overflowCases.testShouldNOTInvokeTheTokenizerWhenRemainingCapacityIsAlreadyNeg5(
      client,
      mockTurnRunFn,
      yieldOkStream,
    );
  // Assert — preflight deferred to the send path; tokenizer never called.
  expect(convertSpy).not.toHaveBeenCalled();
  expect(estimateSpy).not.toHaveBeenCalled();
  expect(events).not.toContainEqual(
    expect.objectContaining({
      type: AgentEventType.ContextWindowWillOverflow,
    }),
  );
  expect(mockTurnRunFn).toHaveBeenCalled();
}

async function testShouldDeferFunctionResponseSizingToFinalizedProviderEnforcem6(): Promise<void> {
  const { events } =
    await overflowCases.testShouldDeferFunctionResponseSizingToFinalizedProviderEnforcem6(
      client,
      mockTurnRunFn,
      yieldOkStream,
    );
  // Assert — client preflight does not size the raw tool response.
  const overflow = events.find(
    (e) => e.type === AgentEventType.ContextWindowWillOverflow,
  );
  expect(overflow).toBeUndefined();
  // Provider projection owns the authoritative count.
  expect(mockTurnRunFn).toHaveBeenCalled();
}

async function testShouldNotInvokeTheLegacyClientTokenizerDuringPreflightWhenIt7(): Promise<void> {
  // Arrange — the client tokenizer would throw if invoked during preflight.
  const MOCKED_TOKEN_LIMIT = 1000;
  (tokenLimit as Mock<typeof tokenLimit>).mockReturnValue(MOCKED_TOKEN_LIMIT);
  const lastPromptTokenCount = 0;
  (
    uiTelemetryService.getLastPromptTokenCount as Mock<
      typeof uiTelemetryService.getLastPromptTokenCount
    >
  ).mockReturnValue(lastPromptTokenCount);

  installOverflowMockChat(client, lastPromptTokenCount, {
    estimatePendingTokens: vi
      .fn()
      .mockRejectedValue(new Error('tokenizer unavailable')),
  });

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
}

async function testShouldNotLetInlineDataFileDataBinaryPayloadsInflateThePrefli8(): Promise<void> {
  // Arrange — large binary payloads must not inflate the fallback estimate.
  const MOCKED_TOKEN_LIMIT = 1000;
  (tokenLimit as Mock<typeof tokenLimit>).mockReturnValue(MOCKED_TOKEN_LIMIT);
  const lastPromptTokenCount = 0;
  (
    uiTelemetryService.getLastPromptTokenCount as Mock<
      typeof uiTelemetryService.getLastPromptTokenCount
    >
  ).mockReturnValue(lastPromptTokenCount);

  installOverflowMockChat(client, lastPromptTokenCount);

  yieldOkStream();

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
}

async function testShouldDeferStickyModelLimitEnforcementToTheFinalizedProvider9(): Promise<void> {
  const STICKY_MODEL_LIMIT = 1000;
  client['currentSequenceModel'] = 'gemini-1.5-flash';
  (tokenLimit as Mock<typeof tokenLimit>).mockReturnValue(STICKY_MODEL_LIMIT);
  const lastPromptTokenCount = 900;
  (
    uiTelemetryService.getLastPromptTokenCount as Mock<
      typeof uiTelemetryService.getLastPromptTokenCount
    >
  ).mockReturnValue(lastPromptTokenCount);
  const mockChat = installOverflowMockChat(client, lastPromptTokenCount);

  installZeroCountGenerator(client);

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
}

async function testShouldForwardLargeBinaryRequestsToProviderEnforcementWithout10(): Promise<void> {
  // Arrange
  const MOCKED_TOKEN_LIMIT = 1000000; // 1M tokens
  (tokenLimit as Mock<typeof tokenLimit>).mockReturnValue(MOCKED_TOKEN_LIMIT);

  const lastPromptTokenCount = 10000;
  installOverflowMockChat(client, lastPromptTokenCount);

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
}

async function testShouldRecursivelyCallSendMessageStreamWithPleaseContinueWhen11(): Promise<void> {
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

  installOverflowMockChat(client, 0);

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
}

async function testShouldNotRecursivelyCallSendMessageStreamWithPleaseContinueW12(): Promise<void> {
  vi.spyOn(client['config'], 'getContinueOnFailedApiCall').mockReturnValue(
    false,
  );
  // Arrange
  const mockStream1 = (async function* () {
    yield { type: AgentEventType.InvalidStream };
  })();

  mockTurnRunFn.mockReturnValueOnce(mockStream1);

  installOverflowMockChat(client, 0);

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
}

async function testShouldNotTriggerThinkingOnlyContinuationAfterInvalidStreamWh13(): Promise<void> {
  const { events, continuationRequestPresent, forwardedRequestCount } =
    await overflowCases.observeNotTriggerThinkingOnlyContinuationAfterInvalidStreamWhenFlagIsFalse(
      client,
      mockTurnRunFn,
      todoStoreReadMock,
    );
  expect(mockTurnRunFn).toHaveBeenCalledTimes(1);
  expect({
    continuationRequestPresent,
    forwardedRequestCount,
  }).toStrictEqual({
    continuationRequestPresent: false,
    forwardedRequestCount: 1,
  });
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
}

async function testShouldStopRecursingAfterOneRetryWhenInvalidStreamEventsAreRe14(): Promise<void> {
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

  installOverflowMockChat(client, 0);

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
}
