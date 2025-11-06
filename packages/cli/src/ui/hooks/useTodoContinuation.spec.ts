/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  type MockedFunction,
  type Mock,
} from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTodoContinuation } from './useTodoContinuation.js';
import { useTodoContext } from '../contexts/TodoContext.js';
import {
  Config,
  GeminiClient,
  ApprovalMode,
  type Todo,
} from '@vybestack/llxprt-code-core';

// Mock dependencies
vi.mock('../contexts/TodoContext.js');
vi.mock('@vybestack/llxprt-code-core', async () => {
  const actual = (await vi.importActual(
    '@vybestack/llxprt-code-core',
  )) as Record<string, unknown>;
  return {
    ...actual,
    Config: vi.fn(),
    GeminiClient: vi.fn(),
  };
});

interface MockTodoContext {
  todos: Todo[];
  updateTodos: Mock<(todos: Todo[]) => void>;
  refreshTodos: Mock<() => void>;
}

interface MockConfig {
  getEphemeralSettings: Mock<() => Record<string, unknown>>;
  getApprovalMode: Mock<() => ApprovalMode>;
}

interface MockGeminiClient {
  sendMessageStream: Mock<
    (message: string, options?: { ephemeral: boolean }) => Promise<void>
  >;
}

describe('useTodoContinuation - Behavioral Tests', () => {
  let mockConfig: MockConfig;
  let mockGeminiClient: MockGeminiClient;
  let mockTodoContext: MockTodoContext;
  let mockOnDebugMessage: Mock<(message: string) => void>;

  const createTodo = (
    id: string,
    content: string,
    status: 'pending' | 'in_progress' | 'completed' = 'pending',
  ): Todo => ({
    id,
    content,
    status,
    priority: 'medium',
  });

  beforeEach(() => {
    vi.resetAllMocks();

    // Mock Config
    mockConfig = {
      getEphemeralSettings: vi.fn().mockReturnValue({}),
      getApprovalMode: vi.fn().mockReturnValue(ApprovalMode.DEFAULT),
    };
    (Config as unknown as MockedFunction<() => Config>).mockImplementation(
      () => mockConfig as unknown as Config,
    );

    // Mock GeminiClient
    mockGeminiClient = {
      sendMessageStream: vi.fn().mockResolvedValue(undefined),
    };
    (
      GeminiClient as unknown as MockedFunction<() => GeminiClient>
    ).mockImplementation(() => mockGeminiClient as unknown as GeminiClient);

    // Mock TodoContext
    mockTodoContext = {
      todos: [],
      updateTodos: vi.fn(),
      refreshTodos: vi.fn(),
    };
    (useTodoContext as MockedFunction<typeof useTodoContext>).mockReturnValue(
      mockTodoContext as unknown as ReturnType<typeof useTodoContext>,
    );

    // Mock debug message handler
    mockOnDebugMessage = vi.fn();
  });

  describe('Stream Completion Detection', () => {
    it('@requirement REQ-001.1 should trigger continuation when stream completes without tool calls and has active todos', () => {
      // Given: Active todos exist and todo-continuation is enabled
      mockTodoContext.todos = [
        createTodo('1', 'Complete feature implementation', 'in_progress'),
        createTodo('2', 'Write tests', 'pending'),
      ];
      mockConfig.getEphemeralSettings.mockReturnValue({
        'todo-continuation': true,
      });

      const { result } = renderHook(() =>
        useTodoContinuation(
          mockGeminiClient as unknown as GeminiClient,
          mockConfig as unknown as Config,
          false, // not responding
          mockOnDebugMessage,
        ),
      );

      // When: Stream completes without tool calls
      act(() => {
        result.current.handleStreamCompleted(false);
      });

      // Then: Continuation should be triggered
      expect(mockGeminiClient.sendMessageStream).toHaveBeenCalledWith(
        expect.stringContaining('Complete feature implementation'),
        { ephemeral: true },
      );
    });

    it('@requirement REQ-001.2 should NOT trigger when no active todos exist', () => {
      // Given: No active todos
      mockTodoContext.todos = [createTodo('1', 'Completed task', 'completed')];
      mockConfig.getEphemeralSettings.mockReturnValue({
        'todo-continuation': true,
      });

      const { result } = renderHook(() =>
        useTodoContinuation(
          mockGeminiClient as unknown as GeminiClient,
          mockConfig as unknown as Config,
          false,
          mockOnDebugMessage,
        ),
      );

      // When: Stream completes without tool calls
      act(() => {
        result.current.handleStreamCompleted(false);
      });

      // Then: No continuation should be triggered
      expect(mockGeminiClient.sendMessageStream).not.toHaveBeenCalled();
    });

    it('@requirement REQ-001.2 continues when tool calls were present and todos remain active', () => {
      // Given: Active todos exist and continuation is enabled
      mockTodoContext.todos = [createTodo('1', 'Active task', 'in_progress')];
      mockConfig.getEphemeralSettings.mockReturnValue({
        'todo-continuation': true,
      });

      const { result } = renderHook(() =>
        useTodoContinuation(
          mockGeminiClient as unknown as GeminiClient,
          mockConfig as unknown as Config,
          false,
          mockOnDebugMessage,
        ),
      );

      // When: Stream completes WITH tool calls
      act(() => {
        result.current.handleStreamCompleted(true);
      });

      // Then: Continuation should still trigger
      expect(mockGeminiClient.sendMessageStream).toHaveBeenCalledTimes(1);
    });

    it('@requirement REQ-001.4 should NOT trigger when todo-continuation setting is disabled', () => {
      // Given: Active todos exist but continuation is disabled
      mockTodoContext.todos = [createTodo('1', 'Active task', 'in_progress')];
      mockConfig.getEphemeralSettings.mockReturnValue({
        'todo-continuation': false,
      });

      const { result } = renderHook(() =>
        useTodoContinuation(
          mockGeminiClient as unknown as GeminiClient,
          mockConfig as unknown as Config,
          false,
          mockOnDebugMessage,
        ),
      );

      // When: Stream completes without tool calls
      act(() => {
        result.current.handleStreamCompleted(false);
      });

      // Then: No continuation should be triggered
      expect(mockGeminiClient.sendMessageStream).not.toHaveBeenCalled();
    });

    it('@requirement REQ-001.3 should NOT trigger when AI is currently responding', () => {
      // Given: Active todos and continuation enabled
      mockTodoContext.todos = [createTodo('1', 'Active task', 'in_progress')];
      mockConfig.getEphemeralSettings.mockReturnValue({
        'todo-continuation': true,
      });

      const { result } = renderHook(() =>
        useTodoContinuation(
          mockGeminiClient as unknown as GeminiClient,
          mockConfig as unknown as Config,
          true, // currently responding
          mockOnDebugMessage,
        ),
      );

      // When: Stream completes without tool calls
      act(() => {
        result.current.handleStreamCompleted(false);
      });

      // Then: No continuation should be triggered
      expect(mockGeminiClient.sendMessageStream).not.toHaveBeenCalled();
    });
  });

  describe('Prompt Generation', () => {
    it('@requirement REQ-002.1 should send ephemeral prompt with most relevant active task', () => {
      // Given: Multiple active todos with priorities
      mockTodoContext.todos = [
        createTodo('1', 'Fix critical bug', 'in_progress'),
        createTodo('2', 'Update documentation', 'pending'),
        createTodo('3', 'Add new feature', 'pending'),
      ];
      mockConfig.getEphemeralSettings.mockReturnValue({
        'todo-continuation': true,
      });

      const { result } = renderHook(() =>
        useTodoContinuation(
          mockGeminiClient as unknown as GeminiClient,
          mockConfig as unknown as Config,
          false,
          mockOnDebugMessage,
        ),
      );

      // When: Stream completes without tool calls
      act(() => {
        result.current.handleStreamCompleted(false);
      });

      // Then: Should send prompt with in_progress task (most relevant)
      expect(mockGeminiClient.sendMessageStream).toHaveBeenCalledWith(
        expect.stringContaining('Fix critical bug'),
        { ephemeral: true },
      );
    });

    it('@requirement REQ-002.2 should use different prompt for YOLO mode', () => {
      // Given: YOLO mode is active
      mockTodoContext.todos = [
        createTodo('1', 'Complete implementation', 'in_progress'),
      ];
      mockConfig.getEphemeralSettings.mockReturnValue({
        'todo-continuation': true,
      });
      mockConfig.getApprovalMode.mockReturnValue(ApprovalMode.YOLO);

      const { result } = renderHook(() =>
        useTodoContinuation(
          mockGeminiClient as unknown as GeminiClient,
          mockConfig as unknown as Config,
          false,
          mockOnDebugMessage,
        ),
      );

      // When: Stream completes without tool calls
      act(() => {
        result.current.handleStreamCompleted(false);
      });

      // Then: Should use YOLO-specific prompt
      expect(mockGeminiClient.sendMessageStream).toHaveBeenCalledWith(
        expect.stringMatching(/(continue|proceed).*without.*confirmation/i),
        { ephemeral: true },
      );
    });

    it('@requirement REQ-002.1 should NOT store prompt in conversation history', () => {
      // Given: Active todos and continuation enabled
      mockTodoContext.todos = [createTodo('1', 'Active task', 'in_progress')];
      mockConfig.getEphemeralSettings.mockReturnValue({
        'todo-continuation': true,
      });

      const { result } = renderHook(() =>
        useTodoContinuation(
          mockGeminiClient as unknown as GeminiClient,
          mockConfig as unknown as Config,
          false,
          mockOnDebugMessage,
        ),
      );

      // When: Stream completes without tool calls
      act(() => {
        result.current.handleStreamCompleted(false);
      });

      // Then: Should send with ephemeral flag
      expect(mockGeminiClient.sendMessageStream).toHaveBeenCalledWith(
        expect.any(String),
        { ephemeral: true },
      );
    });
  });

  describe('Integration with TodoContext', () => {
    it('@requirement REQ-003.1 should respond to todo state changes', () => {
      const { result, rerender } = renderHook(() =>
        useTodoContinuation(
          mockGeminiClient as unknown as GeminiClient,
          mockConfig as unknown as Config,
          false,
          mockOnDebugMessage,
        ),
      );

      // Given: Initially no todos
      mockTodoContext.todos = [];
      mockConfig.getEphemeralSettings.mockReturnValue({
        'todo-continuation': true,
      });

      // When: Stream completes (should not trigger)
      act(() => {
        result.current.handleStreamCompleted(false);
      });

      expect(mockGeminiClient.sendMessageStream).not.toHaveBeenCalled();

      // When: Todos are updated with active task
      mockTodoContext.todos = [
        createTodo('1', 'New active task', 'in_progress'),
      ];
      rerender();

      // Then: Next completion should trigger continuation
      act(() => {
        result.current.handleStreamCompleted(false);
      });

      expect(mockGeminiClient.sendMessageStream).toHaveBeenCalledWith(
        expect.stringContaining('New active task'),
        { ephemeral: true },
      );
    });

    it('@requirement REQ-003.2 should handle todo_pause events', () => {
      const { result } = renderHook(() =>
        useTodoContinuation(
          mockGeminiClient as unknown as GeminiClient,
          mockConfig as unknown as Config,
          false,
          mockOnDebugMessage,
        ),
      );

      // When: Todo pause is requested
      const pauseResult = result.current.handleTodoPause(
        'User requested pause',
      );

      // Then: Should return pause event structure
      expect(pauseResult).toEqual({
        type: 'pause',
        reason: 'User requested pause',
        message: expect.stringContaining('paused'),
      });
    });
  });

  describe('State Management', () => {
    it('@requirement REQ-004.1 should track continuation state', () => {
      const { result } = renderHook(() =>
        useTodoContinuation(
          mockGeminiClient as unknown as GeminiClient,
          mockConfig as unknown as Config,
          false,
          mockOnDebugMessage,
        ),
      );

      // Initially not active
      expect(result.current.continuationState.isActive).toBe(false);
      expect(result.current.continuationState.attemptCount).toBe(0);

      // Given: Active todos and continuation enabled
      mockTodoContext.todos = [createTodo('1', 'Active task', 'in_progress')];
      mockConfig.getEphemeralSettings.mockReturnValue({
        'todo-continuation': true,
      });

      // When: Continuation is triggered
      act(() => {
        result.current.handleStreamCompleted(false);
      });

      // Then: State should be updated
      expect(result.current.continuationState.taskDescription).toContain(
        'Active task',
      );
    });

    it('@requirement REQ-004.2 should reset state appropriately', () => {
      // Given: Active continuation state
      mockTodoContext.todos = [createTodo('1', 'Task 1', 'in_progress')];
      mockConfig.getEphemeralSettings.mockReturnValue({
        'todo-continuation': true,
      });

      const { result } = renderHook(() =>
        useTodoContinuation(
          mockGeminiClient as unknown as GeminiClient,
          mockConfig as unknown as Config,
          false,
          mockOnDebugMessage,
        ),
      );

      // Trigger continuation
      act(() => {
        result.current.handleStreamCompleted(false);
      });

      // When: Stream completes with tool calls (should reset)
      act(() => {
        result.current.handleStreamCompleted(true);
      });

      // Then: State should be reset
      expect(result.current.continuationState.isActive).toBe(false);
    });
  });

  describe('Edge Cases', () => {
    it('@requirement REQ-005.1 should handle multiple rapid completions', () => {
      // Given: Continuation enabled with active todo
      mockTodoContext.todos = [createTodo('1', 'Active task', 'in_progress')];
      mockConfig.getEphemeralSettings.mockReturnValue({
        'todo-continuation': true,
      });

      const { result } = renderHook(() =>
        useTodoContinuation(
          mockGeminiClient as unknown as GeminiClient,
          mockConfig as unknown as Config,
          false,
          mockOnDebugMessage,
        ),
      );

      // When: Multiple rapid completions occur
      act(() => {
        result.current.handleStreamCompleted(false);
        result.current.handleStreamCompleted(false);
        result.current.handleStreamCompleted(false);
      });

      // Then: Should not trigger multiple continuations simultaneously
      expect(mockGeminiClient.sendMessageStream).toHaveBeenCalledTimes(1);
    });

    it('@requirement REQ-005.2 should handle changing settings mid-stream', () => {
      // Given: Initially enabled
      mockTodoContext.todos = [createTodo('1', 'Active task', 'in_progress')];
      mockConfig.getEphemeralSettings.mockReturnValue({
        'todo-continuation': true,
      });

      const { result, rerender } = renderHook(() =>
        useTodoContinuation(
          mockGeminiClient as unknown as GeminiClient,
          mockConfig as unknown as Config,
          false,
          mockOnDebugMessage,
        ),
      );

      // When: Setting is changed during hook lifecycle
      mockConfig.getEphemeralSettings.mockReturnValue({
        'todo-continuation': false,
      });
      rerender();

      // Then: Should respect new setting
      act(() => {
        result.current.handleStreamCompleted(false);
      });

      expect(mockGeminiClient.sendMessageStream).not.toHaveBeenCalled();
    });

    it('@requirement REQ-005.3 should handle malformed todos gracefully', () => {
      // Given: Malformed todos (missing required fields)
      mockTodoContext.todos = [
        {
          id: '1',
          content: '',
          status: 'in_progress',
          priority: 'medium',
        } as Todo,
        // @ts-expect-error Testing malformed data
        {
          id: '2',
          status: 'pending',
          priority: 'high',
        },
      ];
      mockConfig.getEphemeralSettings.mockReturnValue({
        'todo-continuation': true,
      });

      const { result } = renderHook(() =>
        useTodoContinuation(
          mockGeminiClient as unknown as GeminiClient,
          mockConfig as unknown as Config,
          false,
          mockOnDebugMessage,
        ),
      );

      // When: Stream completes
      act(() => {
        result.current.handleStreamCompleted(false);
      });

      // Then: Should handle gracefully without crashing
      expect(() => {
        result.current.handleStreamCompleted(false);
      }).not.toThrow();

      // Should either skip malformed todos or handle them safely
      if (mockGeminiClient.sendMessageStream.mock.calls.length > 0) {
        const callArgs = mockGeminiClient.sendMessageStream.mock.calls[0];
        expect(callArgs[0]).toBeTypeOf('string');
        expect(callArgs[1]).toEqual({ ephemeral: true });
      }
    });

    it('@requirement REQ-005.4 should prevent continuation loops', () => {
      // Given: Continuation enabled
      mockTodoContext.todos = [createTodo('1', 'Active task', 'in_progress')];
      mockConfig.getEphemeralSettings.mockReturnValue({
        'todo-continuation': true,
      });

      const { result } = renderHook(() =>
        useTodoContinuation(
          mockGeminiClient as unknown as GeminiClient,
          mockConfig as unknown as Config,
          false,
          mockOnDebugMessage,
        ),
      );

      // When: Continuation is triggered multiple times in sequence
      act(() => {
        result.current.handleStreamCompleted(false);
      });

      const firstCallCount =
        mockGeminiClient.sendMessageStream.mock.calls.length;

      act(() => {
        result.current.handleStreamCompleted(false);
      });

      // Then: Should not trigger additional continuations if already active
      expect(mockGeminiClient.sendMessageStream.mock.calls.length).toBe(
        firstCallCount,
      );
    });
  });

  describe('Configuration Integration', () => {
    it('@requirement REQ-006.1 should respect default settings when todo-continuation is undefined', () => {
      // Given: Settings don't specify todo-continuation
      mockTodoContext.todos = [createTodo('1', 'Active task', 'in_progress')];
      mockConfig.getEphemeralSettings.mockReturnValue({});

      const { result } = renderHook(() =>
        useTodoContinuation(
          mockGeminiClient as unknown as GeminiClient,
          mockConfig as unknown as Config,
          false,
          mockOnDebugMessage,
        ),
      );

      // When: Stream completes without tool calls
      act(() => {
        result.current.handleStreamCompleted(false);
      });

      // Then: Should use default behavior (disabled)
      expect(mockGeminiClient.sendMessageStream).not.toHaveBeenCalled();
    });

    it('@requirement REQ-006.2 should prioritize in_progress todos over pending ones', () => {
      // Given: Mix of pending and in_progress todos
      mockTodoContext.todos = [
        createTodo('1', 'Pending task', 'pending'),
        createTodo('2', 'Active task', 'in_progress'),
        createTodo('3', 'Another pending', 'pending'),
      ];
      mockConfig.getEphemeralSettings.mockReturnValue({
        'todo-continuation': true,
      });

      const { result } = renderHook(() =>
        useTodoContinuation(
          mockGeminiClient as unknown as GeminiClient,
          mockConfig as unknown as Config,
          false,
          mockOnDebugMessage,
        ),
      );

      // When: Stream completes
      act(() => {
        result.current.handleStreamCompleted(false);
      });

      // Then: Should select in_progress task
      expect(mockGeminiClient.sendMessageStream).toHaveBeenCalledWith(
        expect.stringContaining('Active task'),
        { ephemeral: true },
      );
    });
  });
});
