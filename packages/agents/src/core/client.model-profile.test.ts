/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * AgentClient model profile and ModelInfo tests (issue #1770).
 * Sibling to client.test.ts (split to avoid file-level max-lines disable).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import {
  configHistoryRows,
  readConfigHistory,
} from '@vybestack/llxprt-code-core/config/config-stream-test-helpers.js';
import type { BaseLLMClient } from './baseLlmClient.js';
import type { Turn } from './turn.js';
import type { ContentGeneratorConfig } from '@vybestack/llxprt-code-core/core/contentGenerator.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { AgentClient } from './client.js';
import type { ContentGenerator } from '@vybestack/llxprt-code-core/core/contentGenerator.js';
import type { ChatSession } from './chatSession.js';
import {
  AgentEventType,
  type ServerAgentStreamEvent,
  type ModelInfo,
} from './turn.js';
import { coreEvents } from '@vybestack/llxprt-code-core/utils/events.js';
import {
  fromAsync,
  setupAgentClient,
  type MockResponseShape,
} from './__tests__/client-test-helpers.js';

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

let getModelSpy: ReturnType<typeof vi.spyOn>;

/**
 * Helper: collect only ModelInfo events from a stream.
 */
async function collectModelInfos(
  stream: AsyncIterable<ServerAgentStreamEvent>,
): Promise<ModelInfo[]> {
  const events = await fromAsync(stream);
  return events
    .filter(
      (
        e,
      ): e is ServerAgentStreamEvent & {
        type: typeof AgentEventType.ModelInfo;
        value: ModelInfo;
      } => e.type === AgentEventType.ModelInfo,
    )
    .map((e) => e.value);
}

async function disposeClientFixture(): Promise<void> {
  await client.dispose();
  vi.restoreAllMocks();
}

async function setupClientFixture(): Promise<void> {
  vi.clearAllMocks();
  const ctx = await setupAgentClient(
    {
      mockChatCreateFn,
      mockGenerateContentFn,
      mockEmbedContentFn,
    },
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

function verifyProfileSequenceReset(): void {
  // Set a sticky model
  client['currentSequenceModel'] = 'sticky-model';

  expect(client.getCurrentSequenceModel()).toBe('sticky-model');

  // Emit ModelProfileChanged — should reset the sticky model
  coreEvents.emitModelProfileChanged({
    model: 'new-model',
    providerName: 'anthropic',
    profileName: null,
    displayLabel: 'new-model',
  });
}

function verifyProfileInvalidation(): {
  historyService: unknown;
  contentGenerator: ContentGenerator;
} {
  const historyService = {
    clear: vi.fn(),
    findUnmatchedToolCalls: vi.fn().mockReturnValue([]),
    getCurated: vi.fn().mockReturnValue([]),
    getTotalTokens: vi.fn().mockReturnValue(0),
  };

  const mockChat: Partial<ChatSession> = {
    getHistoryService: vi.fn().mockReturnValue(historyService),
  };

  const contentGenerator = {} as ContentGenerator;

  client['chat'] = mockChat as ChatSession;

  client['contentGenerator'] = contentGenerator;

  client['_baseLlmClient'] = {} as BaseLLMClient;

  client['_pendingConfig'] = {
    model: 'test-model',
    apiKey: 'old-key',
    vertexai: false,
  };

  expect(client.hasChatInitialized()).toBe(true);

  coreEvents.emitModelProfileChanged({
    model: 'claude-opus-4-8',
    providerName: 'anthropic',
    profileName: 'opusthinking',
    displayLabel: 'opusthinking',
  });
  return { historyService, contentGenerator };
}

async function verifyDeferredInvalidation(): Promise<{
  executeSpy: unknown;
  historyService: unknown;
}> {
  const historyService = {
    clear: vi.fn(),
    findUnmatchedToolCalls: vi.fn().mockReturnValue([]),
    getCurated: vi.fn().mockReturnValue([]),
    getTotalTokens: vi.fn().mockReturnValue(0),
  };

  const mockChat: Partial<ChatSession> = {
    getHistoryService: vi.fn().mockReturnValue(historyService),
  };

  client['chat'] = mockChat as ChatSession;

  client['contentGenerator'] = {} as ContentGenerator;

  const executeSpy = vi
    .spyOn(client['messageStreamOrchestrator'], 'execute')
    .mockImplementation(async function* () {
      coreEvents.emitModelProfileChanged({
        model: 'claude-opus-4-8',
        providerName: 'anthropic',
        profileName: 'opusthinking',
        displayLabel: 'opusthinking',
      });
      expect(client.hasChatInitialized()).toBe(true);
      yield { type: AgentEventType.Content, value: 'done' };
      return {} as Turn;
    });

  await fromAsync(
    client.sendMessageStream('hello', new AbortController().signal, 'prompt'),
  );
  return { executeSpy, historyService };
}

async function verifyLiveHistory(): Promise<{ liveHistory: IContent[] }> {
  const storedHistory = configHistoryRows({
    speaker: 'human',
    blocks: [{ type: 'text', text: 'old turn' }],
  });
  const liveHistory = configHistoryRows(...storedHistory, {
    speaker: 'ai',
    blocks: [{ type: 'text', text: 'new committed turn' }],
  });
  const history = new HistoryService();
  const root = mkdtempSync(join(tmpdir(), 'model-profile-stream-'));
  Object.assign(client['config'], {
    getTokenizerFactory: () => undefined,
    getLocalMediaStore: () =>
      new LocalMediaStore({ rootDirectory: root, quotaBytes: 1024 * 1024 }),
  });
  try {
    await history.transformRows(async (_previous, sink) => {
      for (const row of liveHistory) sink.appendDetached(row);
    });
    const mockChat: Partial<ChatSession> = {
      waitForIdle: async (): Promise<void> => {},
      streamHistory: (signal) => history.streamRawHistory(signal),
      clearHistory: async (): Promise<void> => {
        history.clear();
        await history.waitForOwnershipSettlement();
      },
      getHistoryService: () => history,
    };
    client['chat'] = mockChat as ChatSession;
    client['_previousHistory'] = storedHistory;
    await client.initialize({
      model: 'new-model',
      apiKey: 'test-key',
      vertexai: false,
    });
    return { liveHistory };
  } finally {
    history.dispose();
    rmSync(root, { recursive: true, force: true });
  }
}

async function verifyStoredHistoryOnToolsRefresh(): Promise<{
  restoredHistory: readonly IContent[];
  committedHistory: IContent[];
}> {
  const committedHistory: IContent[] = [
    {
      speaker: 'human',
      blocks: [{ type: 'text', text: 'We are fixing issue 2049.' }],
    },
    {
      speaker: 'ai',
      blocks: [
        { type: 'text', text: 'Profile switches must preserve context.' },
      ],
    },
  ];

  const pendingSend = Promise.withResolvers<void>();

  await client.storeHistoryForLaterUse(committedHistory);

  client['chat'] = undefined;

  const startChatSpy = vi
    .spyOn(client, 'startChat')
    .mockImplementation(async (extraHistory?: IContent[]) => {
      const restoredHistory = extraHistory ?? [];
      return {
        waitForIdle: async (): Promise<void> => {
          await pendingSend.promise.catch(() => undefined);
        },
        getHistory: vi.fn().mockReturnValue(restoredHistory),
        getHistoryService: vi.fn().mockReturnValue({
          clear: vi.fn(),
          findUnmatchedToolCalls: vi.fn().mockReturnValue([]),
          getCurated: vi.fn().mockReturnValue([]),
          getTotalTokens: vi.fn().mockReturnValue(0),
        }),
        getLastPromptTokenCount: vi.fn().mockReturnValue(0),
        getProjectedPromptBaseline: vi.fn().mockReturnValue(0),
        setTools: vi.fn(),
      } as unknown as ChatSession;
    });

  await client.setTools();

  expect(startChatSpy).toHaveBeenCalledWith(committedHistory);

  let historyState = 'pending';

  const historyRequest = AgentClient.prototype.getHistory
    .call(client)
    .then((history) => {
      historyState = 'settled';
      return history;
    });

  await Bun.sleep(0);

  const historyStateBeforeIdle = historyState;

  pendingSend.resolve();

  expect(historyStateBeforeIdle).toBe('pending');

  const restoredHistory = await historyRequest;
  return { restoredHistory, committedHistory };
}

function verifyModelChangedSequenceReset(): void {
  client['currentSequenceModel'] = 'sticky-model';

  coreEvents.emitModelChanged('other-model');
}

async function verifyContinuationModelChange(): Promise<{
  infos: ModelInfo[];
}> {
  // Stream 2: continuation succeeds
  const mockStream2 = (async function* () {
    yield { type: AgentEventType.Content, value: 'Continued' };
    yield { type: AgentEventType.Finished, value: { reason: 'STOP' } };
  })();

  getModelSpy.mockReturnValue('test-model');

  // Intercept between stream1 and stream2 to simulate a model change.
  // After the first Turn.run returns InvalidStream, change config.getModel
  // so the continuation's _buildModelInfo reads a different effective model.
  mockTurnRunFn.mockReset();

  let callCount = 0;

  mockTurnRunFn.mockImplementation(() => {
    callCount++;
    if (callCount === 1) {
      const stream = (async function* () {
        yield { type: AgentEventType.InvalidStream };
      })();
      // Simulate model change before continuation
      getModelSpy.mockReturnValue('changed-model');
      // Reset sequence model so orchestrator re-reads from config
      coreEvents.emitModelProfileChanged({
        model: 'changed-model',
        providerName: 'anthropic',
        profileName: null,
        displayLabel: 'changed-model',
      });
      return stream;
    }
    return mockStream2;
  });

  const stream = client.sendMessageStream(
    [{ type: 'text', text: 'Hi' }],
    new AbortController().signal,
    'prompt-change-mid-seq',
  );

  const infos = await collectModelInfos(stream);
  return { infos };
}

async function verifyContinuationStableModel(): Promise<{
  infos: ModelInfo[];
}> {
  const mockStream1 = (async function* () {
    yield { type: AgentEventType.InvalidStream };
  })();

  const mockStream2 = (async function* () {
    yield { type: AgentEventType.Content, value: 'Continued' };
    yield { type: AgentEventType.Finished, value: { reason: 'STOP' } };
  })();

  getModelSpy.mockReturnValue('test-model');

  mockTurnRunFn.mockReset();

  mockTurnRunFn.mockReturnValueOnce(mockStream1).mockReturnValue(mockStream2);

  const stream = client.sendMessageStream(
    [{ type: 'text', text: 'Hi' }],
    new AbortController().signal,
    'prompt-same-identity',
  );

  const infos = await collectModelInfos(stream);
  return { infos };
}

async function verifyContinuationStableProvider(): Promise<{
  infos: ModelInfo[];
}> {
  const mockStream2 = (async function* () {
    yield { type: AgentEventType.Content, value: 'ok' };
    yield { type: AgentEventType.Finished, value: { reason: 'STOP' } };
  })();

  getModelSpy.mockReturnValue('test-model');

  // The orchestrator's _getProviderName reads from
  // getContentGeneratorConfig().providerManager?.getActiveProviderName().
  // We spy on getContentGeneratorConfig to return different provider info
  // after the first stream.
  const getContentGenSpy = vi.spyOn(
    client['config'],
    'getContentGeneratorConfig',
  );

  getContentGenSpy.mockReturnValue({
    model: 'test-model',
    apiKey: 'test-key',
    vertexai: false,
  });

  mockTurnRunFn.mockReset();

  let callCount = 0;

  mockTurnRunFn.mockImplementation(() => {
    callCount++;
    if (callCount === 1) {
      const stream = (async function* () {
        yield { type: AgentEventType.InvalidStream };
      })();
      // Simulate provider change before continuation: now the config
      // returns a providerManager with a different active provider.
      getContentGenSpy.mockReturnValue({
        model: 'test-model',
        apiKey: 'test-key',
        vertexai: false,
        providerManager: {
          getActiveProviderName: () => 'anthropic',
          getActiveProvider: () => ({
            name: 'anthropic',
            getDefaultModel: () => 'test-model',
          }),
        },
      } as unknown as ContentGeneratorConfig);
      // Reset sequence model so orchestrator re-reads
      coreEvents.emitModelProfileChanged({
        model: 'test-model',
        providerName: 'anthropic',
        profileName: null,
        displayLabel: 'test-model',
      });
      return stream;
    }
    return mockStream2;
  });

  const stream = client.sendMessageStream(
    [{ type: 'text', text: 'Hi' }],
    new AbortController().signal,
    'prompt-provider-change',
  );

  const infos = await collectModelInfos(stream);

  getContentGenSpy.mockRestore();
  return { infos };
}

function setupContinuationChat(): void {
  vi.spyOn(client['config'], 'getContinueOnFailedApiCall').mockReturnValue(
    true,
  );

  const mockChat: Partial<ChatSession> = {
    addHistory: vi.fn(),
    getHistory: vi.fn().mockReturnValue([]),
    getHistoryService: vi.fn().mockReturnValue({
      clear: vi.fn(),
      findUnmatchedToolCalls: vi.fn().mockReturnValue([]),
      getCurated: vi.fn().mockReturnValue([]),
      getTotalTokens: vi.fn().mockReturnValue(0),
    }),
    getLastPromptTokenCount: vi.fn().mockReturnValue(0),
    getProjectedPromptBaseline: vi.fn().mockReturnValue(0),
    getContextLimit: vi.fn().mockReturnValue(1000000),
  };
  client['chat'] = mockChat as ChatSession;
  getModelSpy = vi.spyOn(client['config'], 'getModel');
}

describe('AgentClient (client.ts)', () => {
  beforeEach(setupClientFixture);
  afterEach(disposeClientFixture);
  describe('ModelProfileChanged resets sequence model (issue #1770)', () => {
    it('resets currentSequenceModel when ModelProfileChanged fires', () => {
      verifyProfileSequenceReset();
      // currentSequenceModel should now be null
      expect(client.getCurrentSequenceModel()).toBeNull();
    });

    it('invalidates active chat state when ModelProfileChanged fires so profile context-limit is rebuilt', () => {
      const { historyService, contentGenerator } = verifyProfileInvalidation();
      expect(client.hasChatInitialized()).toBe(false);
      expect(client['contentGenerator']).toBe(contentGenerator);
      expect(client['_baseLlmClient']).toBeUndefined();
      expect(client['_pendingConfig']).toStrictEqual({
        model: 'test-model',
        apiKey: 'old-key',
        vertexai: false,
      });
      expect(client['_storedHistoryService']).toBe(historyService);
      expect(client.getHistoryService()).toBe(historyService);
      expect(client['_previousHistory']).toBeUndefined();
    });

    it('defers chat invalidation until active streams finish', async () => {
      const { executeSpy, historyService } = await verifyDeferredInvalidation();
      expect(executeSpy).toHaveBeenCalledOnce();
      expect(client.hasChatInitialized()).toBe(false);
      expect(client['_storedHistoryService']).toBe(historyService);
    });

    it('uses live chat history instead of a stale stored snapshot when reinitializing', async () => {
      const { liveHistory } = await verifyLiveHistory();
      const stored = client.getHistoryService();
      if (stored === null) throw new Error('Missing reinitialized history');
      expect(await readConfigHistory(stored.streamRawHistory())).toStrictEqual(
        liveHistory,
      );
      expect(client['_previousHistory']).toBeUndefined();
    });

    it('preserves stored conversation history when refreshing tools before the next turn', async () => {
      const { restoredHistory, committedHistory } =
        await verifyStoredHistoryOnToolsRefresh();
      expect(restoredHistory).toStrictEqual(committedHistory);
    });
    it('also resets currentSequenceModel on ModelChanged', () => {
      verifyModelChangedSequenceReset();
      expect(client.getCurrentSequenceModel()).toBeNull();
    });
  });

  describe('ModelInfo during InvalidStream continuation when model changes mid-sequence (issue #1770)', () => {
    beforeEach(setupContinuationChat);

    afterEach(() => {
      getModelSpy.mockRestore();
    });

    it('emits exactly one additional ModelInfo when model changes during InvalidStream continuation', async () => {
      const { infos } = await verifyContinuationModelChange();
      // First emission for the initial model, then exactly one additional
      // ModelInfo for the changed identity — no duplicates.
      expect(infos).toHaveLength(2);
      expect(infos[0]?.model).toBe('test-model');
      expect(infos[1]?.model).toBe('changed-model');
    });

    it('does not emit additional ModelInfo when identity is unchanged during continuation', async () => {
      const { infos } = await verifyContinuationStableModel();
      // Same model/provider/profile across continuation → only one ModelInfo
      expect(infos).toHaveLength(1);
      expect(infos[0]?.model).toBe('test-model');
    });

    it('keeps the routed provider stable during continuation', async () => {
      const { infos } = await verifyContinuationStableProvider();
      expect(infos).toHaveLength(1);
      expect(infos[0]?.providerName).toBe('gemini');
    });
  });
});
