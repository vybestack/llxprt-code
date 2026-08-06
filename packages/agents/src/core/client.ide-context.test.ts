/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * sendMessageStream: IDE context with pending tool calls.
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
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';

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
  });

  afterEach(() => {
    client.dispose();
    vi.restoreAllMocks();
  });

  describe('sendMessageStream', () => {
    describe('IDE context with pending tool calls', () => {
      let mockChat: Partial<ChatSession>;

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
          getProjectedPromptBaseline: vi.fn().mockReturnValue(0),
          getContextLimit: vi.fn().mockReturnValue(1000000),
        };
        client['chat'] = mockChat as ChatSession;

        const mockGenerator: Partial<ContentGenerator> = {
          countTokens: vi.fn().mockResolvedValue({ totalTokens: 0 }),
        };
        client['contentGenerator'] = mockGenerator as ContentGenerator;

        vi.spyOn(client['config'], 'getIdeMode').mockReturnValue(true);
        (
          ideContext.getIdeContext as Mock<typeof ideContext.getIdeContext>
        ).mockReturnValue({
          workspaceState: {
            openFiles: [{ path: '/path/to/file.ts', timestamp: Date.now() }],
          },
        });
      });

      it('should NOT add IDE context when a tool call is pending', async () => {
        // Arrange: History ends with a tool_call from the model
        const historyWithPendingCall: IContent[] = [
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'Please use a tool.' }],
          },
          {
            speaker: 'ai',
            blocks: [
              {
                type: 'tool_call',
                id: '',
                name: 'some_tool',
                parameters: {},
              },
            ],
          },
        ];
        (
          mockChat.getHistory! as Mock<typeof mockChat.getHistory>
        ).mockReturnValue(historyWithPendingCall);
        // Also spy on the client's getHistory to ensure it returns the right value
        vi.spyOn(client, 'getHistory').mockResolvedValue(
          historyWithPendingCall,
        );

        // Act: Simulate sending the tool's response back
        const stream = client.sendMessageStream(
          [
            {
              type: 'tool_response',
              callId: 'some_tool',
              toolName: 'some_tool',
              result: { success: true },
            },
          ],
          new AbortController().signal,
          'prompt-id-tool-response',
        );
        for await (const _ of stream) {
          // consume stream to complete the call
        }

        // Assert: The IDE context message should NOT have been added to the history.
        const addHistoryCalls = (
          mockChat.addHistory as Mock<typeof mockChat.addHistory>
        ).mock.calls;
        const contextCall = addHistoryCalls.find((call) =>
          JSON.stringify(call[0]).includes("user's editor context"),
        );
        expect(contextCall).toBeUndefined();
      });

      it('should add IDE context when no tool call is pending', async () => {
        // Arrange: History is normal, no pending calls
        const normalHistory: IContent[] = [
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'A normal message.' }],
          },
          {
            speaker: 'ai',
            blocks: [{ type: 'text', text: 'A normal response.' }],
          },
        ];
        (
          mockChat.getHistory! as Mock<typeof mockChat.getHistory>
        ).mockReturnValue(normalHistory);
        vi.spyOn(client, 'getHistory').mockResolvedValue(normalHistory);

        // Act
        const stream = client.sendMessageStream(
          [{ type: 'text', text: 'Another normal message' }],
          new AbortController().signal,
          'prompt-id-normal',
        );
        for await (const _ of stream) {
          // consume stream
        }

        // Assert: The IDE context message SHOULD have been added.
        const addHistoryCalls = (
          mockChat.addHistory as Mock<typeof mockChat.addHistory>
        ).mock.calls;
        const contextCall = addHistoryCalls.find((call) =>
          JSON.stringify(call[0]).includes("user's editor context"),
        );
        expect(contextCall).toBeDefined();
      });

      it('should send the latest IDE context on the next message after a skipped context', async () => {
        // --- Step 1: A tool call is pending, context should be skipped ---

        // Arrange: History ends with a tool_call
        const historyWithPendingCall: IContent[] = [
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'Please use a tool.' }],
          },
          {
            speaker: 'ai',
            blocks: [
              {
                type: 'tool_call',
                id: '',
                name: 'some_tool',
                parameters: {},
              },
            ],
          },
        ];
        (
          mockChat.getHistory! as Mock<typeof mockChat.getHistory>
        ).mockReturnValue(historyWithPendingCall);
        vi.spyOn(client, 'getHistory').mockResolvedValue(
          historyWithPendingCall,
        );

        // Arrange: Set the initial IDE context
        const initialIdeContext = {
          workspaceState: {
            openFiles: [{ path: '/path/to/fileA.ts', timestamp: Date.now() }],
          },
        };
        (
          ideContext.getIdeContext as Mock<typeof ideContext.getIdeContext>
        ).mockReturnValue(initialIdeContext);

        // Act: Send the tool response
        let stream = client.sendMessageStream(
          [
            {
              type: 'tool_response',
              callId: 'some_tool',
              toolName: 'some_tool',
              result: { success: true },
            },
          ],
          new AbortController().signal,
          'prompt-id-tool-response',
        );
        for await (const _ of stream) {
          /* consume */
        }

        // Assert: The initial context was NOT sent
        const addHistoryCalls = (
          mockChat.addHistory as Mock<typeof mockChat.addHistory>
        ).mock.calls;
        const contextCall = addHistoryCalls.find((call) =>
          JSON.stringify(call[0]).includes("user's editor context"),
        );
        expect(contextCall).toBeUndefined();

        // --- Step 2: A new message is sent, latest context should be included ---

        // Arrange: The model has responded to the tool, and the user is sending a new message.
        const historyAfterToolResponse: IContent[] = [
          ...historyWithPendingCall,
          {
            speaker: 'tool',
            blocks: [
              {
                type: 'tool_response',
                callId: 'some_tool',
                toolName: 'some_tool',
                result: { success: true },
              },
            ],
          },
          {
            speaker: 'ai',
            blocks: [{ type: 'text', text: 'The tool ran successfully.' }],
          },
        ];
        (
          mockChat.getHistory! as Mock<typeof mockChat.getHistory>
        ).mockReturnValue(historyAfterToolResponse);
        // Also update the client's getHistory spy
        (client.getHistory as Mock<typeof client.getHistory>).mockResolvedValue(
          historyAfterToolResponse,
        );
        (mockChat.addHistory! as Mock<typeof mockChat.addHistory>).mockClear(); // Clear previous calls for the next assertion

        // Arrange: The IDE context has now changed
        const newIdeContext = {
          workspaceState: {
            openFiles: [{ path: '/path/to/fileB.ts', timestamp: Date.now() }],
          },
        };
        (
          ideContext.getIdeContext as Mock<typeof ideContext.getIdeContext>
        ).mockReturnValue(newIdeContext);

        // Act: Send a new, regular user message
        stream = client.sendMessageStream(
          [{ type: 'text', text: 'Thanks!' }],
          new AbortController().signal,
          'prompt-id-final',
        );
        for await (const _ of stream) {
          /* consume */
        }

        // Assert: The NEW context was sent as a FULL context because there was no previously sent context.
        const finalAddHistoryCalls = (
          mockChat.addHistory! as Mock<typeof mockChat.addHistory>
        ).mock.calls;
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
        (
          mockChat.getHistory! as Mock<typeof mockChat.getHistory>
        ).mockReturnValue([]); // Start with empty history
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
        (
          ideContext.getIdeContext as Mock<typeof ideContext.getIdeContext>
        ).mockReturnValue(contextA);

        // Act: Send a regular message to establish the initial context
        let stream = client.sendMessageStream(
          [{ type: 'text', text: 'Initial message' }],
          new AbortController().signal,
          'prompt-id-initial',
        );
        for await (const _ of stream) {
          /* consume */
        }

        // Assert: Full context for fileA.ts was sent and stored.
        const initialCall = (
          mockChat.addHistory! as Mock<typeof mockChat.addHistory>
        ).mock.calls[0][0];
        expect(JSON.stringify(initialCall)).toContain(
          "user's editor context as a JSON object",
        );
        expect(JSON.stringify(initialCall)).toContain('fileA.ts');
        // This implicitly tests that `lastSentIdeContext` is now set internally by the client.
        (mockChat.addHistory! as Mock<typeof mockChat.addHistory>).mockClear();

        // --- Step 1: A tool call is pending, context should be skipped ---
        const historyWithPendingCall: IContent[] = [
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'Please use a tool.' }],
          },
          {
            speaker: 'ai',
            blocks: [
              {
                type: 'tool_call',
                id: '',
                name: 'some_tool',
                parameters: {},
              },
            ],
          },
        ];
        (
          mockChat.getHistory! as Mock<typeof mockChat.getHistory>
        ).mockReturnValue(historyWithPendingCall);
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
        (
          ideContext.getIdeContext as Mock<typeof ideContext.getIdeContext>
        ).mockReturnValue(contextB);

        // Act: Send the tool response
        stream = client.sendMessageStream(
          [
            {
              type: 'tool_response',
              callId: 'some_tool',
              toolName: 'some_tool',
              result: { success: true },
            },
          ],
          new AbortController().signal,
          'prompt-id-tool-response',
        );
        for await (const _ of stream) {
          /* consume */
        }

        // Assert: No context was sent
        expect(
          (mockChat.addHistory as Mock<typeof mockChat.addHistory>).mock.calls,
        ).toHaveLength(0);

        // --- Step 2: A new message is sent, latest context DELTA should be included ---
        const historyAfterToolResponse: IContent[] = [
          ...historyWithPendingCall,
          {
            speaker: 'tool',
            blocks: [
              {
                type: 'tool_response',
                callId: 'some_tool',
                toolName: 'some_tool',
                result: { success: true },
              },
            ],
          },
          {
            speaker: 'ai',
            blocks: [{ type: 'text', text: 'The tool ran successfully.' }],
          },
        ];
        (
          mockChat.getHistory! as Mock<typeof mockChat.getHistory>
        ).mockReturnValue(historyAfterToolResponse);
        // Also update the client's getHistory spy
        (client.getHistory as Mock<typeof client.getHistory>).mockResolvedValue(
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
        (
          ideContext.getIdeContext as Mock<typeof ideContext.getIdeContext>
        ).mockReturnValue(contextC);

        // Act: Send a new, regular user message
        stream = client.sendMessageStream(
          [{ type: 'text', text: 'Thanks!' }],
          new AbortController().signal,
          'prompt-id-final',
        );
        for await (const _ of stream) {
          /* consume */
        }

        // Assert: The DELTA context was sent
        const finalCall = (
          mockChat.addHistory! as Mock<typeof mockChat.addHistory>
        ).mock.calls[0][0];
        expect(JSON.stringify(finalCall)).toContain('summary of changes');
        // The delta should reflect fileA being closed and fileC being opened.
        expect(JSON.stringify(finalCall)).toContain('filesClosed');
        expect(JSON.stringify(finalCall)).toContain('fileA.ts');
        expect(JSON.stringify(finalCall)).toContain('activeFileChanged');
        expect(JSON.stringify(finalCall)).toContain('fileC.ts');
      });
    });
  });
});
