/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * AgentClient lifecycle tests: setHistory, interactionMode wiring.
 * Sibling to client.test.ts (split to avoid file-level max-lines disable).
 */

import { automock, assertDefined } from '@vybestack/llxprt-code-test-utils';
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from 'bun:test';
import { AgentClient } from './client.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';
import { MediaAdmissionService } from '@vybestack/llxprt-code-core/storage/media-admission-service.js';
import { getCoreSystemPromptAsync } from '@vybestack/llxprt-code-core/core/prompts.js';
import type { ContentGenerator } from '@vybestack/llxprt-code-core/core/contentGenerator.js';
import type { ChatSession } from './chatSession.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
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
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'agent-client-lifecycle-'));
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
    await rm(directory, { recursive: true, force: true });
  });

  describe('setHistory', () => {
    it('should strip thought signatures when stripThoughts is true', async () => {
      let retainedHistory: readonly IContent[] = [];
      const mockChat = {
        async setHistory(history: readonly IContent[]): Promise<void> {
          retainedHistory = history;
        },
        getHistory(): readonly IContent[] {
          return retainedHistory;
        },
        async clearHistory(): Promise<void> {
          retainedHistory = [];
        },
      };
      client['chat'] = mockChat as unknown as ChatSession;

      const historyWithThoughts: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'hello' }],
        },
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'thinking',
              thought: 'thinking...',
              signature: 'thought-123',
            },
            {
              type: 'tool_call',
              id: '',
              name: 'test',
              parameters: {},
            },
          ],
        },
      ];

      await client.setHistory(historyWithThoughts, { stripThoughts: true });

      const expectedHistory: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'hello' }],
        },
        {
          speaker: 'ai',
          blocks: [
            { type: 'thinking', thought: 'thinking...' },
            { type: 'tool_call', id: '', name: 'test', parameters: {} },
          ],
        },
      ];

      expect(retainedHistory).toStrictEqual(expectedHistory);
    });

    it('should not strip thought signatures when stripThoughts is false', async () => {
      let retainedHistory: readonly IContent[] = [];
      const mockChat = {
        async setHistory(history: readonly IContent[]): Promise<void> {
          retainedHistory = history;
        },
        getHistory(): readonly IContent[] {
          return retainedHistory;
        },
        async clearHistory(): Promise<void> {
          retainedHistory = [];
        },
      };
      client['chat'] = mockChat as unknown as ChatSession;

      const historyWithThoughts: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'hello' }],
        },
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'thinking',
              thought: 'thinking...',
              signature: 'thought-123',
            },
            {
              type: 'thinking',
              thought: 'ok',
              signature: 'thought-456',
            },
          ],
        },
      ];

      await client.setHistory(historyWithThoughts, { stripThoughts: false });

      expect(retainedHistory).toStrictEqual(historyWithThoughts);
    });

    it('returns history from a stored history service after profile invalidation', async () => {
      const history: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'remember issue 2049' }],
        },
        {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'we are preserving history' }],
        },
      ];
      const historyService = new HistoryService();
      for (const content of history) {
        historyService.add(content, 'test-model');
      }
      client['_storedHistoryService'] = historyService;
      client['_previousHistory'] = undefined;
      client['chat'] = undefined;
      client.getHistory = AgentClient.prototype.getHistory.bind(client);

      const result = await client.getHistory();
      // Compare block-level content, ignoring metadata (turnId etc.) added by
      // the HistoryService that are not part of the test's input data.
      expect(result).toHaveLength(history.length);
      for (let i = 0; i < history.length; i++) {
        expect(result[i].speaker).toBe(history[i].speaker);
        expect(result[i].blocks).toStrictEqual(history[i].blocks);
      }
    });

    it('should update chat immediately when chat is initialized', async () => {
      // Arrange
      let retainedHistory: readonly IContent[] = [];
      const mockChat = {
        async setHistory(history: readonly IContent[]): Promise<void> {
          retainedHistory = history;
        },
        getHistory(): readonly IContent[] {
          return retainedHistory;
        },
        async clearHistory(): Promise<void> {
          retainedHistory = [];
        },
      };
      client['chat'] = mockChat as unknown as ChatSession;

      const history: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'hello' }],
        },
      ];

      // Act
      await client.setHistory(history);

      // Assert
      expect(retainedHistory).toStrictEqual(history);
      expect(client['_previousHistory']).toStrictEqual(history);
      expect(client['ideContextTracker']['forceFullIdeContext']).toBe(true);
    });

    it('should reset IDE context tracking when history changes', async () => {
      // Arrange
      let retainedHistory: readonly IContent[] = [];
      const mockChat = {
        async setHistory(history: readonly IContent[]): Promise<void> {
          retainedHistory = history;
        },
        getHistory(): readonly IContent[] {
          return retainedHistory;
        },
        async clearHistory(): Promise<void> {
          retainedHistory = [];
        },
      };
      client['chat'] = mockChat as unknown as ChatSession;

      const history: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'hello' }],
        },
      ];

      // Initialize forceFullIdeContext to false to test that it gets reset to true
      client['ideContextTracker']['forceFullIdeContext'] = false;

      // Act
      await client.setHistory(history);

      // Assert
      expect(retainedHistory).toStrictEqual(history);
      expect(client['ideContextTracker']['forceFullIdeContext']).toBe(true);
    });
  });

  describe('restoreHistory media admission lifecycle', () => {
    it('releases restored-history media when adding admitted history fails', async () => {
      const directory = await mkdtemp(
        join(tmpdir(), 'client-restore-history-'),
      );
      try {
        const store = new LocalMediaStore({
          rootDirectory: join(directory, 'media'),
          quotaBytes: 1024 * 1024,
        });
        client['config'].getLocalMediaStore = () => store;
        const initializedChat = client['chat'];
        assertDefined(initializedChat, 'Expected chat');
        const historyService = new HistoryService();
        historyService.replaceBatch = async () => {
          throw new Error('history add failed');
        };
        initializedChat.getHistoryService = () => historyService;
        const mediaHistory: IContent[] = [
          {
            speaker: 'human',
            blocks: [
              {
                type: 'media',
                mimeType: 'image/png',
                encoding: 'base64',
                data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=',
              },
            ],
          },
        ];

        await expect(client.restoreHistory(mediaHistory)).rejects.toThrow(
          'history add failed',
        );

        const admission = new MediaAdmissionService(store);
        const probe = await admission.admitContents(mediaHistory, {
          turnId: 'probe',
          source: 'probe',
        });
        const block = probe[0]?.blocks[0];
        if (block.type !== 'media' || block.encoding !== 'reference') {
          throw new Error('Expected probe media reference');
        }
        await admission.releaseContents(probe, {
          turnId: 'probe',
          source: 'probe',
        });
        expect(await store.hasReservations(block.contentId)).toBe(false);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
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
        getMcpInstructions: () => unknown;
        isInteractive: () => boolean;
      };
      vi.spyOn(config, 'getUserMemory').mockReturnValue('');
      vi.spyOn(config, 'getCoreMemory').mockReturnValue('');
      vi.spyOn(config, 'getMcpInstructions').mockReturnValue(undefined);
      vi.spyOn(config, 'isInteractive').mockReturnValue(true);

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
      ).mockResolvedValue('prompt');

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
        getMcpInstructions: () => unknown;
        isInteractive: () => boolean;
      };
      vi.spyOn(config, 'getUserMemory').mockReturnValue('');
      vi.spyOn(config, 'getCoreMemory').mockReturnValue('');
      vi.spyOn(config, 'getMcpInstructions').mockReturnValue(undefined);
      vi.spyOn(config, 'isInteractive').mockReturnValue(false);

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
      ).mockResolvedValue('prompt');

      await client.updateSystemInstruction();

      expect(getCoreSystemPromptAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          interactionMode: 'non-interactive',
        }),
      );
    });
  });
});
