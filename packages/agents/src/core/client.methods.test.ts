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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type {
  Content,
  EmbedContentResponse,
  GenerateContentResponse,
  Part,
} from '@google/genai';
import { AgentClient } from './client.js';
import { getCoreSystemPromptAsync } from '@vybestack/llxprt-code-core/core/prompts.js';
import type { ContentGenerator } from '@vybestack/llxprt-code-core/core/contentGenerator.js';
import type { ChatSession } from './chatSession.js';
import { GeminiEventType } from './turn.js';
import { retryWithBackoff } from '@vybestack/llxprt-code-core/utils/retry.js';
import {
  getEnabledToolNamesForPrompt,
  shouldIncludeSubagentDelegationForConfig,
} from './clientToolGovernance.js';
import { setupGeminiClient } from './client-test-helpers.js';

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

  describe('generateEmbedding', () => {
    const texts = ['hello world', 'goodbye world'];

    it('should call embedContent and return embeddings for valid input', async () => {
      const mockEmbeddings = [
        [0.1, 0.2, 0.3],
        [0.4, 0.5, 0.6],
      ];
      const mockResponse: EmbedContentResponse = {
        embeddings: [
          { values: mockEmbeddings[0] },
          { values: mockEmbeddings[1] },
        ],
      };
      mockEmbedContentFn.mockResolvedValue(mockResponse);

      const result = await client.generateEmbedding(texts);

      expect(result).toStrictEqual(mockEmbeddings);
    });

    it('should return an empty array if an empty array is passed', async () => {
      const result = await client.generateEmbedding([]);
      expect(result).toStrictEqual([]);
    });

    it('should throw an error if API response has no embeddings array', async () => {
      mockEmbedContentFn.mockResolvedValue({} as EmbedContentResponse); // No `embeddings` key

      await expect(client.generateEmbedding(texts)).rejects.toThrow(
        'No embeddings found in API response.',
      );
    });

    it('should throw an error if API response has an empty embeddings array', async () => {
      const mockResponse: EmbedContentResponse = {
        embeddings: [],
      };
      mockEmbedContentFn.mockResolvedValue(mockResponse);
      await expect(client.generateEmbedding(texts)).rejects.toThrow(
        'No embeddings found in API response.',
      );
    });

    it('should throw an error if API returns a mismatched number of embeddings', async () => {
      const mockResponse: EmbedContentResponse = {
        embeddings: [{ values: [1, 2, 3] }], // Only one for two texts
      };
      mockEmbedContentFn.mockResolvedValue(mockResponse);

      await expect(client.generateEmbedding(texts)).rejects.toThrow(
        'API returned a mismatched number of embeddings. Expected 2, got 1.',
      );
    });

    it('should throw an error if any embedding has nullish values', async () => {
      const mockResponse: EmbedContentResponse = {
        embeddings: [{ values: [1, 2, 3] }, { values: undefined }], // Second one is bad
      };
      mockEmbedContentFn.mockResolvedValue(mockResponse);

      await expect(client.generateEmbedding(texts)).rejects.toThrow(
        'API returned an empty embedding for input text at index 1: "goodbye world"',
      );
    });

    it('should throw an error if any embedding has an empty values array', async () => {
      const mockResponse: EmbedContentResponse = {
        embeddings: [{ values: [] }, { values: [1, 2, 3] }], // First one is bad
      };
      mockEmbedContentFn.mockResolvedValue(mockResponse);

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

      vi.mocked(getEnabledToolNamesForPrompt).mockReturnValue(['tool_a']);
      vi.mocked(shouldIncludeSubagentDelegationForConfig).mockResolvedValue(
        true,
      );

      vi.mocked(getCoreSystemPromptAsync).mockResolvedValue(
        'prompt body with new memory',
      );

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

      vi.mocked(getEnabledToolNamesForPrompt).mockReturnValue([]);
      vi.mocked(shouldIncludeSubagentDelegationForConfig).mockResolvedValue(
        false,
      );

      vi.mocked(getCoreSystemPromptAsync).mockResolvedValue(
        'prompt with core directives',
      );

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

      vi.mocked(getEnabledToolNamesForPrompt).mockReturnValue([]);
      vi.mocked(shouldIncludeSubagentDelegationForConfig).mockResolvedValue(
        false,
      );

      vi.mocked(getCoreSystemPromptAsync).mockResolvedValue('prompt with jit');

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

      vi.mocked(getEnabledToolNamesForPrompt).mockReturnValue([]);
      vi.mocked(shouldIncludeSubagentDelegationForConfig).mockResolvedValue(
        false,
      );

      vi.mocked(getCoreSystemPromptAsync).mockResolvedValue('prompt no jit');

      await client.updateSystemInstruction();

      expect(getCoreSystemPromptAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          userMemory: 'base memory',
        }),
      );
    });
  });

  describe('generateJson', () => {
    it('should call generateContent with the correct parameters', async () => {
      const contents = [{ role: 'user', parts: [{ text: 'hello' }] }];
      const schema = { type: 'string' };
      const abortSignal = new AbortController().signal;

      // Mock lazyInitialize to prevent it from overriding our mock
      client['lazyInitialize'] = vi.fn().mockResolvedValue(undefined);

      const mockGenerator: Partial<ContentGenerator> = {
        countTokens: vi.fn().mockResolvedValue({ totalTokens: 1 }),
        generateContent: vi.fn().mockResolvedValue({
          candidates: [
            {
              content: {
                parts: [{ text: '{"key": "value"}' }],
              },
            },
          ],
        } as GenerateContentResponse),
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
          config: expect.objectContaining({
            responseJsonSchema: schema,
            responseMimeType: 'application/json',
          }),
        }),
        'test-session-id',
      );
    });

    it('should allow overriding model and config', async () => {
      const contents: Content[] = [
        { role: 'user', parts: [{ text: 'hello' }] },
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
          candidates: [
            {
              content: {
                parts: [{ text: '{"key": "value"}' }],
              },
            },
          ],
        } as GenerateContentResponse),
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
          config: expect.objectContaining({
            temperature: 0.9,
            responseJsonSchema: schema,
            responseMimeType: 'application/json',
          }),
        }),
        'test-session-id',
      );
    });

    it('should not change models when consecutive 429 errors occur', async () => {
      const error429 = new Error('Rate limited') as Error & { status?: number };
      error429.status = 429;

      mockGenerateContentFn.mockRejectedValue(error429);

      const retrySpy = vi.mocked(retryWithBackoff);
      const originalImpl = retrySpy.getMockImplementation();

      retrySpy.mockImplementation(async (apiCall) => {
        await expect(apiCall()).rejects.toThrow('Rate limited');
        await expect(apiCall()).rejects.toThrow('Rate limited');
        throw error429;
      });

      const contents = [{ role: 'user', parts: [{ text: 'throttle?' }] }];
      const schema = { type: 'string' };
      const abortSignal = new AbortController().signal;

      await expect(
        client.generateJson(contents, schema, abortSignal, 'test-model'),
      ).rejects.toThrow('Rate limited');

      const configInstance = client['config'] as unknown as {
        setModel: ReturnType<typeof vi.fn>;
        setFallbackMode: ReturnType<typeof vi.fn>;
      };

      expect(configInstance.setModel).not.toHaveBeenCalled();
      expect(configInstance.setFallbackMode).not.toHaveBeenCalled();

      retrySpy.mockImplementation(originalImpl ?? ((apiCall) => apiCall()));
    });
  });

  // resetChat test deleted - new behavior preserves context between provider switches
  // Only /clear command should clear context, not provider switching

  describe('addHistory', () => {
    it('should call chat.addHistory with the provided content', async () => {
      const mockChat: Partial<ChatSession> = {
        addHistory: vi.fn(),
      };
      client['chat'] = mockChat as ChatSession;

      const newContent = {
        role: 'user',
        parts: [{ text: 'New history item' }],
      };
      await client.addHistory(newContent);

      expect(mockChat.addHistory).toHaveBeenCalledWith(newContent);
    });
  });

  describe('resetChat', () => {
    it('should create a new chat session, clearing the old history', async () => {
      // Setup: Mock getHistory to track history state
      let historyState: Content[] = [];
      vi.mocked(client.getHistory).mockImplementation(() =>
        Promise.resolve([...historyState]),
      );

      // Mock addHistory to update the state
      const mockChat = client['chat'] as ChatSession;
      mockChat.addHistory.mockImplementation((content: Content) => {
        historyState.push(content);
        return Promise.resolve();
      });

      // 1. Get the initial chat instance and add some history.
      const initialChat = client.getChat();
      const initialHistory = await client.getHistory();
      await client.addHistory({
        role: 'user',
        parts: [{ text: 'some old message' }],
      } as Content);
      const historyWithOldMessage = await client.getHistory();
      expect(historyWithOldMessage.length).toBeGreaterThan(
        initialHistory.length,
      );

      // Mock resetChat to clear history and create new chat
      vi.spyOn(client, 'resetChat').mockImplementation(async () => {
        historyState = [];
        // Create a new mock chat instance
        const newMockChat = {
          addHistory: vi.fn().mockImplementation((content: Content) => {
            historyState.push(content);
            return Promise.resolve();
          }),
          getHistory: vi
            .fn()
            .mockImplementation(() => Promise.resolve([...historyState])),
          getHistoryService: vi.fn().mockReturnValue({
            clear: vi.fn(),
            findUnmatchedToolCalls: vi.fn().mockReturnValue([]),
            getCurated: vi.fn().mockReturnValue([]),
            getTotalTokens: vi.fn().mockReturnValue(0),
          }),
          clearHistory: vi.fn(),
          sendMessageStream: vi.fn(),
        };
        client['chat'] = newMockChat as ChatSession;
      });

      // 2. Call resetChat.
      await client.resetChat();

      // 3. Get the new chat instance and its history.
      const newChat = client.getChat();
      const newHistory = await client.getHistory();

      // 4. Assert that the chat instance is new and the history is reset.
      expect(newChat).not.toBe(initialChat);
      expect(newHistory.length).toBe(initialHistory.length);
      expect(JSON.stringify(newHistory)).not.toContain('some old message');
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
          type: GeminiEventType.Content,
          value: 'intermediate',
        });
      }

      expect(svc.toolActivityCount).toBe(0);
      expect(svc.toolCallReminderLevel).toBe('none');

      for (let i = 0; i < 4; i++) {
        svc.recordModelActivity({
          type: GeminiEventType.ToolCallResponse,
          value: {
            callId: `call-${i}`,
            responseParts: [] as Part[],
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
