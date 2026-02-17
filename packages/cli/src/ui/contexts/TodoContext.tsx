/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Todo } from '@vybestack/llxprt-code-core';

interface TodoContextType {
  todos: Todo[];
  updateTodos: (todos: Todo[]) => void;
  refreshTodos: () => void;
  /**
   * Whether the todo continuation is paused (via todo_pause tool).
   * Persisted across sessions to survive --continue restores.
   */
  paused: boolean;
  /**
   * Set the paused state. Persists to disk immediately.
   */
  setPaused: (paused: boolean) => void;
}

const defaultContextValue: TodoContextType = {
  todos: [],
  updateTodos: () => {
    throw new Error(
      'TodoContext updateTodos not implemented - use TodoProvider',
    );
  },
  refreshTodos: () => {
    throw new Error(
      'TodoContext refreshTodos not implemented - use TodoProvider',
    );
  },
  paused: false,
  setPaused: () => {
    throw new Error('TodoContext setPaused not implemented - use TodoProvider');
  },
};

export const TodoContext =
  React.createContext<TodoContextType>(defaultContextValue);

export const useTodoContext = () => React.useContext(TodoContext);
