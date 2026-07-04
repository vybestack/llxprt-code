/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/** @vitest-environment jsdom */

import type { Mock } from 'vitest';
import {
  MockedAgentClientClass,
  mockSendMessageStream,
  mockStartChat,
} from './useAgentStream-test-helpers.js';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act } from 'react';
import { renderHook } from '../../test-utils/render.js';
import { waitFor } from '../../test-utils/async.js';
import { useAgentStream } from './agentStream/index.js';
import * as atCommandProcessor from './atCommandProcessor.js';
import { useReactToolScheduler } from './useReactToolScheduler.js';
import type {
  Config,
  EditorType,
  ToolRegistry,
} from '@vybestack/llxprt-code-core';
import {
  ApprovalMode,
  AgentEventType as ServerEventType,
  tokenLimit,
} from '@vybestack/llxprt-code-core';
import { StreamingState } from '../types.js';
import type { LoadedSettings } from '../../config/settings.js';

// --- MOCKS ---
const mockUseReactToolScheduler = useReactToolScheduler as Mock;
vi.mock('./useReactToolScheduler.js', async (importOriginal) => {
  const actualSchedulerModule = await importOriginal<Record<string, unknown>>();
  return {
    ...actualSchedulerModule,
    useReactToolScheduler: vi.fn(),
  };
});

vi.mock('./useKeypress.js', () => ({
  useKeypress: vi.fn(),
}));

vi.mock('./shellCommandProcessor.js', () => ({
  useShellCommandProcessor: vi.fn().mockReturnValue({
    handleShellCommand: vi.fn(),
  }),
}));

vi.mock('./atCommandProcessor.js');

vi.mock('../utils/markdownUtilities.js', () => ({
  findLastSafeSplitPoint: vi.fn((s: string) => s.length),
}));

vi.mock('./useStateAndRef.js', () => ({
  useStateAndRef: vi.fn((initial) => {
    let val = initial;
    const ref = { current: val };
    const setVal = vi.fn((updater) => {
      if (typeof updater === 'function') {
        val = updater(val);
      } else {
        val = updater;
      }
      ref.current = val;
    });
    return [val, ref, setVal];
  }),
}));

vi.mock('./useLogger.js', () => ({
  useLogger: vi.fn().mockReturnValue({
    logMessage: vi.fn().mockResolvedValue(undefined),
  }),
}));

const mockStartNewPrompt = vi.fn();
const mockAddUsage = vi.fn();
vi.mock('../contexts/SessionContext.js', () => ({
  useSessionStats: vi.fn(() => ({
    startNewPrompt: mockStartNewPrompt,
    addUsage: mockAddUsage,
    getPromptCount: vi.fn(() => 5),
  })),
}));

vi.mock('./slashCommandProcessor.js', () => ({
  handleSlashCommand: vi.fn().mockReturnValue(false),
}));

// --- END MOCKS ---

// --- Tests for useAgentStream Hook ---
describe('useAgentStream', () => {
  let mockAddItem: Mock;
  let mockConfig: Config;
  let mockOnDebugMessage: Mock;
  let mockHandleSlashCommand: Mock;
  let mockScheduleToolCalls: Mock;
  let mockCancelAllToolCalls: Mock;
  let mockMarkToolsAsDisplayCleared: Mock;

  beforeEach(() => {
    vi.clearAllMocks(); // Clear mocks before each test

    mockAddItem = vi.fn();
    // Define the mock for getAgentClient
    const _mockGetAgentClient = vi.fn().mockImplementation(() => {
      // MockedAgentClientClass is defined in the module scope by the previous change.
      // It will use the mockStartChat and mockSendMessageStream that are managed within beforeEach.
      const clientInstance = new MockedAgentClientClass(mockConfig);
      return clientInstance;
    });

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
      [], // Default to empty array for toolCalls
      mockScheduleToolCalls,
      mockMarkToolsAsDisplayCleared,
      mockCancelAllToolCalls,
      0,
      true,
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
      setModelSwitched?: Mock;
      modelSwitched?: boolean;
    } = {},
  ) => {
    const {
      shellModeActive = false,
      onCancelSubmit = () => {},
      setShellInputFocused = () => {},
      performMemoryRefresh = () => Promise.resolve(),
      onAuthError = () => {},
      setModelSwitched = vi.fn(),
      modelSwitched = false,
    } = options;

    return renderHook(() =>
      useAgentStream(
        new MockedAgentClientClass(mockConfig),
        [],
        mockAddItem,
        mockConfig,
        mockLoadedSettings,
        mockOnDebugMessage,
        mockHandleSlashCommand,
        shellModeActive,
        () => 'vscode' as EditorType,
        onAuthError,
        performMemoryRefresh,
        modelSwitched,
        setModelSwitched,
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
            value: { reason: 'MAX_TOKENS', usageMetadata: undefined },
          };
        })(),
      );

      const { result } = renderHook(() =>
        useAgentStream(
          new MockedAgentClientClass(mockConfig),
          [],
          mockAddItem,
          mockConfig,
          mockLoadedSettings,
          mockOnDebugMessage,
          mockHandleSlashCommand,
          false,
          () => 'vscode' as EditorType,
          () => {},
          () => Promise.resolve(),
          false,
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

    it('should not add refusal notice for a normal STOP without stopReason @issue:2329', async () => {
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
        expect(result.current.streamingState).toBe(StreamingState.Idle);
      });

      const refusalInfoMessages = mockAddItem.mock.calls.filter((call) => {
        const item = call[0] as { type?: string; text?: unknown };
        return (
          item.type === 'info' &&
          typeof item.text === 'string' &&
          item.text.includes('safety classifier refused')
        );
      });
      expect(refusalInfoMessages).toHaveLength(0);
    });

    describe('ContextWindowWillOverflow event', () => {
      beforeEach(() => {
        vi.mocked(tokenLimit).mockReturnValue(100);
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
          yield {
            type: ServerEventType.ContextWindowWillOverflow,
            value: {
              estimatedRequestTokenCount: 100,
              remainingTokenCount: 50,
            },
          };
        })(),
      );

      const { result } = renderHook(() =>
        useAgentStream(
          new MockedAgentClientClass(mockConfig),
          [],
          mockAddItem,
          mockConfig,
          mockLoadedSettings,
          mockOnDebugMessage,
          mockHandleSlashCommand,
          false,
          () => 'vscode' as EditorType,
          () => {},
          () => Promise.resolve(),
          false,
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

    it.each([
      {
        reason: 'STOP',
        shouldAddMessage: false,
      },
      {
        reason: 'FINISH_REASON_UNSPECIFIED',
        shouldAddMessage: false,
      },
      {
        reason: 'SAFETY',
        message: 'WARNING:  Response stopped due to safety reasons.',
      },
      {
        reason: 'RECITATION',
        message: 'WARNING:  Response stopped due to recitation policy.',
      },
      {
        reason: 'LANGUAGE',
        message: 'WARNING:  Response stopped due to unsupported language.',
      },
      {
        reason: 'BLOCKLIST',
        message: 'WARNING:  Response stopped due to forbidden terms.',
      },
      {
        reason: 'PROHIBITED_CONTENT',
        message: 'WARNING:  Response stopped due to prohibited content.',
      },
      {
        reason: 'SPII',
        message:
          'WARNING:  Response stopped due to sensitive personally identifiable information.',
      },
      {
        reason: 'OTHER',
        message: 'WARNING:  Response stopped for other reasons.',
      },
      {
        reason: 'MALFORMED_FUNCTION_CALL',
        message: 'WARNING:  Response stopped due to malformed function call.',
      },
      {
        reason: 'IMAGE_SAFETY',
        message: 'WARNING:  Response stopped due to image safety violations.',
      },
      {
        reason: 'UNEXPECTED_TOOL_CALL',
        message: 'WARNING:  Response stopped due to unexpected tool call.',
      },
    ])(
      'should handle $reason finish reason correctly',
      async ({ reason, shouldAddMessage = true, message }) => {
        mockSendMessageStream.mockReturnValue(
          (async function* () {
            yield {
              type: ServerEventType.Content,
              value: `Response for ${reason}`,
            };
            yield {
              type: ServerEventType.Finished,
              value: { reason, usageMetadata: undefined },
            };
          })(),
        );

        const { result } = renderHookWithDefaults();

        await act(async () => {
          await result.current.submitQuery(`Test ${reason}`);
        });

        // Wait for the stream to complete and state to settle
        await waitFor(() => {
          expect(result.current.streamingState).toBe(StreamingState.Idle);
        });

        // Check assertions based on shouldAddMessage (outside of conditional)
        const infoMessages = mockAddItem.mock.calls.filter(
          (call) => call[0].type === 'info',
        );

        // Split assertions outside of conditionals to satisfy vitest/no-conditional-expect
        // This verifies that the test result matches the expected behavior for each case
        const expectedInfoMessageCount = shouldAddMessage ? 1 : 0;
        expect(infoMessages.length >= expectedInfoMessageCount).toBe(true);

        // When shouldAddMessage is true, verify the message content
        // This assertion runs for all cases but only meaningfully validates when shouldAddMessage is true
        const expectedMessage = shouldAddMessage
          ? { type: 'info', text: message }
          : undefined;
        expect(infoMessages[0]?.[0]).toStrictEqual(expectedMessage);
      },
    );
  });

  it('should flush pending text rationale before scheduling tool calls to ensure correct history order', async () => {
    const addItemOrder: string[] = [];
    let capturedOnComplete:
      | ((
          schedulerId: symbol,
          tools: unknown[],
          opts: unknown,
        ) => Promise<void>)
      | undefined;

    const mockScheduleToolCalls = vi.fn(async (requests) => {
      addItemOrder.push('scheduleToolCalls_START');
      // Simulate tools completing and triggering onComplete immediately.
      // This mimics the behavior that caused the regression where tool results
      // were added to history during the await scheduleToolCalls(...) block.
      const tools = requests.map((r: { name: string; callId: string }) => ({
        request: r,
        status: 'success',
        tool: { displayName: r.name, name: r.name },
        invocation: { getDescription: () => 'desc' },
        response: { responseParts: [], resultDisplay: 'done' },
        startTime: Date.now(),
        endTime: Date.now(),
      }));
      await capturedOnComplete(Symbol('test-scheduler'), tools, {
        isPrimary: true,
      });
      addItemOrder.push('scheduleToolCalls_END');
    });

    mockAddItem.mockImplementation((item: { type: string }) => {
      addItemOrder.push(`addItem:${item.type}`);
    });

    // We need to capture the onComplete callback from useReactToolScheduler
    const mockUseReactToolScheduler = useReactToolScheduler as Mock;
    mockUseReactToolScheduler.mockImplementation((onComplete) => {
      capturedOnComplete = onComplete;
      return [
        [], // toolCalls
        mockScheduleToolCalls,
        vi.fn(), // markToolsAsDisplayCleared
        vi.fn(), // cancelAllToolCalls
        0, // lastToolOutputTime
        true, // interactiveRuntimeReady
      ];
    });

    const { result } = renderHook(() =>
      useAgentStream(
        new MockedAgentClientClass(mockConfig),
        [],
        mockAddItem,
        mockConfig,
        mockLoadedSettings,
        vi.fn(),
        vi.fn(),
        false,
        () => 'vscode' as EditorType,
        vi.fn(),
        vi.fn(),
        false,
        vi.fn(),
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

    // Expectation: addItem:gemini (rationale) MUST happen before scheduleToolCalls_START
    const rationaleIndex = addItemOrder.indexOf('addItem:gemini');
    const scheduleIndex = addItemOrder.indexOf('scheduleToolCalls_START');
    const toolGroupIndex = addItemOrder.indexOf('addItem:tool_group');

    expect(rationaleIndex).toBeGreaterThan(-1);
    expect(scheduleIndex).toBeGreaterThan(-1);
    expect(toolGroupIndex).toBeGreaterThan(-1);

    // This is the core fix validation: Rationale comes before tools are even scheduled (awaited)
    expect(rationaleIndex).toBeLessThan(scheduleIndex);
    expect(rationaleIndex).toBeLessThan(toolGroupIndex);
  });
});
