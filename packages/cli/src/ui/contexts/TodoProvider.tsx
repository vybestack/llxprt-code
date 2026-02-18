/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  TodoStore,
  Todo,
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

export const TodoProvider: React.FC<TodoProviderProps> = ({
  children,
  sessionId = 'default',
  agentId,
}) => {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [paused, setPausedState] = useState<boolean>(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const scopedAgentId = agentId ?? DEFAULT_AGENT_ID;

  const refreshTodos = useCallback(async () => {
    try {
      setLoading(true);
      const store = new TodoStore(sessionId, agentId);
      const todos = await store.readTodos();
      const pausedState = await store.readPausedState();
      setTodos(todos);
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

  // Load initial data
  useEffect(() => {
    refreshTodos();
  }, [refreshTodos]);

  // Listen for todo updates
  useEffect(() => {
    const handleTodoUpdate = (eventData: TodoUpdateEvent) => {
      // Verify this update is for our session
      if (
        eventData.sessionId === sessionId &&
        (eventData.agentId ?? DEFAULT_AGENT_ID) === scopedAgentId
      ) {
        // Use the todos from the event instead of re-reading from file
        // This avoids race conditions with file I/O
        setTodos(eventData.todos);
        setError(null);
      }
    };

    todoEvents.onTodoUpdated(handleTodoUpdate);

    return () => {
      todoEvents.offTodoUpdated(handleTodoUpdate);
    };
  }, [scopedAgentId, sessionId]);

  const updateTodos = useCallback(
    (newTodos: Todo[]) => {
      setTodos(newTodos);
      // Persist to store
      const store = new TodoStore(sessionId, agentId);
      store.writeTodos(newTodos).catch((err) => {
        setError(
          `Failed to save todos: ${err instanceof Error ? err.message : 'Unknown error'}`,
        );
      });
    },
    [agentId, sessionId],
  );

  const setPaused = useCallback(
    (newPaused: boolean) => {
      setPausedState(newPaused);
      // Persist to store
      const store = new TodoStore(sessionId, agentId);
      store.writePausedState(newPaused).catch((err: unknown) => {
        setError(
          `Failed to save paused state: ${err instanceof Error ? err.message : 'Unknown error'}`,
        );
      });
    },
    [agentId, sessionId],
  );

  const contextValue = useMemo(
    () => ({
      todos,
      updateTodos,
      refreshTodos,
      paused,
      setPaused,
      loading,
      error,
    }),
    [todos, updateTodos, refreshTodos, paused, setPaused, loading, error],
  );

  return (
    <TodoContext.Provider value={contextValue}>{children}</TodoContext.Provider>
  );
};
