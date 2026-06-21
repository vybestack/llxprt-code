/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * AgentClient model profile and ModelInfo tests (issue #1770).
 * Sibling to client.test.ts (split to avoid file-level max-lines disable).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Content } from '@google/genai';
import { AgentClient } from './client.js';
import type { ContentGenerator } from '@vybestack/llxprt-code-core/core/contentGenerator.js';
import type { ChatSession } from './chatSession.js';
import {
  GeminiEventType,
  type ServerGeminiStreamEvent,
  type ModelInfo,
} from './turn.js';
import { coreEvents } from '@vybestack/llxprt-code-core/utils/events.js';
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

describe('Gemini Client (client.ts)', () => {
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

  describe('ModelProfileChanged resets sequence model (issue #1770)', () => {
    it('resets currentSequenceModel when ModelProfileChanged fires', () => {
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

      // currentSequenceModel should now be null
      expect(client.getCurrentSequenceModel()).toBeNull();
    });

    it('invalidates active chat state when ModelProfileChanged fires so profile context-limit is rebuilt', () => {
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
          yield { type: GeminiEventType.Content, value: 'done' };
          return {} as Turn;
        });

      await fromAsync(
        client.sendMessageStream(
          'hello',
          new AbortController().signal,
          'prompt',
        ),
      );

      expect(executeSpy).toHaveBeenCalledOnce();
      expect(client.hasChatInitialized()).toBe(false);
      expect(client['_storedHistoryService']).toBe(historyService);
    });

    it('uses live chat history instead of a stale stored snapshot when reinitializing', async () => {
      const storedHistory: Content[] = [
        { role: 'user', parts: [{ text: 'old turn' }] },
      ];
      const liveHistory: Content[] = [
        ...storedHistory,
        { role: 'model', parts: [{ text: 'new committed turn' }] },
      ];
      const mockChat: Partial<ChatSession> = {
        getHistory: vi.fn().mockReturnValue(liveHistory),
      };
      client['chat'] = mockChat as ChatSession;
      client['_previousHistory'] = storedHistory;

      await client.initialize({
        model: 'new-model',
        apiKey: 'test-key',
        vertexai: false,
      });

      expect(client['_previousHistory']).toBe(liveHistory);
    });

    it('preserves stored conversation history when refreshing tools before the next turn', async () => {
      const committedHistory: Content[] = [
        { role: 'user', parts: [{ text: 'We are fixing issue 2049.' }] },
        {
          role: 'model',
          parts: [{ text: 'Profile switches must preserve context.' }],
        },
      ];
      client.storeHistoryForLaterUse(committedHistory);
      client['chat'] = undefined;
      const startChatSpy = vi
        .spyOn(client, 'startChat')
        .mockImplementation(async (extraHistory?: Content[]) => {
          const restoredHistory = extraHistory ?? [];
          return {
            getHistory: vi.fn().mockReturnValue(restoredHistory),
            getHistoryService: vi.fn().mockReturnValue({
              clear: vi.fn(),
              findUnmatchedToolCalls: vi.fn().mockReturnValue([]),
              getCurated: vi.fn().mockReturnValue([]),
              getTotalTokens: vi.fn().mockReturnValue(0),
            }),
            getLastPromptTokenCount: vi.fn().mockReturnValue(0),
            setTools: vi.fn(),
          } as unknown as ChatSession;
        });

      await client.setTools();

      expect(startChatSpy).toHaveBeenCalledWith(committedHistory);
      const restoredHistory =
        await AgentClient.prototype.getHistory.call(client);
      expect(restoredHistory).toStrictEqual(committedHistory);
    });
    it('also resets currentSequenceModel on ModelChanged', () => {
      client['currentSequenceModel'] = 'sticky-model';
      coreEvents.emitModelChanged('other-model');
      expect(client.getCurrentSequenceModel()).toBeNull();
    });
  });

  describe('ModelInfo during InvalidStream continuation when model changes mid-sequence (issue #1770)', () => {
    let getModelSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
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
      };
      client['chat'] = mockChat as ChatSession;
      getModelSpy = vi.spyOn(client['config'], 'getModel');
    });

    afterEach(() => {
      getModelSpy.mockRestore();
    });

    /**
     * Helper: collect only ModelInfo events from a stream.
     */
    async function collectModelInfos(
      stream: AsyncIterable<ServerGeminiStreamEvent>,
    ): Promise<ModelInfo[]> {
      const events = await fromAsync(stream);
      return events
        .filter(
          (
            e,
          ): e is ServerGeminiStreamEvent & {
            type: typeof GeminiEventType.ModelInfo;
            value: ModelInfo;
          } => e.type === GeminiEventType.ModelInfo,
        )
        .map((e) => e.value);
    }

    it('emits exactly one additional ModelInfo when model changes during InvalidStream continuation', async () => {
      // Stream 2: continuation succeeds
      const mockStream2 = (async function* () {
        yield { type: GeminiEventType.Content, value: 'Continued' };
        yield { type: GeminiEventType.Finished, value: { reason: 'STOP' } };
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
            yield { type: GeminiEventType.InvalidStream };
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
        [{ text: 'Hi' }],
        new AbortController().signal,
        'prompt-change-mid-seq',
      );

      const infos = await collectModelInfos(stream);

      // First emission for the initial model, then exactly one additional
      // ModelInfo for the changed identity — no duplicates.
      expect(infos).toHaveLength(2);
      expect(infos[0]?.model).toBe('test-model');
      expect(infos[1]?.model).toBe('changed-model');
    });

    it('does not emit additional ModelInfo when identity is unchanged during continuation', async () => {
      const mockStream1 = (async function* () {
        yield { type: GeminiEventType.InvalidStream };
      })();
      const mockStream2 = (async function* () {
        yield { type: GeminiEventType.Content, value: 'Continued' };
        yield { type: GeminiEventType.Finished, value: { reason: 'STOP' } };
      })();

      getModelSpy.mockReturnValue('test-model');
      mockTurnRunFn.mockReset();
      mockTurnRunFn
        .mockReturnValueOnce(mockStream1)
        .mockReturnValue(mockStream2);

      const stream = client.sendMessageStream(
        [{ text: 'Hi' }],
        new AbortController().signal,
        'prompt-same-identity',
      );

      const infos = await collectModelInfos(stream);

      // Same model/provider/profile across continuation → only one ModelInfo
      expect(infos).toHaveLength(1);
      expect(infos[0]?.model).toBe('test-model');
    });

    it('emits exactly one additional ModelInfo when provider changes during continuation', async () => {
      const mockStream2 = (async function* () {
        yield { type: GeminiEventType.Content, value: 'ok' };
        yield { type: GeminiEventType.Finished, value: { reason: 'STOP' } };
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
            yield { type: GeminiEventType.InvalidStream };
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
        [{ text: 'Hi' }],
        new AbortController().signal,
        'prompt-provider-change',
      );

      const infos = await collectModelInfos(stream);

      getContentGenSpy.mockRestore();

      // First emission (provider 'backend' — no providerManager), then one
      // additional for provider change to 'anthropic' — exactly one, not
      // duplicates.
      expect(infos).toHaveLength(2);
      expect(infos[0]?.providerName).toBe('backend');
      expect(infos[1]?.providerName).toBe('anthropic');
    });
  });
});
