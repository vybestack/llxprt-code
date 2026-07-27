/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { type Todo } from '@vybestack/llxprt-code-core';

/**
 * @plan PLAN-20260129-TODOPERSIST.P03
 * @fix FIX-1336-EMPTY-CLEAR
 * Determine whether todos should be cleared based on their state.
 * Returns true only if all todos are completed (user finished their work).
 * Returns false if the list is empty (nothing to clear) or has incomplete todos.
 */
export function shouldClearTodos(todos: Todo[]): boolean {
  if (todos.length === 0) {
    return false;
  }
  return todos.every((t) => t.status === 'completed');
}
