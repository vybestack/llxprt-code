/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Todo } from '../types/todo-schemas.js';

export interface TodoStateChange {
  added: Todo[];
  removed: Todo[];
  statusChanged: Array<{
    todo: Todo;
    oldStatus: Todo['status'];
    newStatus: Todo['status'];
  }>;
}

export class TodoReminderService {
  private static readonly EMPTY_TODO_REMINDER = `This is a reminder that your todo list is currently empty. DO NOT mention this to the user explicitly because they are already aware. If you are working on tasks that would benefit from a todo list please use the TodoWrite tool to create one. If not, please feel free to ignore. Again do not mention this message to the user.`;

  calculateStateChange(oldTodos: Todo[], newTodos: Todo[]): TodoStateChange {
    const oldById = new Map(oldTodos.map((todo) => [todo.id, todo]));
    const newById = new Map(newTodos.map((todo) => [todo.id, todo]));

    const added = newTodos.filter((todo) => !oldById.has(todo.id));
    const removed = oldTodos.filter((todo) => !newById.has(todo.id));
    const statusChanged = newTodos.flatMap((todo) => {
      const oldTodo = oldById.get(todo.id);
      if (!oldTodo || oldTodo.status === todo.status) {
        return [];
      }
      return [
        {
          todo,
          oldStatus: oldTodo.status,
          newStatus: todo.status,
        },
      ];
    });

    return { added, removed, statusChanged };
  }

  shouldGenerateReminder(stateChange: TodoStateChange): boolean {
    return (
      stateChange.added.length > 0 ||
      stateChange.removed.length > 0 ||
      stateChange.statusChanged.length > 0
    );
  }

  getReminderForStateChange(stateChange: TodoStateChange): string | undefined {
    if (!this.shouldGenerateReminder(stateChange)) {
      return undefined;
    }
    return 'Todo list updated. Continue using TodoWrite to keep progress current.';
  }

  getReminderForEmptyTodos(isComplexTask: boolean): string {
    return isComplexTask ? TodoReminderService.EMPTY_TODO_REMINDER : '';
  }
}
