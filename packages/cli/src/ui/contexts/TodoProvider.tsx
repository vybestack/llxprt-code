/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  TodoStore,
  type Todo,
  todoEvents,
  type TodoUpdateEvent,
  DEFAULT_AGENT_ID,
} from '@vybestack/llxprt-code-core';
import { TodoContext } from './TodoContext.js';

interface TodoProviderProps {
  children: React.ReactNode;
  sessionId: string;
  agentId?: string;
}

/**
 * Hook for managing task state and loading.
 */
function useTaskState(sessionId: string, agentId: string | undefined) {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [paused, setPausedState] = useState<boolean>(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshTodos = useCallback(async () => {
    try {
      setLoading(true);
      const store = new TodoStore(sessionId, agentId);
      const loadedTodos = await store.readTodos();
      const pausedState = await store.readPausedState();
      setTodos(loadedTodos);
      setPausedState(pausedState);
      setError(null);
    } catch (err) {
      setError(
        `Failed to load todos: ${err instanceof Error ? err.message : 'Unknown error'}`,
      );
      setTodos([]);
      setPausedState(false);
    } finally {
      setLoading(false);
    }
  }, [agentId, sessionId]);

  return {
    todos,
    setTodos,
    paused,
    setPausedState,
    loading,
    setLoading,
    error,
    setError,
    refreshTodos,
  };
}

/**
 * Hook for listening to task update events.
 */
function useTaskUpdates(
  sessionId: string,
  scopedAgentId: string,
  setTodos: (todos: Todo[]) => void,
  setError: (error: string | null) => void,
) {
  useEffect(() => {
    const handleTaskUpdate = (eventData: TodoUpdateEvent) => {
      if (
        eventData.sessionId === sessionId &&
        (eventData.agentId ?? DEFAULT_AGENT_ID) === scopedAgentId
      ) {
        setTodos(eventData.todos);
        setError(null);
      }
    };

    todoEvents.onTodoUpdated(handleTaskUpdate);

    return () => {
      todoEvents.offTodoUpdated(handleTaskUpdate);
    };
  }, [scopedAgentId, sessionId, setTodos, setError]);
}

/**
 * Hook for task persistence operations.
 */
function useTaskPersistence(
  sessionId: string,
  agentId: string | undefined,
  setTodos: (todos: Todo[]) => void,
  setPausedState: (paused: boolean) => void,
  setError: (error: string | null) => void,
) {
  const updateTodos = useCallback(
    (newTodos: Todo[]) => {
      setTodos(newTodos);
      const store = new TodoStore(sessionId, agentId);
      store.writeTodos(newTodos).catch((err) => {
        setError(
          `Failed to save todos: ${err instanceof Error ? err.message : 'Unknown error'}`,
        );
      });
    },
    [agentId, sessionId, setTodos, setError],
  );

  const setPaused = useCallback(
    (newPaused: boolean) => {
      setPausedState(newPaused);
      const store = new TodoStore(sessionId, agentId);
      store.writePausedState(newPaused).catch((err: unknown) => {
        setError(
          `Failed to save paused state: ${err instanceof Error ? err.message : 'Unknown error'}`,
        );
      });
    },
    [agentId, sessionId, setPausedState, setError],
  );

  return { updateTodos, setPaused };
}

/**
 * Hook that combines all task management logic.
 */
function useTaskManagement(sessionId: string, agentId: string | undefined) {
  const scopedAgentId = agentId ?? DEFAULT_AGENT_ID;
  const state = useTaskState(sessionId, agentId);

  useTaskUpdates(sessionId, scopedAgentId, state.setTodos, state.setError);

  const persistence = useTaskPersistence(
    sessionId,
    agentId,
    state.setTodos,
    state.setPausedState,
    state.setError,
  );

  // Load initial data
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    state.refreshTodos();
    // Only run on mount - refreshTodos is stable via useCallback
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    todos: state.todos,
    paused: state.paused,
    loading: state.loading,
    error: state.error,
    refreshTodos: state.refreshTodos,
    updateTodos: persistence.updateTodos,
    setPaused: persistence.setPaused,
  };
}

export const TodoProvider: React.FC<TodoProviderProps> = ({
  children,
  sessionId = 'default',
  agentId,
}) => {
  const management = useTaskManagement(sessionId, agentId);

  const contextValue = useMemo(
    () => ({
      todos: management.todos,
      updateTodos: management.updateTodos,
      refreshTodos: management.refreshTodos,
      paused: management.paused,
      setPaused: management.setPaused,
      loading: management.loading,
      error: management.error,
    }),
    [
      management.todos,
      management.updateTodos,
      management.refreshTodos,
      management.paused,
      management.setPaused,
      management.loading,
      management.error,
    ],
  );

  return (
    <TodoContext.Provider value={contextValue}>{children}</TodoContext.Provider>
  );
};
