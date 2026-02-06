/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Test for issue #1040: Tool calls being executed twice
 *
 * This test verifies that duplicate ToolCallRequest events (same callId)
 * are deduplicated before being scheduled, preventing commands like
 * `mkdir` or `git init` from running twice and failing with "already exists".
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '../../test-utils/render.js';
import { act } from 'react';
import { useGeminiStream } from './useGeminiStream.js';
import {
  Config,
  GeminiClient,
  GeminiEventType,
  ToolCallRequestInfo,
  ToolRegistry,
  ApprovalMode,
  DebugLogger,
} from '@vybestack/llxprt-code-core';
import { LoadedSettings } from '../../config/settings.js';
import type { UseHistoryManagerReturn } from './useHistoryManager.js';
import {
  ToolCallStatus,
  type HistoryItem,
  type HistoryItemWithoutId,
  type SlashCommandProcessorResult,
} from '../types.js';

// Mock core dependencies
vi.mock('@vybestack/llxprt-code-core', async () => {
  const actual = await vi.importActual('@vybestack/llxprt-code-core');
  return {
    ...actual,
    logUserPrompt: vi.fn(),
    GitService: vi.fn().mockImplementation(() => ({
      createFileSnapshot: vi.fn(),
      getCurrentCommitHash: vi.fn(),
    })),
  };
});

// Mock useSessionStats
vi.mock('../contexts/SessionContext.js', () => ({
  useSessionStats: () => ({
    startNewPrompt: vi.fn(),
    getPromptCount: () => 1,
  }),
}));

// Mock useLogger
vi.mock('./useLogger.js', () => ({
  useLogger: () => ({
    logMessage: vi.fn(),
  }),
}));

// Mock useKeypress
vi.mock('./useKeypress.js', () => ({
  useKeypress: vi.fn(),
}));

// Mock useReactToolScheduler to capture scheduled tool calls
const scheduledToolCalls: ToolCallRequestInfo[][] = [];
vi.mock('./useReactToolScheduler.js', () => ({
  useReactToolScheduler: vi.fn(() => {
    const scheduleFn = (
      requests: ToolCallRequestInfo[],
      _signal: AbortSignal,
    ) => {
      scheduledToolCalls.push([...requests]);
    };
    return [
      [], // toolCalls
      scheduleFn,
      vi.fn(), // markToolsAsSubmitted
      vi.fn(), // cancelAllToolCalls
    ];
  }),
  mapToDisplay: vi.fn(() => ({
    type: 'tool_group',
    tools: [],
    agentId: 'primary',
  })),
}));

describe('useGeminiStream duplicate tool call deduplication (issue #1040)', () => {
  let mockGeminiClient: GeminiClient;
  let mockConfig: Config;
  let mockSettings: LoadedSettings;
  let mockAddItem: UseHistoryManagerReturn['addItem'];
  let mockOnDebugMessage: (message: string) => void;
  let mockHandleSlashCommand: (
    cmd: unknown,
  ) => Promise<SlashCommandProcessorResult | false>;
  let mockOnAuthError: () => void;
  let mockPerformMemoryRefresh: () => Promise<void>;
  let mockOnEditorClose: () => void;
  let mockOnCancelSubmit: () => void;
  let mockHistory: HistoryItem[];

  beforeEach(() => {
    // Reset captured tool calls
    scheduledToolCalls.length = 0;

    const mockToolRegistry = {
      getTool: vi.fn(),
      getAllToolNames: vi.fn(() => ['run_shell_command']),
    };

    const mockMessageBus = {
      publish: vi.fn(),
      subscribe: vi.fn(() => vi.fn()),
    };

    mockConfig = {
      getToolRegistry: vi.fn(() => mockToolRegistry as unknown as ToolRegistry),
      getApprovalMode: vi.fn(() => ApprovalMode.DEFAULT),
      getSessionId: () => 'test-session-id',
      getProjectRoot: () => '/test/project',
      getModel: () => 'test-model',
      getMaxSessionTurns: () => 100,
      getContentGeneratorConfig: () => ({
        model: 'test-model',
      }),
      getGeminiClient: () => mockGeminiClient,
      getSettingsService: () => undefined,
      getCheckpointingEnabled: () => false,
      storage: {
        getProjectTempCheckpointsDir: () => '/tmp/checkpoints',
      },
      getMessageBus: () => mockMessageBus,
      getEphemeralSetting: () => undefined,
    } as unknown as Config;

    // Create mock stream generator that emits duplicate tool call requests
    const createDuplicateToolCallStream = async function* () {
      // Simulate a stream that emits the SAME tool call request TWICE
      // This is what appears to be happening in production
      const duplicateToolCallRequest: ToolCallRequestInfo = {
        callId: 'duplicate-call-123',
        name: 'run_shell_command',
        args: { command: 'mkdir test_dir' },
        isClientInitiated: false,
        prompt_id: 'prompt-1',
        agentId: 'primary',
      };

      // First emission
      yield {
        type: GeminiEventType.ToolCallRequest,
        value: duplicateToolCallRequest,
      };

      // Second emission of the SAME callId (this is the bug)
      yield {
        type: GeminiEventType.ToolCallRequest,
        value: duplicateToolCallRequest,
      };

      // Stream finished
      yield {
        type: GeminiEventType.Finished,
        value: { reason: 'STOP' },
      };
    };

    mockGeminiClient = {
      sendMessageStream: vi.fn(() => createDuplicateToolCallStream()),
      getChat: vi.fn(() => ({
        recordCompletedToolCalls: vi.fn(),
      })),
      getCurrentSequenceModel: vi.fn(() => 'test-model'),
      addHistory: vi.fn(),
      getHistory: vi.fn(() => []),
    } as unknown as GeminiClient;

    mockSettings = {
      merged: {},
    } as unknown as LoadedSettings;

    mockAddItem = vi.fn();
    mockOnDebugMessage = vi.fn();
    mockHandleSlashCommand = vi.fn().mockResolvedValue(false);
    mockOnAuthError = vi.fn();
    mockPerformMemoryRefresh = vi.fn().mockResolvedValue(undefined);
    mockOnEditorClose = vi.fn();
    mockOnCancelSubmit = vi.fn();
    mockHistory = [];

    vi.useFakeTimers();
  });

  afterEach(() => {
    // Dispose FileOutput singleton to stop its recurring timer before
    // clearing fake timers. This prevents infinite timer loops when
    // vi.runAllTimersAsync() advances the recurring flush timer.
    // We need to reset all loggers which disposes FileOutput.
    try {
      DebugLogger.resetForTesting();
    } catch (_e) {
      // Ignore if not available
    }

    vi.clearAllTimers();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('should deduplicate tool call requests with the same callId', async () => {
    const { result } = renderHook(() =>
      useGeminiStream(
        mockGeminiClient,
        mockHistory,
        mockAddItem,
        mockConfig,
        mockSettings,
        mockOnDebugMessage,
        mockHandleSlashCommand,
        false, // shellModeActive
        () => undefined, // getPreferredEditor
        mockOnAuthError,
        mockPerformMemoryRefresh,
        mockOnEditorClose,
        mockOnCancelSubmit,
        () => {}, // setShellInputFocused
      ),
    );

    // Submit a query that will trigger the duplicate tool call stream
    await act(async () => {
      await result.current.submitQuery('create a directory');
      await vi.runAllTimersAsync();
    });

    // Verify that scheduleToolCalls was called only ONCE
    // with only ONE tool call request (not two duplicates)
    expect(scheduledToolCalls.length).toBe(1);
    expect(scheduledToolCalls[0].length).toBe(1);
    expect(scheduledToolCalls[0][0].callId).toBe('duplicate-call-123');
  });

  it('should allow different callIds to be scheduled together', async () => {
    // Override the mock to emit two DIFFERENT tool calls
    const createTwoDifferentToolCallsStream = async function* () {
      yield {
        type: GeminiEventType.ToolCallRequest,
        value: {
          callId: 'call-1',
          name: 'run_shell_command',
          args: { command: 'mkdir dir1' },
          isClientInitiated: false,
          prompt_id: 'prompt-1',
          agentId: 'primary',
        },
      };

      yield {
        type: GeminiEventType.ToolCallRequest,
        value: {
          callId: 'call-2',
          name: 'run_shell_command',
          args: { command: 'mkdir dir2' },
          isClientInitiated: false,
          prompt_id: 'prompt-1',
          agentId: 'primary',
        },
      };

      yield {
        type: GeminiEventType.Finished,
        value: { reason: 'STOP' },
      };
    };

    (
      mockGeminiClient.sendMessageStream as ReturnType<typeof vi.fn>
    ).mockReturnValue(createTwoDifferentToolCallsStream());

    const { result } = renderHook(() =>
      useGeminiStream(
        mockGeminiClient,
        mockHistory,
        mockAddItem,
        mockConfig,
        mockSettings,
        mockOnDebugMessage,
        mockHandleSlashCommand,
        false,
        () => undefined,
        mockOnAuthError,
        mockPerformMemoryRefresh,
        mockOnEditorClose,
        mockOnCancelSubmit,
        () => {}, // setShellInputFocused
      ),
    );

    await act(async () => {
      await result.current.submitQuery('create two directories');
      await vi.runAllTimersAsync();
    });

    // Both DIFFERENT tool calls should be scheduled
    expect(scheduledToolCalls.length).toBe(1);
    expect(scheduledToolCalls[0].length).toBe(2);
    expect(scheduledToolCalls[0][0].callId).toBe('call-1');
    expect(scheduledToolCalls[0][1].callId).toBe('call-2');
  });

  it('should keep overlapping non-shell scheduler tools while deduplicating overlapping shell tools in pending display merge', async () => {
    const { mergePendingToolGroupsForDisplay } = await import(
      './useGeminiStream.js'
    );

    const sharedShellCallId = 'shared-shell-call';
    const sharedNonShellCallId = 'shared-non-shell-call';
    const schedulerOnlyCallId = 'scheduler-only-call';

    const pendingHistoryItem: HistoryItemWithoutId = {
      type: 'tool_group',
      agentId: 'primary',
      tools: [
        {
          callId: sharedShellCallId,
          name: 'Shell Command',
          description: 'bash',
          status: ToolCallStatus.Executing,
          resultDisplay: 'pending shell output',
          confirmationDetails: undefined,
          ptyId: 12345,
        },
        {
          callId: sharedNonShellCallId,
          name: 'read_file',
          description: 'Read README.md',
          status: ToolCallStatus.Executing,
          resultDisplay: 'pending read output',
          confirmationDetails: undefined,
        },
      ],
    };

    const pendingToolCallGroupDisplay: HistoryItemWithoutId = {
      type: 'tool_group',
      agentId: 'primary',
      tools: [
        {
          callId: sharedShellCallId,
          name: 'Shell Command',
          description: 'bash',
          status: ToolCallStatus.Executing,
          resultDisplay: 'scheduler shell output',
          confirmationDetails: undefined,
          ptyId: 12345,
        },
        {
          callId: sharedNonShellCallId,
          name: 'read_file',
          description: 'Read README.md',
          status: ToolCallStatus.Executing,
          resultDisplay: 'scheduler read_file output',
          confirmationDetails: undefined,
        },
        {
          callId: schedulerOnlyCallId,
          name: 'search_file_content',
          description: 'Search for TODO',
          status: ToolCallStatus.Executing,
          resultDisplay: 'scheduler search output',
          confirmationDetails: undefined,
        },
      ],
    };

    const mergedItems = mergePendingToolGroupsForDisplay(
      pendingHistoryItem,
      pendingToolCallGroupDisplay,
    );
    const pendingToolGroups = mergedItems.filter(
      (item) => item.type === 'tool_group',
    );
    expect(pendingToolGroups).toHaveLength(2);

    const pendingGroup = pendingToolGroups.find((group) =>
      group.tools.some((tool) => tool.callId === sharedShellCallId),
    );
    const schedulerGroup = pendingToolGroups.find((group) =>
      group.tools.some((tool) => tool.callId === schedulerOnlyCallId),
    );

    expect(pendingGroup).toBeDefined();
    expect(schedulerGroup).toBeDefined();

    const pendingTools = pendingGroup?.tools ?? [];
    const schedulerTools = schedulerGroup?.tools ?? [];

    expect(
      pendingTools.filter((tool) => tool.callId === sharedShellCallId),
    ).toHaveLength(1);
    expect(
      pendingTools.filter((tool) => tool.callId === sharedNonShellCallId),
    ).toHaveLength(1);

    expect(
      schedulerTools.filter((tool) => tool.callId === sharedShellCallId),
    ).toHaveLength(0);
    expect(
      schedulerTools.filter((tool) => tool.callId === sharedNonShellCallId),
    ).toHaveLength(1);
    expect(
      schedulerTools.filter((tool) => tool.callId === schedulerOnlyCallId),
    ).toHaveLength(1);
  });
});
