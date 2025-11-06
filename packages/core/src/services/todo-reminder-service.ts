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
    // Return plain text instead of XML tags to avoid breaking OpenAI API
    return `---\nSystem Note: ${message}\n---`;
  }

  /**
   * Generate proactive todo suggestion for complex tasks
   */
  getComplexTaskSuggestion(detectedTasks: string[]): string {
    const taskList = this.buildNumberedTaskList(detectedTasks);

    const message = `I notice you're asking about multiple tasks. Consider using the TodoWrite tool to track these items:\n${taskList}\n\nThis will help ensure all tasks are completed systematically.`;

    return this.formatSystemReminder(message);
  }

  /**
   * Generate escalated reminder after sustained complexity without todos
   */
  getEscalatedComplexTaskSuggestion(detectedTasks: string[]): string {
    const taskList = this.buildNumberedTaskList(detectedTasks);
    const message = `You have handled several complex instructions without creating a todo list. Pause and use the TodoWrite tool now:\n${taskList}\n\nTodoWrite is required so we can track progress and avoid losing steps. Create the list before continuing.`;
    return this.formatSystemReminder(message);
  }

  getCreateListReminder(_detectedTasks: string[]): string {
    return this.formatSystemReminder(
      'Please create a todo list before continuing.',
    );
  }

  getUpdateActiveTodoReminder(_todo: Todo): string {
    return this.formatSystemReminder(
      'Update the active todo with concrete progress, continue executing the outstanding work, and only respond once you have advanced the task. If you are blocked, call todo_pause("reason") instead of rewriting the todo list.',
    );
  }

  getEscalatedActiveTodoReminder(_todo: Todo): string {
    return this.formatSystemReminder(
      'You still have unfinished todos. Continue the required work (e.g., copy files, run tools, produce the requested output) and update the active todo with new progress, or call todo_pause("reason") to explain the blocker. Do not call todo_write again without new progress.',
    );
  }

  private buildNumberedTaskList(detectedTasks: string[]): string {
    if (detectedTasks.length === 0) {
      return [
        '1. Break this request into discrete todos',
        '2. Capture each major area using TodoWrite',
        '3. Update the list as you make progress',
      ].join('\n');
    }

    const maxDisplay = Math.min(5, detectedTasks.length);
    const numbered = detectedTasks
      .slice(0, maxDisplay)
      .map((task, index) => `${index + 1}. ${task}`);

    if (detectedTasks.length > maxDisplay) {
      numbered.push(`... and ${detectedTasks.length - maxDisplay} more tasks`);
    }

    return numbered.join('\n');
  }
}
