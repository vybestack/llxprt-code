/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TodoWrite } from './todo-write.js';
import type { Todo } from './todo-schemas.js';
import { TodoReminderService } from '../services/todo-reminder-service.js';
import { formatTodoListForDisplay } from '../todo/todoFormatter.js';

const {
  readTodosMock,
  writeTodosMock,
  emitTodoUpdatedMock,
  setActiveTodoMock,
} = vi.hoisted(() => ({
  readTodosMock: vi.fn(),
  writeTodosMock: vi.fn(),
  emitTodoUpdatedMock: vi.fn(),
  setActiveTodoMock: vi.fn(),
}));

vi.mock('./todo-store.js', () => ({
  TodoStore: vi.fn().mockImplementation(() => ({
    readTodos: readTodosMock,
    writeTodos: writeTodosMock,
  })),
}));

vi.mock('./todo-events.js', () => ({
  todoEvents: {
    emitTodoUpdated: emitTodoUpdatedMock,
  },
}));

vi.mock('../services/todo-context-tracker.js', () => ({
  TodoContextTracker: {
    forAgent: vi.fn().mockReturnValue({
      setActiveTodo: setActiveTodoMock,
    }),
  },
}));

describe('TodoWrite tool', () => {
  beforeEach(() => {
    readTodosMock.mockReset();
    writeTodosMock.mockReset();
    emitTodoUpdatedMock.mockReset();
    setActiveTodoMock.mockReset();
  });

  it('omits reminder text from llmContent while exposing it via metadata', async () => {
    readTodosMock.mockResolvedValue([
      {
        id: '1',
        content: 'Copy README.md to ./tmp/README.jp.md using shell command',
        status: 'pending',
        priority: 'high',
      },
    ]);
    writeTodosMock.mockResolvedValue(undefined);

    const reminderText =
      '---\nSystem Note: Update the active todo before replying.\n---';

    const shouldGenerateReminder = vi
      .spyOn(TodoReminderService.prototype, 'shouldGenerateReminder')
      .mockReturnValue(true);
    const getReminder = vi
      .spyOn(TodoReminderService.prototype, 'getReminderForStateChange')
      .mockReturnValue(reminderText);

    const tool = new TodoWrite();
    tool.context = {
      sessionId: 'session-1',
      agentId: 'primary',
      interactiveMode: false,
    };

    const params = {
      todos: [
        {
          id: '1',
          content: 'Copy README.md to ./tmp/README.jp.md using shell command',
          status: 'in_progress',
          priority: 'high',
        },
        {
          id: '2',
          content:
            'Edit ./tmp/README.jp.md to translate text to Japanese (keeping code blocks in English)',
          status: 'pending',
          priority: 'high',
        },
      ],
    };

    const result = await tool.execute(params, new AbortController().signal);

    const expectedDisplay = formatTodoListForDisplay(params.todos);

    expect(result.llmContent).toBe(expectedDisplay);
    expect(result.llmContent).not.toContain('System Note:');
    expect(result.returnDisplay).toBe(expectedDisplay);
    expect(result.metadata.reminder).toBe(reminderText);

    expect(writeTodosMock).toHaveBeenCalledWith(params.todos);
    expect(shouldGenerateReminder).toHaveBeenCalled();
    expect(getReminder).toHaveBeenCalled();
  });

  it('fills missing todo and subtask IDs before validation', async () => {
    readTodosMock.mockResolvedValue([]);
    writeTodosMock.mockResolvedValue(undefined);

    const tool = new TodoWrite();
    tool.context = {
      sessionId: 'session-normalize',
      agentId: 'primary',
      interactiveMode: false,
    };

    const todosInput = [
      {
        // Missing id should be auto-filled
        id: undefined,
        content: 'Create initial translation plan',
        status: 'pending',
        priority: 'high',
        subtasks: [
          {
            id: undefined,
            content: 'Outline translation steps',
          },
        ],
      },
      {
        id: 'existing-id',
        content: 'Verify translated document formatting',
        status: 'pending',
        priority: 'medium',
        subtasks: [],
      },
    ] as unknown as Todo[];

    await tool.execute(
      {
        todos: todosInput,
      },
      new AbortController().signal,
    );

    const writtenTodos = writeTodosMock.mock.calls[0]?.[0] as
      | Todo[]
      | undefined;
    expect(writtenTodos).toBeDefined();
    expect(writtenTodos?.[0]?.id).toBe('1');
    expect(writtenTodos?.[0]?.subtasks?.[0]?.id).toBe('1-1');
    expect(writtenTodos?.[1]?.id).toBe('existing-id');
  });
});
