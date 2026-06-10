/**
 * @plan:PLAN-20260608-ISSUE1585.P03
 * @requirement:REQ-INTERFACE-OWNERSHIP
 */

/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Tools-owned interface for todo management.
 *
 * Provides todo store, reminder service, context tracker, and
 * default agent ID access needed by todo-read, todo-write,
 * todo-pause, and todo-store tools.
 *
 * Consumed by: todo-read, todo-write, todo-pause, todo-store.
 * Implemented by: CoreTodoServiceAdapter in packages/core.
 */

import type { ToolContext } from '../types/tool-context.js';
import type { Todo } from '../types/todo-schemas.js';
import type { TodoStateChange } from '../utils/todoReminderService.js';

/** Opaque handle to the todo store. */
export interface TodoStore {
  /** Get all todos. */
  getTodos?: () => Todo[];
  /** Set/replace all todos. */
  setTodos?: (todos: Todo[]) => void;
  /** Read persisted todos asynchronously. */
  readTodos?: () => Promise<Todo[]>;
  /** Write persisted todos asynchronously. */
  writeTodos?: (todos: Todo[]) => Promise<void>;
  /** Read paused state. */
  readPausedState?: () => Promise<boolean>;
  /** Write paused state. */
  writePausedState?: (paused: boolean) => Promise<void>;
}

/** Opaque handle to the todo reminder service. */
export interface TodoReminderService {
  /** Calculate the difference between two todo lists. */
  calculateStateChange?: (
    oldTodos: Todo[],
    newTodos: Todo[],
  ) => TodoStateChange;
  /** Check whether a reminder should be generated. */
  shouldGenerateReminder?: (stateChange: TodoStateChange) => boolean;
  /** Get reminder text for a state change. */
  getReminderForStateChange?: (
    stateChange: TodoStateChange,
  ) => string | undefined;
  /** Get reminder text when the todo list is empty. */
  getReminderForEmptyTodos?: (isComplexTask: boolean) => string;
}

/** Opaque handle to the todo context tracker. */
export interface TodoContextTracker {
  /** Set the active todo. */
  setActiveTodo?: (todoId: string | null) => void;
  /** Clear the active todo. */
  clearActiveTodo?: () => void;
  /** Read the active todo. */
  getActiveTodo?: () => string | null;
}

export interface ITodoService {
  /**
   * Get the todo store instance.
   * @returns The todo store.
   */
  getTodoStore(context?: ToolContext): TodoStore;

  /**
   * Get the todo reminder service instance.
   * @returns The reminder service.
   */
  getReminderService(): TodoReminderService;

  /**
   * Get the todo context tracker instance.
   * @returns The context tracker.
   */
  getContextTracker(context?: ToolContext): TodoContextTracker;

  /**
   * Get the default agent ID for todo scoping.
   * @returns The default agent ID.
   */
  getDefaultAgentId(): string;
}
