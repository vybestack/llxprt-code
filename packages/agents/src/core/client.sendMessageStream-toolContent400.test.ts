/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * sendMessageStream tests: HTTP 400 tool-content rejection recovery (issue #2722).
 * Sibling to client.sendMessageStream-errors.test.ts (the 413 suite), modelled
 * closely on its structure: same vi.mock preamble, same setupAgentClient helper.
 */

import { automock } from '@vybestack/llxprt-code-test-utils';
import { describe, it, expect, vi, beforeEach, afterEach } from '../testApi.js';
import { AgentClient } from './client.js';
import type { ChatSession } from './chatSession.js';
import { AgentEventType } from './turn.js';
import {
  fromAsync,
  setupAgentClient,
  type MockResponseShape,
} from './client-test-helpers.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';

const realConfigModule = {
  ...(await import('@vybestack/llxprt-code-core/config/config.js')),
};

const REJECTION_400_MESSAGE =
  "The image data you provided does not represent a valid image. Please check your input and try again with one of the supported image formats: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'].";

// Mock prompts module before imports
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

function makeChatMock(): Partial<ChatSession> {
  return {
    addHistory: vi.fn(),
    getHistory: vi.fn().mockReturnValue([]),
    getLastPromptTokenCount: vi.fn().mockReturnValue(0),
    getProjectedPromptBaseline: vi.fn().mockReturnValue(0),
    getContextLimit: vi.fn().mockReturnValue(1000000),
  };
}

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

  describe('sendMessageStream — tool-content 400 recovery', () => {
    beforeEach(() => {
      (
        client as unknown as {
          todoContinuationService: { todoToolsAvailable: boolean };
        }
      ).todoContinuationService.todoToolsAvailable = true;
    });

    it('AC1/AC4: injects an advice message and re-issues after a tool-content 400', async () => {
      vi.spyOn(client['config'], 'getContinueOnFailedApiCall').mockReturnValue(
        true,
      );
      const mockStream1 = (async function* () {
        yield {
          type: AgentEventType.Error,
          value: {
            error: { message: REJECTION_400_MESSAGE, status: 400 },
          },
        };
      })();
      const mockStream2 = (async function* () {
        yield { type: AgentEventType.Content, value: 'Retried content' };
      })();

      mockTurnRunFn
        .mockReturnValueOnce(mockStream1)
        .mockReturnValueOnce(mockStream2);

      client['chat'] = makeChatMock() as ChatSession;

      const initialRequest = [
        { type: 'text', text: 'Show me the shader file' },
        {
          type: 'tool_response',
          callId: 'read_file',
          toolName: 'read_file',
          result: { content: 'binary blob' },
        },
        {
          type: 'media',
          mimeType: 'image/png',
          data: 'AAA',
          encoding: 'base64',
          filename: 'shader.fh',
        },
      ];
      const signal = new AbortController().signal;

      const events = await fromAsync(
        client.sendMessageStream(initialRequest, signal, 'prompt-id-400-retry'),
      );

      // The error event is still emitted before recovery.
      expect(events).toStrictEqual([
        {
          type: AgentEventType.ModelInfo,
          value: {
            model: 'test-model',
            providerName: 'gemini',
            profileName: null,
            displayLabel: 'test-model',
          },
        },
        {
          type: AgentEventType.Error,
          value: {
            error: { message: REJECTION_400_MESSAGE, status: 400 },
          },
        },
        { type: AgentEventType.Content, value: 'Retried content' },
      ]);

      // turn.run is called twice: the failing attempt then the recovery.
      expect(mockTurnRunFn).toHaveBeenCalledTimes(2);

      const secondCallArgs = mockTurnRunFn.mock.calls[1];
      const secondRequest = secondCallArgs?.[0];
      expect(secondRequest).toStrictEqual([
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: expect.any(String) }],
        },
      ]);
      const adviceText =
        (
          secondRequest as unknown as Array<{
            blocks: Array<{ text: string }>;
          }>
        )[0]?.blocks[0]?.text ?? '';
      // The advice names the tool, the rejected media, and the alternative.
      expect(adviceText).toContain('HTTP 400');
      expect(adviceText).toContain('The tools involved were: read_file.');
      expect(adviceText).toContain(
        'The rejected content was: shader.fh (image/png).',
      );
      expect(adviceText).toContain('read it as text');
    });

    it('AC2: a non-content 400 is not recovered (turn.run called once)', async () => {
      vi.spyOn(client['config'], 'getContinueOnFailedApiCall').mockReturnValue(
        true,
      );
      const mockStream1 = (async function* () {
        yield {
          type: AgentEventType.Error,
          value: {
            error: {
              message: "Invalid value for 'temperature': must be <= 2",
              status: 400,
            },
          },
        };
      })();
      mockTurnRunFn.mockReturnValueOnce(mockStream1);
      client['chat'] = makeChatMock() as ChatSession;

      const events = await fromAsync(
        client.sendMessageStream(
          [{ text: 'Hi' }],
          new AbortController().signal,
          'prompt-id-400-noncontent',
        ),
      );

      expect(events).toStrictEqual([
        {
          type: AgentEventType.ModelInfo,
          value: {
            model: 'test-model',
            providerName: 'gemini',
            profileName: null,
            displayLabel: 'test-model',
          },
        },
        {
          type: AgentEventType.Error,
          value: {
            error: {
              message: "Invalid value for 'temperature': must be <= 2",
              status: 400,
            },
          },
        },
      ]);
      expect(mockTurnRunFn).toHaveBeenCalledTimes(1);
    });

    it('AC5: stops after one recovery when the tool-content 400 repeats', async () => {
      vi.spyOn(client['config'], 'getContinueOnFailedApiCall').mockReturnValue(
        true,
      );
      mockTurnRunFn.mockImplementation(() =>
        (async function* () {
          yield {
            type: AgentEventType.Error,
            value: {
              error: { message: REJECTION_400_MESSAGE, status: 400 },
            },
          };
        })(),
      );
      client['chat'] = makeChatMock() as ChatSession;

      // The request must carry tool evidence so the recovery gate fires.
      const events = await fromAsync(
        client.sendMessageStream(
          [
            { type: 'text', text: 'Hi' },
            {
              type: 'tool_response',
              callId: 'read_file',
              toolName: 'read_file',
              result: { content: 'x' },
            },
          ],
          new AbortController().signal,
          'prompt-id-400-infinite',
        ),
      );

      // 1 ModelInfo + exactly 2 Error events (original + 1 recovery), no loop.
      expect(events.length).toBe(3);
      expect(events[0]?.type).toBe(AgentEventType.ModelInfo);
      expect(
        events
          .slice(1)
          .every(
            (e) =>
              e.type === AgentEventType.Error &&
              (e.value as { error: { status?: number } }).error.status === 400,
          ),
      ).toBe(true);
      expect(mockTurnRunFn).toHaveBeenCalledTimes(2);
    });

    it('AC1 gate: a content-rejection 400 whose request carried no tool evidence is not recovered', async () => {
      vi.spyOn(client['config'], 'getContinueOnFailedApiCall').mockReturnValue(
        true,
      );
      const mockStream1 = (async function* () {
        yield {
          type: AgentEventType.Error,
          value: {
            error: { message: REJECTION_400_MESSAGE, status: 400 },
          },
        };
      })();
      mockTurnRunFn.mockReturnValueOnce(mockStream1);
      client['chat'] = makeChatMock() as ChatSession;

      // Plain text request: no tool_response and no media block. Even though
      // the message is a content-rejection 400, recovery must NOT fire because
      // the failing request carried no tool evidence.
      const events = await fromAsync(
        client.sendMessageStream(
          [{ text: 'Hi' }],
          new AbortController().signal,
          'prompt-id-400-no-tool-evidence',
        ),
      );

      expect(mockTurnRunFn).toHaveBeenCalledTimes(1);
      // Only the original 400 Error event was emitted (plus ModelInfo).
      expect(
        events.filter((e) => e.type === AgentEventType.Error),
      ).toHaveLength(1);
    });

    it('AC6a: does not recover when getContinueOnFailedApiCall is false', async () => {
      vi.spyOn(client['config'], 'getContinueOnFailedApiCall').mockReturnValue(
        false,
      );
      const mockStream1 = (async function* () {
        yield {
          type: AgentEventType.Error,
          value: {
            error: { message: REJECTION_400_MESSAGE, status: 400 },
          },
        };
      })();
      mockTurnRunFn.mockReturnValueOnce(mockStream1);
      client['chat'] = makeChatMock() as ChatSession;

      const events = await fromAsync(
        client.sendMessageStream(
          [{ text: 'Hi' }],
          new AbortController().signal,
          'prompt-id-400-no-continue',
        ),
      );

      expect(events).toStrictEqual([
        {
          type: AgentEventType.ModelInfo,
          value: {
            model: 'test-model',
            providerName: 'gemini',
            profileName: null,
            displayLabel: 'test-model',
          },
        },
        {
          type: AgentEventType.Error,
          value: {
            error: { message: REJECTION_400_MESSAGE, status: 400 },
          },
        },
      ]);
      expect(mockTurnRunFn).toHaveBeenCalledTimes(1);
    });

    it('AC6b: does not recover when content was already emitted before the 400', async () => {
      vi.spyOn(client['config'], 'getContinueOnFailedApiCall').mockReturnValue(
        true,
      );
      const mockStream = (async function* () {
        yield { type: AgentEventType.Content, value: 'Partial content' };
        yield {
          type: AgentEventType.Error,
          value: {
            error: { message: REJECTION_400_MESSAGE, status: 400 },
          },
        };
      })();
      mockTurnRunFn.mockReturnValueOnce(mockStream);
      client['chat'] = makeChatMock() as ChatSession;

      const events = await fromAsync(
        client.sendMessageStream(
          [{ text: 'Hi' }],
          new AbortController().signal,
          'prompt-id-400-after-content',
        ),
      );

      expect(events.slice(-2)).toStrictEqual([
        { type: AgentEventType.Content, value: 'Partial content' },
        {
          type: AgentEventType.Error,
          value: {
            error: { message: REJECTION_400_MESSAGE, status: 400 },
          },
        },
      ]);
      expect(mockTurnRunFn).toHaveBeenCalledTimes(1);
    });
  });
});

/**
 * Issue #2722 recovery re-issues a bare text message after a failed
 * tool-response request, which leaves the preceding AI turn's tool_call
 * without a matching tool_response in history. That is safe ONLY because
 * HistoryService.getCuratedForProvider closes orphaned tool calls before any
 * provider converter runs. This test pins that structural assumption using a
 * real HistoryService (no mocks).
 */
describe('tool-content 400 recovery — history assumption (issue #2722)', () => {
  it('orphaned tool calls are closed before the provider sees the recovery request (issue #2722)', () => {
    const history = new HistoryService();
    // Seed: an AI turn issued a tool_call whose response was rejected by the
    // provider (HTTP 400), so no tool_response was ever recorded for it.
    const aiTurn: IContent = {
      speaker: 'ai',
      blocks: [
        {
          type: 'tool_call',
          id: 'call-1',
          name: 'read_file',
          parameters: { path: 'shader.fh' },
        },
      ],
    };
    history.add(aiTurn);

    // The recovery re-issues a bare text (advice) message as tail content.
    const tailContents: IContent[] = [
      {
        speaker: 'human',
        blocks: [
          {
            type: 'text',
            text: 'System: The provider rejected the previous request with HTTP 400.',
          },
        ],
      },
    ];

    const curated = history.getCuratedForProvider(tailContents);

    const aiIndex = curated.findIndex(
      (c) =>
        c.speaker === 'ai' &&
        c.blocks.some((b) => b.type === 'tool_call' && b.id === 'call-1'),
    );
    expect(aiIndex).toBeGreaterThanOrEqual(0);

    // A synthetic tool response is inserted immediately after the AI turn...
    expect(curated[aiIndex + 1]?.speaker).toBe('tool');
    expect(
      curated[aiIndex + 1]?.blocks.some(
        (b) => b.type === 'tool_response' && b.callId === 'call-1',
      ),
    ).toBe(true);

    // ...and BEFORE the human advice content reaches the provider.
    const humanIndex = curated.findIndex((c) => c.speaker === 'human');
    expect(humanIndex).toBeGreaterThan(aiIndex + 1);

    // Stored history is left untouched (the offending media was never added).
    expect(history.getAll()).toHaveLength(1);
  });
});
