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
import { useKeypress } from './useKeypress.js';
import * as atCommandProcessor from './atCommandProcessor.js';
import type {
  TrackedToolCall,
  TrackedExecutingToolCall,
  TrackedCancelledToolCall,
  TrackedWaitingToolCall,
} from './useReactToolScheduler.js';
import { useReactToolScheduler } from './useReactToolScheduler.js';
import type {
  Config,
  EditorType,
  AnyToolInvocation,
  AnyDeclarativeTool,
  ToolRegistry,
} from '@vybestack/llxprt-code-core';
import { ApprovalMode } from '@vybestack/llxprt-code-core';
import type { PartListUnion } from '@google/genai';
import type { UseHistoryManagerReturn } from './useHistoryManager.js';
import type { SlashCommandProcessorResult } from '../types.js';
import { MessageType, StreamingState } from '../types.js';
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

  describe('User Cancellation', () => {
    let keypressCallback: (key: string) => void;
    const mockUseKeypress = useKeypress as Mock;

    beforeEach(() => {
      // Capture the callback passed to useKeypress
      mockUseKeypress.mockImplementation((callback, options) => {
        if (options.isActive === true) {
          keypressCallback = callback;
        } else {
          keypressCallback = () => {};
        }
      });
    });

    const simulateEscapeKeyPress = () => {
      act(() => {
        keypressCallback({ name: 'escape' });
      });
    };

    it('should cancel an in-progress stream when escape is pressed', async () => {
      const mockStream = (async function* () {
        yield { type: 'content', value: 'Part 1' };
        // Keep the stream open
        await new Promise(() => {});
      })();
      mockSendMessageStream.mockReturnValue(mockStream);

      const { result } = renderTestHook();

      // Start a query
      await act(async () => {
        await result.current.submitQuery('test query');
      });

      // Wait for the first part of the response
      await waitFor(() => {
        expect(result.current.streamingState).toBe(StreamingState.Responding);
      });

      // Simulate escape key press
      simulateEscapeKeyPress();

      // Verify cancellation message is added
      await waitFor(() => {
        expect(mockAddItem).toHaveBeenCalledWith(
          {
            type: MessageType.INFO,
            text: 'Request cancelled.',
          },
          expect.any(Number),
        );
      });

      // Verify state is reset
      expect(result.current.streamingState).toBe(StreamingState.Idle);
    });

    it('should call onCancelSubmit handler when escape is pressed', async () => {
      const cancelSubmitSpy = vi.fn();
      const mockStream = (async function* () {
        yield { type: 'content', value: 'Part 1' };
        // Keep the stream open
        await new Promise(() => {});
      })();
      mockSendMessageStream.mockReturnValue(mockStream);

      const { result } = renderHook(() =>
        useGeminiStream(
          mockConfig.getAgentClient(),
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
          cancelSubmitSpy,
          () => {},
          80,
          24,
        ),
      );

      // Start a query
      await act(async () => {
        await result.current.submitQuery('test query');
      });

      simulateEscapeKeyPress();

      expect(cancelSubmitSpy).toHaveBeenCalled();
      // Normal cancel should NOT request prompt restoration
      expect(cancelSubmitSpy).not.toHaveBeenCalledWith(true);
    });

    it('should call setShellInputFocused(false) when escape is pressed', async () => {
      const setShellInputFocusedSpy = vi.fn();
      const mockStream = (async function* () {
        yield { type: 'content', value: 'Part 1' };
        await new Promise(() => {}); // Keep stream open
      })();
      mockSendMessageStream.mockReturnValue(mockStream);

      const { result } = renderHook(() =>
        useGeminiStream(
          mockConfig.getAgentClient(),
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
          vi.fn(),
          setShellInputFocusedSpy, // Pass the spy here
          80,
          24,
        ),
      );

      // Start a query
      await act(async () => {
        await result.current.submitQuery('test query');
      });

      simulateEscapeKeyPress();

      expect(setShellInputFocusedSpy).toHaveBeenCalledWith(false);
    });

    it('should not do anything if escape is pressed when not responding', () => {
      const { result } = renderTestHook();

      expect(result.current.streamingState).toBe(StreamingState.Idle);

      // Simulate escape key press
      simulateEscapeKeyPress();

      // No change should happen, no cancellation message
      expect(mockAddItem).not.toHaveBeenCalledWith(
        expect.objectContaining({
          text: 'Request cancelled.',
        }),
        expect.any(Number),
      );
    });

    it('should prevent further processing after cancellation', async () => {
      let continueStream: () => void;
      const streamPromise = new Promise<void>((resolve) => {
        continueStream = resolve;
      });

      const mockStream = (async function* () {
        yield { type: 'content', value: 'Initial' };
        await streamPromise; // Wait until we manually continue
        yield { type: 'content', value: ' Canceled' };
      })();
      mockSendMessageStream.mockReturnValue(mockStream);

      const { result } = renderTestHook();

      await act(async () => {
        await result.current.submitQuery('long running query');
      });

      await waitFor(() => {
        expect(result.current.streamingState).toBe(StreamingState.Responding);
      });

      // Cancel the request
      simulateEscapeKeyPress();

      // Allow the stream to continue
      await act(async () => {
        continueStream();
        // Wait a bit to see if the second part is processed
        await new Promise((resolve) => setTimeout(resolve, 50));
      });

      // The text should not have been updated with " Canceled"
      const lastCall = mockAddItem.mock.calls.find(
        (call) => call[0].type === 'gemini',
      );
      expect(lastCall?.[0].text).toBe('Initial');

      // The final state should be idle after cancellation
      expect(result.current.streamingState).toBe(StreamingState.Idle);
    });

    it('should cancel if a tool call is in progress', async () => {
      const toolCalls: TrackedToolCall[] = [
        {
          request: { callId: 'call1', name: 'tool1', args: {} },
          status: 'executing',
          displayCleared: false,
          tool: {
            name: 'tool1',
            description: 'desc1',
            build: vi.fn().mockImplementation((_) => ({
              getDescription: () => `Mock description`,
            })),
          } as unknown as AnyDeclarativeTool,
          invocation: {
            getDescription: () => `Mock description`,
          },
          startTime: Date.now(),
          liveOutput: '...',
        } as TrackedExecutingToolCall,
      ];

      const { result } = renderTestHook(toolCalls);

      // State is `Responding` because a tool is running
      expect(result.current.streamingState).toBe(StreamingState.Responding);

      // Try to cancel
      simulateEscapeKeyPress();

      // The cancel function should be called
      expect(mockCancelAllToolCalls).toHaveBeenCalled();
    });

    it('should cancel a request when a tool is awaiting confirmation', async () => {
      const mockOnConfirm = vi.fn().mockResolvedValue(undefined);
      const toolCalls: TrackedToolCall[] = [
        {
          request: {
            callId: 'confirm-call',
            name: 'some_tool',
            args: {},
            isClientInitiated: false,
            prompt_id: 'prompt-id-1',
          },
          status: 'awaiting_approval',
          displayCleared: false,
          tool: {
            name: 'some_tool',
            description: 'a tool',
            build: vi.fn().mockImplementation((_) => ({
              getDescription: () => `Mock description`,
            })),
          } as unknown as AnyDeclarativeTool,
          invocation: {
            getDescription: () => `Mock description`,
          } as unknown as AnyToolInvocation,
          confirmationDetails: {
            type: 'edit',
            title: 'Confirm Edit',
            onConfirm: mockOnConfirm,
            fileName: 'file.txt',
            filePath: '/test/file.txt',
            fileDiff: 'fake diff',
            originalContent: 'old',
            newContent: 'new',
          },
        } as TrackedWaitingToolCall,
      ];

      const { result } = renderTestHook(toolCalls);

      // State is `WaitingForConfirmation` because a tool is awaiting approval
      expect(result.current.streamingState).toBe(
        StreamingState.WaitingForConfirmation,
      );

      // Try to cancel
      simulateEscapeKeyPress();

      // The imperative cancel function should be called on the scheduler
      expect(mockCancelAllToolCalls).toHaveBeenCalled();

      // A cancellation message should be added to history
      await waitFor(() => {
        expect(mockAddItem).toHaveBeenCalledWith(
          expect.objectContaining({
            text: 'Request cancelled.',
          }),
          expect.any(Number),
        );
      });

      // The final state should be idle
      expect(result.current.streamingState).toBe(StreamingState.Idle);
    });
  });
});
