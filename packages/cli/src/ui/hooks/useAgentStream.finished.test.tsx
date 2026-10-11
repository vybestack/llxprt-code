import { MockTool } from '@vybestack/llxprt-code-test-utils/core/mock-tool.js';
import type {
  ToolCallRequestInfo,
  Config,
  EditorType,
  ToolRegistry,
} from '@vybestack/llxprt-code-core';
/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { automock } from '@vybestack/llxprt-code-test-utils';
import { describe, it, expect, vi, beforeEach } from 'bun:test';
import type { Mock } from 'bun:test';
import {
  MockedAgentClientClass,
  mockSendMessageStream,
  mockStartChat,
  createFakeAgentFromMockClient,
} from './__tests__/useAgentStream-test-helpers.js';
import { act } from 'react';
import { renderHook } from '../../__tests__/render.js';
import { waitFor } from '../../__tests__/async.js';
import { useAgentStream } from './agentStream/index.js';
import { createStreamRuntimeForTest } from './agentStream/__tests__/streamRuntimeTestHelper.js';
import * as atCommandProcessor from './atCommandProcessor.js';
import { useReactToolScheduler } from './useReactToolScheduler.js';
import {
  ApprovalMode,
  AgentEventType as ServerEventType,
  tokenLimit,
} from '@vybestack/llxprt-code-core';
import { StreamingState } from '../types.js';
import type { LoadedSettings } from '../../config/settings.js';

// --- MOCKS ---
const realAtCommandProcessorModule = {
  ...(await import('./atCommandProcessor.js')),
};

const actualSchedulerModule = {
  ...(await import('./useReactToolScheduler.js')),
};
const mockUseReactToolScheduler = vi.fn<typeof useReactToolScheduler>();
void vi.mock('./useReactToolScheduler.js', () => ({
  ...actualSchedulerModule,
  useReactToolScheduler: mockUseReactToolScheduler,
}));

void vi.mock('./useKeypress.js', () => ({
  useKeypress: vi.fn(),
}));

void vi.mock('./shellCommandProcessor.js', () => ({
  useShellCommandProcessor: vi.fn().mockReturnValue({
    handleShellCommand: vi.fn(),
  }),
}));

void vi.mock('./atCommandProcessor.js', () =>
  automock(realAtCommandProcessorModule),
);

void vi.mock('../utils/markdownUtilities.js', () => ({
  findLastSafeSplitPoint: vi.fn((s: string) => s.length),
}));

void vi.mock('./useLogger.js', () => ({
  useLogger: vi.fn().mockReturnValue({
    logMessage: vi.fn().mockResolvedValue(undefined),
  }),
}));

const mockStartNewPrompt = vi.fn();
const mockAddUsage = vi.fn();
void vi.mock('../contexts/SessionContext.js', () => ({
  useSessionStats: vi.fn(() => ({
    startNewPrompt: mockStartNewPrompt,
    addUsage: mockAddUsage,
    getPromptCount: vi.fn(() => 5),
  })),
}));

void vi.mock('./slashCommandProcessor.js', () => ({
  handleSlashCommand: vi.fn().mockReturnValue(false),
}));

// --- END MOCKS ---

// --- Tests for useAgentStream Hook ---
describe('useAgentStream', () => {
  let mockAddItem: Mock<Parameters<typeof useAgentStream>[2]>;
  let mockConfig: Config;
  let contextLimit: number | undefined;
  let mockOnDebugMessage: Mock<(message: string) => void>;
  let mockHandleSlashCommand: Mock<Parameters<typeof useAgentStream>[6]>;
  let mockScheduleToolCalls: Mock<ReturnType<typeof useReactToolScheduler>[1]>;
  let mockCancelAllToolCalls: Mock<ReturnType<typeof useReactToolScheduler>[3]>;
  let mockMarkToolsAsDisplayCleared: Mock<
    ReturnType<typeof useReactToolScheduler>[2]
  >;

  beforeEach(() => {
    contextLimit = undefined;
    vi.clearAllMocks(); // Clear mocks before each test

    mockAddItem = vi.fn<Parameters<typeof useAgentStream>[2]>(() => 0);
    // Define the mock for getAgentClient

    const contentGeneratorConfig = {
      model: 'test-model',
      apiKey: 'test-key',
      vertexai: false,
    };

    mockConfig = {
      apiKey: 'test-api-key',
      model: 'gemini-pro',
      sandbox: false,
      targetDir: '/test/dir',
      debugMode: false,
      question: undefined,

      coreTools: [],
      toolDiscoveryCommand: undefined,
      toolCallCommand: undefined,
      mcpServerCommand: undefined,
      mcpServers: undefined,
      userAgent: 'test-agent',
      userMemory: '',
      llxprtMdFileCount: 0,
      alwaysSkipModificationConfirmation: false,
      vertexai: false,
      showMemoryUsage: false,
      contextFileName: undefined,
      getToolRegistry: vi.fn(
        () =>
          ({ getToolSchemaList: vi.fn(() => []) }) as unknown as ToolRegistry,
      ),
      getProjectRoot: vi.fn(() => '/test/dir'),
      getCheckpointingEnabled: vi.fn(() => false),
      getApprovalMode: () => ApprovalMode.DEFAULT,
      getUsageStatisticsEnabled: () => true,
      getDebugMode: () => false,
      addHistory: vi.fn(),
      getSessionId() {
        return 'test-session-id';
      },
      setQuotaErrorOccurred: vi.fn(),
      getQuotaErrorOccurred: vi.fn(() => false),
      getModel: vi.fn(() => 'gemini-2.5-pro'),
      getContentGeneratorConfig: vi
        .fn()
        .mockReturnValue(contentGeneratorConfig),
      getUseSmartEdit: () => false,
      getUseModelRouter: () => false,
    } as unknown as Config;
    mockOnDebugMessage = vi.fn();
    mockHandleSlashCommand = vi.fn().mockResolvedValue(false);

    // Mock return value for useReactToolScheduler
    mockScheduleToolCalls = vi.fn();
    mockCancelAllToolCalls = vi.fn();
    mockMarkToolsAsDisplayCleared = vi.fn();

    // Default mock for useReactToolScheduler to prevent toolCalls being undefined initially
    mockUseReactToolScheduler.mockReturnValue([
      [],
      mockScheduleToolCalls,
      mockMarkToolsAsDisplayCleared,
      mockCancelAllToolCalls,
      0,
      true,
      vi.fn(),
      vi.fn(),
    ]);

    // Reset mocks for AgentClient instance methods (startChat and sendMessageStream)
    // The AgentClient constructor itself is mocked at the module level.
    mockStartChat.mockClear().mockResolvedValue({
      sendMessageStream: mockSendMessageStream,
    } as unknown as Awaited<ReturnType<typeof mockStartChat>>);
    mockSendMessageStream
      .mockClear()
      .mockReturnValue((async function* () {})());
    vi.spyOn(atCommandProcessor, 'handleAtCommand');
  });

  const mockLoadedSettings: LoadedSettings = {
    merged: { preferredEditor: 'vscode' },
    user: { path: '/user/settings.json', settings: {} },
    workspace: { path: '/workspace/.gemini/settings.json', settings: {} },
    errors: [],
    forScope: vi.fn(),
    setValue: vi.fn(),
  } as unknown as LoadedSettings;

  // Helper to create mock tool calls - reduces boilerplate

  // Helper to render hook with default parameters - reduces boilerplate
  const renderHookWithDefaults = (
    options: {
      shellModeActive?: boolean;
      onCancelSubmit?: (shouldRestorePrompt?: boolean) => void;
      setShellInputFocused?: (focused: boolean) => void;
      performMemoryRefresh?: () => Promise<void>;
      onAuthError?: () => void;
      setModelSwitched?: Mock<(...args: never[]) => unknown>;
      modelSwitched?: boolean;
    } = {},
  ) => {
    const {
      shellModeActive = false,
      onCancelSubmit = () => {},
      setShellInputFocused = () => {},
      performMemoryRefresh = () => Promise.resolve(),
      onAuthError = () => {},
    } = options;

    return renderHook(() =>
      useAgentStream(
        createFakeAgentFromMockClient(new MockedAgentClientClass(mockConfig)),
        [],
        mockAddItem,
        createStreamRuntimeForTest(mockConfig, {
          ephemeral: {
            getEphemeralSetting: (key) =>
              key === 'context-limit' ? contextLimit : undefined,
          },
        }),
        mockLoadedSettings,
        mockOnDebugMessage,
        mockHandleSlashCommand,
        shellModeActive,
        () => 'vscode' as EditorType,
        onAuthError,
        performMemoryRefresh,
        () => {},
        onCancelSubmit,
        setShellInputFocused,
        80,
        24,
      ),
    );
  };

  describe('handleFinishedEvent', () => {
    it('should add info message for MAX_TOKENS finish reason', async () => {
      // Setup mock to return a stream with MAX_TOKENS finish reason
      mockSendMessageStream.mockReturnValue(
        (async function* () {
          yield {
            type: ServerEventType.Content,
            value: 'This is a truncated response...',
          };
          yield {
            type: ServerEventType.Finished,
            value: { reason: 'max_tokens', usageMetadata: undefined },
          };
        })(),
      );

      const { result } = renderHook(() =>
        useAgentStream(
          createFakeAgentFromMockClient(new MockedAgentClientClass(mockConfig)),
          [],
          mockAddItem,
          createStreamRuntimeForTest(mockConfig, {
            ephemeral: {
              getEphemeralSetting: (key) =>
                key === 'context-limit' ? contextLimit : undefined,
            },
          }),
          mockLoadedSettings,
          mockOnDebugMessage,
          mockHandleSlashCommand,
          false,
          () => 'vscode' as EditorType,
          () => {},
          () => Promise.resolve(),
          () => {},
          () => {},
          () => {},
          80,
          24,
        ),
      );

      // Submit a query
      await act(async () => {
        await result.current.submitQuery('Generate long text');
      });

      // Check that the info message was added
      await waitFor(() => {
        expect(mockAddItem).toHaveBeenCalledWith(
          {
            type: 'info',
            text: 'WARNING:  Response truncated due to token limits.',
          },
          expect.any(Number),
        );
      });
    });
    it('should add refusal notice for Finished with stopReason "refusal" @issue:2329', async () => {
      mockSendMessageStream.mockReturnValue(
        (async function* () {
          yield {
            type: ServerEventType.Content,
            value: 'I cannot help with that.',
          };
          yield {
            type: ServerEventType.Finished,
            value: {
              reason: 'STOP',
              stopReason: 'refusal',
              usageMetadata: undefined,
            },
          };
        })(),
      );

      const { result } = renderHookWithDefaults();

      await act(async () => {
        await result.current.submitQuery('risky request');
      });

      await waitFor(() => {
        expect(mockAddItem).toHaveBeenCalledWith(
          {
            type: 'info',
            text: expect.stringContaining('safety classifier refused'),
          },
          expect.any(Number),
        );
      });
    });

    const observeNormalStopMessages = async (): Promise<{
      readonly streamingState: StreamingState;
      readonly refusalInfoMessages: readonly unknown[];
    }> => {
      mockSendMessageStream.mockReturnValue(
        (async function* () {
          yield {
            type: ServerEventType.Content,
            value: 'Here is the answer.',
          };
          yield {
            type: ServerEventType.Finished,
            value: { reason: 'STOP', usageMetadata: undefined },
          };
        })(),
      );

      const { result } = renderHookWithDefaults();

      await act(async () => {
        await result.current.submitQuery('normal request');
      });

      await waitFor(() => {
        if (result.current.streamingState !== StreamingState.Idle) {
          throw new Error('Expected the normal response stream to finish');
        }
      });

      const refusalInfoMessages = mockAddItem.mock.calls.filter((call) => {
        const item = call[0] as { type?: string; text?: unknown };
        return (
          item.type === 'info' &&
          typeof item.text === 'string' &&
          item.text.includes('safety classifier refused')
        );
      });
      return {
        streamingState: result.current.streamingState,
        refusalInfoMessages,
      };
    };

    it('should not add refusal notice for a normal STOP without stopReason @issue:2329', async () => {
      const stop = await observeNormalStopMessages();
      expect(stop.streamingState).toBe(StreamingState.Idle);
      expect(stop.refusalInfoMessages).toHaveLength(0);
    });

    describe('ContextWindowWillOverflow event', () => {
      beforeEach(() => {
        (tokenLimit as Mock<typeof tokenLimit>).mockReturnValue(100);
        contextLimit = 100;
      });

      it.each([
        {
          name: 'without suggestion when remaining tokens are > 75% of limit',
          requestTokens: 20,
          remainingTokens: 80,
          expectedMessage:
            'Sending this message (20 tokens) might exceed the remaining context window limit (80 tokens).',
        },
        {
          name: 'with suggestion when remaining tokens are < 75% of limit',
          requestTokens: 30,
          remainingTokens: 70,
          expectedMessage:
            'Sending this message (30 tokens) might exceed the remaining context window limit (70 tokens). Please try reducing the size of your message or use the `/compress` command to compress the chat history.',
        },
      ])(
        'should add message $name',
        async ({ requestTokens, remainingTokens, expectedMessage }) => {
          mockSendMessageStream.mockReturnValue(
            (async function* () {
              yield {
                type: ServerEventType.ContextWindowWillOverflow,
                value: {
                  estimatedRequestTokenCount: requestTokens,
                  remainingTokenCount: remainingTokens,
                },
              };
            })(),
          );

          const { result } = renderHookWithDefaults();

          await act(async () => {
            await result.current.submitQuery('Test overflow');
          });

          await waitFor(() => {
            expect(mockAddItem).toHaveBeenCalledWith(
              {
                type: 'info',
                text: expectedMessage,
              },
              expect.any(Number),
            );
          });
        },
      );
    });

    it('should call onCancelSubmit when ContextWindowWillOverflow event is received', async () => {
      const onCancelSubmitSpy = vi.fn();
      // Setup mock to return a stream with ContextWindowWillOverflow event
      mockSendMessageStream.mockReturnValue(
        (async function* () {
          // The fake agent feeds this stream through the real event adapter,
          // so it must carry the RAW server event. The adapter maps
          // ContextWindowWillOverflow to the 'context-warning' agent event
          // that the dispatcher consumes.
          yield {
            type: 'context_window_will_overflow',
            value: {
              estimatedRequestTokenCount: 100,
              remainingTokenCount: 50,
            },
          };
        })(),
      );

      const { result } = renderHook(() =>
        useAgentStream(
          createFakeAgentFromMockClient(new MockedAgentClientClass(mockConfig)),
          [],
          mockAddItem,
          createStreamRuntimeForTest(mockConfig, {
            ephemeral: {
              getEphemeralSetting: (key) =>
                key === 'context-limit' ? contextLimit : undefined,
            },
          }),
          mockLoadedSettings,
          mockOnDebugMessage,
          mockHandleSlashCommand,
          false,
          () => 'vscode' as EditorType,
          () => {},
          () => Promise.resolve(),
          () => {},
          onCancelSubmitSpy,
          () => {},
          80,
          24,
        ),
      );

      // Submit a query
      await act(async () => {
        await result.current.submitQuery('Test overflow');
      });

      // Check that onCancelSubmit was called with shouldRestorePrompt=true
      await waitFor(() => {
        expect(onCancelSubmitSpy).toHaveBeenCalledWith(true);
      });
    });

    type FinishReasonCase = {
      readonly reason: 'stop' | 'safety' | 'other' | 'error';
      readonly stopReason: string;
      readonly shouldAddMessage?: boolean;
      readonly message?: string;
    };

    function requiredInfoMessageCount(
      shouldAddMessage: boolean | undefined,
    ): number {
      return shouldAddMessage === false ? 0 : 1;
    }

    function requiredInfoMessage(testCase: FinishReasonCase): unknown {
      return testCase.shouldAddMessage === false
        ? undefined
        : { type: 'info', text: testCase.message };
    }

    const observeFinishReasonHandling = async ({
      reason,
      stopReason,
    }: FinishReasonCase): Promise<{
      readonly streamingState: StreamingState;
      readonly infoMessages: readonly unknown[][];
    }> => {
      mockSendMessageStream.mockReturnValue(
        (async function* () {
          yield {
            type: ServerEventType.Content,
            value: `Response for ${stopReason}`,
          };
          yield {
            type: ServerEventType.Finished,
            value: { reason, stopReason, usageMetadata: undefined },
          };
        })(),
      );

      const { result } = renderHookWithDefaults();

      await act(async () => {
        await result.current.submitQuery(`Test ${stopReason}`);
      });

      // Wait for the stream to complete and state to settle
      await waitFor(() => {
        if (result.current.streamingState !== StreamingState.Idle) {
          throw new Error('Expected finish-reason handling to settle');
        }
      });

      const infoMessages = mockAddItem.mock.calls.filter(
        (call) => call[0].type === 'info',
      );
      return {
        streamingState: result.current.streamingState,
        infoMessages,
      };
    };

    it.each([
      { reason: 'stop', stopReason: 'STOP', shouldAddMessage: false },
      {
        reason: 'stop',
        stopReason: 'FINISH_REASON_UNSPECIFIED',
        shouldAddMessage: false,
      },
      {
        reason: 'safety',
        stopReason: 'SAFETY',
        message: 'WARNING:  Response stopped due to safety reasons.',
      },
      {
        reason: 'safety',
        stopReason: 'RECITATION',
        message: 'WARNING:  Response stopped due to recitation policy.',
      },
      {
        reason: 'other',
        stopReason: 'LANGUAGE',
        message: 'WARNING:  Response stopped due to unsupported language.',
      },
      {
        reason: 'safety',
        stopReason: 'BLOCKLIST',
        message: 'WARNING:  Response stopped due to forbidden terms.',
      },
      {
        reason: 'safety',
        stopReason: 'PROHIBITED_CONTENT',
        message: 'WARNING:  Response stopped due to prohibited content.',
      },
      {
        reason: 'safety',
        stopReason: 'SPII',
        message:
          'WARNING:  Response stopped due to sensitive personally identifiable information.',
      },
      {
        reason: 'other',
        stopReason: 'OTHER',
        message: 'WARNING:  Response stopped for other reasons.',
      },
      {
        reason: 'error',
        stopReason: 'MALFORMED_FUNCTION_CALL',
        message: 'WARNING:  Response stopped due to malformed function call.',
      },
      {
        reason: 'safety',
        stopReason: 'IMAGE_SAFETY',
        message: 'WARNING:  Response stopped due to image safety violations.',
      },
      {
        reason: 'error',
        stopReason: 'UNEXPECTED_TOOL_CALL',
        message: 'WARNING:  Response stopped due to unexpected tool call.',
      },
    ])(
      'should handle $stopReason finish reason correctly',
      async (testCase) => {
        const finish = await observeFinishReasonHandling(testCase);
        expect(finish.streamingState).toBe(StreamingState.Idle);
        expect(
          finish.infoMessages.length >=
            requiredInfoMessageCount(testCase.shouldAddMessage),
        ).toBe(true);
        expect(finish.infoMessages[0]?.[0]).toStrictEqual(
          requiredInfoMessage(testCase),
        );
      },
    );
  });

  it('should flush pending text rationale before scheduling tool calls to ensure correct history order', async () => {
    const addItemOrder: string[] = [];
    let capturedOnComplete:
      | Parameters<typeof useReactToolScheduler>[0]
      | undefined;

    const mockScheduleToolCalls = vi.fn(async (requests) => {
      addItemOrder.push('scheduleToolCalls_START');
      // Simulate tools completing and triggering onComplete immediately.
      // This mimics the behavior that caused the regression where tool results
      // were added to history during the await scheduleToolCalls(...) block.
      const tools = requests.map(
        (
          r: ToolCallRequestInfo,
        ): Parameters<
          Parameters<typeof useReactToolScheduler>[0]
        >[1][number] => {
          const tool = new MockTool({ name: r.name });
          return {
            request: r,
            status: 'success',
            tool,
            invocation: tool.build(r.args),
            response: {
              callId: r.callId,
              responseParts: [],
              resultDisplay: 'done',
              error: undefined,
              errorType: undefined,
            },
            durationMs: 0,
          };
        },
      );
      if (capturedOnComplete === undefined)
        throw new Error('Scheduler callback not supplied');
      await capturedOnComplete(Symbol('test-scheduler'), tools, {
        isPrimary: true,
      });
      addItemOrder.push('scheduleToolCalls_END');
    });

    mockAddItem.mockImplementation((item: { type: string }) => {
      addItemOrder.push(`addItem:${item.type}`);
      return 0;
    });

    // We need to capture the onComplete callback from useReactToolScheduler
    mockUseReactToolScheduler.mockImplementation((onComplete) => {
      capturedOnComplete = onComplete;
      return [
        [], // toolCalls
        mockScheduleToolCalls,
        vi.fn(), // markToolsAsDisplayCleared
        vi.fn(), // cancelAllToolCalls
        0, // lastToolOutputTime
        true, // interactiveRuntimeReady
        vi.fn(),
        vi.fn(),
      ];
    });

    const { result } = renderHook(() =>
      useAgentStream(
        createFakeAgentFromMockClient(new MockedAgentClientClass(mockConfig)),
        [],
        mockAddItem,
        createStreamRuntimeForTest(mockConfig, {
          ephemeral: {
            getEphemeralSetting: (key) =>
              key === 'context-limit' ? contextLimit : undefined,
          },
        }),
        mockLoadedSettings,
        mockOnDebugMessage,
        mockHandleSlashCommand,
        false,
        () => 'vscode' as EditorType,
        vi.fn(),
        vi.fn(),
        () => {},
        vi.fn(),
        vi.fn(),
        80,
        24,
      ),
    );

    const mockStream = (async function* () {
      yield {
        type: ServerEventType.Content,
        value: 'Rationale rationale.',
      };
      yield {
        type: ServerEventType.ToolCallRequest,
        value: { callId: '1', name: 'test_tool', args: {} },
      };
    })();
    mockSendMessageStream.mockReturnValue(mockStream);

    await act(async () => {
      await result.current.submitQuery('test input');
    });

    // A ToolCallRequest in the stream no longer makes the CLI call
    // scheduleToolCalls: the dispatcher treats tool-call as display-only and
    // the agent executes tools itself, so the React scheduler is now reached
    // only for client-initiated calls. Drive the completion callback directly
    // to exercise the ordering guarantee that does still exist —
    // useAgentEventStream flushes pending AI content before adding the
    // tool_group item.
    const completedTool = new MockTool({ name: 'test_tool' });
    const completedTools: Parameters<
      Parameters<typeof useReactToolScheduler>[0]
    >[1] = [
      {
        request: {
          callId: '1',
          name: 'test_tool',
          args: {},
          isClientInitiated: false,
          prompt_id: 'test-prompt',
        },
        status: 'success',
        tool: completedTool,
        invocation: completedTool.build({}),
        response: {
          callId: '1',
          responseParts: [],
          resultDisplay: 'done',
          error: undefined,
          errorType: undefined,
        },
        durationMs: 0,
      },
    ];

    expect(capturedOnComplete).toBeDefined();
    await act(async () => {
      await capturedOnComplete!(Symbol('test-scheduler'), completedTools, {
        isPrimary: true,
      });
    });

    const rationaleIndex = addItemOrder.indexOf('addItem:gemini');
    const toolGroupIndex = addItemOrder.indexOf('addItem:tool_group');

    expect(rationaleIndex).toBeGreaterThan(-1);
    expect(toolGroupIndex).toBeGreaterThan(-1);

    // Core guarantee: the rationale is committed to history before the tools.
    expect(rationaleIndex).toBeLessThan(toolGroupIndex);
  });
});
