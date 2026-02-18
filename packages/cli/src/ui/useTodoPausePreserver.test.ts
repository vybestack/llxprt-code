/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import { TodoPausePreserver } from './hooks/useTodoPausePreserver.js';

describe('useTodoPausePreserver', () => {
  it('skips clearing todos once after a todo_pause and then resumes clearing', () => {
    const controller = new TodoPausePreserver();
    const onClear = vi.fn();
    // Use completed todos - shouldClearTodos returns true for all-completed
    const completedTodos = [
      { id: '1', content: 'done', status: 'completed' as const },
    ];

    controller.handleSubmit(onClear, completedTodos);
    expect(onClear).toHaveBeenCalledTimes(1);

    controller.registerTodoPause();
    controller.handleSubmit(onClear, completedTodos);
    expect(onClear).toHaveBeenCalledTimes(1);

    controller.handleSubmit(onClear, completedTodos);
    expect(onClear).toHaveBeenCalledTimes(2);
  });
});
