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

    controller.handleSubmit(onClear, []);
    expect(onClear).toHaveBeenCalledTimes(1);

    controller.registerTodoPause();
    controller.handleSubmit(onClear, []);
    expect(onClear).toHaveBeenCalledTimes(1);

    controller.handleSubmit(onClear, []);
    expect(onClear).toHaveBeenCalledTimes(2);
  });
});
