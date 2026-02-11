/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TodoWrite } from './todo-write.js';
import type { Todo } from './todo-schemas.js';

vi.mock('./todo-store.js', () => ({
  TodoStore: vi.fn().mockImplementation(() => ({
    readTodos: vi.fn().mockResolvedValue([]),
    writeTodos: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('../services/todo-context-tracker.js', () => ({
  TodoContextTracker: {
    forAgent: vi.fn().mockReturnValue({
      setActiveTodo: vi.fn(),
    }),
  },
}));

const makeTodo = (
  id: string,
  status: Todo['status'],
  content?: string,
): Todo => ({
  id,
  content: content ?? `Task ${id}`,
  status,
});

describe('TodoWrite - Single In-Progress Enforcement', () => {
  let tool: TodoWrite;
  const abortSignal = new AbortController().signal;

  beforeEach(() => {
    tool = new TodoWrite();
    tool.context = {
      sessionId: 'test-session',
      agentId: 'test-agent',
      interactiveMode: false,
    };
  });

  it('should keep only the last in_progress todo when multiple are set', async () => {
    const todos = [
      makeTodo('1', 'in_progress'),
      makeTodo('2', 'pending'),
      makeTodo('3', 'in_progress'),
    ];

    const result = await tool.execute({ todos }, abortSignal);

    expect(result.metadata.statistics.inProgress).toBe(1);
    expect(result.llmContent).toContain('Task 3');
    expect(result.llmContent).toContain('current');
    expect(result.llmContent).not.toMatch(/Task 1.*current/);
  });

  it('should not modify todos when only one is in_progress', async () => {
    const todos = [
      makeTodo('1', 'pending'),
      makeTodo('2', 'in_progress'),
      makeTodo('3', 'pending'),
    ];

    const result = await tool.execute({ todos }, abortSignal);

    expect(result.metadata.statistics.inProgress).toBe(1);
    expect(result.metadata.statistics.pending).toBe(2);
  });

  it('should not modify todos when none are in_progress', async () => {
    const todos = [
      makeTodo('1', 'pending'),
      makeTodo('2', 'pending'),
      makeTodo('3', 'pending'),
    ];

    const result = await tool.execute({ todos }, abortSignal);

    expect(result.metadata.statistics.inProgress).toBe(0);
    expect(result.metadata.statistics.pending).toBe(3);
  });

  it('should handle all todos set to in_progress by keeping only the last', async () => {
    const todos = [
      makeTodo('1', 'in_progress'),
      makeTodo('2', 'in_progress'),
      makeTodo('3', 'in_progress'),
    ];

    const result = await tool.execute({ todos }, abortSignal);

    expect(result.metadata.statistics.inProgress).toBe(1);
    expect(result.metadata.statistics.pending).toBe(2);
  });

  it('should preserve completed status when enforcing single in_progress', async () => {
    const todos = [
      makeTodo('1', 'completed'),
      makeTodo('2', 'in_progress'),
      makeTodo('3', 'in_progress'),
    ];

    const result = await tool.execute({ todos }, abortSignal);

    expect(result.metadata.statistics.completed).toBe(1);
    expect(result.metadata.statistics.inProgress).toBe(1);
    expect(result.metadata.statistics.pending).toBe(1);
  });

  it('should report inProgress as at most 1 in statistics', async () => {
    const todos = [
      makeTodo('1', 'in_progress'),
      makeTodo('2', 'in_progress'),
      makeTodo('3', 'in_progress'),
      makeTodo('4', 'in_progress'),
    ];

    const result = await tool.execute({ todos }, abortSignal);

    expect(result.metadata.statistics.inProgress).toBeLessThanOrEqual(1);
  });
});
