/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Todo } from '../tools/todo-schemas.js';

export interface TodoStateChange {
  previousTodos: Todo[];
  currentTodos: Todo[];
  added: Todo[];
  removed: Todo[];
  statusChanged: Todo[];
}

export class TodoReminderService {
  private static readonly EMPTY_TODO_REMINDER = `This is a reminder that your todo list is currently empty. DO NOT mention this to the user explicitly because they are already aware. If you are working on tasks that would benefit from a todo list please use the TodoWrite tool to create one. If not, please feel free to ignore. Again do not mention this message to the user.`;

  private static readonly TODO_CHANGED_PREFIX = `Your todo list has changed. DO NOT mention this explicitly to the user. Here are the latest contents of your todo list:\n\n`;

  private static readonly TODO_CHANGED_SUFFIX = `. Continue on with the tasks at hand if applicable.`;

  /**
   * Generate reminder for empty todo list
   */
  getReminderForEmptyTodos(isComplexTask: boolean = false): string | null {
    if (!isComplexTask) {
      return null;
    }

    return this.formatSystemReminder(TodoReminderService.EMPTY_TODO_REMINDER);
  }

  /**
   * Generate reminder for todo state change
   */
  getReminderForStateChange(stateChange: TodoStateChange): string {
    const todoJson = JSON.stringify(
      stateChange.currentTodos.map((todo) => ({
        content: todo.content,
        status: todo.status,
        priority: todo.priority,
        id: todo.id,
      })),
    );

    const message =
      TodoReminderService.TODO_CHANGED_PREFIX +
      todoJson +
      TodoReminderService.TODO_CHANGED_SUFFIX;

    return this.formatSystemReminder(message);
  }

  /**
   * Calculate state changes between old and new todos
   */
  calculateStateChange(
    previousTodos: Todo[],
    currentTodos: Todo[],
  ): TodoStateChange {
    const added = currentTodos.filter(
      (newTodo) => !previousTodos.some((oldTodo) => oldTodo.id === newTodo.id),
    );

    const removed = previousTodos.filter(
      (oldTodo) => !currentTodos.some((newTodo) => newTodo.id === oldTodo.id),
    );

    const statusChanged = currentTodos.filter((newTodo) => {
      const oldTodo = previousTodos.find((t) => t.id === newTodo.id);
      return oldTodo && oldTodo.status !== newTodo.status;
    });

    return {
      previousTodos,
      currentTodos,
      added,
      removed,
      statusChanged,
    };
  }

  /**
   * Check if a reminder should be generated based on changes
   */
  shouldGenerateReminder(stateChange: TodoStateChange): boolean {
    return (
      stateChange.added.length > 0 ||
      stateChange.removed.length > 0 ||
      stateChange.statusChanged.length > 0
    );
  }

  /**
   * Format message as system reminder
   */
  private formatSystemReminder(message: string): string {
    return `<system-reminder>\n${message}\n</system-reminder>`;
  }

  /**
   * Generate proactive todo suggestion for complex tasks
   */
  getComplexTaskSuggestion(detectedTasks: string[]): string {
    const taskList = detectedTasks
      .map((task, i) => `${i + 1}. ${task}`)
      .join('\n');

    const message = `I notice you're asking about multiple tasks. Consider using the TodoWrite tool to track these items:\n${taskList}\n\nThis will help ensure all tasks are completed systematically.`;

    return this.formatSystemReminder(message);
  }
}
