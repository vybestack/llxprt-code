/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  TodoStore,
  type Todo,
  todoEvents,
  type TodoUpdateEvent,
  DEFAULT_AGENT_ID,
} from '@vybestack/llxprt-code-core';
import { Storage } from '@vybestack/llxprt-code-settings';
import { TodoContext } from './TodoContext.js';

interface TodoProviderProps {
  children: React.ReactNode;
  sessionId: string;
  agentId?: string;
}

/**
 * Publish a provider-originated task-list replacement on the observation
 * channel (issue #3052). Every observer of the singleton `todoEvents`
 * emitter — external consumers (JSP/jefe, Zed) and any peer `TodoProvider`
 * subscribed to the same channel — receives it. The originating provider's own
 * listener is skipped by matching the exact event object against its
 * per-instance publication ref (see `useTaskPersistence` / `useTaskUpdates`),
 * so a provider-originated publication does not re-enter the origin.
 *
 * This mirrors the TodoWrite tool's canonical event shape and channel, not its
 * call ordering: `updateTodos` stays a synchronous, optimistic API that applies
 * local UI state and starts fire-and-forget persistence before emitting. The
 * synchronous emit preserves fail-fast behavior — a throwing observer
 * propagates to the caller.
 */
function publishTodos(
  sessionId: string,
  agentId: string | undefined,
  todos: Todo[],
  originPublicationRef: React.MutableRefObject<TodoUpdateEvent | null>,
): void {
  const eventData: TodoUpdateEvent = {
    sessionId,
    agentId,
    todos,
    timestamp: new Date(),
  };
  originPublicationRef.current = eventData;
  try {
    todoEvents.emitTodoUpdated(eventData);
  } finally {
    originPublicationRef.current = null;
  }
}

/**
 * Hook for managing task state and the mount/session read.
 *
 * The read path deliberately does NOT publish. `TodoStore.readTodos` maps a
 * parse or I/O failure to an empty list, so a refresh cannot distinguish an
 * authoritative empty list from a load failure, and publishing it would risk
 * advertising a stale or failed state as current. External TodoWrite events
 * remain the authoritative source for external observers.
 */
function useTaskState(sessionId: string, agentId: string | undefined) {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshTodos = useCallback(async () => {
    try {
      setLoading(true);
      const store = new TodoStore(
        sessionId,
        { dataDirResolver: () => Storage.getGlobalDataDir() },
        agentId,
      );
      const loadedTodos = await store.readTodos();
      setTodos(loadedTodos);
      setError(null);
    } catch (err) {
      setError(
        `Failed to load todos: ${err instanceof Error ? err.message : 'Unknown error'}`,
      );
      setTodos([]);
    } finally {
      setLoading(false);
    }
  }, [agentId, sessionId]);

  return {
    todos,
    setTodos,
    loading,
    setLoading,
    error,
    setError,
    refreshTodos,
  };
}

/**
 * Hook for listening to task update events. An accepted external event (e.g.
 * from the TodoWrite tool) is authoritative and mirrors the published list into
 * local state. A provider-originated publication records the exact event object
 * in its per-instance `originPublicationRef` before emitting (see
 * `useTaskPersistence`); the origin's own listener skips only that event while
 * external observers, nested external events, and matching peer providers still
 * receive their events.
 */
function useTaskUpdates(
  sessionId: string,
  scopedAgentId: string,
  originPublicationRef: React.MutableRefObject<TodoUpdateEvent | null>,
  setTodos: (todos: Todo[]) => void,
  setError: (error: string | null) => void,
) {
  useEffect(() => {
    const handleTaskUpdate = (eventData: TodoUpdateEvent) => {
      if (originPublicationRef.current === eventData) {
        return;
      }
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
  }, [scopedAgentId, sessionId, originPublicationRef, setTodos, setError]);
}

/**
 * Hook for task persistence operations — the single provider write path. It
 * applies local UI state, starts fire-and-forget persistence, then publishes
 * synchronously. The exact event object is recorded per provider so the
 * origin's own `todoEvents` listener skips only that event (issue #3052), while
 * external observers and any matching peer provider still receive it once.
 */
function useTaskPersistence(
  sessionId: string,
  agentId: string | undefined,
  originPublicationRef: React.MutableRefObject<TodoUpdateEvent | null>,
  setTodos: (todos: Todo[]) => void,
  setError: (error: string | null) => void,
) {
  const updateTodos = useCallback(
    (newTodos: Todo[]) => {
      setTodos(newTodos);

      const store = new TodoStore(
        sessionId,
        { dataDirResolver: () => Storage.getGlobalDataDir() },
        agentId,
      );
      store.writeTodos(newTodos).catch((err) => {
        setError(
          `Failed to save todos: ${err instanceof Error ? err.message : 'Unknown error'}`,
        );
      });

      publishTodos(sessionId, agentId, newTodos, originPublicationRef);
    },
    [agentId, sessionId, originPublicationRef, setTodos, setError],
  );

  return { updateTodos };
}

/**
 * Hook that combines all task management logic.
 */
function useTaskManagement(sessionId: string, agentId: string | undefined) {
  const scopedAgentId = agentId ?? DEFAULT_AGENT_ID;
  const originPublicationRef = useRef<TodoUpdateEvent | null>(null);
  const state = useTaskState(sessionId, agentId);

  useTaskUpdates(
    sessionId,
    scopedAgentId,
    originPublicationRef,
    state.setTodos,
    state.setError,
  );

  const persistence = useTaskPersistence(
    sessionId,
    agentId,
    originPublicationRef,
    state.setTodos,
    state.setError,
  );

  // Load data on mount and whenever the session identity changes.
  // refreshTodos is stable via useCallback (keyed on sessionId/agentId).
  const { refreshTodos } = state;
  useEffect(() => {
    void refreshTodos();
  }, [refreshTodos]);

  return {
    todos: state.todos,
    loading: state.loading,
    error: state.error,
    refreshTodos: state.refreshTodos,
    updateTodos: persistence.updateTodos,
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
      loading: management.loading,
      error: management.error,
    }),
    [
      management.todos,
      management.updateTodos,
      management.refreshTodos,
      management.loading,
      management.error,
    ],
  );

  return (
    <TodoContext.Provider value={contextValue}>{children}</TodoContext.Provider>
  );
};
