import type {
  ToolCallResponseInfo,
  AnyDeclarativeTool,
  AnyToolInvocation,
  Config,
  AgentRequestInput,
  EditorType,
  ToolRegistry,
} from '@vybestack/llxprt-code-core';
type ToolResponsePart = ToolCallResponseInfo['responseParts'][number];
/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { automock } from '@vybestack/llxprt-code-test-utils';
import type { Mock } from 'bun:test';
import {
  MockedAgentClientClass,
  mockSendMessageStream,
  mockStartChat,
  createFakeAgentFromMockClient,
} from './__tests__/useAgentStream-test-helpers.js';
import { describe, it, expect, vi, beforeEach } from 'bun:test';
import { act } from 'react';
import { renderHook } from '../../__tests__/render.js';
import { useAgentStream } from './agentStream/index.js';
import { createStreamRuntimeForTest } from './agentStream/__tests__/streamRuntimeTestHelper.js';
import * as atCommandProcessor from './atCommandProcessor.js';
import type {
  TrackedToolCall,
  TrackedCompletedToolCall,
  TrackedExecutingToolCall,
  TrackedCancelledToolCall,
} from './useReactToolScheduler.js';
import { useReactToolScheduler } from './useReactToolScheduler.js';
import { ApprovalMode, ToolErrorType } from '@vybestack/llxprt-code-core';
import type { UseHistoryManagerReturn } from './useHistoryManager.js';
import type { SlashCommandProcessorResult } from '../types.js';
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
  let mockOnDebugMessage: Mock<(message: string) => void>;
  let mockHandleSlashCommand: Mock<Parameters<typeof useAgentStream>[6]>;
  let mockScheduleToolCalls: Mock<ReturnType<typeof useReactToolScheduler>[1]>;
  let mockCancelAllToolCalls: Mock<ReturnType<typeof useReactToolScheduler>[3]>;
  let mockMarkToolsAsDisplayCleared: Mock<
    ReturnType<typeof useReactToolScheduler>[2]
  >;

  beforeEach(() => {
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

  const renderTestHook = (
    initialToolCalls: TrackedToolCall[] = [],
    agentClient?: Parameters<typeof createFakeAgentFromMockClient>[0],
  ) => {
    const client = createFakeAgentFromMockClient(
      agentClient ?? new MockedAgentClientClass(mockConfig),
    );

    const initialProps = {
      client,
      history: [],
      addItem: mockAddItem as unknown as UseHistoryManagerReturn['addItem'],
      runtime: createStreamRuntimeForTest(mockConfig),
      onDebugMessage: mockOnDebugMessage,
      handleSlashCommand: mockHandleSlashCommand as unknown as (
        cmd: AgentRequestInput,
      ) => Promise<SlashCommandProcessorResult | false>,
      shellModeActive: false,
      loadedSettings: mockLoadedSettings,
      toolCalls: initialToolCalls,
    };

    const { result, rerender } = renderHook(
      (props: typeof initialProps) => {
        // Create a stateful mock for cancellation that updates the toolCalls state.
        const statefulCancelAllToolCalls = vi.fn(() => {
          // Call the original spy so `toHaveBeenCalled` checks still work.
          mockCancelAllToolCalls();

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
          statefulCancelAllToolCalls,
          0,
          true,
          vi.fn(),
          vi.fn(),
        ]);

        return useAgentStream(
          props.client,
          props.history,
          props.addItem,
          props.runtime,
          props.loadedSettings,
          props.onDebugMessage,
          props.handleSlashCommand,
          props.shellModeActive,
          () => 'vscode' as EditorType,
          () => {},
          () => Promise.resolve(),
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

  it('should not submit tool responses if not all tool calls are completed', () => {
    const toolCalls: TrackedToolCall[] = [
      {
        request: {
          callId: 'call1',
          name: 'tool1',
          args: {},
          isClientInitiated: false,
          prompt_id: 'prompt-id-1',
        },
        status: 'success',
        displayCleared: false,
        response: {
          callId: 'call1',
          responseParts: [{ type: 'text', text: 'tool 1 response' }],
          error: undefined,
          errorType: undefined, // FIX: Added missing property
          resultDisplay: 'Tool 1 success display',
        },
        tool: {
          name: 'tool1',
          displayName: 'tool1',
          description: 'desc1',
          build: vi.fn(),
        } as unknown as AnyDeclarativeTool,
        invocation: {
          getDescription: () => `Mock description`,
        } as unknown as AnyToolInvocation,
        startTime: Date.now(),
        durationMs: 0,
        endTime: Date.now(),
      } as TrackedCompletedToolCall,
      {
        request: {
          callId: 'call2',
          name: 'tool2',
          args: {},
          prompt_id: 'prompt-id-1',
        },
        status: 'executing',
        displayCleared: false,
        tool: {
          name: 'tool2',
          displayName: 'tool2',
          description: 'desc2',
          build: vi.fn(),
        } as unknown as AnyDeclarativeTool,
        invocation: {
          getDescription: () => `Mock description`,
        } as unknown as AnyToolInvocation,
        startTime: Date.now(),
        liveOutput: '...',
      } as TrackedExecutingToolCall,
    ];

    const { mockMarkToolsAsDisplayCleared, mockSendMessageStream } =
      renderTestHook(toolCalls);

    // Effect for submitting tool responses depends on toolCalls and isResponding
    // isResponding is initially false, so the effect should run.

    expect(mockMarkToolsAsDisplayCleared).not.toHaveBeenCalled();
    expect(mockSendMessageStream).not.toHaveBeenCalled(); // submitQuery uses this
  });

  const completePrimaryToolCalls = async (): Promise<{
    readonly sendMessageStream: ReturnType<typeof vi.fn>;
  }> => {
    const toolCall1ResponseParts: ToolResponsePart[] = [
      { type: 'text', text: 'tool 1 final response' },
    ];
    const toolCall2ResponseParts: ToolResponsePart[] = [
      { type: 'text', text: 'tool 2 final response' },
    ];
    const completedToolCalls: Parameters<
      Parameters<typeof useReactToolScheduler>[0]
    >[1] = [
      {
        request: {
          callId: 'call1',
          name: 'tool1',
          args: {},
          isClientInitiated: false,
          prompt_id: 'prompt-id-2',
        },
        status: 'success',
        displayCleared: false,
        response: {
          callId: 'call1',
          responseParts: toolCall1ResponseParts,
          errorType: undefined,
        },
        tool: {
          displayName: 'MockTool',
        },
        invocation: {
          getDescription: () => `Mock description`,
        } as unknown as AnyToolInvocation,
      } as TrackedCompletedToolCall,
      {
        request: {
          callId: 'call2',
          name: 'tool2',
          args: {},
          isClientInitiated: false,
          prompt_id: 'prompt-id-2',
        },
        status: 'error',
        displayCleared: false,
        response: {
          callId: 'call2',
          responseParts: toolCall2ResponseParts,
          errorType: ToolErrorType.UNHANDLED_EXCEPTION,
        },
      } as TrackedCompletedToolCall,
    ];

    // Capture the onComplete callback
    let capturedOnComplete:
      | ((
          schedulerId: symbol,
          completedTools: Parameters<
            Parameters<typeof useReactToolScheduler>[0]
          >[1],
          metadata: { isPrimary: boolean },
        ) => void | Promise<void>)
      | null = null;

    mockUseReactToolScheduler.mockImplementation((onComplete) => {
      capturedOnComplete = onComplete;
      return [
        [],
        mockScheduleToolCalls,
        mockMarkToolsAsDisplayCleared,
        mockCancelAllToolCalls,
        0,
        true,
        vi.fn(),
        vi.fn(),
      ];
    });

    renderHook(() =>
      useAgentStream(
        createFakeAgentFromMockClient(new MockedAgentClientClass(mockConfig)),
        [],
        mockAddItem,
        createStreamRuntimeForTest(mockConfig),
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

    // Trigger the onComplete callback with completed tools
    await act(async () => {
      if (capturedOnComplete) {
        await capturedOnComplete(Symbol('test-scheduler'), completedToolCalls, {
          isPrimary: true,
        });
      }
    });

    // Continuation is owned by the Agent loop, so sendMessageStream is
    // NOT called again from the CLI for tool-response submission.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    return { sendMessageStream: mockSendMessageStream };
  };

  it('should not call sendMessageStream when all primary tool calls complete (continuation owned by Agent loop)', async () => {
    const completion = await completePrimaryToolCalls();
    expect(completion.sendMessageStream).not.toHaveBeenCalled();
  });

  const completeToolCallsWithFunctionResponses = async (): Promise<{
    readonly sendMessageStream: ReturnType<typeof vi.fn>;
  }> => {
    const functionResponseParts: ToolResponsePart[] = [
      {
        type: 'tool_response',
        callId: 'call1',
        toolName: 'toolFilter',
        result: { result: 'filtered response' },
      },
      { type: 'text', text: 'filtered response' },
    ];
    const completedToolCalls: Parameters<
      Parameters<typeof useReactToolScheduler>[0]
    >[1] = [
      {
        request: {
          callId: 'call-filter',
          name: 'toolFilter',
          args: {},
          isClientInitiated: false,
          prompt_id: 'prompt-id-filter',
        },
        status: 'success',
        displayCleared: false,
        response: {
          callId: 'call-filter',
          responseParts: functionResponseParts,
          errorType: undefined,
        },
        tool: {
          displayName: 'MockTool',
        },
        invocation: {
          getDescription: () => `Mock description`,
        } as unknown as AnyToolInvocation,
      } as TrackedCompletedToolCall,
    ];

    let capturedOnComplete:
      | ((
          schedulerId: symbol,
          completedTools: Parameters<
            Parameters<typeof useReactToolScheduler>[0]
          >[1],
          metadata: { isPrimary: boolean },
        ) => void | Promise<void>)
      | null = null;

    mockUseReactToolScheduler.mockImplementation((onComplete) => {
      capturedOnComplete = onComplete;
      return [
        [],
        mockScheduleToolCalls,
        mockMarkToolsAsDisplayCleared,
        mockCancelAllToolCalls,
        0,
        true,
        vi.fn(),
        vi.fn(),
      ];
    });

    renderHook(() =>
      useAgentStream(
        createFakeAgentFromMockClient(new MockedAgentClientClass(mockConfig)),
        [],
        mockAddItem,
        createStreamRuntimeForTest(mockConfig),
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
      ),
    );

    await act(async () => {
      if (capturedOnComplete) {
        await capturedOnComplete(Symbol('test-scheduler'), completedToolCalls, {
          isPrimary: true,
        });
      }
    });

    // Continuation is owned by the Agent loop, so sendMessageStream is
    // NOT called again from the CLI for tool-response submission.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    return { sendMessageStream: mockSendMessageStream };
  };

  it('should not call sendMessageStream for completed tool calls with functionResponse parts (continuation owned by Agent loop)', async () => {
    const completion = await completeToolCallsWithFunctionResponses();
    expect(completion.sendMessageStream).not.toHaveBeenCalled();
  });
});
