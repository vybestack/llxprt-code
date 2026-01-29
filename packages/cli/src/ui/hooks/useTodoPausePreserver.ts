/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback } from 'react';
import { type Todo } from '@vybestack/llxprt-code-core';

/**
 * @plan PLAN-20260129-TODOPERSIST.P03
 * Determine whether todos should be cleared based on their state.
 * Returns true if the list is empty or all todos are completed.
 * Returns false if there are any pending or in_progress todos.
 */
export function shouldClearTodos(todos: Todo[]): boolean {
  if (todos.length === 0) {
    return true;
  }
  return todos.every((t) => t.status === 'completed');
}

export class TodoPausePreserver {
  private preserveNextSubmission = false;

  /**
   * @plan PLAN-20260129-TODOPERSIST.P01
   * Modified to accept todos parameter for conditional clearing logic.
   */
  handleSubmit(onClear: () => void, todos: Todo[]): void {
    if (this.preserveNextSubmission) {
      this.preserveNextSubmission = false;
      return;
    }
    if (shouldClearTodos(todos)) {
      onClear();
    }
  }

  registerTodoPause(): void {
    this.preserveNextSubmission = true;
  }
}

interface UseTodoPausePreserverOptions {
  controller: TodoPausePreserver;
  updateTodos: (todos: Todo[]) => void;
  handleFinalSubmit: (submittedValue: string) => void;
  /**
   * @plan PLAN-20260129-TODOPERSIST.P01
   * Current todos list required for conditional clearing.
   */
  todos: Todo[];
}

export const useTodoPausePreserver = ({
  controller,
  updateTodos,
  handleFinalSubmit,
  todos,
}: UseTodoPausePreserverOptions) => {
  const handleUserInputSubmit = useCallback(
    (submittedValue: string) => {
      controller.handleSubmit(() => {
        updateTodos([]);
      }, todos);
      handleFinalSubmit(submittedValue);
    },
    [controller, updateTodos, handleFinalSubmit, todos],
  );

  return {
    handleUserInputSubmit,
  };
};
