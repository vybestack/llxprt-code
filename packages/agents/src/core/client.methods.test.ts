/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * AgentClient method tests: generateEmbedding, updateSystemInstruction,
 * generateJson, addHistory, resetChat, recordModelActivity.
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
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { AgentClient } from './client.js';
import { getCoreSystemPromptAsync } from '@vybestack/llxprt-code-core/core/prompts.js';
import type { ContentGenerator } from '@vybestack/llxprt-code-core/core/contentGenerator.js';
import type { ChatSession } from './chatSession.js';
import { AgentEventType } from './turn.js';
import { retryWithBackoff } from '@vybestack/llxprt-code-core/utils/retry.js';
import {
  getEnabledToolNamesForPrompt,
  shouldIncludeSubagentDelegationForConfig,
} from './clientToolGovernance.js';
import {
  setupAgentClient,
  type MockResponseShape,
} from './client-test-helpers.js';

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

function prepareInstructionChat(tokenCount: number): {
  setSystemInstruction: ReturnType<typeof vi.fn>;
  estimateTokensForText: ReturnType<typeof vi.fn>;
  setBaseTokenOffset: ReturnType<typeof vi.fn>;
} {
  const setSystemInstruction = vi.fn();
  const estimateTokensForText = vi.fn().mockResolvedValue(tokenCount);
  const setBaseTokenOffset = vi.fn();
  const getHistoryService = vi.fn().mockReturnValue({
    estimateTokensForText,
    setBaseTokenOffset,
  });
  client['chat'] = {
    setSystemInstruction,
    getHistoryService,
  } as unknown as ChatSession;
  client['contentGenerator'] = {
    countTokens: vi.fn(),
  } as unknown as ContentGenerator;
  return { setSystemInstruction, estimateTokensForText, setBaseTokenOffset };
}

function prepareInstructionPrompt(
  tools: string[],
  includeSubagentDelegation: boolean,
  prompt: string,
): void {
  (
    getEnabledToolNamesForPrompt as Mock<typeof getEnabledToolNamesForPrompt>
  ).mockReturnValue(tools);
  (
    shouldIncludeSubagentDelegationForConfig as Mock<
      typeof shouldIncludeSubagentDelegationForConfig
    >
  ).mockResolvedValue(includeSubagentDelegation);
  (
    getCoreSystemPromptAsync as Mock<typeof getCoreSystemPromptAsync>
  ).mockResolvedValue(prompt);
}

function registerGenerateEmbeddingTests(): void {
  describe('generateEmbedding', () => {
    const texts = ['hello world', 'goodbye world'];

    it('should call embedContent and return embeddings for valid input', async () => {
      const mockEmbeddings = [
        [0.1, 0.2, 0.3],
        [0.4, 0.5, 0.6],
      ];
      mockEmbedContentFn.mockResolvedValue({ embeddings: mockEmbeddings });

      const result = await client.generateEmbedding(texts);

      expect(result).toStrictEqual(mockEmbeddings);
    });

    it('should return an empty array if an empty array is passed', async () => {
      const result = await client.generateEmbedding([]);
      expect(result).toStrictEqual([]);
    });

    it('should throw an error if API response has no embeddings array', async () => {
      mockEmbedContentFn.mockResolvedValue({ embeddings: [] });

      await expect(client.generateEmbedding(texts)).rejects.toThrow(
        'No embeddings found in API response.',
      );
    });

    it('should throw an error if API response has an empty embeddings array', async () => {
      mockEmbedContentFn.mockResolvedValue({ embeddings: [] });
      await expect(client.generateEmbedding(texts)).rejects.toThrow(
        'No embeddings found in API response.',
      );
    });

    it('should throw an error if API returns a mismatched number of embeddings', async () => {
      mockEmbedContentFn.mockResolvedValue({
        embeddings: [[1, 2, 3]], // Only one for two texts
      });

      await expect(client.generateEmbedding(texts)).rejects.toThrow(
        'API returned a mismatched number of embeddings. Expected 2, got 1.',
      );
    });

    it('should throw an error if any embedding has nullish values', async () => {
      mockEmbedContentFn.mockResolvedValue({
        embeddings: [[1, 2, 3], []], // Second one is empty
      });

      await expect(client.generateEmbedding(texts)).rejects.toThrow(
        'API returned an empty embedding for input text at index 1: "goodbye world"',
      );
    });

    it('should throw an error if any embedding has an empty values array', async () => {
      mockEmbedContentFn.mockResolvedValue({
        embeddings: [[], [1, 2, 3]], // First one is empty
      });

      await expect(client.generateEmbedding(texts)).rejects.toThrow(
        'API returned an empty embedding for input text at index 0: "hello world"',
      );
    });

    it('should propagate errors from the API call', async () => {
      const apiError = new Error('API Failure');
      mockEmbedContentFn.mockRejectedValue(apiError);

      await expect(client.generateEmbedding(texts)).rejects.toThrow(
        'API Failure',
      );
    });
  });
}

async function prepareUpdateInstruction1(): Promise<
  ReturnType<typeof prepareInstructionChat>
> {
  const { setSystemInstruction, estimateTokensForText, setBaseTokenOffset } =
    prepareInstructionChat(321);
  const config = client['config'];
  vi.spyOn(config, 'getUserMemory').mockReturnValue('new memory');
  prepareInstructionPrompt(['tool_a'], true, 'prompt body with new memory');
  await client.updateSystemInstruction();
  return { setSystemInstruction, estimateTokensForText, setBaseTokenOffset };
}

async function prepareUpdateInstruction2(): Promise<void> {
  prepareInstructionChat(100);
  const config = client['config'];
  vi.spyOn(config, 'getUserMemory').mockReturnValue('');
  vi.spyOn(config, 'getCoreMemory').mockReturnValue('Always respond in JSON');
  prepareInstructionPrompt([], false, 'prompt with core directives');
  await client.updateSystemInstruction();
}

function prepareJitInstruction(
  jitMemory: string,
  prompt: string,
): (typeof client)['config'] {
  prepareInstructionChat(100);
  const config = client['config'];
  vi.spyOn(config, 'getUserMemory').mockReturnValue('base memory');
  vi.spyOn(config, 'getCoreMemory').mockReturnValue('');
  vi.spyOn(config, 'getJitMemoryForPath').mockResolvedValue(jitMemory);
  vi.spyOn(config, 'getWorkingDir').mockReturnValue('/test/dir');
  prepareInstructionPrompt([], false, prompt);
  return config;
}

async function prepareUpdateInstruction3(): Promise<(typeof client)['config']> {
  const config = prepareJitInstruction(
    `--- JIT Context from: sub/LLXPRT.md ---
sub memory
--- End of JIT Context from: sub/LLXPRT.md ---`,
    'prompt with jit',
  );
  await client.updateSystemInstruction();
  return config;
}

async function prepareUpdateInstruction4(): Promise<void> {
  prepareJitInstruction('', 'prompt no jit');
  await client.updateSystemInstruction();
}

async function prepareUpdateInstruction5(): Promise<{
  estimateTokensForText: ReturnType<typeof vi.fn>;
}> {
  const { estimateTokensForText } = prepareInstructionChat(100);
  // runtimeState.model is 'test-model' (from setup), but the live config
  // returns a different model after a profile or provider switch.
  const config = client['config'];
  vi.spyOn(config, 'getUserMemory').mockReturnValue('memory');
  vi.spyOn(config, 'getModel').mockReturnValue('glm-5.2');
  prepareInstructionPrompt([], false, 'prompt with live model');
  await client.updateSystemInstruction();
  return { estimateTokensForText };
}

async function prepareUpdateInstruction6(): Promise<void> {
  prepareInstructionChat(0);
  const config = client['config'];
  vi.spyOn(config, 'getModel').mockReturnValue('');
}

async function prepareGenerateJson(
  model: string,
  customConfig?: { temperature: number; topK: number },
): Promise<{
  result: unknown;
  mockGenerator: Partial<ContentGenerator>;
  schema: { type: string };
}> {
  const contents: IContent[] = [
    { speaker: 'human', blocks: [{ type: 'text', text: 'hello' }] },
  ];
  const schema = { type: 'string' };
  const abortSignal = new AbortController().signal;
  // Mock lazyInitialize to prevent it from overriding our mock
  client['lazyInitialize'] = vi.fn().mockResolvedValue(undefined);
  const mockGenerator: Partial<ContentGenerator> = {
    countTokens: vi.fn().mockResolvedValue({ totalTokens: 1 }),
    generateContent: vi.fn().mockResolvedValue({
      content: {
        speaker: 'ai',
        blocks: [{ type: 'text', text: '{"key": "value"}' }],
      },
    }),
    ...(customConfig
      ? {}
      : { generateContentStream: vi.fn(), embedContent: vi.fn() }),
  };
  client['contentGenerator'] = mockGenerator as ContentGenerator;
  const result = customConfig
    ? await client.generateJson(
        contents,
        schema,
        abortSignal,
        model,
        customConfig,
      )
    : await client.generateJson(contents, schema, abortSignal, model);
  return { result, mockGenerator, schema };
}

async function observeNotChangeModelsWhenConsecutive429ErrorsOccur(): Promise<{
  generatedErrorMessage: string;
  configInstance: {
    setModel: ReturnType<typeof vi.fn>;
    setFallbackMode: ReturnType<typeof vi.fn>;
  };
  retryErrorMessages: string[];
}> {
  const error429 = new Error('Rate limited') as Error & { status?: number };
  error429.status = 429;
  mockGenerateContentFn.mockRejectedValue(error429);
  const retrySpy = retryWithBackoff as Mock<typeof retryWithBackoff>;
  const originalImpl = retrySpy.getMockImplementation();
  const retryErrors: unknown[] = [];
  retrySpy.mockImplementation(async (apiCall) => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await apiCall();
      } catch (error: unknown) {
        retryErrors.push(error);
      }
    }
    throw error429;
  });
  const contents: IContent[] = [
    { speaker: 'human', blocks: [{ type: 'text', text: 'throttle?' }] },
  ];
  const schema = { type: 'string' };
  const abortSignal = new AbortController().signal;
  const configInstance = client['config'] as unknown as {
    setModel: ReturnType<typeof vi.fn>;
    setFallbackMode: ReturnType<typeof vi.fn>;
  };
  let generatedError: unknown;
  try {
    await client.generateJson(contents, schema, abortSignal, 'test-model');
  } catch (error: unknown) {
    generatedError = error;
  } finally {
    retrySpy.mockImplementation(originalImpl ?? ((apiCall) => apiCall()));
  }

  const generatedErrorMessage =
    generatedError instanceof Error
      ? generatedError.message
      : String(generatedError);
  const retryErrorMessages = retryErrors.map((error) =>
    error instanceof Error ? error.message : String(error),
  );
  return { generatedErrorMessage, configInstance, retryErrorMessages };
}

function registerAddHistoryTests(): void {
  describe('addHistory', () => {
    it('admits the provided content into the active chat', async () => {
      let admittedHistory: IContent[] = [];
      const mockChat: Partial<ChatSession> = {
        admitAndAddHistory: async (content) => {
          admittedHistory = [...admittedHistory, content];
        },
      };
      client['chat'] = mockChat as ChatSession;
      const newContent: IContent = {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'New history item' }],
      };
      await client.addHistory(newContent);
      expect(admittedHistory).toStrictEqual([newContent]);
    });
  });
}

function registerResetChatTests(): void {
  describe('resetChat', () => {
    it('clears history and keeps the active chat instance', async () => {
      let historyState: IContent[] = [];
      (client.getHistory as Mock<typeof client.getHistory>).mockImplementation(
        async function* () {
          yield* historyState;
        },
      );
      const activeChat = client.getChat();
      activeChat.admitAndAddHistory = async (content: IContent) => {
        historyState = [...historyState, content];
      };
      const clearHistory = async (): Promise<void> => {
        historyState = [];
      };
      activeChat.clearHistory = clearHistory;
      activeChat.getLastPromptTokenCount = () => 0;
      const oldContent: IContent = {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'some old message' }],
      };
      await client.addHistory(oldContent);
      expect(await Array.fromAsync(client.getHistory())).toStrictEqual([
        oldContent,
      ]);

      await client.resetChat();

      expect(client.getChat().clearHistory).toBe(clearHistory);
      expect(await Array.fromAsync(client.getHistory())).toStrictEqual([]);
    });
  });
}

function registerRecordModelActivityTests(): void {
  describe('recordModelActivity', () => {
    it('only counts completed tool call responses toward reminders', () => {
      const svc = (
        client as unknown as {
          todoContinuationService: {
            todoToolsAvailable: boolean;
            toolActivityCount: number;
            toolCallReminderLevel: string;
            recordModelActivity: (event: unknown) => void;
          };
        }
      ).todoContinuationService;

      svc.todoToolsAvailable = true;

      for (let i = 0; i < 5; i++) {
        svc.recordModelActivity({
          type: AgentEventType.Content,
          value: 'intermediate',
        });
      }

      expect(svc.toolActivityCount).toBe(0);
      expect(svc.toolCallReminderLevel).toBe('none');

      for (let i = 0; i < 4; i++) {
        svc.recordModelActivity({
          type: AgentEventType.ToolCallResponse,
          value: {
            callId: `call-${i}`,
            responseParts: [] as ContentBlock[],
            resultDisplay: undefined,
            error: undefined,
            errorType: undefined,
          },
        });
      }

      expect(svc.toolCallReminderLevel).toBe('base');
    });
  });
}

function expectJsonCall(
  mockGenerator: Partial<ContentGenerator>,
  model: string,
  settings: { responseJsonSchema: { type: string }; temperature?: number },
): void {
  expect(mockGenerator.generateContent).toHaveBeenCalledWith(
    expect.objectContaining({
      model,
      settings: expect.objectContaining(settings),
      modelParams: expect.objectContaining({
        responseMimeType: 'application/json',
      }),
    }),
    'test-session-id',
  );
}

function registerGenerateJsonTests(): void {
  describe('generateJson', () => {
    it('should call generateContent with the correct parameters', async () => {
      const { result, mockGenerator, schema } =
        await prepareGenerateJson('test-model');
      expect(result).toStrictEqual({ key: 'value' });

      // Verify generateContent was called (now via BaseLLMClient)
      expectJsonCall(mockGenerator, 'test-model', {
        responseJsonSchema: schema,
      });
    });
    it('should allow overriding model and config', async () => {
      const customModel = 'custom-json-model';
      const { result, mockGenerator, schema } = await prepareGenerateJson(
        customModel,
        { temperature: 0.9, topK: 20 },
      );
      expect(result).toStrictEqual({ key: 'value' });

      // Verify generateContent was called with custom config (now via BaseLLMClient)
      expectJsonCall(mockGenerator, customModel, {
        temperature: 0.9,
        responseJsonSchema: schema,
      });
    });
    it('should not change models when consecutive 429 errors occur', async () => {
      const { generatedErrorMessage, configInstance, retryErrorMessages } =
        await observeNotChangeModelsWhenConsecutive429ErrorsOccur();
      expect(generatedErrorMessage).toContain('Rate limited');
      expect(retryErrorMessages[0]).toContain('Rate limited');
      expect(retryErrorMessages[1]).toContain('Rate limited');
      expect(configInstance.setModel).not.toHaveBeenCalled();
      expect(configInstance.setFallbackMode).not.toHaveBeenCalled();
    });
  });
}

function registerUpdateSystemInstructionTests(): void {
  describe('updateSystemInstruction', () => {
    it('updates chat system instruction and history token offset', async () => {
      const {
        setSystemInstruction,
        estimateTokensForText,
        setBaseTokenOffset,
      } = await prepareUpdateInstruction1();
      expect(getEnabledToolNamesForPrompt).toHaveBeenCalled();
      expect(shouldIncludeSubagentDelegationForConfig).toHaveBeenCalledWith(
        expect.anything(),
        ['tool_a'],
      );
      expect(getCoreSystemPromptAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          userMemory: 'new memory',
          model: 'test-model',
          tools: ['tool_a'],
          includeSubagentDelegation: true,
        }),
      );
      expect(setSystemInstruction).toHaveBeenCalledWith(
        expect.stringContaining('prompt body with new memory'),
      );
      expect(estimateTokensForText).toHaveBeenCalledWith(
        expect.any(String),
        'test-model',
      );
      expect(setBaseTokenOffset).toHaveBeenCalledWith(321);
    });
    it('passes non-empty coreMemory to getCoreSystemPromptAsync', async () => {
      await prepareUpdateInstruction2();
      expect(getCoreSystemPromptAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          coreMemory: 'Always respond in JSON',
        }),
      );
    });
    it('appends JIT subdirectory memory to userMemory', async () => {
      const config = await prepareUpdateInstruction3();
      expect(config.getJitMemoryForPath).toHaveBeenCalledWith('/test/dir');
      expect(getCoreSystemPromptAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          userMemory: expect.stringContaining('base memory'),
        }),
      );
      expect(getCoreSystemPromptAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          userMemory: expect.stringContaining('sub memory'),
        }),
      );
    });
    it('does not modify userMemory when JIT returns empty', async () => {
      await prepareUpdateInstruction4();
      expect(getCoreSystemPromptAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          userMemory: 'base memory',
        }),
      );
    });
    it('uses config.getModel() for the system prompt, not the stale runtimeState snapshot (issue #3138)', async () => {
      const { estimateTokensForText } = await prepareUpdateInstruction5();
      expect(getCoreSystemPromptAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'glm-5.2',
        }),
      );
      expect(estimateTokensForText).toHaveBeenCalledWith(
        expect.any(String),
        'glm-5.2',
      );
    });
    it('throws when config has no model rather than substituting a vendor default (issue #3138)', async () => {
      await prepareUpdateInstruction6();
      await expect(client.updateSystemInstruction()).rejects.toThrow(
        /no model identity/i,
      );
    });
  });
}

describe('AgentClient (client.ts)', () => {
  afterAll(() => {
    void vi.mock('./clientToolGovernance.js', () => realClientToolGovernance);
    void vi.mock(
      '@vybestack/llxprt-code-core/utils/retry.js',
      () => realRetryModule,
    );
    void vi.mock('./turn', () => __actual);
    void vi.mock(
      '@vybestack/llxprt-code-core/core/tokenLimits.js',
      () => actual4,
    );
    void vi.mock(
      '@vybestack/llxprt-code-core/config/config.js',
      () => realConfigModule,
    );
    void vi.mock('@vybestack/llxprt-code-tools', () => actual);
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

    // Inject a mock content generator so embedding validation runs in BaseLLMClient
    const mockContentGenerator = {
      embedContent: vi
        .fn()
        .mockImplementation((opts: { texts: string[] }) =>
          mockEmbedContentFn(opts),
        ),
      generateContentStream: vi.fn(),
      generateContent: vi.fn(),
    };
    (client as unknown as { contentGenerator: unknown }).contentGenerator =
      mockContentGenerator;
  });

  afterEach(async () => {
    await client.dispose();
    vi.restoreAllMocks();
  });

  registerGenerateEmbeddingTests();
  registerUpdateSystemInstructionTests();
  registerGenerateJsonTests();

  // resetChat test deleted - new behavior preserves context between provider switches
  // Only /clear command should clear context, not provider switching

  registerAddHistoryTests();
  registerResetChatTests();
  registerRecordModelActivityTests();
});
