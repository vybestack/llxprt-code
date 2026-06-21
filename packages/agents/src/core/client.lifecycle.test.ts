/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * AgentClient lifecycle tests: setHistory, interactionMode wiring.
 * Sibling to client.test.ts (split to avoid file-level max-lines disable).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Content } from '@google/genai';
import { AgentClient } from './client.js';
import { getCoreSystemPromptAsync } from '@vybestack/llxprt-code-core/core/prompts.js';
import type { ContentGenerator } from '@vybestack/llxprt-code-core/core/contentGenerator.js';
import type { ChatSession } from './chatSession.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { ContentConverters } from '@vybestack/llxprt-code-core/services/history/ContentConverters.js';
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

  describe('setHistory', () => {
    it('should strip thought signatures when stripThoughts is true', async () => {
      const mockChat = {
        setHistory: vi.fn(),
      };
      client['chat'] = mockChat as unknown as ChatSession;

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
      client['chat'] = mockChat as unknown as ChatSession;

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
      expect(client['_previousHistory']).toStrictEqual(history);
      expect(client['ideContextTracker']['forceFullIdeContext']).toBe(true);
    });

    it('returns history from a stored history service after profile invalidation', async () => {
      const history: Content[] = [
        { role: 'user', parts: [{ text: 'remember issue 2049' }] },
        { role: 'model', parts: [{ text: 'we are preserving history' }] },
      ];
      const historyService = new HistoryService();
      for (const content of history) {
        historyService.add(ContentConverters.toIContent(content), 'test-model');
      }
      client['_storedHistoryService'] = historyService;
      client['_previousHistory'] = undefined;
      client['chat'] = undefined;
      client.getHistory = AgentClient.prototype.getHistory.bind(client);

      await expect(client.getHistory()).resolves.toStrictEqual(history);
    });

    it('should update chat immediately when chat is initialized', async () => {
      // Arrange
      const mockChat = {
        setHistory: vi.fn(),
      };
      client['chat'] = mockChat as unknown as ChatSession;
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
      expect(client['_previousHistory']).toStrictEqual(history);
      expect(client['ideContextTracker']['forceFullIdeContext']).toBe(true);
    });

    it('should reset IDE context tracking when history changes', async () => {
      // Arrange
      const mockChat = {
        setHistory: vi.fn(),
      };
      client['chat'] = mockChat as unknown as ChatSession;
      vi.spyOn(client, 'hasChatInitialized').mockReturnValue(true);

      const history: Content[] = [
        {
          role: 'user',
          parts: [{ text: 'hello' }],
        },
      ];

      // Initialize forceFullIdeContext to false to test that it gets reset to true
      client['ideContextTracker']['forceFullIdeContext'] = false;

      // Act
      await client.setHistory(history);

      // Assert
      expect(client['ideContextTracker']['forceFullIdeContext']).toBe(true);
    });
  });

  describe('interactionMode wiring', () => {
    it('passes interactionMode interactive when config.isInteractive() returns true', async () => {
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
        getMcpClientManager: () => unknown;
        isInteractive: () => boolean;
      };
      vi.spyOn(config, 'getUserMemory').mockReturnValue('');
      vi.spyOn(config, 'getCoreMemory').mockReturnValue('');
      vi.spyOn(config, 'getMcpClientManager').mockReturnValue(undefined);
      vi.spyOn(config, 'isInteractive').mockReturnValue(true);

      vi.mocked(getEnabledToolNamesForPrompt).mockReturnValue([]);
      vi.mocked(shouldIncludeSubagentDelegationForConfig).mockResolvedValue(
        false,
      );

      vi.mocked(getCoreSystemPromptAsync).mockResolvedValue('prompt');

      await client.updateSystemInstruction();

      expect(getCoreSystemPromptAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          interactionMode: 'interactive',
        }),
      );
    });

    it('passes interactionMode non-interactive when config.isInteractive() returns false', async () => {
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
        getMcpClientManager: () => unknown;
        isInteractive: () => boolean;
      };
      vi.spyOn(config, 'getUserMemory').mockReturnValue('');
      vi.spyOn(config, 'getCoreMemory').mockReturnValue('');
      vi.spyOn(config, 'getMcpClientManager').mockReturnValue(undefined);
      vi.spyOn(config, 'isInteractive').mockReturnValue(false);

      vi.mocked(getEnabledToolNamesForPrompt).mockReturnValue([]);
      vi.mocked(shouldIncludeSubagentDelegationForConfig).mockResolvedValue(
        false,
      );

      vi.mocked(getCoreSystemPromptAsync).mockResolvedValue('prompt');

      await client.updateSystemInstruction();

      expect(getCoreSystemPromptAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          interactionMode: 'non-interactive',
        }),
      );
    });
  });
});
