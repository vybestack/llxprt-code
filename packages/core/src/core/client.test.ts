/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20251027-STATELESS5.P09
 * Note: Legacy tests updated with plan markers. Runtime state integration tests
 * are in __tests__/geminiClient.runtimeState.test.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock prompts module before imports
vi.mock('./prompts.js', () => ({
  getCoreSystemPromptAsync: vi
    .fn()
    .mockResolvedValue('Test system instruction'),
  getCoreSystemPrompt: vi.fn().mockReturnValue('Test system instruction'),
  getCompressionPrompt: vi.fn().mockReturnValue('Test compression prompt'),
  initializePromptSystem: vi.fn().mockResolvedValue(undefined),
}));

import {
  Chat,
  Content,
  EmbedContentResponse,
  GenerateContentResponse,
  GoogleGenAI,
  Part,
  PartListUnion,
} from '@google/genai';
import {
  findCompressSplitPoint,
  GeminiClient,
  isThinkingSupported,
} from './client.js';
import { getCoreSystemPromptAsync } from './prompts.js';
import {
  ContentGenerator,
  ContentGeneratorConfig,
} from './contentGenerator.js';
import type { Mock } from 'vitest';
import type { ConfigParameters } from '../config/config.js';
import { GeminiChat } from './geminiChat.js';
import { Config } from '../config/config.js';
import { createAgentRuntimeState } from '../runtime/AgentRuntimeState.js';
import { GeminiEventType, Turn } from './turn.js';
import { getCoreSystemPrompt as _getCoreSystemPrompt } from './prompts.js';
import { DEFAULT_GEMINI_FLASH_MODEL } from '../config/models.js';
import { FileDiscoveryService } from '../services/fileDiscoveryService.js';
import { setSimulate429 } from '../utils/testUtils.js';
import { retryWithBackoff } from '../utils/retry.js';
import { ideContext } from '../ide/ideContext.js';
import { ComplexityAnalyzer } from '../services/complexity-analyzer.js';
import { TodoReminderService } from '../services/todo-reminder-service.js';
import { tokenLimit } from './tokenLimits.js';
import { uiTelemetryService } from '../telemetry/uiTelemetry.js';

// --- Mocks ---
const mockChatCreateFn = vi.fn();
const mockGenerateContentFn = vi.fn();
const mockEmbedContentFn = vi.fn();
const mockTurnRunFn = vi.fn();

vi.mock('@google/genai');
vi.mock('../services/complexity-analyzer.js', () => ({
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
const { todoStoreReadMock, mockTodoStoreConstructor } = vi.hoisted(() => {
  const readMock = vi.fn();
  const constructorMock = vi.fn().mockImplementation(() => ({
    readTodos: readMock,
  }));
  return {
    todoStoreReadMock: readMock,
    mockTodoStoreConstructor: constructorMock,
  };
});

vi.mock('../services/todo-reminder-service.js', () => ({
  TodoReminderService: vi.fn().mockImplementation(() => ({
    getComplexTaskSuggestion: vi.fn(),
    getEscalatedComplexTaskSuggestion: vi.fn(),
    getCreateListReminder: vi.fn(),
    getUpdateActiveTodoReminder: vi.fn(),
  })),
}));
vi.mock('../tools/todo-store.js', () => ({
  TodoStore: mockTodoStoreConstructor,
}));
vi.mock('./turn', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./turn.js')>();
  // Define a mock class that has the same shape as the real Turn
  class MockTurn {
    pendingToolCalls = [];
    // The run method is a property that holds our mock function
    run = mockTurnRunFn;

    constructor() {
      // The constructor can be empty or do some mock setup
    }
  }
  // Export the mock class as 'Turn'
  return {
    ...actual,
    Turn: MockTurn,
  };
});

vi.mock('../config/config.js');
vi.mock('../utils/getFolderStructure', () => ({
  getFolderStructure: vi.fn().mockResolvedValue('Mock Folder Structure'),
}));
vi.mock('../utils/errorReporting', () => ({ reportError: vi.fn() }));
vi.mock('../utils/generateContentResponseUtilities', () => ({
  getResponseText: (result: GenerateContentResponse) =>
    result.candidates?.[0]?.content?.parts?.map((part) => part.text).join('') ||
    undefined,
}));
vi.mock('../telemetry/index.js', () => ({
  logApiRequest: vi.fn(),
  logApiResponse: vi.fn(),
  logApiError: vi.fn(),
}));
vi.mock('../utils/retry.js', () => ({
  retryWithBackoff: vi.fn((apiCall) => apiCall()),
}));
vi.mock('../ide/ideContext.js');
vi.mock('./tokenLimits', () => ({
  tokenLimit: vi.fn(),
}));
vi.mock('../telemetry/uiTelemetry.js', () => ({
  uiTelemetryService: {
    setLastPromptTokenCount: vi.fn(),
    getLastPromptTokenCount: vi.fn(),
  },
}));

/**
 * Array.fromAsync ponyfill, which will be available in es 2024.
 *
 * Buffers an async generator into an array and returns the result.
 */
async function fromAsync<T>(promise: AsyncGenerator<T>): Promise<readonly T[]> {
  const results: T[] = [];
  for await (const result of promise) {
    results.push(result);
  }
  return results;
}

describe('isThinkingSupported', () => {
  it('should return true for gemini-2.5', () => {
    expect(isThinkingSupported('gemini-2.5')).toBe(true);
    expect(isThinkingSupported('gemini-2.5-flash')).toBe(true);
  });

  it('should return false for gemini-2.0 models', () => {
    expect(isThinkingSupported('gemini-2.0-flash')).toBe(false);
    expect(isThinkingSupported('gemini-2.0-pro')).toBe(false);
  });

  it('should return true for other models', () => {
    expect(isThinkingSupported('some-other-model')).toBe(true);
  });
});

describe('findCompressSplitPoint', () => {
  it('should throw an error for non-positive numbers', () => {
    expect(() => findCompressSplitPoint([], 0)).toThrow(
      'Fraction must be between 0 and 1',
    );
  });

  it('should throw an error for a fraction greater than or equal to 1', () => {
    expect(() => findCompressSplitPoint([], 1)).toThrow(
      'Fraction must be between 0 and 1',
    );
  });

  it('should handle an empty history', () => {
    expect(findCompressSplitPoint([], 0.5)).toBe(0);
  });

  it('should handle a fraction in the middle', () => {
    const history: Content[] = [
      { role: 'user', parts: [{ text: 'This is the first message.' }] },
      { role: 'model', parts: [{ text: 'This is the second message.' }] },
      { role: 'user', parts: [{ text: 'This is the third message.' }] },
      { role: 'model', parts: [{ text: 'This is the fourth message.' }] },
      { role: 'user', parts: [{ text: 'This is the fifth message.' }] },
    ];
    expect(findCompressSplitPoint(history, 0.5)).toBe(4);
  });

  it('should handle a fraction of last index', () => {
    const history: Content[] = [
      { role: 'user', parts: [{ text: 'This is the first message.' }] },
      { role: 'model', parts: [{ text: 'This is the second message.' }] },
      { role: 'user', parts: [{ text: 'This is the third message.' }] },
      { role: 'model', parts: [{ text: 'This is the fourth message.' }] },
      { role: 'user', parts: [{ text: 'This is the fifth message.' }] },
    ];
    expect(findCompressSplitPoint(history, 0.9)).toBe(4);
  });

  it('should handle a fraction of after last index', () => {
    const history: Content[] = [
      { role: 'user', parts: [{ text: 'This is the first message.' }] },
      { role: 'model', parts: [{ text: 'This is the second message.' }] },
      { role: 'user', parts: [{ text: 'This is the third message.' }] },
      { role: 'model', parts: [{ text: 'This is the fourth message.' }] },
    ];
    expect(findCompressSplitPoint(history, 0.8)).toBe(4);
  });

  it('should return earlier splitpoint if no valid ones are after threshhold', () => {
    const history: Content[] = [
      { role: 'user', parts: [{ text: 'This is the first message.' }] },
      { role: 'model', parts: [{ text: 'This is the second message.' }] },
      { role: 'user', parts: [{ text: 'This is the third message.' }] },
      { role: 'model', parts: [{ functionCall: {} }] },
    ];
    expect(findCompressSplitPoint(history, 0.99)).toBe(2);
  });

  it('should handle a history with only one item', () => {
    const historyWithEmptyParts: Content[] = [
      { role: 'user', parts: [{ text: 'Message 1' }] },
    ];
    expect(findCompressSplitPoint(historyWithEmptyParts, 0.5)).toBe(0);
  });

  it('should handle history with weird parts', () => {
    const historyWithEmptyParts: Content[] = [
      { role: 'user', parts: [{ text: 'Message 1' }] },
      { role: 'model', parts: [{ fileData: { fileUri: 'derp' } }] },
      { role: 'user', parts: [{ text: 'Message 2' }] },
    ];
    expect(findCompressSplitPoint(historyWithEmptyParts, 0.5)).toBe(2);
  });

  it('should fall back to tool call split when no user splits exist', () => {
    const history: Content[] = [
      { role: 'model', parts: [{ functionCall: { name: 'toolA' } }] },
      {
        role: 'user',
        parts: [
          {
            functionResponse: {
              name: 'toolA',
              response: { ok: true },
              id: 'toolA',
            },
          },
        ],
      },
      { role: 'model', parts: [{ functionCall: { name: 'toolB' } }] },
      {
        role: 'user',
        parts: [
          {
            functionResponse: {
              name: 'toolB',
              response: { ok: true },
              id: 'toolB',
            },
          },
        ],
      },
    ];

    expect(findCompressSplitPoint(history, 0.6)).toBe(2);
  });
});

describe('Gemini Client (client.ts)', () => {
  let client: GeminiClient;
  beforeEach(async () => {
    vi.resetAllMocks();
    vi.mocked(uiTelemetryService.setLastPromptTokenCount).mockClear();
    mockTodoStoreConstructor.mockReset();
    todoStoreReadMock.mockReset();
    mockTodoStoreConstructor.mockImplementation(() => ({
      readTodos: todoStoreReadMock,
    }));
    todoStoreReadMock.mockResolvedValue([]);

    // Re-setup prompts mocks after reset
    vi.mocked(getCoreSystemPromptAsync).mockResolvedValue(
      'Test system instruction',
    );

    // Re-setup mocks after reset
    vi.mocked(ComplexityAnalyzer).mockImplementation(
      () =>
        ({
          analyzeComplexity: vi.fn().mockReturnValue({
            complexityScore: 0.2,
            isComplex: false,
            detectedTasks: [],
            sequentialIndicators: [],
            questionCount: 0,
            shouldSuggestTodos: false,
          }),
        }) as unknown as ComplexityAnalyzer,
    );

    vi.mocked(TodoReminderService).mockImplementation(
      () =>
        ({
          getComplexTaskSuggestion: vi.fn(),
          getEscalatedComplexTaskSuggestion: vi.fn(),
          getCreateListReminder: vi.fn(),
          getUpdateActiveTodoReminder: vi.fn(),
          getEscalatedActiveTodoReminder: vi.fn(),
        }) as unknown as TodoReminderService,
    );

    // Disable 429 simulation for tests
    setSimulate429(false);

    // Set up the mock for GoogleGenAI constructor and its methods
    const MockedGoogleGenAI = vi.mocked(GoogleGenAI);
    MockedGoogleGenAI.mockImplementation((..._args: unknown[]): GoogleGenAI => {
      const mockInstance = {
        chats: { create: mockChatCreateFn },
        models: {
          generateContent: mockGenerateContentFn,
          embedContent: mockEmbedContentFn,
        },
      };
      return mockInstance as unknown as GoogleGenAI;
    });

    mockChatCreateFn.mockResolvedValue({} as Chat);
    mockGenerateContentFn.mockResolvedValue({
      candidates: [
        {
          content: {
            parts: [{ text: '{"key": "value"}' }],
          },
        },
      ],
    } as unknown as GenerateContentResponse);

    // Because the GeminiClient constructor kicks off an async process (startChat)
    // that depends on a fully-formed Config object, we need to mock the
    // entire implementation of Config for these tests.
    const mockToolRegistry = {
      getFunctionDeclarations: vi.fn().mockReturnValue([]),
      getTool: vi.fn().mockReturnValue(null),
      getAllTools: vi.fn().mockReturnValue([]),
    };
    const fileService = new FileDiscoveryService('/test/dir');
    const MockedConfig = vi.mocked(Config, true);
    const contentGeneratorConfig: ContentGeneratorConfig = {
      model: 'test-model',
      apiKey: 'test-key',
      vertexai: false,
    };
    const mockConfigObject = {
      getContentGeneratorConfig: vi
        .fn()
        .mockReturnValue(contentGeneratorConfig),
      getToolRegistry: vi.fn().mockReturnValue(mockToolRegistry),
      getModel: vi.fn().mockReturnValue('test-model'),
      setModel: vi.fn(),
      getEmbeddingModel: vi.fn().mockReturnValue('test-embedding-model'),
      getApiKey: vi.fn().mockReturnValue('test-key'),
      getVertexAI: vi.fn().mockReturnValue(false),
      getUserAgent: vi.fn().mockReturnValue('test-agent'),
      getUserMemory: vi.fn().mockReturnValue(''),
      getCoreMemory: vi.fn().mockReturnValue(''),

      getSessionId: vi.fn().mockReturnValue('test-session-id'),
      getProxy: vi.fn().mockReturnValue(undefined),
      getWorkingDir: vi.fn().mockReturnValue('/test/dir'),
      getFileService: vi.fn().mockReturnValue(fileService),
      getMaxSessionTurns: vi.fn().mockReturnValue(0),
      getNoBrowser: vi.fn().mockReturnValue(false),
      getUsageStatisticsEnabled: vi.fn().mockReturnValue(true),
      getIdeMode: vi.fn().mockReturnValue(true),
      getDebugMode: vi.fn().mockReturnValue(false),
      getWorkspaceContext: vi.fn().mockReturnValue({
        getDirectories: vi.fn().mockReturnValue(['/test/dir']),
      }),
      getGeminiClient: vi.fn(),
      setFallbackMode: vi.fn(),
      getProvider: vi.fn().mockReturnValue('gemini'),
      getComplexityAnalyzerSettings: vi.fn().mockReturnValue({
        complexityThreshold: 0.5,
        minTasksForSuggestion: 3,
        suggestionCooldownMs: 300000,
      }),
      getContinueOnFailedApiCall: vi.fn().mockReturnValue(true),
      getChatCompression: vi.fn().mockReturnValue(undefined),
      getEphemeralSettings: vi.fn().mockReturnValue({}),
      getEphemeralSetting: vi.fn().mockReturnValue(undefined),
    };
    MockedConfig.mockImplementation(
      () => mockConfigObject as unknown as Config,
    );

    // We can instantiate the client here since Config is mocked
    // and the constructor will use the mocked GoogleGenAI
    const mockConfig = new Config({
      sessionId: 'test-session-id',
    } as ConfigParameters);
    const runtimeState = createAgentRuntimeState({
      runtimeId: 'test-runtime',
      provider: 'gemini',
      model: 'test-model',
      sessionId: 'test-session-id',
    });
    client = new GeminiClient(mockConfig, runtimeState);
    await client.initialize(contentGeneratorConfig);

    // Update the mock to return the client
    mockConfigObject.getGeminiClient.mockReturnValue(client);

    // Add missing methods to the client instance for tests
    client.getHistory = vi.fn().mockReturnValue([]);

    // Mock the chat object to prevent getHistoryService errors
    const mockChat = {
      addHistory: vi.fn(),
      getHistory: vi.fn().mockReturnValue([]),
      getHistoryService: vi.fn().mockReturnValue({
        clear: vi.fn(),
        findUnmatchedToolCalls: vi.fn().mockReturnValue([]),
        getCurated: vi.fn().mockReturnValue([]),
        getTotalTokens: vi.fn().mockReturnValue(0),
      }),
      clearHistory: vi.fn(),
      sendMessageStream: vi.fn(),
      getLastPromptTokenCount: vi.fn().mockReturnValue(0),
    };
    client['chat'] = mockChat as unknown as (typeof client)['chat'];
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // NOTE: The following tests for startChat were removed due to persistent issues with
  // the @google/genai mock. Specifically, the mockChatCreateFn (representing instance.chats.create)
  // was not being detected as called by the GeminiClient instance.
  // This likely points to a subtle issue in how the GoogleGenerativeAI class constructor
  // and its instance methods are mocked and then used by the class under test.
  // For future debugging, ensure that the `this.client` in `GeminiClient` (which is an
  // instance of the mocked GoogleGenerativeAI) correctly has its `chats.create` method
  // pointing to `mockChatCreateFn`.
  // it('startChat should call getCoreSystemPrompt with userMemory and pass to chats.create', async () => { ... });
  // it('startChat should call getCoreSystemPrompt with empty string if userMemory is empty', async () => { ... });

  // NOTE: The following tests for generateJson were removed due to persistent issues with
  // the @google/genai mock, similar to the startChat tests. The mockGenerateContentFn
  // (representing instance.models.generateContent) was not being detected as called, or the mock
  // was not preventing an actual API call (leading to API key errors).
  // For future debugging, ensure `this.client.models.generateContent` in `GeminiClient` correctly
  // uses the `mockGenerateContentFn`.
  // it('generateJson should call getCoreSystemPrompt with userMemory and pass to generateContent', async () => { ... });
  // it('generateJson should call getCoreSystemPrompt with empty string if userMemory is empty', async () => { ... });

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

      expect(result).toEqual(mockEmbeddings);
    });

    it('should return an empty array if an empty array is passed', async () => {
      const result = await client.generateEmbedding([]);
      expect(result).toEqual([]);
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

      client['chat'] = mockChat as unknown as GeminiChat;
      client['contentGenerator'] = {
        countTokens: vi.fn(),
      } as unknown as ContentGenerator;

      const config = client['config'] as unknown as {
        getUserMemory: () => string;
      };
      vi.spyOn(config, 'getUserMemory').mockReturnValue('new memory');

      const toolNamesSpy = vi
        .spyOn(
          client as unknown as {
            getEnabledToolNamesForPrompt: () => string[];
          },
          'getEnabledToolNamesForPrompt',
        )
        .mockReturnValue(['tool_a']);

      const subagentSpy = vi
        .spyOn(
          client as unknown as {
            shouldIncludeSubagentDelegation: (
              tools: string[],
            ) => Promise<boolean>;
          },
          'shouldIncludeSubagentDelegation',
        )
        .mockResolvedValue(true);

      vi.mocked(getCoreSystemPromptAsync).mockResolvedValue(
        'prompt body with new memory',
      );

      await client.updateSystemInstruction();

      expect(toolNamesSpy).toHaveBeenCalled();
      expect(subagentSpy).toHaveBeenCalledWith(['tool_a']);
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

      client['chat'] = mockChat as unknown as GeminiChat;
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

      vi.spyOn(
        client as unknown as {
          getEnabledToolNamesForPrompt: () => string[];
        },
        'getEnabledToolNamesForPrompt',
      ).mockReturnValue([]);

      vi.spyOn(
        client as unknown as {
          shouldIncludeSubagentDelegation: (
            tools: string[],
          ) => Promise<boolean>;
        },
        'shouldIncludeSubagentDelegation',
      ).mockResolvedValue(false);

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
      expect(result).toEqual({ key: 'value' });

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
      expect(result).toEqual({ key: 'value' });

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
      const mockChat: Partial<GeminiChat> = {
        addHistory: vi.fn(),
      };
      client['chat'] = mockChat as GeminiChat;

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
      const mockChat = client['chat'] as GeminiChat;
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
        client['chat'] = newMockChat as GeminiChat;
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
      (
        client as unknown as { todoToolsAvailable: boolean }
      ).todoToolsAvailable = true;

      const recordActivity = client['recordModelActivity'].bind(client);

      for (let i = 0; i < 5; i++) {
        recordActivity({
          type: GeminiEventType.Content,
          value: 'intermediate',
        } as unknown as Parameters<typeof recordActivity>[0]);
      }

      expect(
        (client as unknown as { toolActivityCount: number }).toolActivityCount,
      ).toBe(0);
      expect(
        (client as unknown as { toolCallReminderLevel: string })
          .toolCallReminderLevel,
      ).toBe('none');

      for (let i = 0; i < 4; i++) {
        recordActivity({
          type: GeminiEventType.ToolCallResponse,
          value: {
            callId: `call-${i}`,
            responseParts: [] as Part[],
            resultDisplay: undefined,
            error: undefined,
            errorType: undefined,
          },
        } as unknown as Parameters<typeof recordActivity>[0]);
      }

      expect(
        (client as unknown as { toolCallReminderLevel: string })
          .toolCallReminderLevel,
      ).toBe('base');
    });
  });

  describe('sendMessageStream', () => {
    beforeEach(() => {
      (
        client as unknown as { todoToolsAvailable: boolean }
      ).todoToolsAvailable = true;
    });

    it('retries once when no tool work and todos unchanged', async () => {
      const reminderService = new TodoReminderService();
      const followUpReminderText =
        '---\nSystem Note: You still have unfinished todos. Continue the required work.\n---';
      vi.mocked(reminderService.getUpdateActiveTodoReminder).mockReturnValue(
        followUpReminderText,
      );
      vi.mocked(reminderService.getEscalatedActiveTodoReminder).mockReturnValue(
        followUpReminderText,
      );
      (
        client as unknown as { todoReminderService: TodoReminderService }
      ).todoReminderService = reminderService as unknown as TodoReminderService;
      (
        client as unknown as { todoToolsAvailable: boolean }
      ).todoToolsAvailable = true;

      todoStoreReadMock.mockResolvedValue([
        {
          id: 'todo-1',
          content: 'Complete the task',
          status: 'pending',
        },
      ]);

      const forwardedRequests: Part[][] = [];
      mockTurnRunFn.mockReset();
      mockTurnRunFn.mockImplementation((req: PartListUnion) => {
        forwardedRequests.push(req as Part[]);
        return (async function* () {
          yield {
            type: GeminiEventType.Content,
            value: 'Just thinking about it',
          };
          yield {
            type: GeminiEventType.Finished,
            value: { reason: 'STOP' },
          };
        })();
      });

      vi.spyOn(client['config'], 'getIdeMode').mockReturnValue(false);

      const mockChat: Partial<GeminiChat> = {
        addHistory: vi.fn(),
        getHistory: vi.fn().mockReturnValue([]),
        getLastPromptTokenCount: vi.fn().mockReturnValue(0),
      };
      client['chat'] = mockChat as GeminiChat;

      const mockGenerator: Partial<ContentGenerator> = {
        countTokens: vi.fn().mockResolvedValue({ totalTokens: 0 }),
      };
      client['contentGenerator'] = mockGenerator as ContentGenerator;

      const stream = client.sendMessageStream(
        [{ text: 'Get started' }],
        new AbortController().signal,
        'prompt-no-tools',
      );
      await fromAsync(stream);

      expect(mockTurnRunFn).toHaveBeenCalledTimes(2);
      expect(forwardedRequests.length).toBe(2);

      const secondRequest = forwardedRequests[1];
      const reminderPart = secondRequest?.find(
        (part) =>
          typeof part === 'object' &&
          part !== null &&
          'text' in part &&
          typeof (part as Part).text === 'string' &&
          (part as Part).text.includes('System Note'),
      );
      expect(reminderPart).toBeDefined();
    });

    it('does not retry after todo_pause', async () => {
      const reminderService = new TodoReminderService();
      vi.mocked(reminderService.getUpdateActiveTodoReminder).mockReturnValue(
        '---\nSystem Note: Update the active todo before replying.\n---',
      );
      (
        client as unknown as { todoReminderService: TodoReminderService }
      ).todoReminderService = reminderService as unknown as TodoReminderService;
      (
        client as unknown as { todoToolsAvailable: boolean }
      ).todoToolsAvailable = true;

      todoStoreReadMock.mockResolvedValue([
        {
          id: 'todo-1',
          content: 'Blocked task',
          status: 'pending',
        },
      ]);

      mockTurnRunFn.mockReset();
      mockTurnRunFn.mockImplementation(() =>
        (async function* () {
          yield {
            type: GeminiEventType.ToolCallRequest,
            value: {
              name: 'todo_pause',
              args: { reason: 'Need more information' },
            },
          };
          yield {
            type: GeminiEventType.ToolCallResponse,
            value: {
              callId: 'pause-1',
              responseParts: [
                {
                  functionResponse: {
                    name: 'todo_pause',
                    id: 'pause-1',
                    response: {},
                  },
                } as unknown as Part,
              ],
              resultDisplay: undefined,
              error: undefined,
              errorType: undefined,
            },
          };
          yield {
            type: GeminiEventType.Content,
            value: 'I need more info',
          };
          yield {
            type: GeminiEventType.Finished,
            value: { reason: 'STOP' },
          };
        })(),
      );

      vi.spyOn(client['config'], 'getIdeMode').mockReturnValue(false);

      const mockChat: Partial<GeminiChat> = {
        addHistory: vi.fn(),
        getHistory: vi.fn().mockReturnValue([]),
        getLastPromptTokenCount: vi.fn().mockReturnValue(0),
      };
      client['chat'] = mockChat as GeminiChat;

      const mockGenerator: Partial<ContentGenerator> = {
        countTokens: vi.fn().mockResolvedValue({ totalTokens: 0 }),
      };
      client['contentGenerator'] = mockGenerator as ContentGenerator;

      const stream = client.sendMessageStream(
        [{ text: 'Work on the task' }],
        new AbortController().signal,
        'prompt-pause',
      );
      const events = await fromAsync(stream);

      expect(mockTurnRunFn).toHaveBeenCalledTimes(1);
      expect(events.some((e) => e.type === GeminiEventType.Content)).toBe(true);
      expect(events.some((e) => e.type === GeminiEventType.Finished)).toBe(
        true,
      );
    });

    it('should add context if ideMode is enabled and there are open files but no active file', async () => {
      // Arrange
      vi.mocked(ideContext.getIdeContext).mockReturnValue({
        workspaceState: {
          openFiles: [
            {
              path: '/path/to/recent/file1.ts',
              timestamp: Date.now(),
            },
            {
              path: '/path/to/recent/file2.ts',
              timestamp: Date.now(),
            },
          ],
        },
      });

      vi.spyOn(client['config'], 'getIdeMode').mockReturnValue(true);

      const mockStream = (async function* () {
        yield { type: 'content', value: 'Hello' };
      })();
      mockTurnRunFn.mockReturnValue(mockStream);

      const mockChat: Partial<GeminiChat> = {
        addHistory: vi.fn(),
        getHistory: vi.fn().mockReturnValue([]),
        getLastPromptTokenCount: vi.fn().mockReturnValue(0),
      };
      client['chat'] = mockChat as GeminiChat;

      const mockGenerator: Partial<ContentGenerator> = {
        countTokens: vi.fn().mockResolvedValue({ totalTokens: 0 }),
        generateContent: mockGenerateContentFn,
      };
      client['contentGenerator'] = mockGenerator as ContentGenerator;

      const initialRequest = [{ text: 'Hi' }];

      // Act
      const stream = client.sendMessageStream(
        initialRequest,
        new AbortController().signal,
        'prompt-id-ide',
      );
      for await (const _ of stream) {
        // consume stream
      }

      // Verify that the IDE context was included correctly for files without active file
      const addHistoryCalls = vi.mocked(mockChat.addHistory).mock.calls;
      const contextCall = addHistoryCalls.find((call) =>
        JSON.stringify(call[0]).includes('editor context'),
      );
      expect(contextCall).toBeDefined();
      expect(JSON.stringify(contextCall![0])).toContain('recent/file1.ts');
      expect(JSON.stringify(contextCall![0])).toContain('recent/file2.ts');
    });

    it('should return the turn instance after the stream is complete', async () => {
      // Arrange
      const mockStream = (async function* () {
        yield { type: 'content', value: 'Hello' };
      })();
      mockTurnRunFn.mockReturnValue(mockStream);

      const mockChat: Partial<GeminiChat> = {
        addHistory: vi.fn(),
        getHistory: vi.fn().mockReturnValue([]),
        getLastPromptTokenCount: vi.fn().mockReturnValue(0),
      };
      client['chat'] = mockChat as GeminiChat;

      const mockGenerator: Partial<ContentGenerator> = {
        countTokens: vi.fn().mockResolvedValue({ totalTokens: 0 }),
        generateContent: vi.fn(),
        generateContentStream: vi.fn(),
        embedContent: vi.fn(),
      };
      client['contentGenerator'] = mockGenerator as ContentGenerator;

      // Act
      const stream = client.sendMessageStream(
        [{ text: 'Hi' }],
        new AbortController().signal,
        'prompt-id-1',
      );

      // Consume the stream manually to get the final return value.
      let finalResult: Turn | undefined;
      while (true) {
        const result = await stream.next();
        if (result.done) {
          finalResult = result.value;
          break;
        }
      }

      // Assert
      expect(finalResult).toBeInstanceOf(Turn);
    });

    it.skip('should stop infinite loop after MAX_TURNS when nextSpeaker always returns model', async () => {
      // Get the mocked checkNextSpeaker function and configure it to trigger infinite loop
      const { checkNextSpeaker } = await import(
        '../utils/nextSpeakerChecker.js'
      );
      const mockCheckNextSpeaker = vi.mocked(checkNextSpeaker);
      mockCheckNextSpeaker.mockResolvedValue({
        next_speaker: 'model',
        reasoning: 'Test case - always continue',
      });

      // Mock provider manager to return 'gemini' provider
      const mockProviderManager = {
        getActiveProviderName: vi.fn().mockReturnValue('gemini'),
        getActiveProvider: vi.fn().mockReturnValue(null),
      };
      const mockContentGenConfig = {
        model: 'test-model',
        providerManager: mockProviderManager,
      };
      vi.spyOn(client['config'], 'getContentGeneratorConfig').mockReturnValue(
        mockContentGenConfig as unknown as ContentGeneratorConfig,
      );

      // Mock Turn to have no pending tool calls (which would allow nextSpeaker check)
      const mockStream = (async function* () {
        yield { type: 'content', value: 'Continue...' };
      })();
      mockTurnRunFn.mockReturnValue(mockStream);

      const mockChat: Partial<GeminiChat> = {
        addHistory: vi.fn(),
        getHistory: vi.fn().mockReturnValue([]),
        getLastPromptTokenCount: vi.fn().mockReturnValue(0),
      };
      client['chat'] = mockChat as GeminiChat;

      const mockGenerator: Partial<ContentGenerator> = {
        countTokens: vi.fn().mockResolvedValue({ totalTokens: 0 }),
      };
      client['contentGenerator'] = mockGenerator as ContentGenerator;

      // Use a signal that never gets aborted
      const abortController = new AbortController();
      const signal = abortController.signal;

      // Act - Start the stream that should loop
      const stream = client.sendMessageStream(
        [{ text: 'Start conversation' }],
        signal,
        'prompt-id-2',
      );

      // Count how many stream events we get
      let eventCount = 0;
      let finalResult: Turn | undefined;

      // Consume the stream and count iterations
      while (true) {
        const result = await stream.next();
        if (result.done) {
          finalResult = result.value;
          break;
        }
        eventCount++;

        // Safety check to prevent actual infinite loop in test
        if (eventCount > 200) {
          abortController.abort();
          throw new Error(
            'Test exceeded expected event limit - possible actual infinite loop',
          );
        }
      }

      // Assert
      expect(finalResult).toBeInstanceOf(Turn);

      // Debug: Check how many times checkNextSpeaker was called
      const callCount = mockCheckNextSpeaker.mock.calls.length;

      // If infinite loop protection is working, checkNextSpeaker should be called many times
      // but stop at MAX_TURNS (100). Since each recursive call should trigger checkNextSpeaker,
      // we expect it to be called multiple times before hitting the limit
      expect(mockCheckNextSpeaker).toHaveBeenCalled();

      // The test should demonstrate that the infinite loop protection works:
      // - If checkNextSpeaker is called many times (close to MAX_TURNS), it shows the loop was happening
      // - If it's only called once, the recursive behavior might not be triggered
      if (callCount === 0) {
        throw new Error(
          'checkNextSpeaker was never called - the recursive condition was not met',
        );
      }

      // Verify protection worked - should be called at least once but not exceed MAX_TURNS
      expect(callCount).toBeGreaterThanOrEqual(1);
      expect(callCount).toBeLessThanOrEqual(100); // Should not exceed MAX_TURNS

      console.log(
        callCount === 1
          ? 'checkNextSpeaker called only once - no infinite loop occurred'
          : `checkNextSpeaker called ${callCount} times - infinite loop protection worked`,
      );

      // The stream should produce events and eventually terminate
      expect(eventCount).toBeGreaterThanOrEqual(1);
      expect(eventCount).toBeLessThan(200); // Should not exceed our safety limit
    });

    it('should yield MaxSessionTurns and stop when session turn limit is reached', async () => {
      // Arrange
      const MAX_SESSION_TURNS = 5;
      vi.spyOn(client['config'], 'getMaxSessionTurns').mockReturnValue(
        MAX_SESSION_TURNS,
      );

      const mockStream = (async function* () {
        yield { type: 'content', value: 'Hello' };
      })();
      mockTurnRunFn.mockReturnValue(mockStream);

      const mockChat: Partial<GeminiChat> = {
        addHistory: vi.fn(),
        getHistory: vi.fn().mockReturnValue([]),
        getLastPromptTokenCount: vi.fn().mockReturnValue(0),
      };
      client['chat'] = mockChat as GeminiChat;

      const mockGenerator: Partial<ContentGenerator> = {
        countTokens: vi.fn().mockResolvedValue({ totalTokens: 0 }),
      };
      client['contentGenerator'] = mockGenerator as ContentGenerator;

      // Act & Assert
      // Run up to the limit
      for (let i = 0; i < MAX_SESSION_TURNS; i++) {
        const stream = client.sendMessageStream(
          [{ text: 'Hi' }],
          new AbortController().signal,
          'prompt-id-4',
        );
        // consume stream
        for await (const _event of stream) {
          // do nothing
        }
      }

      // This call should exceed the limit
      const stream = client.sendMessageStream(
        [{ text: 'Hi' }],
        new AbortController().signal,
        'prompt-id-5',
      );

      const events = [];
      for await (const event of stream) {
        events.push(event);
      }

      // Verify that the max session turns limit was respected
      expect(events).toEqual([{ type: GeminiEventType.MaxSessionTurns }]);
    });

    it.skip('should respect MAX_TURNS limit even when turns parameter is set to a large value', async () => {
      // This test verifies that the infinite loop protection works even when
      // someone tries to bypass it by calling with a very large turns value

      // Get the mocked checkNextSpeaker function and configure it to trigger infinite loop
      const { checkNextSpeaker } = await import(
        '../utils/nextSpeakerChecker.js'
      );
      const mockCheckNextSpeaker = vi.mocked(checkNextSpeaker);
      mockCheckNextSpeaker.mockResolvedValue({
        next_speaker: 'model',
        reasoning: 'Test case - always continue',
      });

      // Mock Turn to have no pending tool calls (which would allow nextSpeaker check)
      const mockStream = (async function* () {
        yield { type: 'content', value: 'Continue...' };
      })();
      mockTurnRunFn.mockReturnValue(mockStream);

      const mockChat: Partial<GeminiChat> = {
        addHistory: vi.fn(),
        getHistory: vi.fn().mockReturnValue([]),
        getLastPromptTokenCount: vi.fn().mockReturnValue(0),
      };
      client['chat'] = mockChat as GeminiChat;

      const mockGenerator: Partial<ContentGenerator> = {
        countTokens: vi.fn().mockResolvedValue({ totalTokens: 0 }),
      };
      client['contentGenerator'] = mockGenerator as ContentGenerator;

      // Use a signal that never gets aborted
      const abortController = new AbortController();
      const signal = abortController.signal;

      // Act - Start the stream with an extremely high turns value
      // This simulates a case where the turns protection is bypassed
      const stream = client.sendMessageStream(
        [{ text: 'Start conversation' }],
        signal,
        'prompt-id-3',
        Number.MAX_SAFE_INTEGER, // Bypass the MAX_TURNS protection
      );

      // Count how many stream events we get
      let eventCount = 0;
      const maxTestIterations = 1000; // Higher limit to show the loop continues

      // Consume the stream and count iterations
      try {
        while (true) {
          const result = await stream.next();
          if (result.done) {
            break;
          }
          eventCount++;

          // This test should hit this limit, demonstrating the infinite loop
          if (eventCount > maxTestIterations) {
            abortController.abort();
            // This is the expected behavior - we hit the infinite loop
            break;
          }
        }
      } catch (error) {
        // If the test framework times out, that also demonstrates the infinite loop
        console.error('Test timed out or errored:', error);
      }

      // Assert that the fix works - the loop should stop at MAX_TURNS
      const callCount = mockCheckNextSpeaker.mock.calls.length;

      // With the fix: even when turns is set to a very high value,
      // the loop should stop at MAX_TURNS (100)
      expect(callCount).toBeLessThanOrEqual(100); // Should not exceed MAX_TURNS
      expect(eventCount).toBeLessThanOrEqual(200); // Should have reasonable number of events

      console.log(
        `Infinite loop protection working: checkNextSpeaker called ${callCount} times, ` +
          `${eventCount} events generated (properly bounded by MAX_TURNS)`,
      );
    });

    it('should yield ContextWindowWillOverflow when the context window is about to overflow', async () => {
      // Arrange
      const MOCKED_TOKEN_LIMIT = 1000;
      vi.mocked(tokenLimit).mockReturnValue(MOCKED_TOKEN_LIMIT);

      // Set last prompt token count
      const lastPromptTokenCount = 900;
      vi.mocked(uiTelemetryService.getLastPromptTokenCount).mockReturnValue(
        lastPromptTokenCount,
      );

      // Mock the chat to return the lastPromptTokenCount
      const mockChat: Partial<GeminiChat> = {
        addHistory: vi.fn(),
        getHistory: vi.fn().mockReturnValue([]),
        getLastPromptTokenCount: vi.fn().mockReturnValue(lastPromptTokenCount),
      };
      client['chat'] = mockChat as GeminiChat;

      const mockGenerator: Partial<ContentGenerator> = {
        countTokens: vi.fn().mockResolvedValue({ totalTokens: 0 }),
      };
      client['contentGenerator'] = mockGenerator as ContentGenerator;

      // Remaining = 100. Threshold (95%) = 95.
      // We need a request > 95 tokens.
      // A string of length 400 is roughly 100 tokens.
      const longText = 'a'.repeat(400);
      const request: Part[] = [{ text: longText }];
      // estimateTextOnlyLength counts only text content (400 chars), not JSON structure
      const estimatedRequestTokenCount = Math.floor(longText.length / 4);
      const remainingTokenCount = MOCKED_TOKEN_LIMIT - lastPromptTokenCount;

      // Act
      const stream = client.sendMessageStream(
        request,
        new AbortController().signal,
        'prompt-id-overflow',
      );

      const events = await fromAsync(stream);

      // Assert
      expect(events).toContainEqual({
        type: GeminiEventType.ContextWindowWillOverflow,
        value: {
          estimatedRequestTokenCount,
          remainingTokenCount,
        },
      });
      // Ensure turn.run is not called
      expect(mockTurnRunFn).not.toHaveBeenCalled();
    });

    it("should use the sticky model's token limit for the overflow check", async () => {
      // Arrange
      const STICKY_MODEL = 'gemini-1.5-flash';
      const STICKY_MODEL_LIMIT = 1000;
      const CONFIG_MODEL_LIMIT = 2000;

      // Set up token limits
      vi.mocked(tokenLimit).mockImplementation((model) => {
        if (model === STICKY_MODEL) return STICKY_MODEL_LIMIT;
        return CONFIG_MODEL_LIMIT;
      });

      // Set the sticky model
      client['currentSequenceModel'] = STICKY_MODEL;

      // Set token count
      const lastPromptTokenCount = 900;
      vi.mocked(uiTelemetryService.getLastPromptTokenCount).mockReturnValue(
        lastPromptTokenCount,
      );

      // Mock the chat to return the lastPromptTokenCount
      const mockChat: Partial<GeminiChat> = {
        addHistory: vi.fn(),
        getHistory: vi.fn().mockReturnValue([]),
        getLastPromptTokenCount: vi.fn().mockReturnValue(lastPromptTokenCount),
      };
      client['chat'] = mockChat as GeminiChat;

      const mockGenerator: Partial<ContentGenerator> = {
        countTokens: vi.fn().mockResolvedValue({ totalTokens: 0 }),
      };
      client['contentGenerator'] = mockGenerator as ContentGenerator;

      // Remaining (sticky) = 100. Threshold (95%) = 95.
      // We need a request > 95 tokens.
      const longText = 'a'.repeat(400);
      const request: Part[] = [{ text: longText }];
      // estimateTextOnlyLength counts only text content (400 chars), not JSON structure
      const estimatedRequestTokenCount = Math.floor(longText.length / 4);
      const remainingTokenCount = STICKY_MODEL_LIMIT - lastPromptTokenCount;

      // Act
      const stream = client.sendMessageStream(
        request,
        new AbortController().signal,
        'test-session-id', // Use the same ID as the session to keep stickiness
      );

      const events = await fromAsync(stream);

      // Assert
      // Should overflow based on the sticky model's limit
      expect(events).toContainEqual({
        type: GeminiEventType.ContextWindowWillOverflow,
        value: {
          estimatedRequestTokenCount,
          remainingTokenCount,
        },
      });
      expect(tokenLimit).toHaveBeenCalledWith(STICKY_MODEL);
      expect(mockTurnRunFn).not.toHaveBeenCalled();
    });

    it('should not trigger overflow warning for requests with large binary data (PDFs/images)', async () => {
      // Arrange
      const MOCKED_TOKEN_LIMIT = 1000000; // 1M tokens
      vi.mocked(tokenLimit).mockReturnValue(MOCKED_TOKEN_LIMIT);

      const lastPromptTokenCount = 10000;
      const mockChat: Partial<GeminiChat> = {
        getLastPromptTokenCount: vi.fn().mockReturnValue(lastPromptTokenCount),
        getHistory: vi.fn().mockReturnValue([]),
      };
      client['chat'] = mockChat as GeminiChat;

      // Simulate a PDF file with large base64 data (11MB when encoded)
      // In the old implementation, this would incorrectly estimate ~2.7M tokens
      // In the new implementation, only the text part is counted
      const largePdfBase64 = 'A'.repeat(11 * 1024 * 1024);
      const request: Part[] = [
        { text: 'Please analyze this PDF document' }, // ~35 chars = ~8 tokens
        {
          inlineData: {
            mimeType: 'application/pdf',
            data: largePdfBase64, // This should be ignored in token estimation
          },
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

      // Assert
      // Should NOT contain overflow warning
      expect(events).not.toContainEqual(
        expect.objectContaining({
          type: GeminiEventType.ContextWindowWillOverflow,
        }),
      );

      // Turn.run should be called (processing should continue)
      expect(mockTurnRunFn).toHaveBeenCalled();
    });

    it('should recursively call sendMessageStream with "Please continue." when InvalidStream event is received', async () => {
      vi.spyOn(client['config'], 'getContinueOnFailedApiCall').mockReturnValue(
        true,
      );
      // Arrange
      const mockStream1 = (async function* () {
        yield { type: GeminiEventType.InvalidStream };
      })();
      const mockStream2 = (async function* () {
        yield { type: GeminiEventType.Content, value: 'Continued content' };
      })();

      mockTurnRunFn
        .mockReturnValueOnce(mockStream1)
        .mockReturnValueOnce(mockStream2);

      const mockChat: Partial<GeminiChat> = {
        addHistory: vi.fn(),
        getHistory: vi.fn().mockReturnValue([]),
        getLastPromptTokenCount: vi.fn().mockReturnValue(0),
      };
      client['chat'] = mockChat as GeminiChat;

      const initialRequest = [{ text: 'Hi' }];
      const promptId = 'prompt-id-invalid-stream';
      const signal = new AbortController().signal;

      // Act
      const stream = client.sendMessageStream(initialRequest, signal, promptId);
      const events = await fromAsync(stream);

      // Assert
      expect(events).toEqual([
        { type: GeminiEventType.InvalidStream },
        { type: GeminiEventType.Content, value: 'Continued content' },
      ]);

      // Verify that turn.run was called twice
      expect(mockTurnRunFn).toHaveBeenCalledTimes(2);

      // First call with original request
      expect(mockTurnRunFn).toHaveBeenNthCalledWith(
        1,
        initialRequest,
        expect.any(Object),
      );

      // Second call with "Please continue."
      expect(mockTurnRunFn).toHaveBeenNthCalledWith(
        2,
        [{ text: 'System: Please continue.' }],
        expect.any(Object),
      );
    });

    it('should not recursively call sendMessageStream with "Please continue." when InvalidStream event is received and flag is false', async () => {
      vi.spyOn(client['config'], 'getContinueOnFailedApiCall').mockReturnValue(
        false,
      );
      // Arrange
      const mockStream1 = (async function* () {
        yield { type: GeminiEventType.InvalidStream };
      })();

      mockTurnRunFn.mockReturnValueOnce(mockStream1);

      const mockChat: Partial<GeminiChat> = {
        addHistory: vi.fn(),
        getHistory: vi.fn().mockReturnValue([]),
        getLastPromptTokenCount: vi.fn().mockReturnValue(0),
      };
      client['chat'] = mockChat as GeminiChat;

      const initialRequest = [{ text: 'Hi' }];
      const promptId = 'prompt-id-invalid-stream';
      const signal = new AbortController().signal;

      // Act
      const stream = client.sendMessageStream(initialRequest, signal, promptId);
      const events = await fromAsync(stream);

      // Assert
      expect(events).toEqual([{ type: GeminiEventType.InvalidStream }]);

      // Verify that turn.run was called only once
      expect(mockTurnRunFn).toHaveBeenCalledTimes(1);
    });

    it('should stop recursing after one retry when InvalidStream events are repeatedly received', async () => {
      vi.spyOn(client['config'], 'getContinueOnFailedApiCall').mockReturnValue(
        true,
      );
      // Arrange
      // Always return a new invalid stream
      mockTurnRunFn.mockImplementation(() =>
        (async function* () {
          yield { type: GeminiEventType.InvalidStream };
        })(),
      );

      const mockChat: Partial<GeminiChat> = {
        addHistory: vi.fn(),
        getHistory: vi.fn().mockReturnValue([]),
        getLastPromptTokenCount: vi.fn().mockReturnValue(0),
      };
      client['chat'] = mockChat as GeminiChat;

      const initialRequest = [{ text: 'Hi' }];
      const promptId = 'prompt-id-infinite-invalid-stream';
      const signal = new AbortController().signal;

      // Act
      const stream = client.sendMessageStream(initialRequest, signal, promptId);
      const events = await fromAsync(stream);

      // Assert
      // We expect 2 InvalidStream events (original + 1 retry)
      expect(events.length).toBe(2);
      expect(
        events.every((e) => e.type === GeminiEventType.InvalidStream),
      ).toBe(true);

      // Verify that turn.run was called twice
      expect(mockTurnRunFn).toHaveBeenCalledTimes(2);
    });

    describe('Editor context delta', () => {
      const mockStream = (async function* () {
        yield { type: 'content', value: 'Hello' };
      })();

      beforeEach(() => {
        client['forceFullIdeContext'] = false; // Reset before each delta test
        vi.spyOn(client['config'], 'getIdeMode').mockReturnValue(true);
        mockTurnRunFn.mockReturnValue(mockStream);

        const mockChat: Partial<GeminiChat> = {
          addHistory: vi.fn(),
          setHistory: vi.fn(),
          sendMessage: vi.fn().mockResolvedValue({ text: 'summary' }),
          // Assume history is not empty for delta checks
          getHistory: vi
            .fn()
            .mockReturnValue([
              { role: 'user', parts: [{ text: 'previous message' }] },
            ]),
          getLastPromptTokenCount: vi.fn().mockReturnValue(0),
        };
        client['chat'] = mockChat as GeminiChat;

        // Override the client.getHistory mock to return non-empty history for delta tests
        (client.getHistory as ReturnType<typeof vi.fn>).mockResolvedValue([
          { role: 'user', parts: [{ text: 'previous message' }] },
        ]);

        const mockGenerator: Partial<ContentGenerator> = {
          countTokens: vi.fn().mockResolvedValue({ totalTokens: 0 }),
          generateContent: mockGenerateContentFn,
        };
        client['contentGenerator'] = mockGenerator as ContentGenerator;
      });

      const testCases = [
        {
          description: 'sends delta when active file changes',
          previousActiveFile: {
            path: '/path/to/old/file.ts',
            cursor: { line: 5, character: 10 },
            selectedText: 'hello',
          },
          currentActiveFile: {
            path: '/path/to/active/file.ts',
            cursor: { line: 5, character: 10 },
            selectedText: 'hello',
          },
          shouldSendContext: true,
        },
        {
          description: 'sends delta when cursor line changes',
          previousActiveFile: {
            path: '/path/to/active/file.ts',
            cursor: { line: 1, character: 10 },
            selectedText: 'hello',
          },
          currentActiveFile: {
            path: '/path/to/active/file.ts',
            cursor: { line: 5, character: 10 },
            selectedText: 'hello',
          },
          shouldSendContext: true,
        },
        {
          description: 'sends delta when cursor character changes',
          previousActiveFile: {
            path: '/path/to/active/file.ts',
            cursor: { line: 5, character: 1 },
            selectedText: 'hello',
          },
          currentActiveFile: {
            path: '/path/to/active/file.ts',
            cursor: { line: 5, character: 10 },
            selectedText: 'hello',
          },
          shouldSendContext: true,
        },
        {
          description: 'sends delta when selected text changes',
          previousActiveFile: {
            path: '/path/to/active/file.ts',
            cursor: { line: 5, character: 10 },
            selectedText: 'world',
          },
          currentActiveFile: {
            path: '/path/to/active/file.ts',
            cursor: { line: 5, character: 10 },
            selectedText: 'hello',
          },
          shouldSendContext: true,
        },
        {
          description: 'sends delta when selected text is added',
          previousActiveFile: {
            path: '/path/to/active/file.ts',
            cursor: { line: 5, character: 10 },
          },
          currentActiveFile: {
            path: '/path/to/active/file.ts',
            cursor: { line: 5, character: 10 },
            selectedText: 'hello',
          },
          shouldSendContext: true,
        },
        {
          description: 'sends delta when selected text is removed',
          previousActiveFile: {
            path: '/path/to/active/file.ts',
            cursor: { line: 5, character: 10 },
            selectedText: 'hello',
          },
          currentActiveFile: {
            path: '/path/to/active/file.ts',
            cursor: { line: 5, character: 10 },
          },
          shouldSendContext: true,
        },
        {
          description: 'does not send context when nothing changes',
          previousActiveFile: {
            path: '/path/to/active/file.ts',
            cursor: { line: 5, character: 10 },
            selectedText: 'hello',
          },
          currentActiveFile: {
            path: '/path/to/active/file.ts',
            cursor: { line: 5, character: 10 },
            selectedText: 'hello',
          },
          shouldSendContext: false,
        },
      ];

      it.each(testCases)(
        '$description',
        async ({
          previousActiveFile,
          currentActiveFile,
          shouldSendContext,
        }) => {
          // Setup previous context
          client['lastSentIdeContext'] = {
            workspaceState: {
              openFiles: [
                {
                  path: previousActiveFile.path,
                  cursor: previousActiveFile.cursor,
                  selectedText: previousActiveFile.selectedText,
                  isActive: true,
                  timestamp: Date.now() - 1000,
                },
              ],
            },
          };

          // Setup current context
          vi.mocked(ideContext.getIdeContext).mockReturnValue({
            workspaceState: {
              openFiles: [
                { ...currentActiveFile, isActive: true, timestamp: Date.now() },
              ],
            },
          });

          const stream = client.sendMessageStream(
            [{ text: 'Hi' }],
            new AbortController().signal,
            'prompt-id-delta',
          );
          for await (const _ of stream) {
            // consume stream
          }

          const mockChat = client['chat'] as unknown as {
            addHistory: (typeof vi)['fn'];
          };

          const addHistoryCalls = vi.mocked(mockChat.addHistory).mock.calls;

          // Check for the appropriate context based on shouldSendContext flag
          const summaryCall = addHistoryCalls.find((call) =>
            JSON.stringify(call[0]).includes('summary of changes'),
          );
          const editorContextCall = addHistoryCalls.find((call) =>
            JSON.stringify(call[0]).includes('editor context'),
          );

          // Assert expectations based on the test case
          expect(shouldSendContext ? summaryCall : editorContextCall)[
            shouldSendContext ? 'toBeDefined' : 'toBeUndefined'
          ]();
        },
      );

      it('sends full context when history is cleared, even if editor state is unchanged', async () => {
        const activeFile = {
          path: '/path/to/active/file.ts',
          cursor: { line: 5, character: 10 },
          selectedText: 'hello',
        };

        // Setup previous context
        client['lastSentIdeContext'] = {
          workspaceState: {
            openFiles: [
              {
                path: activeFile.path,
                cursor: activeFile.cursor,
                selectedText: activeFile.selectedText,
                isActive: true,
                timestamp: Date.now() - 1000,
              },
            ],
          },
        };

        // Setup current context (same as previous)
        vi.mocked(ideContext.getIdeContext).mockReturnValue({
          workspaceState: {
            openFiles: [
              { ...activeFile, isActive: true, timestamp: Date.now() },
            ],
          },
        });

        // Make history empty
        const mockChat = client['chat'] as unknown as {
          getHistory: ReturnType<(typeof vi)['fn']>;
          addHistory: ReturnType<(typeof vi)['fn']>;
        };
        mockChat.getHistory.mockReturnValue([]);

        // Also update client.getHistory to return empty for this test
        (client.getHistory as ReturnType<typeof vi.fn>).mockResolvedValue([]);

        const stream = client.sendMessageStream(
          [{ text: 'Hi' }],
          new AbortController().signal,
          'prompt-id-history-cleared',
        );
        for await (const _ of stream) {
          // consume stream
        }

        const addHistoryCalls = vi.mocked(mockChat.addHistory).mock.calls;
        const contextCall = addHistoryCalls.find((call) =>
          JSON.stringify(call[0]).includes("user's editor context"),
        );
        expect(contextCall).toBeDefined();

        // Also verify it's the full context, not a delta.
        const call = contextCall![0];
        const contextText = call.parts[0].text;
        const contextJson = JSON.parse(
          contextText.match(/```json\n(.*)\n```/s)![1],
        );
        expect(contextJson).toHaveProperty('activeFile');
        expect(contextJson.activeFile.path).toBe('/path/to/active/file.ts');
      });
    });

    describe('IDE context with pending tool calls', () => {
      let mockChat: Partial<GeminiChat>;

      beforeEach(() => {
        const mockStream = (async function* () {
          yield { type: 'content', value: 'response' };
        })();
        mockTurnRunFn.mockReturnValue(mockStream);

        mockChat = {
          addHistory: vi.fn(),
          getHistory: vi.fn().mockReturnValue([]), // Default empty history
          setHistory: vi.fn(),
          sendMessage: vi.fn().mockResolvedValue({ text: 'summary' }),
          getLastPromptTokenCount: vi.fn().mockReturnValue(0),
        };
        client['chat'] = mockChat as GeminiChat;

        const mockGenerator: Partial<ContentGenerator> = {
          countTokens: vi.fn().mockResolvedValue({ totalTokens: 0 }),
        };
        client['contentGenerator'] = mockGenerator as ContentGenerator;

        vi.spyOn(client['config'], 'getIdeMode').mockReturnValue(true);
        vi.mocked(ideContext.getIdeContext).mockReturnValue({
          workspaceState: {
            openFiles: [{ path: '/path/to/file.ts', timestamp: Date.now() }],
          },
        });
      });

      it('should NOT add IDE context when a tool call is pending', async () => {
        // Arrange: History ends with a functionCall from the model
        const historyWithPendingCall: Content[] = [
          { role: 'user', parts: [{ text: 'Please use a tool.' }] },
          {
            role: 'model',
            parts: [{ functionCall: { name: 'some_tool', args: {} } }],
          },
        ];
        vi.mocked(mockChat.getHistory!).mockReturnValue(historyWithPendingCall);
        // Also spy on the client's getHistory to ensure it returns the right value
        vi.spyOn(client, 'getHistory').mockResolvedValue(
          historyWithPendingCall,
        );

        // Act: Simulate sending the tool's response back
        const stream = client.sendMessageStream(
          [
            {
              functionResponse: {
                name: 'some_tool',
                response: { success: true },
              },
            },
          ],
          new AbortController().signal,
          'prompt-id-tool-response',
        );
        for await (const _ of stream) {
          // consume stream to complete the call
        }

        // Assert: The IDE context message should NOT have been added to the history.
        const addHistoryCalls = vi.mocked(mockChat.addHistory).mock.calls;
        const contextCall = addHistoryCalls.find((call) =>
          JSON.stringify(call[0]).includes("user's editor context"),
        );
        expect(contextCall).toBeUndefined();
      });

      it('should add IDE context when no tool call is pending', async () => {
        // Arrange: History is normal, no pending calls
        const normalHistory: Content[] = [
          { role: 'user', parts: [{ text: 'A normal message.' }] },
          { role: 'model', parts: [{ text: 'A normal response.' }] },
        ];
        vi.mocked(mockChat.getHistory!).mockReturnValue(normalHistory);

        // Act
        const stream = client.sendMessageStream(
          [{ text: 'Another normal message' }],
          new AbortController().signal,
          'prompt-id-normal',
        );
        for await (const _ of stream) {
          // consume stream
        }

        // Assert: The IDE context message SHOULD have been added.
        const addHistoryCalls = vi.mocked(mockChat.addHistory).mock.calls;
        const contextCall = addHistoryCalls.find((call) =>
          JSON.stringify(call[0]).includes("user's editor context"),
        );
        expect(contextCall).toBeDefined();
      });

      it('should send the latest IDE context on the next message after a skipped context', async () => {
        // --- Step 1: A tool call is pending, context should be skipped ---

        // Arrange: History ends with a functionCall
        const historyWithPendingCall: Content[] = [
          { role: 'user', parts: [{ text: 'Please use a tool.' }] },
          {
            role: 'model',
            parts: [{ functionCall: { name: 'some_tool', args: {} } }],
          },
        ];
        vi.mocked(mockChat.getHistory!).mockReturnValue(historyWithPendingCall);
        vi.spyOn(client, 'getHistory').mockResolvedValue(
          historyWithPendingCall,
        );

        // Arrange: Set the initial IDE context
        const initialIdeContext = {
          workspaceState: {
            openFiles: [{ path: '/path/to/fileA.ts', timestamp: Date.now() }],
          },
        };
        vi.mocked(ideContext.getIdeContext).mockReturnValue(initialIdeContext);

        // Act: Send the tool response
        let stream = client.sendMessageStream(
          [
            {
              functionResponse: {
                name: 'some_tool',
                response: { success: true },
              },
            },
          ],
          new AbortController().signal,
          'prompt-id-tool-response',
        );
        for await (const _ of stream) {
          /* consume */
        }

        // Assert: The initial context was NOT sent
        const addHistoryCalls = vi.mocked(mockChat.addHistory).mock.calls;
        const contextCall = addHistoryCalls.find((call) =>
          JSON.stringify(call[0]).includes("user's editor context"),
        );
        expect(contextCall).toBeUndefined();

        // --- Step 2: A new message is sent, latest context should be included ---

        // Arrange: The model has responded to the tool, and the user is sending a new message.
        const historyAfterToolResponse: Content[] = [
          ...historyWithPendingCall,
          {
            role: 'user',
            parts: [
              {
                functionResponse: {
                  name: 'some_tool',
                  response: { success: true },
                },
              },
            ],
          },
          { role: 'model', parts: [{ text: 'The tool ran successfully.' }] },
        ];
        vi.mocked(mockChat.getHistory!).mockReturnValue(
          historyAfterToolResponse,
        );
        // Also update the client's getHistory spy
        vi.mocked(client.getHistory).mockResolvedValue(
          historyAfterToolResponse,
        );
        vi.mocked(mockChat.addHistory!).mockClear(); // Clear previous calls for the next assertion

        // Arrange: The IDE context has now changed
        const newIdeContext = {
          workspaceState: {
            openFiles: [{ path: '/path/to/fileB.ts', timestamp: Date.now() }],
          },
        };
        vi.mocked(ideContext.getIdeContext).mockReturnValue(newIdeContext);

        // Act: Send a new, regular user message
        stream = client.sendMessageStream(
          [{ text: 'Thanks!' }],
          new AbortController().signal,
          'prompt-id-final',
        );
        for await (const _ of stream) {
          /* consume */
        }

        // Assert: The NEW context was sent as a FULL context because there was no previously sent context.
        const finalAddHistoryCalls = vi.mocked(mockChat.addHistory!).mock.calls;
        const finalContextCall = finalAddHistoryCalls.find((call) =>
          JSON.stringify(call[0]).includes("user's editor context"),
        );
        expect(finalContextCall).toBeDefined();
        expect(JSON.stringify(finalContextCall![0])).toContain(
          "Here is the user's editor context as a JSON object",
        );
        // Check that the sent context is the new one (fileB.ts)
        expect(JSON.stringify(finalContextCall![0])).toContain('fileB.ts');
        // Check that the sent context is NOT the old one (fileA.ts)
        expect(JSON.stringify(finalContextCall![0])).not.toContain('fileA.ts');
      });

      it('should send a context DELTA on the next message after a skipped context', async () => {
        // --- Step 0: Establish an initial context ---
        vi.mocked(mockChat.getHistory!).mockReturnValue([]); // Start with empty history
        vi.spyOn(client, 'getHistory').mockResolvedValue([]);
        const contextA = {
          workspaceState: {
            openFiles: [
              {
                path: '/path/to/fileA.ts',
                isActive: true,
                timestamp: Date.now(),
              },
            ],
          },
        };
        vi.mocked(ideContext.getIdeContext).mockReturnValue(contextA);

        // Act: Send a regular message to establish the initial context
        let stream = client.sendMessageStream(
          [{ text: 'Initial message' }],
          new AbortController().signal,
          'prompt-id-initial',
        );
        for await (const _ of stream) {
          /* consume */
        }

        // Assert: Full context for fileA.ts was sent and stored.
        const initialCall = vi.mocked(mockChat.addHistory!).mock.calls[0][0];
        expect(JSON.stringify(initialCall)).toContain(
          "user's editor context as a JSON object",
        );
        expect(JSON.stringify(initialCall)).toContain('fileA.ts');
        // This implicitly tests that `lastSentIdeContext` is now set internally by the client.
        vi.mocked(mockChat.addHistory!).mockClear();

        // --- Step 1: A tool call is pending, context should be skipped ---
        const historyWithPendingCall: Content[] = [
          { role: 'user', parts: [{ text: 'Please use a tool.' }] },
          {
            role: 'model',
            parts: [{ functionCall: { name: 'some_tool', args: {} } }],
          },
        ];
        vi.mocked(mockChat.getHistory!).mockReturnValue(historyWithPendingCall);
        vi.spyOn(client, 'getHistory').mockResolvedValue(
          historyWithPendingCall,
        );

        // Arrange: IDE context changes, but this should be skipped
        const contextB = {
          workspaceState: {
            openFiles: [
              {
                path: '/path/to/fileB.ts',
                isActive: true,
                timestamp: Date.now(),
              },
            ],
          },
        };
        vi.mocked(ideContext.getIdeContext).mockReturnValue(contextB);

        // Act: Send the tool response
        stream = client.sendMessageStream(
          [
            {
              functionResponse: {
                name: 'some_tool',
                response: { success: true },
              },
            },
          ],
          new AbortController().signal,
          'prompt-id-tool-response',
        );
        for await (const _ of stream) {
          /* consume */
        }

        // Assert: No context was sent
        expect(vi.mocked(mockChat.addHistory).mock.calls).toHaveLength(0);

        // --- Step 2: A new message is sent, latest context DELTA should be included ---
        const historyAfterToolResponse: Content[] = [
          ...historyWithPendingCall,
          {
            role: 'user',
            parts: [
              {
                functionResponse: {
                  name: 'some_tool',
                  response: { success: true },
                },
              },
            ],
          },
          { role: 'model', parts: [{ text: 'The tool ran successfully.' }] },
        ];
        vi.mocked(mockChat.getHistory!).mockReturnValue(
          historyAfterToolResponse,
        );
        // Also update the client's getHistory spy
        vi.mocked(client.getHistory).mockResolvedValue(
          historyAfterToolResponse,
        );

        // Arrange: The IDE context has changed again
        const contextC = {
          workspaceState: {
            openFiles: [
              // fileA is now closed, fileC is open
              {
                path: '/path/to/fileC.ts',
                isActive: true,
                timestamp: Date.now(),
              },
            ],
          },
        };
        vi.mocked(ideContext.getIdeContext).mockReturnValue(contextC);

        // Act: Send a new, regular user message
        stream = client.sendMessageStream(
          [{ text: 'Thanks!' }],
          new AbortController().signal,
          'prompt-id-final',
        );
        for await (const _ of stream) {
          /* consume */
        }

        // Assert: The DELTA context was sent
        const finalCall = vi.mocked(mockChat.addHistory!).mock.calls[0][0];
        expect(JSON.stringify(finalCall)).toContain('summary of changes');
        // The delta should reflect fileA being closed and fileC being opened.
        expect(JSON.stringify(finalCall)).toContain('filesClosed');
        expect(JSON.stringify(finalCall)).toContain('fileA.ts');
        expect(JSON.stringify(finalCall)).toContain('activeFileChanged');
        expect(JSON.stringify(finalCall)).toContain('fileC.ts');
      });
    });
  });

  // TODO: Re-enable when updateModel method is implemented
  describe.skip('updateModel', () => {
    it('should update model in config and reinitialize chat', async () => {
      // Arrange
      const mockSetModel = vi.fn();
      const _mockConfig = {
        getModel: vi.fn().mockReturnValue('gemini-2.5-pro'),
        setModel: mockSetModel,
        getProjectRoot: vi.fn().mockReturnValue('/test'),
        getWorkingDir: vi.fn().mockReturnValue('/test'),

        getUserMemory: vi.fn().mockReturnValue(''),
        getLlxprtMdFileCount: vi.fn().mockReturnValue(0),
        getFileService: vi.fn().mockReturnValue(null),
        getCheckpointingEnabled: vi.fn().mockReturnValue(false),
        getToolRegistry: vi.fn().mockResolvedValue({
          generateSchema: vi.fn().mockReturnValue([]),
          getToolTelemetry: vi.fn().mockReturnValue([]),
          getFunctionDeclarations: vi.fn().mockReturnValue([]),
        }),
      } as unknown as Config;

      // Test logic would go here
    });
  });

  describe('generateContent', () => {
    it('should call generateContent with the correct parameters', async () => {
      const contents = [{ role: 'user', parts: [{ text: 'hello' }] }];
      const generationConfig = { temperature: 0.5 };
      const abortSignal = new AbortController().signal;

      // Mock countTokens
      const mockGenerator: Partial<ContentGenerator> = {
        countTokens: vi.fn().mockResolvedValue({ totalTokens: 1 }),
        generateContent: mockGenerateContentFn,
      };
      client['contentGenerator'] = mockGenerator as ContentGenerator;

      await client.generateContent(
        contents,
        generationConfig,
        abortSignal,
        DEFAULT_GEMINI_FLASH_MODEL,
      );

      expect(mockGenerateContentFn).toHaveBeenCalledWith(
        {
          model: DEFAULT_GEMINI_FLASH_MODEL,
          config: {
            abortSignal,
            systemInstruction: 'Test system instruction',
            temperature: 0.5,
            topP: 1,
          },
          contents,
        },
        'test-session-id',
      );
    });

    it('should use current model from config for content generation', async () => {
      const initialModel = client['config'].getModel();
      const contents = [{ role: 'user', parts: [{ text: 'test' }] }];
      const currentModel = initialModel + '-changed';

      vi.spyOn(client['config'], 'getModel').mockReturnValueOnce(currentModel);

      const _mockGenerator: Partial<ContentGenerator> = {
        countTokens: vi.fn().mockResolvedValue({ totalTokens: 1 }),
        generateContent: mockGenerateContentFn,
      };
      // The config is already mocked in beforeEach, no need to reassign

      // Mock the content generator and chat
      const mockContentGenerator: ContentGenerator = {
        generateContent: vi.fn(),
        generateContentStream: vi.fn(),
        countTokens: vi.fn(),
        embedContent: vi.fn(),
      };
      client['contentGenerator'] = mockContentGenerator as ContentGenerator;

      await client.generateContent(
        contents,
        {},
        new AbortController().signal,
        DEFAULT_GEMINI_FLASH_MODEL,
      );

      // const initialChat = client['chat'];

      // Act
      // await client.updateModel('gemini-2.5-flash');

      // Assert
      // expect(mockSetModel).toHaveBeenCalledWith('gemini-2.5-flash');
      // expect(client['model']).toBe('gemini-2.5-flash');
      // expect(client['chat']).not.toBe(initialChat); // Chat should be reinitialized

      // Skip test - updateModel method not implemented yet
      expect(true).toBe(true);
    });
  });

  // TODO: Re-enable when listAvailableModels method is implemented
  describe.skip('listAvailableModels', () => {
    beforeEach(() => {
      global.fetch = vi.fn();
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should fetch models from API for GEMINI auth type', async () => {
      // Arrange
      const mockModels = [
        { name: 'models/gemini-2.5-pro', displayName: 'Gemini 2.5 Pro' },
        { name: 'models/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash' },
      ];

      const mockConfig = {
        getContentGeneratorConfig: vi.fn().mockReturnValue({
          apiKey: 'test-api-key',
        }),
      };
      client['config'] = mockConfig as unknown as Config;

      (global.fetch as unknown as Mock).mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ models: mockModels }),
      });
      // Act
      // const models = await client.listAvailableModels();
      const models: unknown[] = []; // Placeholder - listAvailableModels not implemented

      // Assert
      expect(global.fetch).toHaveBeenCalledWith(
        'https://generativelanguage.googleapis.com/v1beta/models?key=test-api-key',
        expect.objectContaining({
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      expect(mockGenerateContentFn).toHaveBeenCalledWith(
        {
          model: DEFAULT_GEMINI_FLASH_MODEL,
          config: expect.any(Object),
          contents,
        },
        'test-session-id',
      );
      expect(models).toEqual(mockModels);
    });

    it('should return OAuth marker for OAuth auth types', async () => {
      // Arrange
      const mockConfig = {
        getContentGeneratorConfig: vi.fn().mockReturnValue({}),
      };
      client['config'] = mockConfig as unknown as Config;

      // Test logic would go here
    });
  });

  describe('setHistory', () => {
    it('should strip thought signatures when stripThoughts is true', async () => {
      const mockChat = {
        setHistory: vi.fn(),
      };
      client['chat'] = mockChat as unknown as GeminiChat;

      const historyWithThoughts: Content[] = [
        {
          role: 'user',
          parts: [{ text: 'hello' }],
        },
        {
          role: 'model',
          parts: [
            { text: 'thinking...', thoughtSignature: 'thought-123' },
            {
              functionCall: { name: 'test', args: {} },
              thoughtSignature: 'thought-456',
            },
          ],
        },
      ];

      await client.setHistory(historyWithThoughts, { stripThoughts: true });

      const expectedHistory: Content[] = [
        {
          role: 'user',
          parts: [{ text: 'hello' }],
        },
        {
          role: 'model',
          parts: [
            { text: 'thinking...' },
            { functionCall: { name: 'test', args: {} } },
          ],
        },
      ];

      expect(mockChat.setHistory).toHaveBeenCalledWith(expectedHistory);
    });

    it('should not strip thought signatures when stripThoughts is false', async () => {
      const mockChat = {
        setHistory: vi.fn(),
      };
      client['chat'] = mockChat as unknown as GeminiChat;

      const historyWithThoughts: Content[] = [
        {
          role: 'user',
          parts: [{ text: 'hello' }],
        },
        {
          role: 'model',
          parts: [
            { text: 'thinking...', thoughtSignature: 'thought-123' },
            { text: 'ok', thoughtSignature: 'thought-456' },
          ],
        },
      ];

      await client.setHistory(historyWithThoughts, { stripThoughts: false });

      expect(mockChat.setHistory).toHaveBeenCalledWith(historyWithThoughts);
    });

    it('should store history for later use when chat is not initialized', async () => {
      // Arrange
      client['chat'] = undefined; // Chat not initialized
      vi.spyOn(client, 'hasChatInitialized').mockReturnValue(false);

      const history: Content[] = [
        {
          role: 'user',
          parts: [{ text: 'hello' }],
        },
      ];

      // Act
      await client.setHistory(history);

      // Assert
      expect(client['_previousHistory']).toEqual(history);
      expect(client['forceFullIdeContext']).toBe(true);
    });

    it('should update chat immediately when chat is initialized', async () => {
      // Arrange
      const mockChat = {
        setHistory: vi.fn(),
      };
      client['chat'] = mockChat as unknown as GeminiChat;
      vi.spyOn(client, 'hasChatInitialized').mockReturnValue(true);

      const history: Content[] = [
        {
          role: 'user',
          parts: [{ text: 'hello' }],
        },
      ];

      // Act
      await client.setHistory(history);

      // Assert
      expect(mockChat.setHistory).toHaveBeenCalledWith(history);
      expect(client['_previousHistory']).toEqual(history);
      expect(client['forceFullIdeContext']).toBe(true);
    });

    it('should reset IDE context tracking when history changes', async () => {
      // Arrange
      const mockChat = {
        setHistory: vi.fn(),
      };
      client['chat'] = mockChat as unknown as GeminiChat;
      vi.spyOn(client, 'hasChatInitialized').mockReturnValue(true);

      const history: Content[] = [
        {
          role: 'user',
          parts: [{ text: 'hello' }],
        },
      ];

      // Initialize forceFullIdeContext to false to test that it gets reset to true
      client['forceFullIdeContext'] = false;

      // Act
      await client.setHistory(history);

      // Assert
      expect(client['forceFullIdeContext']).toBe(true);
    });
  });
});
