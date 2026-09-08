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

  describe('updateSystemInstruction', () => {
    it('updates chat system instruction and history token offset', async () => {
      const setSystemInstruction = vi.fn();
      const estimateTokensForText = vi.fn().mockResolvedValue(321);
      const setBaseTokenOffset = vi.fn();
      const getHistoryService = vi.fn().mockReturnValue({
        estimateTokensForText,
        setBaseTokenOffset,
      });

      const mockChat = {
        setSystemInstruction,
        getHistoryService,
      };

      client['chat'] = mockChat as unknown as ChatSession;
      client['contentGenerator'] = {
        countTokens: vi.fn(),
      } as unknown as ContentGenerator;

      const config = client['config'] as unknown as {
        getUserMemory: () => string;
      };
      vi.spyOn(config, 'getUserMemory').mockReturnValue('new memory');

      (
        getEnabledToolNamesForPrompt as Mock<
          typeof getEnabledToolNamesForPrompt
        >
      ).mockReturnValue(['tool_a']);
      (
        shouldIncludeSubagentDelegationForConfig as Mock<
          typeof shouldIncludeSubagentDelegationForConfig
        >
      ).mockResolvedValue(true);

      (
        getCoreSystemPromptAsync as Mock<typeof getCoreSystemPromptAsync>
      ).mockResolvedValue('prompt body with new memory');

      await client.updateSystemInstruction();

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
      const setSystemInstruction = vi.fn();
      const estimateTokensForText = vi.fn().mockResolvedValue(100);
      const setBaseTokenOffset = vi.fn();
      const getHistoryService = vi.fn().mockReturnValue({
        estimateTokensForText,
        setBaseTokenOffset,
      });

      const mockChat = {
        setSystemInstruction,
        getHistoryService,
      };

      client['chat'] = mockChat as unknown as ChatSession;
      client['contentGenerator'] = {
        countTokens: vi.fn(),
      } as unknown as ContentGenerator;

      const config = client['config'] as unknown as {
        getUserMemory: () => string;
        getCoreMemory: () => string;
      };
      vi.spyOn(config, 'getUserMemory').mockReturnValue('');
      vi.spyOn(config, 'getCoreMemory').mockReturnValue(
        'Always respond in JSON',
      );

      (
        getEnabledToolNamesForPrompt as Mock<
          typeof getEnabledToolNamesForPrompt
        >
      ).mockReturnValue([]);
      (
        shouldIncludeSubagentDelegationForConfig as Mock<
          typeof shouldIncludeSubagentDelegationForConfig
        >
      ).mockResolvedValue(false);

      (
        getCoreSystemPromptAsync as Mock<typeof getCoreSystemPromptAsync>
      ).mockResolvedValue('prompt with core directives');

      await client.updateSystemInstruction();

      expect(getCoreSystemPromptAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          coreMemory: 'Always respond in JSON',
        }),
      );
    });

    it('appends JIT subdirectory memory to userMemory', async () => {
      const setSystemInstruction = vi.fn();
      const estimateTokensForText = vi.fn().mockResolvedValue(100);
      const setBaseTokenOffset = vi.fn();
      const getHistoryService = vi.fn().mockReturnValue({
        estimateTokensForText,
        setBaseTokenOffset,
      });

      const mockChat = {
        setSystemInstruction,
        getHistoryService,
      };

      client['chat'] = mockChat as unknown as ChatSession;
      client['contentGenerator'] = {
        countTokens: vi.fn(),
      } as unknown as ContentGenerator;

      const config = client['config'] as unknown as {
        getUserMemory: () => string;
        getCoreMemory: () => string;
        getJitMemoryForPath: (path: string) => Promise<string>;
        getWorkingDir: () => string;
      };
      vi.spyOn(config, 'getUserMemory').mockReturnValue('base memory');
      vi.spyOn(config, 'getCoreMemory').mockReturnValue('');
      vi.spyOn(config, 'getJitMemoryForPath').mockResolvedValue(
        `--- JIT Context from: sub/LLXPRT.md ---
sub memory
--- End of JIT Context from: sub/LLXPRT.md ---`,
      );
      vi.spyOn(config, 'getWorkingDir').mockReturnValue('/test/dir');

      (
        getEnabledToolNamesForPrompt as Mock<
          typeof getEnabledToolNamesForPrompt
        >
      ).mockReturnValue([]);
      (
        shouldIncludeSubagentDelegationForConfig as Mock<
          typeof shouldIncludeSubagentDelegationForConfig
        >
      ).mockResolvedValue(false);

      (
        getCoreSystemPromptAsync as Mock<typeof getCoreSystemPromptAsync>
      ).mockResolvedValue('prompt with jit');

      await client.updateSystemInstruction();

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
      const setSystemInstruction = vi.fn();
      const estimateTokensForText = vi.fn().mockResolvedValue(100);
      const setBaseTokenOffset = vi.fn();
      const getHistoryService = vi.fn().mockReturnValue({
        estimateTokensForText,
        setBaseTokenOffset,
      });

      const mockChat = {
        setSystemInstruction,
        getHistoryService,
      };

      client['chat'] = mockChat as unknown as ChatSession;
      client['contentGenerator'] = {
        countTokens: vi.fn(),
      } as unknown as ContentGenerator;

      const config = client['config'] as unknown as {
        getUserMemory: () => string;
        getCoreMemory: () => string;
        getJitMemoryForPath: (path: string) => Promise<string>;
        getWorkingDir: () => string;
      };
      vi.spyOn(config, 'getUserMemory').mockReturnValue('base memory');
      vi.spyOn(config, 'getCoreMemory').mockReturnValue('');
      vi.spyOn(config, 'getJitMemoryForPath').mockResolvedValue('');
      vi.spyOn(config, 'getWorkingDir').mockReturnValue('/test/dir');

      (
        getEnabledToolNamesForPrompt as Mock<
          typeof getEnabledToolNamesForPrompt
        >
      ).mockReturnValue([]);
      (
        shouldIncludeSubagentDelegationForConfig as Mock<
          typeof shouldIncludeSubagentDelegationForConfig
        >
      ).mockResolvedValue(false);

      (
        getCoreSystemPromptAsync as Mock<typeof getCoreSystemPromptAsync>
      ).mockResolvedValue('prompt no jit');

      await client.updateSystemInstruction();

      expect(getCoreSystemPromptAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          userMemory: 'base memory',
        }),
      );
    });

    it('uses config.getModel() for the system prompt, not the stale runtimeState snapshot (issue #3138)', async () => {
      const setSystemInstruction = vi.fn();
      const estimateTokensForText = vi.fn().mockResolvedValue(100);
      const setBaseTokenOffset = vi.fn();
      const getHistoryService = vi.fn().mockReturnValue({
        estimateTokensForText,
        setBaseTokenOffset,
      });

      const mockChat = {
        setSystemInstruction,
        getHistoryService,
      };

      client['chat'] = mockChat as unknown as ChatSession;
      client['contentGenerator'] = {
        countTokens: vi.fn(),
      } as unknown as ContentGenerator;

      // runtimeState.model is 'test-model' (from setup), but the live config
      // returns a different model after a profile or provider switch.
      const config = client['config'] as unknown as {
        getModel: () => string;
        getUserMemory: () => string;
      };
      vi.spyOn(config, 'getUserMemory').mockReturnValue('memory');
      vi.spyOn(config, 'getModel').mockReturnValue('glm-5.2');

      (
        getEnabledToolNamesForPrompt as Mock<
          typeof getEnabledToolNamesForPrompt
        >
      ).mockReturnValue([]);
      (
        shouldIncludeSubagentDelegationForConfig as Mock<
          typeof shouldIncludeSubagentDelegationForConfig
        >
      ).mockResolvedValue(false);

      (
        getCoreSystemPromptAsync as Mock<typeof getCoreSystemPromptAsync>
      ).mockResolvedValue('prompt with live model');

      await client.updateSystemInstruction();

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
      const mockChat = {
        setSystemInstruction: vi.fn(),
        getHistoryService: vi.fn().mockReturnValue({
          estimateTokensForText: vi.fn().mockResolvedValue(0),
          setBaseTokenOffset: vi.fn(),
        }),
      };

      client['chat'] = mockChat as unknown as ChatSession;
      client['contentGenerator'] = {
        countTokens: vi.fn(),
      } as unknown as ContentGenerator;

      const config = client['config'] as unknown as {
        getModel: () => string;
      };
      vi.spyOn(config, 'getModel').mockReturnValue('');

      await expect(client.updateSystemInstruction()).rejects.toThrow(
        /no model identity/i,
      );
    });
  });

  describe('generateJson', () => {
    it('should call generateContent with the correct parameters', async () => {
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
        generateContentStream: vi.fn(),
        embedContent: vi.fn(),
      };
      client['contentGenerator'] = mockGenerator as ContentGenerator;

      const result = await client.generateJson(
        contents,
        schema,
        abortSignal,
        'test-model',
      );

      // Check that generateJson returns the correct result
      expect(result).toStrictEqual({ key: 'value' });

      // Verify generateContent was called (now via BaseLLMClient)
      expect(mockGenerator.generateContent).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'test-model',
          settings: expect.objectContaining({
            responseJsonSchema: schema,
          }),
          modelParams: expect.objectContaining({
            responseMimeType: 'application/json',
          }),
        }),
        'test-session-id',
      );
    });

    it('should allow overriding model and config', async () => {
      const contents: IContent[] = [
        { speaker: 'human', blocks: [{ type: 'text', text: 'hello' }] },
      ];
      const schema = { type: 'string' };
      const abortSignal = new AbortController().signal;
      const customModel = 'custom-json-model';
      const customConfig = { temperature: 0.9, topK: 20 };

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
      };
      client['contentGenerator'] = mockGenerator as ContentGenerator;

      const result = await client.generateJson(
        contents,
        schema,
        abortSignal,
        customModel,
        customConfig,
      );

      // Check that generateJson returns the correct result
      expect(result).toStrictEqual({ key: 'value' });

      // Verify generateContent was called with custom config (now via BaseLLMClient)
      expect(mockGenerator.generateContent).toHaveBeenCalledWith(
        expect.objectContaining({
          model: customModel,
          settings: expect.objectContaining({
            temperature: 0.9,
            responseJsonSchema: schema,
          }),
          modelParams: expect.objectContaining({
            responseMimeType: 'application/json',
          }),
        }),
        'test-session-id',
      );
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

    const observeNotChangeModelsWhenConsecutive429ErrorsOccur = async () => {
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
    };
  });

  // resetChat test deleted - new behavior preserves context between provider switches
  // Only /clear command should clear context, not provider switching

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

  describe('resetChat', () => {
    it('clears history and keeps the active chat instance', async () => {
      let historyState: IContent[] = [];
      (client.getHistory as Mock<typeof client.getHistory>).mockImplementation(
        () => Promise.resolve([...historyState]),
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
      expect(await client.getHistory()).toStrictEqual([oldContent]);

      await client.resetChat();

      expect(client.getChat().clearHistory).toBe(clearHistory);
      expect(await client.getHistory()).toStrictEqual([]);
    });
  });

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
});
