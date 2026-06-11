/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { BaseTool, type ToolResult, Kind } from './tools.js';
import { type Todo } from '../types/todo-schemas.js';
import { TodoStore } from './todo-store.js';
import { Type } from '@google/genai';
import { TodoReminderService } from '../utils/todoReminderService.js';
import { formatTodoListForDisplay } from '../utils/todoFormatter.js';
import type { ITodoService } from '../interfaces/ITodoService.js';

export type TodoReadParams = Record<string, never>;

export class TodoRead extends BaseTool<TodoReadParams, ToolResult> {
  static readonly Name = 'todo_read';
  private reminderService = new TodoReminderService();

  constructor(private readonly todoService?: ITodoService) {
    super(
      TodoRead.Name,
      'TodoRead',
      'Read the current todo list for the session. Returns all todos with their status and content.',
      Kind.Think,
      {
        type: Type.OBJECT,
        properties: {},
      },
      true, // isOutputMarkdown
      false, // canUpdateOutput
    );
  }

  override getDescription(_params: TodoReadParams): string {
    return 'Read current todo list';
  }

  async execute(
    _params: TodoReadParams,
    _signal: AbortSignal,
    _updateOutput?: (output: string) => void,
  ): Promise<ToolResult> {
    // Get session and agent IDs from context
    const sessionId = this.context?.sessionId ?? 'default';
    const agentId = this.context?.agentId;

    const store = this.todoService?.getTodoStore(this.context);
    const rawTodos = store?.readTodos
      ? await store.readTodos()
      : store?.getTodos
        ? store.getTodos()
        : await new TodoStore(sessionId, agentId).readTodos();
    const todos = rawTodos as Todo[];

    const paused = store?.readPausedState
      ? await store.readPausedState()
      : false;
    const output =
      formatTodoListForDisplay(todos) +
      (paused ? '\\n\\nAI execution is paused.' : '');

    if (todos.length === 0) {
      const isComplexTask = false;
      const reminder =
        this.reminderService.getReminderForEmptyTodos(isComplexTask);
      return {
        llmContent:
          output +
          // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing: empty reminder string should not be concatenated
          (reminder || ''),
        returnDisplay: output,
      };
    }

    // Calculate metadata
    const statistics = this.calculateStatistics(todos);
    const suggestedAction = this.determineSuggestedAction(todos);

    return {
      llmContent: output,
      returnDisplay: output,
      metadata: {
        totalTasks: todos.length,
        statistics,
        suggestedAction,
      },
    };
  }

  private calculateStatistics(todos: Todo[]): {
    inProgress: number;
    pending: number;
    completed: number;
    total: number;
  } {
    return {
      total: todos.length,
      inProgress: todos.filter((t) => t.status === 'in_progress').length,
      pending: todos.filter((t) => t.status === 'pending').length,
      completed: todos.filter((t) => t.status === 'completed').length,
    };
  }

  private determineSuggestedAction(todos: Todo[]): {
    type: 'continue' | 'start' | 'all-complete';
    taskId?: string;
    taskContent?: string;
  } {
    // Check if any tasks are in progress - return first one (preserves LLM order)
    const inProgressTasks = todos.filter((t) => t.status === 'in_progress');
    if (inProgressTasks.length > 0) {
      const task = inProgressTasks[0];
      return {
        type: 'continue',
        taskId: task.id,
        taskContent: task.content,
      };
    }

    // Check if any tasks are pending - return first one (preserves LLM order)
    const pendingTasks = todos.filter((t) => t.status === 'pending');
    if (pendingTasks.length > 0) {
      const task = pendingTasks[0];
      return {
        type: 'start',
        taskId: task.id,
        taskContent: task.content,
      };
    }

    // All tasks are completed
    return { type: 'all-complete' };
  }
}
