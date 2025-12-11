/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { BaseTool, type ToolResult, Kind } from './tools.js';
import { type Todo } from './todo-schemas.js';
import { TodoStore } from './todo-store.js';
import { Type } from '@google/genai';
import { TodoReminderService } from '../services/todo-reminder-service.js';
import { formatTodoListForDisplay } from '../todo/todoFormatter.js';
import { ToolCallTrackerService } from '../services/tool-call-tracker-service.js';

export type TodoReadParams = Record<string, never>;

export class TodoRead extends BaseTool<TodoReadParams, ToolResult> {
  static readonly Name = 'todo_read';
  private reminderService = new TodoReminderService();

  constructor() {
    super(
      TodoRead.Name,
      'TodoRead',
      'Read the current todo list for the session. Returns all todos with their status, priority, and content.',
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
    const sessionId = this.context?.sessionId || 'default';
    const agentId = this.context?.agentId;

    const store = new TodoStore(sessionId, agentId);
    const todos = await store.readTodos();

    const output = formatTodoListForDisplay(todos, {
      getLiveToolCalls: (todoId: string) =>
        ToolCallTrackerService.getAllToolCalls(sessionId, todoId, agentId),
    });

    if (todos.length === 0) {
      const isComplexTask = false;
      const reminder =
        this.reminderService.getReminderForEmptyTodos(isComplexTask);
      return {
        llmContent: output + (reminder || ''),
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
    highPriority: number;
    mediumPriority: number;
    lowPriority: number;
    total: number;
  } {
    return {
      total: todos.length,
      inProgress: todos.filter((t) => t.status === 'in_progress').length,
      pending: todos.filter((t) => t.status === 'pending').length,
      completed: todos.filter((t) => t.status === 'completed').length,
      highPriority: todos.filter((t) => t.priority === 'high').length,
      mediumPriority: todos.filter((t) => t.priority === 'medium').length,
      lowPriority: todos.filter((t) => t.priority === 'low').length,
    };
  }

  private determineSuggestedAction(todos: Todo[]): {
    type: 'continue' | 'start' | 'all-complete';
    taskId?: string;
    taskContent?: string;
  } {
    // Check if any tasks are in progress
    const inProgressTasks = todos.filter((t) => t.status === 'in_progress');
    if (inProgressTasks.length > 0) {
      // Continue with highest priority in-progress task
      const task = inProgressTasks.sort((a, b) => {
        const priorityOrder = { high: 0, medium: 1, low: 2 };
        return priorityOrder[a.priority] - priorityOrder[b.priority];
      })[0];
      return {
        type: 'continue',
        taskId: task.id,
        taskContent: task.content,
      };
    }

    // Check if any tasks are pending
    const pendingTasks = todos.filter((t) => t.status === 'pending');
    if (pendingTasks.length > 0) {
      // Start with highest priority pending task
      const task = pendingTasks.sort((a, b) => {
        const priorityOrder = { high: 0, medium: 1, low: 2 };
        return priorityOrder[a.priority] - priorityOrder[b.priority];
      })[0];
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
