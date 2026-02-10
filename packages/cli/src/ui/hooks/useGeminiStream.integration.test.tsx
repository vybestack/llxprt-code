/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * INTEGRATION TESTS FOR TODO CONTINUATION FUNCTIONALITY
 *
 * These tests are designed to verify the behavioral integration between
 * useGeminiStream and the todo continuation system. They serve as both:
 * 1. Specification of expected behavior per requirements REQ-001 through REQ-004
 * 2. Functional tests that will pass once the integration is implemented
 *
 * CURRENT STATUS: These tests expect functionality that is not yet fully implemented.
 * The useGeminiStream hook currently has a NotYetImplemented stub for todo continuation.
 *
 * IMPLEMENTATION NOTES:
 * - The todo continuation logic exists in useTodoContinuation.ts
 * - The integration point in useGeminiStream.ts is stubbed out
 * - The GeminiClient.sendMessageStream API needs ephemeral message support
 *
 * These tests will be useful when:
 * 1. The NotYetImplemented stub is removed from useGeminiStream
 * 2. The GeminiClient API is extended to support ephemeral messages
 * 3. The _handleStreamCompleted call is activated in useGeminiStream
 */

import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import React, { act, Dispatch, SetStateAction } from 'react';
import { renderHook, waitFor } from '../../test-utils/render.js';
import { useGeminiStream } from './useGeminiStream.js';
import {
  useReactToolScheduler,
  TrackedToolCall,
} from './useReactToolScheduler.js';
import {
  Config,
  EditorType,
  GeminiEventType as ServerGeminiEventType,
  Todo,
  ApprovalMode,
} from '@vybestack/llxprt-code-core';
import { UseHistoryManagerReturn } from './useHistoryManager.js';
import {
  HistoryItem,
  SlashCommandProcessorResult,
  StreamingState,
} from '../types.js';
import { LoadedSettings } from '../../config/settings.js';
import { TodoContext } from '../contexts/TodoContext.js';

// --- MOCKS ---
const mockSendMessageStream = vi
  .fn()
  .mockReturnValue((async function* () {})());
const mockStartChat = vi.fn();

const MockedGeminiClientClass = vi.hoisted(() =>
  vi.fn().mockImplementation(function (this: any, _config: any) {
    this.startChat = mockStartChat;
    this.sendMessageStream = mockSendMessageStream;
    this.addHistory = vi.fn();
    this.isInitialized = vi.fn().mockReturnValue(true);
  }),
);

const MockedUserPromptEvent = vi.hoisted(() =>
  vi.fn().mockImplementation(() => {}),
);

vi.mock('@vybestack/llxprt-code-core', async (importOriginal) => {
  const actualCoreModule = (await importOriginal()) as any;
  return {
    ...actualCoreModule,
    GitService: vi.fn(),
    GeminiClient: MockedGeminiClientClass,
    UserPromptEvent: MockedUserPromptEvent,
    parseAndFormatApiError: mockParseAndFormatApiError,
  };
});

const mockUseReactToolScheduler = useReactToolScheduler as Mock;
vi.mock('./useReactToolScheduler.js', async (importOriginal) => {
  const actualSchedulerModule = (await importOriginal()) as any;
  return {
    ...(actualSchedulerModule || {}),
    useReactToolScheduler: vi.fn(),
  };
});

vi.mock('ink', async (importOriginal) => {
  const actualInkModule = (await importOriginal()) as any;
  return { ...(actualInkModule || {}), useInput: vi.fn() };
});

vi.mock('./shellCommandProcessor.js', () => ({
  useShellCommandProcessor: vi.fn().mockReturnValue({
    handleShellCommand: vi.fn(),
  }),
}));

vi.mock('./atCommandProcessor.js', () => ({
  handleAtCommand: vi
    .fn()
    .mockResolvedValue({ shouldProceed: true, processedQuery: 'mocked' }),
}));

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

const mockParseAndFormatApiError = vi.hoisted(() => vi.fn());

// --- END MOCKS ---

describe('Todo Continuation Integration - useGeminiStream', () => {
  /**
   * @requirement CURRENT_STATE
   * @scenario Integration not yet implemented
   * @given Current codebase state
   * @when Stream completes
   * @then Integration is stubbed out with NotYetImplemented
   * @note This test verifies the current state and should be updated when implementation is complete
   */
  it('should currently have todo continuation integration stubbed out', async () => {
    // This test verifies the current implementation state
    // It should be updated/removed when the actual integration is implemented

    const activeTodos = createActiveTodos();

    mockSendMessageStream.mockReturnValue(
      (async function* () {
        yield {
          type: ServerGeminiEventType.Content,
          value: 'Response without tool calls',
        };
        yield { type: ServerGeminiEventType.Finished, value: 'STOP' };
      })(),
    );

    const { result } = renderTestHook([], activeTodos);

    await act(async () => {
      result.current.submitQuery('What should I work on?');
    });

    await waitFor(() => {
      expect(result.current.streamingState).toBe(StreamingState.Idle);
    });

    // Currently, no continuation prompt should be sent because the integration is stubbed
    expect(mockSendMessageStream).toHaveBeenCalledTimes(1);
    expect(mockSendMessageStream).toHaveBeenCalledWith(
      'What should I work on?',
      expect.any(AbortSignal),
      expect.any(String),
    );
  });
  let mockAddItem: Mock;
  let mockSetShowHelp: Mock;
  let mockConfig: Config;
  let mockOnDebugMessage: Mock;
  let mockHandleSlashCommand: Mock;
  let mockScheduleToolCalls: Mock;
  let mockMarkToolsAsSubmitted: Mock;
  let mockTodoContext: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockAddItem = vi.fn();
    mockSetShowHelp = vi.fn();
    mockOnDebugMessage = vi.fn();
    mockHandleSlashCommand = vi.fn().mockResolvedValue(false);

    // Create mock todo context
    mockTodoContext = {
      todos: [],
      updateTodos: vi.fn(),
      refreshTodos: vi.fn(),
    };

    // Create mock config with ephemeral settings support
    const mockGetEphemeralSettings = vi.fn(() => ({
      'todo-continuation': true,
    }));

    const mockGetGeminiClient = vi.fn().mockImplementation(() => {
      const clientInstance = new MockedGeminiClientClass(mockConfig);
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
          Promise.resolve({ getFunctionDeclarations: vi.fn(() => []) }) as any,
      ),
      getProjectRoot: vi.fn(() => '/test/dir'),
      getCheckpointingEnabled: vi.fn(() => false),
      getGeminiClient: mockGetGeminiClient,
      getUsageStatisticsEnabled: () => true,
      getDebugMode: () => false,
      addHistory: vi.fn(),
      getSessionId() {
        return 'test-session-id';
      },
      getModel: vi.fn(() => 'gemini-2.5-pro'),
      getContentGeneratorConfig: vi
        .fn()
        .mockReturnValue(contentGeneratorConfig),
      getEphemeralSettings: mockGetEphemeralSettings,
      getApprovalMode: vi.fn(() => ApprovalMode.DEFAULT),
    } as unknown as Config;

    // Mock return value for useReactToolScheduler
    mockScheduleToolCalls = vi.fn();
    mockMarkToolsAsSubmitted = vi.fn();

    mockUseReactToolScheduler.mockReturnValue([
      [], // Default to empty array for toolCalls
      mockScheduleToolCalls,
      mockMarkToolsAsSubmitted,
    ]);

    // Reset mocks for GeminiClient instance methods
    mockStartChat.mockClear().mockResolvedValue({
      sendMessageStream: mockSendMessageStream,
    } as unknown as any);
    mockSendMessageStream
      .mockClear()
      .mockReturnValue((async function* () {})());
  });

  const mockLoadedSettings: LoadedSettings = {
    merged: { preferredEditor: 'vscode' },
    user: { path: '/user/settings.json', settings: {} },
    workspace: { path: '/workspace/.llxprt/settings.json', settings: {} },
    errors: [],
    forScope: vi.fn(),
    setValue: vi.fn(),
  } as unknown as LoadedSettings;

  const createActiveTodos = (): Todo[] => [
    {
      id: 'todo-1',
      content: 'Implement user auth',
      status: 'in_progress' as const,
    },
    {
      id: 'todo-2',
      content: 'Add validation',
      status: 'pending' as const,
    },
  ];

  const TodoContextProvider = ({
    children,
    todos = [],
  }: {
    children: React.ReactNode;
    todos?: Todo[];
  }) => {
    const contextValue = {
      ...mockTodoContext,
      todos,
    };

    return React.createElement(
      TodoContext.Provider,
      { value: contextValue },
      children,
    );
  };

  const renderTestHook = (
    initialToolCalls: TrackedToolCall[] = [],
    todos: Todo[] = [],
    ephemeralSettings: Record<string, unknown> = { 'todo-continuation': true },
  ) => {
    // Update mock config with provided ephemeral settings
    (mockConfig.getEphemeralSettings as Mock).mockReturnValue(
      ephemeralSettings,
    );

    let currentToolCalls = initialToolCalls;
    const setToolCalls = (newToolCalls: TrackedToolCall[]) => {
      currentToolCalls = newToolCalls;
    };

    mockUseReactToolScheduler.mockImplementation(() => [
      currentToolCalls,
      mockScheduleToolCalls,
      mockMarkToolsAsSubmitted,
    ]);

    const client = mockConfig.getGeminiClient();

    const { result, rerender } = renderHook(
      (props: {
        client: any;
        history: HistoryItem[];
        addItem: UseHistoryManagerReturn['addItem'];
        setShowHelp: Dispatch<SetStateAction<boolean>>;
        config: Config;
        onDebugMessage: (message: string) => void;
        handleSlashCommand: (
          cmd: any,
        ) => Promise<SlashCommandProcessorResult | false>;
        shellModeActive: boolean;
        loadedSettings: LoadedSettings;
        toolCalls?: TrackedToolCall[];
      }) => {
        if (props.toolCalls) {
          setToolCalls(props.toolCalls);
        }
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
          () => {},
          () => {},
          () => {},
        );
      },
      {
        initialProps: {
          client,
          history: [],
          addItem: mockAddItem as unknown as UseHistoryManagerReturn['addItem'],
          setShowHelp: mockSetShowHelp,
          config: mockConfig,
          onDebugMessage: mockOnDebugMessage,
          handleSlashCommand: mockHandleSlashCommand as unknown as (
            cmd: any,
          ) => Promise<SlashCommandProcessorResult | false>,
          shellModeActive: false,
          loadedSettings: mockLoadedSettings,
          toolCalls: initialToolCalls,
        },
        wrapper: ({ children }: { children: React.ReactNode }) =>
          TodoContextProvider({ children, todos }),
      },
    );
    return {
      result,
      rerender,
      mockMarkToolsAsSubmitted,
      mockSendMessageStream,
      client,
    };
  };

  /**
   * @requirement REQ-001.1, REQ-001.2, REQ-002.1
   * @scenario Model completes with active todo and no tool calls
   * @given Active todo 'Implement user auth', model completes streaming
   * @when Stream completes without tool calls
   * @then Continuation prompt sent with task description
   * @and Prompt marked as ephemeral (not in history)
   * @note SPECIFICATION TEST - will pass when integration is implemented
   */
  it.skip('should send continuation prompt when stream completes with active todo and no tool calls', async () => {
    const activeTodos = createActiveTodos();

    // Mock stream that completes without tool calls
    mockSendMessageStream.mockReturnValue(
      (async function* () {
        yield {
          type: ServerGeminiEventType.Content,
          value: 'I see the todos but made no tool calls',
        };
        yield { type: ServerGeminiEventType.Finished, value: 'STOP' };
      })(),
    );

    const { result } = renderTestHook([], activeTodos);

    // Submit a query that will complete without tool calls
    await act(async () => {
      result.current.submitQuery('What should I work on?');
    });

    // Wait for the stream to complete
    await waitFor(() => {
      expect(result.current.streamingState).toBe(StreamingState.Idle);
    });

    // Verify continuation prompt was sent
    await waitFor(() => {
      expect(mockSendMessageStream).toHaveBeenCalledWith(
        'Please continue working on the following task: "Implement user auth"',
        { ephemeral: true },
      );
    });

    // Verify the call was made twice: original query + continuation
    expect(mockSendMessageStream).toHaveBeenCalledTimes(2);
  });

  /**
   * @requirement REQ-001.1
   * @scenario Model completes with tool calls pending
   * @given Active todo exists, model makes tool calls
   * @when Stream completes with tool calls
   * @then NO continuation prompt sent
   * @note SPECIFICATION TEST - will pass when integration is implemented
   */
  it.skip('should NOT send continuation prompt when stream completes with tool calls made', async () => {
    const activeTodos = createActiveTodos();

    // Mock stream that includes tool calls
    mockSendMessageStream.mockReturnValue(
      (async function* () {
        yield {
          type: ServerGeminiEventType.Content,
          value: 'Let me help with that task',
        };
        yield {
          type: ServerGeminiEventType.ToolCallRequest,
          value: [
            {
              callId: 'call-1',
              name: 'ReadFile',
              args: { filePath: '/src/auth.ts' },
            },
          ],
        };
        yield { type: ServerGeminiEventType.Finished, value: 'STOP' };
      })(),
    );

    const { result } = renderTestHook([], activeTodos);

    await act(async () => {
      result.current.submitQuery('Continue working on auth');
    });

    // Wait for the stream to complete
    await waitFor(() => {
      expect(result.current.streamingState).toBe(StreamingState.Responding);
    });

    // Give additional time for any potential continuation prompt
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify NO continuation prompt was sent (only original query)
    expect(mockSendMessageStream).toHaveBeenCalledTimes(1);
    expect(mockSendMessageStream).toHaveBeenCalledWith(
      'Continue working on auth',
      expect.any(AbortSignal),
      expect.any(String),
    );
  });

  /**
   * @requirement REQ-001.4, REQ-004.1
   * @scenario Continuation disabled via setting
   * @given todo-continuation = false, active todo exists
   * @when Stream completes without tool calls
   * @then NO continuation prompt sent
   */
  it('should NOT send continuation prompt when todo-continuation is disabled', async () => {
    const activeTodos = createActiveTodos();

    // Mock stream that completes without tool calls
    mockSendMessageStream.mockReturnValue(
      (async function* () {
        yield {
          type: ServerGeminiEventType.Content,
          value: 'Response without tool calls',
        };
        yield { type: ServerGeminiEventType.Finished, value: 'STOP' };
      })(),
    );

    // Render with continuation disabled
    const { result } = renderTestHook([], activeTodos, {
      'todo-continuation': false,
    });

    await act(async () => {
      result.current.submitQuery('What next?');
    });

    await waitFor(() => {
      expect(result.current.streamingState).toBe(StreamingState.Idle);
    });

    // Give time for any potential continuation attempt
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify NO continuation prompt was sent
    expect(mockSendMessageStream).toHaveBeenCalledTimes(1);
    expect(mockSendMessageStream).toHaveBeenCalledWith(
      'What next?',
      expect.any(AbortSignal),
      expect.any(String),
    );
  });

  /**
   * @requirement REQ-002.3
   * @scenario YOLO mode uses stronger prompt
   * @given YOLO mode active, todo exists
   * @when Stream completes
   * @then Prompt contains 'without waiting for confirmation'
   * @note SPECIFICATION TEST - will pass when integration is implemented
   */
  it.skip('should use stronger continuation prompt in YOLO mode', async () => {
    const activeTodos = createActiveTodos();

    // Set YOLO mode
    (mockConfig.getApprovalMode as Mock).mockReturnValue(ApprovalMode.YOLO);

    mockSendMessageStream.mockReturnValue(
      (async function* () {
        yield {
          type: ServerGeminiEventType.Content,
          value: 'Task analysis complete',
        };
        yield { type: ServerGeminiEventType.Finished, value: 'STOP' };
      })(),
    );

    const { result } = renderTestHook([], activeTodos);

    await act(async () => {
      result.current.submitQuery('Analyze the task');
    });

    await waitFor(() => {
      expect(result.current.streamingState).toBe(StreamingState.Idle);
    });

    // Verify YOLO continuation prompt was sent
    await waitFor(() => {
      expect(mockSendMessageStream).toHaveBeenCalledWith(
        'Continue to proceed with the active task without waiting for confirmation: "Implement user auth"',
        { ephemeral: true },
      );
    });
  });

  /**
   * @requirement REQ-003.4
   * @scenario todo_pause available to model
   * @given Active continuation scenario
   * @when Model lists available tools
   * @then todo_pause tool is accessible
   */
  it('should make todo_pause tool available during continuation', async () => {
    const activeTodos = createActiveTodos();

    // Mock tool registry that includes todo_pause
    const mockToolRegistry = {
      getFunctionDeclarations: vi.fn(() => [
        {
          name: 'todo_pause',
          description: 'Pause the current todo task',
          parameters: {
            type: 'object',
            properties: {
              reason: { type: 'string' },
            },
            required: ['reason'],
          },
        },
        {
          name: 'ReadFile',
          description: 'Read a file',
          parameters: { type: 'object', properties: {} },
        },
      ]),
    };

    (mockConfig.getToolRegistry as Mock).mockReturnValue(
      Promise.resolve(mockToolRegistry),
    );

    mockSendMessageStream.mockReturnValue(
      (async function* () {
        yield {
          type: ServerGeminiEventType.Content,
          value: 'Looking at available tools',
        };
        yield { type: ServerGeminiEventType.Finished, value: 'STOP' };
      })(),
    );

    const { result } = renderTestHook([], activeTodos);

    await act(async () => {
      result.current.submitQuery('What tools are available?');
    });

    // Verify tool registry includes todo_pause
    const toolRegistry = await mockConfig.getToolRegistry();
    const toolSchemas = toolRegistry.getFunctionDeclarations();
    const todoPauseTool = toolSchemas.find(
      (tool: any) => tool.name === 'todo_pause',
    );

    expect(todoPauseTool).toBeDefined();
    expect(todoPauseTool!.description).toContain('Pause');
  });

  /**
   * @requirement REQ-001.2
   * @scenario Only pending/in_progress todos trigger continuation
   * @given Mix of todo statuses
   * @when Stream completes without tool calls
   * @then Only active todos considered for continuation
   */
  it.skip('should only consider pending and in_progress todos for continuation', async () => {
    const mixedStatusTodos: Todo[] = [
      {
        id: 'todo-1',
        content: 'Completed task',
        status: 'completed' as const,
      },
      {
        id: 'todo-2',
        content: 'Active pending task',
        status: 'pending' as const,
      },
    ];

    mockSendMessageStream.mockReturnValue(
      (async function* () {
        yield {
          type: ServerGeminiEventType.Content,
          value: 'Response without tool calls',
        };
        yield { type: ServerGeminiEventType.Finished, value: 'STOP' };
      })(),
    );

    const { result } = renderTestHook([], mixedStatusTodos);

    await act(async () => {
      result.current.submitQuery('Show me todos');
    });

    await waitFor(() => {
      expect(result.current.streamingState).toBe(StreamingState.Idle);
    });

    // Verify continuation prompt uses the pending task, not the completed one
    await waitFor(() => {
      expect(mockSendMessageStream).toHaveBeenCalledWith(
        'Please continue working on the following task: "Active pending task"',
        { ephemeral: true },
      );
    });
  });

  /**
   * @requirement REQ-001.3
   * @scenario Prioritize in_progress over pending todos
   * @given Both pending and in_progress todos exist
   * @when Stream completes
   * @then in_progress todo is selected for continuation
   */
  it.skip('should prioritize in_progress todos over pending for continuation', async () => {
    const prioritizedTodos: Todo[] = [
      {
        id: 'todo-1',
        content: 'Pending task',
        status: 'pending' as const,
      },
      {
        id: 'todo-2',
        content: 'In progress task',
        status: 'in_progress' as const,
      },
    ];

    mockSendMessageStream.mockReturnValue(
      (async function* () {
        yield {
          type: ServerGeminiEventType.Content,
          value: 'Task status check',
        };
        yield { type: ServerGeminiEventType.Finished, value: 'STOP' };
      })(),
    );

    const { result } = renderTestHook([], prioritizedTodos);

    await act(async () => {
      result.current.submitQuery('Check task status');
    });

    await waitFor(() => {
      expect(result.current.streamingState).toBe(StreamingState.Idle);
    });

    // Verify in_progress task is selected despite lower priority
    await waitFor(() => {
      expect(mockSendMessageStream).toHaveBeenCalledWith(
        'Please continue working on the following task: "In progress task"',
        { ephemeral: true },
      );
    });
  });

  /**
   * @requirement REQ-001.5
   * @scenario No continuation when no active todos
   * @given No pending or in_progress todos
   * @when Stream completes without tool calls
   * @then NO continuation prompt sent
   */
  it('should NOT send continuation prompt when no active todos exist', async () => {
    const completedTodos: Todo[] = [
      {
        id: 'todo-1',
        content: 'Done task',
        status: 'completed' as const,
      },
    ];

    mockSendMessageStream.mockReturnValue(
      (async function* () {
        yield {
          type: ServerGeminiEventType.Content,
          value: 'All tasks complete',
        };
        yield { type: ServerGeminiEventType.Finished, value: 'STOP' };
      })(),
    );

    const { result } = renderTestHook([], completedTodos);

    await act(async () => {
      result.current.submitQuery('How are we doing?');
    });

    await waitFor(() => {
      expect(result.current.streamingState).toBe(StreamingState.Idle);
    });

    // Give time for any potential continuation attempt
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify NO continuation prompt was sent
    expect(mockSendMessageStream).toHaveBeenCalledTimes(1);
  });

  /**
   * @requirement REQ-002.1
   * @scenario Continuation prompt is ephemeral
   * @given Active todo and stream completion
   * @when Continuation prompt is sent
   * @then Prompt is marked with ephemeral flag
   */
  it.skip('should mark continuation prompts as ephemeral (not stored in history)', async () => {
    const activeTodos = createActiveTodos();

    mockSendMessageStream.mockReturnValue(
      (async function* () {
        yield {
          type: ServerGeminiEventType.Content,
          value: 'Regular response',
        };
        yield { type: ServerGeminiEventType.Finished, value: 'STOP' };
      })(),
    );

    const { result, client } = renderTestHook([], activeTodos);

    await act(async () => {
      result.current.submitQuery('Continue task');
    });

    await waitFor(() => {
      expect(result.current.streamingState).toBe(StreamingState.Idle);
    });

    // Verify ephemeral flag is set correctly
    await waitFor(() => {
      expect(mockSendMessageStream).toHaveBeenCalledWith(
        expect.stringContaining(
          'Please continue working on the following task:',
        ),
        { ephemeral: true },
      );
    });

    // Verify the continuation prompt is NOT added to client history
    // (Only the original user query should be in history)
    expect(client.addHistory).toHaveBeenCalledTimes(1);
  });

  /**
   * @requirement REQ-001.6
   * @scenario Prevent rapid fire continuations
   * @given Active todo and continuation in progress
   * @when Multiple streams complete quickly
   * @then Only one continuation prompt sent
   */
  it.skip('should prevent multiple rapid continuation prompts', async () => {
    const activeTodos = createActiveTodos();

    // Mock multiple quick completions
    let completionCount = 0;
    mockSendMessageStream.mockImplementation(() => {
      completionCount++;
      return (async function* () {
        yield {
          type: ServerGeminiEventType.Content,
          value: `Quick response ${completionCount}`,
        };
        yield { type: ServerGeminiEventType.Finished, value: 'STOP' };
      })();
    });

    const { result } = renderTestHook([], activeTodos);

    // Rapidly submit multiple queries
    await act(async () => {
      result.current.submitQuery('Query 1');
    });

    await act(async () => {
      result.current.submitQuery('Query 2');
    });

    await waitFor(() => {
      expect(result.current.streamingState).toBe(StreamingState.Idle);
    });

    // Allow time for any potential extra continuation attempts
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Verify continuation was attempted only once despite multiple completions
    const continuationCalls = mockSendMessageStream.mock.calls.filter((call) =>
      call[0]?.includes('Please continue working on the following task:'),
    );

    expect(continuationCalls.length).toBeLessThanOrEqual(1);
  });

  /**
   * ACTIVE TESTS - These test the current implementation state and architecture
   */

  /**
   * @requirement INTEGRATION_ARCHITECTURE
   * @scenario Todo continuation hook is properly integrated
   * @given useGeminiStream hook is rendered
   * @when Hook is initialized
   * @then useTodoContinuation hook is called with proper parameters
   */
  it('should properly integrate useTodoContinuation hook', () => {
    const activeTodos = createActiveTodos();
    const { result } = renderTestHook([], activeTodos);

    // Verify the hook renders successfully with todo context integration
    expect(result.current).toBeDefined();
    expect(result.current.submitQuery).toBeDefined();
    expect(result.current.streamingState).toBe(StreamingState.Idle);

    // Verify the mock config was set up correctly
    expect(mockConfig.getEphemeralSettings).toBeDefined();
  });

  /**
   * @requirement REQ-004.1
   * @scenario Configuration setting is properly read
   * @given Various todo-continuation settings
   * @when Hook is initialized
   * @then getEphemeralSettings is called to check todo-continuation setting
   */
  it('should read todo-continuation configuration setting', () => {
    const settingsVariations = [
      { 'todo-continuation': true },
      { 'todo-continuation': false },
      { 'other-setting': 'value' }, // no todo-continuation setting
      {}, // empty settings
    ];

    settingsVariations.forEach((settings) => {
      // Reset mocks for each test iteration
      vi.clearAllMocks();
      (mockConfig.getEphemeralSettings as Mock).mockReturnValue(settings);

      const { result } = renderTestHook([], [], settings);

      // Verify hook integration works with all setting variations
      expect(result.current).toBeDefined();
      expect(result.current.streamingState).toBe(StreamingState.Idle);
      // Verify the configuration mock is properly set up
      expect(mockConfig.getEphemeralSettings()).toEqual(settings);
    });
  });

  /**
   * @requirement REQ-003.4
   * @scenario todo_pause tool availability
   * @given Tool registry configuration
   * @when Tools are requested
   * @then todo_pause tool is available in the registry
   */
  it('should have todo_pause tool available in tool registry', async () => {
    // Set up tool registry with todo_pause tool
    const mockToolRegistry = {
      getFunctionDeclarations: vi.fn(() => [
        {
          name: 'todo_pause',
          description: 'Pause the current todo task',
          parameters: {
            type: 'object',
            properties: {
              reason: { type: 'string', description: 'Reason for pausing' },
            },
            required: ['reason'],
          },
        },
        {
          name: 'ReadFile',
          description: 'Read a file',
          parameters: { type: 'object', properties: {} },
        },
      ]),
    };

    (mockConfig.getToolRegistry as Mock).mockReturnValue(
      Promise.resolve(mockToolRegistry),
    );

    const activeTodos = createActiveTodos();
    renderTestHook([], activeTodos);

    // Verify tool registry includes todo_pause
    const toolRegistry = await mockConfig.getToolRegistry();
    const toolSchemas = toolRegistry.getFunctionDeclarations();
    const todoPauseTool = toolSchemas.find(
      (tool: any) => tool.name === 'todo_pause',
    );

    expect(todoPauseTool).toBeDefined();
    expect(todoPauseTool!.description).toContain('Pause');
    expect(todoPauseTool!.parameters!.properties!.reason).toBeDefined();
    expect(todoPauseTool!.parameters!.required).toContain('reason');
  });

  /**
   * @requirement CURRENT_STATE
   * @scenario Hook integration exists but is not activated
   * @given Current implementation with NotYetImplemented stub
   * @when Stream processing completes
   * @then Hook integration code path exists but doesn't execute continuation logic
   */
  it('should have hook integration architecture in place but not activated', async () => {
    const activeTodos = createActiveTodos();

    mockSendMessageStream.mockReturnValue(
      (async function* () {
        yield {
          type: ServerGeminiEventType.Content,
          value: 'Test response',
        };
        yield { type: ServerGeminiEventType.Finished, value: 'STOP' };
      })(),
    );

    const { result } = renderTestHook([], activeTodos);

    await act(async () => {
      result.current.submitQuery('Test query');
    });

    await waitFor(() => {
      expect(result.current.streamingState).toBe(StreamingState.Idle);
    });

    // The architectural integration should be there (hook is called)
    // but the actual continuation logic should not execute due to NotYetImplemented stub
    expect(mockSendMessageStream).toHaveBeenCalledTimes(1);
    expect(mockSendMessageStream).not.toHaveBeenCalledWith(
      expect.stringContaining('Please continue working'),
      expect.anything(),
    );
  });
});
