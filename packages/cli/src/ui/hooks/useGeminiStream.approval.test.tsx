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
import { useGeminiStream } from './geminiStream/index.js';
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
import {
  ApprovalMode,
  ToolConfirmationOutcome,
  debugLogger,
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
  const createMockToolCall = (
    toolName: string,
    callId: string,
    confirmationType: 'edit' | 'info',
    mockOnConfirm: Mock,
    status: TrackedToolCall['status'] = 'awaiting_approval',
  ): TrackedWaitingToolCall => ({
    request: {
      callId,
      name: toolName,
      args: {},
      isClientInitiated: false,
      prompt_id: 'prompt-id-1',
    },
    status: status as 'awaiting_approval',
    displayCleared: false,
    confirmationDetails:
      confirmationType === 'edit'
        ? {
            type: 'edit',
            title: 'Confirm Edit',
            onConfirm: mockOnConfirm,
            fileName: 'file.txt',
            filePath: '/test/file.txt',
            fileDiff: 'fake diff',
            originalContent: 'old',
            newContent: 'new',
          }
        : {
            type: 'info',
            title: `${toolName} confirmation`,
            onConfirm: mockOnConfirm,
            prompt: `Execute ${toolName}?`,
          },
    tool: {
      name: toolName,
      displayName: toolName,
      description: `${toolName} description`,
      build: vi.fn(),
    } as unknown as AnyDeclarativeTool,
    invocation: {
      getDescription: () => 'Mock description',
    } as unknown as AnyToolInvocation,
  });

  // Helper to render hook with default parameters - reduces boilerplate

  describe('handleApprovalModeChange', () => {
    it('should auto-approve all pending tool calls when switching to YOLO mode', async () => {
      const mockOnConfirm = vi.fn().mockResolvedValue(undefined);
      const awaitingApprovalToolCalls: TrackedToolCall[] = [
        createMockToolCall('replace', 'call1', 'edit', mockOnConfirm),
        createMockToolCall('read_file', 'call2', 'info', mockOnConfirm),
      ];

      const { result } = renderTestHook(awaitingApprovalToolCalls);

      await act(async () => {
        await result.current.handleApprovalModeChange(ApprovalMode.YOLO);
      });

      // Both tool calls should be auto-approved
      expect(mockOnConfirm).toHaveBeenCalledTimes(2);
      expect(mockOnConfirm).toHaveBeenCalledWith(
        ToolConfirmationOutcome.ProceedOnce,
      );
    });

    it('should only auto-approve edit tools when switching to AUTO_EDIT mode', async () => {
      const mockOnConfirmReplace = vi.fn().mockResolvedValue(undefined);
      const mockOnConfirmWrite = vi.fn().mockResolvedValue(undefined);
      const mockOnConfirmRead = vi.fn().mockResolvedValue(undefined);

      const awaitingApprovalToolCalls: TrackedToolCall[] = [
        createMockToolCall('replace', 'call1', 'edit', mockOnConfirmReplace),
        createMockToolCall('write_file', 'call2', 'edit', mockOnConfirmWrite),
        createMockToolCall('read_file', 'call3', 'info', mockOnConfirmRead),
      ];

      const { result } = renderTestHook(awaitingApprovalToolCalls);

      await act(async () => {
        await result.current.handleApprovalModeChange(ApprovalMode.AUTO_EDIT);
      });

      // Only replace and write_file should be auto-approved
      expect(mockOnConfirmReplace).toHaveBeenCalledWith(
        ToolConfirmationOutcome.ProceedOnce,
      );
      expect(mockOnConfirmWrite).toHaveBeenCalledWith(
        ToolConfirmationOutcome.ProceedOnce,
      );

      // read_file should not be auto-approved
      expect(mockOnConfirmRead).not.toHaveBeenCalled();
    });

    it('should not auto-approve any tools when switching to REQUIRE_CONFIRMATION mode', async () => {
      const mockOnConfirm = vi.fn().mockResolvedValue(undefined);
      const awaitingApprovalToolCalls: TrackedToolCall[] = [
        createMockToolCall('replace', 'call1', 'edit', mockOnConfirm),
      ];

      const { result } = renderTestHook(awaitingApprovalToolCalls);

      await act(async () => {
        await result.current.handleApprovalModeChange(ApprovalMode.DEFAULT);
      });

      // No tools should be auto-approved
      expect(mockOnConfirm).not.toHaveBeenCalled();
    });

    it('should handle errors gracefully when auto-approving tool calls', async () => {
      const debuggerSpy = vi
        .spyOn(debugLogger, 'warn')
        .mockImplementation(() => {});
      const mockOnConfirmSuccess = vi.fn().mockResolvedValue(undefined);
      const mockOnConfirmError = vi
        .fn()
        .mockRejectedValue(new Error('Approval failed'));

      const awaitingApprovalToolCalls: TrackedToolCall[] = [
        createMockToolCall('replace', 'call1', 'edit', mockOnConfirmSuccess),
        createMockToolCall('write_file', 'call2', 'edit', mockOnConfirmError),
      ];

      const { result } = renderTestHook(awaitingApprovalToolCalls);

      await act(async () => {
        await result.current.handleApprovalModeChange(ApprovalMode.YOLO);
      });

      // Both confirmation methods should be called
      expect(mockOnConfirmSuccess).toHaveBeenCalled();
      expect(mockOnConfirmError).toHaveBeenCalled();

      // Error should be logged
      expect(debuggerSpy).toHaveBeenCalledWith(
        'Failed to auto-approve tool call call2:',
        expect.any(Error),
      );

      debuggerSpy.mockRestore();
    });

    it('should skip tool calls without confirmationDetails', async () => {
      const debuggerSpy = vi
        .spyOn(debugLogger, 'warn')
        .mockImplementation(() => {});
      const awaitingApprovalToolCalls: TrackedToolCall[] = [
        {
          request: {
            callId: 'call1',
            name: 'replace',
            args: { old_string: 'old', new_string: 'new' },
            isClientInitiated: false,
            prompt_id: 'prompt-id-1',
          },
          status: 'awaiting_approval',
          displayCleared: false,
          // No confirmationDetails
          tool: {
            name: 'replace',
            displayName: 'replace',
            description: 'Replace text',
            build: vi.fn(),
          } as unknown as AnyDeclarativeTool,
          invocation: {
            getDescription: () => 'Mock description',
          } as unknown as AnyToolInvocation,
        } as unknown as TrackedWaitingToolCall,
      ];

      const { result } = renderTestHook(awaitingApprovalToolCalls);

      // Should not throw an error
      await act(async () => {
        await result.current.handleApprovalModeChange(ApprovalMode.YOLO);
      });

      // The skip path must be silent: no auto-approve failure logged.
      expect(debuggerSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('Failed to auto-approve tool call'),
        expect.anything(),
      );

      debuggerSpy.mockRestore();
    });

    it('should skip tool calls without onConfirm method in confirmationDetails', async () => {
      const awaitingApprovalToolCalls: TrackedToolCall[] = [
        {
          request: {
            callId: 'call1',
            name: 'replace',
            args: { old_string: 'old', new_string: 'new' },
            isClientInitiated: false,
            prompt_id: 'prompt-id-1',
          },
          status: 'awaiting_approval',
          displayCleared: false,
          confirmationDetails: {
            type: 'edit',
            title: 'Confirm Edit',
            // No onConfirm method
            fileName: 'file.txt',
            filePath: '/test/file.txt',
            fileDiff: 'fake diff',
            originalContent: 'old',
            newContent: 'new',
          } as unknown as AnyDeclarativeTool,
          tool: {
            name: 'replace',
            displayName: 'replace',
            description: 'Replace text',
            build: vi.fn(),
          } as unknown as AnyDeclarativeTool,
          invocation: {
            getDescription: () => 'Mock description',
          } as unknown as AnyToolInvocation,
        } as TrackedWaitingToolCall,
      ];

      const debuggerSpy = vi
        .spyOn(debugLogger, 'warn')
        .mockImplementation(() => {});

      const { result } = renderTestHook(awaitingApprovalToolCalls);

      // Should not throw an error
      await act(async () => {
        await result.current.handleApprovalModeChange(ApprovalMode.YOLO);
      });

      // The skip path (confirmationDetails present but without onConfirm) must
      // be silent: no auto-approve failure logged.
      expect(debuggerSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('Failed to auto-approve tool call'),
        expect.anything(),
      );

      debuggerSpy.mockRestore();
    });

    it('should only process tool calls with awaiting_approval status', async () => {
      const mockOnConfirmAwaiting = vi.fn().mockResolvedValue(undefined);
      const mockOnConfirmExecuting = vi.fn().mockResolvedValue(undefined);

      const mixedStatusToolCalls: TrackedToolCall[] = [
        {
          request: {
            callId: 'call1',
            name: 'replace',
            args: { old_string: 'old', new_string: 'new' },
            isClientInitiated: false,
            prompt_id: 'prompt-id-1',
          },
          status: 'awaiting_approval',
          displayCleared: false,
          confirmationDetails: {
            type: 'edit',
            title: 'Confirm Edit',
            onConfirm: mockOnConfirmAwaiting,
            fileName: 'file.txt',
            filePath: '/test/file.txt',
            fileDiff: 'fake diff',
            originalContent: 'old',
            newContent: 'new',
          },
          tool: {
            name: 'replace',
            displayName: 'replace',
            description: 'Replace text',
            build: vi.fn(),
          } as unknown as AnyDeclarativeTool,
          invocation: {
            getDescription: () => 'Mock description',
          } as unknown as AnyToolInvocation,
        } as TrackedWaitingToolCall,
        {
          request: {
            callId: 'call2',
            name: 'write_file',
            args: { path: '/test/file.txt', content: 'content' },
            isClientInitiated: false,
            prompt_id: 'prompt-id-1',
          },
          status: 'executing',
          displayCleared: false,
          tool: {
            name: 'write_file',
            displayName: 'write_file',
            description: 'Write file',
            build: vi.fn(),
          } as unknown as AnyDeclarativeTool,
          invocation: {
            getDescription: () => 'Mock description',
          } as unknown as AnyToolInvocation,
          startTime: Date.now(),
          liveOutput: 'Writing...',
        } as TrackedExecutingToolCall,
      ];

      const { result } = renderTestHook(mixedStatusToolCalls);

      await act(async () => {
        await result.current.handleApprovalModeChange(ApprovalMode.YOLO);
      });

      // Only the awaiting_approval tool should be processed
      expect(mockOnConfirmAwaiting).toHaveBeenCalledTimes(1);
      expect(mockOnConfirmExecuting).not.toHaveBeenCalled();
    });
  });
});
