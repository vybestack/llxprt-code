/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * sendMessageStream: Editor context delta behaviors.
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
} from '../testApi.js';
import { AgentClient } from './client.js';
import type { ContentGenerator } from '@vybestack/llxprt-code-core/core/contentGenerator.js';
import type { ChatSession } from './chatSession.js';
import { ideContext } from '@vybestack/llxprt-code-ide-integration';
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
void vi.mock('@vybestack/llxprt-code-tools', () => {
  return {
    ...actual,
    LocalTodoStore: mockTodoStoreConstructor,
  };
});
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
void vi.mock('@vybestack/llxprt-code-core/utils/getFolderStructure.js', () => ({
  getFolderStructure: vi.fn().mockResolvedValue('Mock Folder Structure'),
}));
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
void vi.mock('@vybestack/llxprt-code-ide-integration', () => {
  return {
    ...actual3,
    ideContext: {
      ...actual3.ideContext,
      getIdeContext: vi.fn(),
      subscribeToIdeContext: vi.fn(),
      setIdeContext: vi.fn(),
      clearIdeContext: vi.fn(),
    },
  };
});
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

describe('Agent Client (client.ts)', () => {
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
    describe('Editor context delta', () => {
      const mockStream = (async function* () {
        yield { type: 'content', value: 'Hello' };
      })();

      beforeEach(() => {
        // Reset the ideContextTracker so it is in "delta mode" (not forced full)
        // by calling recordSentContext with a dummy context
        client['ideContextTracker']['forceFullIdeContext'] = false;
        vi.spyOn(client['config'], 'getIdeMode').mockReturnValue(true);
        mockTurnRunFn.mockReturnValue(mockStream);

        const mockChat: Partial<ChatSession> = {
          addHistory: vi.fn(),
          setHistory: vi.fn(),
          sendMessage: vi.fn().mockResolvedValue({ text: 'summary' }),
          // Assume history is not empty for delta checks
          getHistory: vi.fn().mockReturnValue([
            {
              speaker: 'user',
              blocks: [{ type: 'text', text: 'previous message' }],
            },
          ]),
          getLastPromptTokenCount: vi.fn().mockReturnValue(0),
          getProjectedPromptBaseline: vi.fn().mockReturnValue(0),
          getContextLimit: vi.fn().mockReturnValue(1000000),
        };
        client['chat'] = mockChat as ChatSession;

        // Override the client.getHistory mock to return non-empty history for delta tests
        (client.getHistory as ReturnType<typeof vi.fn>).mockResolvedValue([
          {
            speaker: 'user',
            blocks: [{ type: 'text', text: 'previous message' }],
          },
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
          // Setup previous context (via ideContextTracker internal state)
          client['ideContextTracker']['lastSentIdeContext'] = {
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
          (
            ideContext.getIdeContext as Mock<typeof ideContext.getIdeContext>
          ).mockReturnValue({
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

          const addHistoryCalls = (
            mockChat.addHistory as Mock<typeof mockChat.addHistory>
          ).mock.calls;

          // Check for the appropriate context based on shouldSendContext flag
          const summaryCall = addHistoryCalls.find((call) =>
            JSON.stringify(call[0]).includes('summary of changes'),
          );
          const editorContextCall = addHistoryCalls.find((call) =>
            JSON.stringify(call[0]).includes('editor context'),
          );

          // Assert expectations based on the test case
          if (shouldSendContext === true) {
            expect(summaryCall).toBeDefined();
          } else {
            expect(editorContextCall).toBeUndefined();
          }
        },
      );

      it('sends full context when history is cleared, even if editor state is unchanged', async () => {
        const activeFile = {
          path: '/path/to/active/file.ts',
          cursor: { line: 5, character: 10 },
          selectedText: 'hello',
        };

        // Setup previous context (via ideContextTracker internal state)
        client['ideContextTracker']['lastSentIdeContext'] = {
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
        (
          ideContext.getIdeContext as Mock<typeof ideContext.getIdeContext>
        ).mockReturnValue({
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

        const addHistoryCalls = (
          mockChat.addHistory as Mock<typeof mockChat.addHistory>
        ).mock.calls;
        const contextCall = addHistoryCalls.find((call) =>
          JSON.stringify(call[0]).includes("user's editor context"),
        );
        expect(contextCall).toBeDefined();

        // Also verify it's the full context, not a delta.
        const call = contextCall![0];
        const textBlock = call.blocks.find(
          (b: { type: string }) => b.type === 'text',
        );
        const contextText = textBlock?.text;
        const contextJson = JSON.parse(
          contextText!.match(/```json\n(.*)\n```/s)![1],
        );
        expect(contextJson).toHaveProperty('activeFile');
        expect(contextJson.activeFile.path).toBe('/path/to/active/file.ts');
      });
    });
  });
});
