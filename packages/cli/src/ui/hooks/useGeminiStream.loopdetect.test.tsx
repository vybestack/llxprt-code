/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/** @vitest-environment jsdom */

import type { Mock } from 'vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act } from 'react';
import { renderHook } from '../../test-utils/render.js';
import { waitFor } from '../../test-utils/async.js';
import { useGeminiStream } from './geminiStream/index.js';
import * as atCommandProcessor from './atCommandProcessor.js';
import type {
  TrackedToolCall,
  TrackedCancelledToolCall,
} from './useReactToolScheduler.js';
import { useReactToolScheduler } from './useReactToolScheduler.js';
import type {
  Config,
  EditorType,
  ToolRegistry,
} from '@vybestack/llxprt-code-core';
import {
  ApprovalMode,
  GeminiEventType as ServerGeminiEventType,
} from '@vybestack/llxprt-code-core';
import type { PartListUnion } from '@google/genai';
import type { UseHistoryManagerReturn } from './useHistoryManager.js';
import type { SlashCommandProcessorResult } from '../types.js';
import type { LoadedSettings } from '../../config/settings.js';

// --- MOCKS ---
const mockSendMessageStream = vi
  .fn()
  .mockReturnValue((async function* () {})());
const mockStartChat = vi.fn();

const MockedAgentClientClass = vi.hoisted(() =>
  vi.fn().mockImplementation(function (
    this: Record<string, unknown>,
    _config: unknown,
  ) {
    // _config
    this.startChat = mockStartChat;
    this.sendMessageStream = mockSendMessageStream;
    this.addHistory = vi.fn();
    this.getChat = vi.fn().mockReturnValue({
      recordCompletedToolCalls: vi.fn(),
    });
  }),
);

const MockedUserPromptEvent = vi.hoisted(() =>
  vi.fn().mockImplementation(() => {}),
);
const mockParseAndFormatApiError = vi.hoisted(() => vi.fn());

vi.mock('@vybestack/llxprt-code-core', async (importOriginal) => {
  const actualCoreModule = await importOriginal<Record<string, unknown>>();
  return {
    ...actualCoreModule,
    GitService: vi.fn(),
    AgentClient: MockedAgentClientClass,
    UserPromptEvent: MockedUserPromptEvent,
    parseAndFormatApiError: mockParseAndFormatApiError,
    tokenLimit: vi.fn().mockReturnValue(100), // Mock tokenLimit
  };
});

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

// --- Tests for useGeminiStream Hook ---
describe('useGeminiStream', () => {
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
      geminiMdFileCount: 0,
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

  const renderTestHook = (
    initialToolCalls: TrackedToolCall[] = [],
    agentClient?: unknown,
  ) => {
    const client = agentClient ?? mockConfig.getAgentClient();

    const initialProps = {
      client,
      history: [],
      addItem: mockAddItem as unknown as UseHistoryManagerReturn['addItem'],
      config: mockConfig,
      onDebugMessage: mockOnDebugMessage,
      handleSlashCommand: mockHandleSlashCommand as unknown as (
        cmd: PartListUnion,
      ) => Promise<SlashCommandProcessorResult | false>,
      shellModeActive: false,
      loadedSettings: mockLoadedSettings,
      toolCalls: initialToolCalls,
    };

    const { result, rerender } = renderHook(
      (props: typeof initialProps) => {
        // Create a stateful mock for cancellation that updates the toolCalls state.
        const statefulCancelAllToolCalls = vi.fn((...args) => {
          // Call the original spy so `toHaveBeenCalled` checks still work.
          mockCancelAllToolCalls(...args);

          const newToolCalls = props.toolCalls.map((tc) => {
            // Only cancel tools that are in a cancellable state.
            if (
              tc.status === 'awaiting_approval' ||
              tc.status === 'executing' ||
              tc.status === 'scheduled' ||
              tc.status === 'validating'
            ) {
              // A real cancelled tool call has a response object.
              // We need to simulate this to avoid type errors downstream.
              return {
                ...tc,
                status: 'cancelled',
                response: {
                  callId: tc.request.callId,
                  responseParts: [],
                  resultDisplay: 'Request cancelled.',
                },
                displayCleared: true, // Cleared from display
              } as unknown as TrackedCancelledToolCall;
            }
            return tc;
          });
          rerender({ ...props, toolCalls: newToolCalls });
        });

        mockUseReactToolScheduler.mockImplementation(() => [
          props.toolCalls,
          mockScheduleToolCalls,
          mockMarkToolsAsDisplayCleared,
          statefulCancelAllToolCalls, // Use the stateful mock
          0,
          true,
        ]);

        return useGeminiStream(
          props.client,
          props.history,
          props.addItem,
          props.config,
          props.loadedSettings,
          props.onDebugMessage,
          props.handleSlashCommand,
          props.shellModeActive,
          () => 'vscode' as EditorType,
          () => {},
          () => Promise.resolve(),
          false,
          () => {},
          () => {},
          () => {},
          80,
          24,
        );
      },
      {
        initialProps,
      },
    );
    return {
      result,
      rerender,
      mockMarkToolsAsDisplayCleared,
      mockSendMessageStream,
      client,
    };
  };

  // Helper to create mock tool calls - reduces boilerplate

  // Helper to render hook with default parameters - reduces boilerplate

  describe('Loop Detection Confirmation', () => {
    beforeEach(() => {
      // Add mock for getLoopDetectionService to the config
      const mockLoopDetectionService = {
        disableForSession: vi.fn(),
      };
      mockConfig.getAgentClient = vi.fn().mockReturnValue({
        ...new MockedAgentClientClass(mockConfig),
        getLoopDetectionService: () => mockLoopDetectionService,
      });
    });

    it('should set loopDetectionConfirmationRequest when LoopDetected event is received', async () => {
      mockSendMessageStream.mockReturnValue(
        (async function* () {
          yield {
            type: ServerGeminiEventType.Content,
            value: 'Some content',
          };
          yield {
            type: ServerGeminiEventType.LoopDetected,
          };
        })(),
      );

      const { result } = renderTestHook();

      await act(async () => {
        await result.current.submitQuery('test query');
      });

      await waitFor(() => {
        expect(result.current.loopDetectionConfirmationRequest).not.toBeNull();
        expect(
          typeof result.current.loopDetectionConfirmationRequest?.onComplete,
        ).toBe('function');
      });
    });

    it('should disable loop detection and show message when user selects "disable"', async () => {
      const mockLoopDetectionService = {
        disableForSession: vi.fn(),
      };
      const mockClient = {
        ...new MockedAgentClientClass(mockConfig),
        getLoopDetectionService: () => mockLoopDetectionService,
      };
      mockConfig.getAgentClient = vi.fn().mockReturnValue(mockClient);

      // Mock for the initial request
      mockSendMessageStream.mockReturnValueOnce(
        (async function* () {
          yield {
            type: ServerGeminiEventType.LoopDetected,
          };
        })(),
      );

      // Mock for the retry request
      mockSendMessageStream.mockReturnValueOnce(
        (async function* () {
          yield {
            type: ServerGeminiEventType.Content,
            value: 'Retry successful',
          };
          yield {
            type: ServerGeminiEventType.Finished,
            value: { reason: 'STOP' },
          };
        })(),
      );

      const { result } = renderTestHook();

      await act(async () => {
        await result.current.submitQuery('test query');
      });

      // Wait for confirmation request to be set
      await waitFor(() => {
        expect(result.current.loopDetectionConfirmationRequest).not.toBeNull();
      });

      // Simulate user selecting "disable"
      await act(async () => {
        result.current.loopDetectionConfirmationRequest?.onComplete({
          userSelection: 'disable',
        });
      });

      // Verify loop detection was disabled
      expect(mockLoopDetectionService.disableForSession).toHaveBeenCalledTimes(
        1,
      );

      // Verify confirmation request was cleared
      expect(result.current.loopDetectionConfirmationRequest).toBeNull();

      // Verify appropriate message was added
      expect(mockAddItem).toHaveBeenCalledWith(
        {
          type: 'info',
          text: 'Loop detection has been disabled for this session. Retrying request...',
        },
        expect.any(Number),
      );

      // Verify that the request was retried
      await waitFor(() => {
        expect(mockSendMessageStream).toHaveBeenCalledTimes(2);
        expect(mockSendMessageStream).toHaveBeenNthCalledWith(
          2,
          'test query',
          expect.any(AbortSignal),
          expect.any(String),
        );
      });
    });

    it('should keep loop detection enabled and show message when user selects "keep"', async () => {
      const mockLoopDetectionService = {
        disableForSession: vi.fn(),
      };
      const mockClient = {
        ...new MockedAgentClientClass(mockConfig),
        getLoopDetectionService: () => mockLoopDetectionService,
      };
      mockConfig.getAgentClient = vi.fn().mockReturnValue(mockClient);

      mockSendMessageStream.mockReturnValue(
        (async function* () {
          yield {
            type: ServerGeminiEventType.LoopDetected,
          };
        })(),
      );

      const { result } = renderTestHook();

      await act(async () => {
        await result.current.submitQuery('test query');
      });

      // Wait for confirmation request to be set
      await waitFor(() => {
        expect(result.current.loopDetectionConfirmationRequest).not.toBeNull();
      });

      // Simulate user selecting "keep"
      await act(async () => {
        result.current.loopDetectionConfirmationRequest?.onComplete({
          userSelection: 'keep',
        });
      });

      // Verify loop detection was NOT disabled
      expect(mockLoopDetectionService.disableForSession).not.toHaveBeenCalled();

      // Verify confirmation request was cleared
      expect(result.current.loopDetectionConfirmationRequest).toBeNull();

      // Verify appropriate message was added
      expect(mockAddItem).toHaveBeenCalledWith(
        {
          type: 'info',
          text: 'A potential loop was detected. This can happen due to repetitive tool calls or other model behavior. The request has been halted.',
        },
        expect.any(Number),
      );

      // Verify that the request was NOT retried
      expect(mockSendMessageStream).toHaveBeenCalledTimes(1);
    });

    it('should handle multiple loop detection events properly', async () => {
      const { result } = renderTestHook();

      // First loop detection - set up fresh mock for first call
      mockSendMessageStream.mockReturnValueOnce(
        (async function* () {
          yield {
            type: ServerGeminiEventType.LoopDetected,
          };
        })(),
      );

      // First loop detection
      await act(async () => {
        await result.current.submitQuery('first query');
      });

      await waitFor(() => {
        expect(result.current.loopDetectionConfirmationRequest).not.toBeNull();
      });

      // Simulate user selecting "keep" for first request
      await act(async () => {
        result.current.loopDetectionConfirmationRequest?.onComplete({
          userSelection: 'keep',
        });
      });

      expect(result.current.loopDetectionConfirmationRequest).toBeNull();

      // Verify first message was added
      expect(mockAddItem).toHaveBeenCalledWith(
        {
          type: 'info',
          text: 'A potential loop was detected. This can happen due to repetitive tool calls or other model behavior. The request has been halted.',
        },
        expect.any(Number),
      );

      // Second loop detection - set up fresh mock for second call
      mockSendMessageStream.mockReturnValueOnce(
        (async function* () {
          yield {
            type: ServerGeminiEventType.LoopDetected,
          };
        })(),
      );

      // Mock for the retry request
      mockSendMessageStream.mockReturnValueOnce(
        (async function* () {
          yield {
            type: ServerGeminiEventType.Content,
            value: 'Retry successful',
          };
          yield {
            type: ServerGeminiEventType.Finished,
            value: { reason: 'STOP' },
          };
        })(),
      );

      // Second loop detection
      await act(async () => {
        await result.current.submitQuery('second query');
      });

      await waitFor(() => {
        expect(result.current.loopDetectionConfirmationRequest).not.toBeNull();
      });

      // Simulate user selecting "disable" for second request
      await act(async () => {
        result.current.loopDetectionConfirmationRequest?.onComplete({
          userSelection: 'disable',
        });
      });

      expect(result.current.loopDetectionConfirmationRequest).toBeNull();

      // Verify second message was added
      expect(mockAddItem).toHaveBeenCalledWith(
        {
          type: 'info',
          text: 'Loop detection has been disabled for this session. Retrying request...',
        },
        expect.any(Number),
      );

      // Verify that the request was retried
      await waitFor(() => {
        expect(mockSendMessageStream).toHaveBeenCalledTimes(3); // 1st query, 2nd query, retry of 2nd query
        expect(mockSendMessageStream).toHaveBeenNthCalledWith(
          3,
          'second query',
          expect.any(AbortSignal),
          expect.any(String),
        );
      });
    });

    it('should process LoopDetected event after moving pending history to history', async () => {
      mockSendMessageStream.mockReturnValue(
        (async function* () {
          yield {
            type: ServerGeminiEventType.Content,
            value: 'Some response content',
          };
          yield {
            type: ServerGeminiEventType.LoopDetected,
          };
        })(),
      );

      const { result } = renderTestHook();

      await act(async () => {
        await result.current.submitQuery('test query');
      });

      // Verify that the content was added to history before the loop detection dialog
      await waitFor(() => {
        expect(mockAddItem).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'gemini',
            text: 'Some response content',
          }),
          expect.any(Number),
        );
      });

      // Then verify loop detection confirmation request was set
      await waitFor(() => {
        expect(result.current.loopDetectionConfirmationRequest).not.toBeNull();
      });
    });
  });
});
