/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Type } from '@google/genai';
import { BaseTool, ToolResult, Icon } from './tools.js';
import { Todo, TodoArraySchema } from './todo-schemas.js';
import { TodoStore } from './todo-store.js';
import { TodoReminderService } from '../services/todo-reminder-service.js';

export interface TodoWriteParams {
  todos: Todo[];
}

export class TodoWrite extends BaseTool<TodoWriteParams, ToolResult> {
  static readonly Name = 'todo_write';
  private reminderService = new TodoReminderService();

  constructor() {
    super(
      TodoWrite.Name,
      'TodoWrite',
      'Create and manage a structured task list for the current coding session. Updates the entire todo list.',
      Icon.LightBulb,
      {
        type: Type.OBJECT,
        properties: {
          todos: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: {
                  type: Type.STRING,
                  description: 'Unique identifier for the todo item',
                },
                content: {
                  type: Type.STRING,
                  description: 'Description of the todo item',
                  minLength: '1',
                },
                status: {
                  type: Type.STRING,
                  enum: ['pending', 'in_progress', 'completed'],
                  description: 'Current status of the todo item',
                },
                priority: {
                  type: Type.STRING,
                  enum: ['high', 'medium', 'low'],
                  description: 'Priority level of the todo item',
                },
              },
              required: ['id', 'content', 'status', 'priority'],
            },
            description: 'The updated todo list',
          },
        },
        required: ['todos'],
      },
      true, // isOutputMarkdown
      false, // canUpdateOutput
    );
  }

  getDescription(params: TodoWriteParams): string {
    return `Update todo list with ${params.todos.length} items`;
  }

  async execute(
    params: TodoWriteParams,
    _signal: AbortSignal,
    _updateOutput?: (output: string) => void,
  ): Promise<ToolResult> {
    // Validate todos with Zod schema
    const result = TodoArraySchema.safeParse(params.todos);
    if (!result.success) {
      const error = result.error.errors[0];
      throw new Error(
        `Validation error: ${error.path.join('.')} - ${error.message}`,
      );
    }

    // Get session and agent IDs from context
    const sessionId = this.context?.sessionId || 'default';
    const agentId = this.context?.agentId;

    const store = new TodoStore(sessionId, agentId);

    // Read old todos for diff tracking
    const oldTodos = await store.readTodos();

    // Write new todos
    await store.writeTodos(params.todos);

    // Calculate state change
    const stateChange = this.reminderService.calculateStateChange(
      oldTodos,
      params.todos,
    );

    // Generate reminder if needed
    let reminder: string | null = null;
    if (this.reminderService.shouldGenerateReminder(stateChange)) {
      reminder = this.reminderService.getReminderForStateChange(stateChange);
    }

    // Generate output
    const output = this.generateOutput(oldTodos, params.todos);

    const statistics = this.calculateStatistics(params.todos);
    const nextAction = this.determineNextAction(params.todos);

    return {
      llmContent: output + (reminder || ''),
      returnDisplay: output,
      metadata: {
        stateChanged: this.reminderService.shouldGenerateReminder(stateChange),
        todosAdded: stateChange.added.length,
        todosRemoved: stateChange.removed.length,
        statusChanged: stateChange.statusChanged.length,
        statistics,
        nextAction,
      },
    };
  }

  private generateOutput(oldTodos: Todo[], newTodos: Todo[]): string {
    let output = '## Todo List Updated\n\n';

    // Changes Summary
    output += '### Changes Summary\n\n';

    // Calculate changes
    const added = newTodos.filter(
      (newTodo) => !oldTodos.some((oldTodo) => oldTodo.id === newTodo.id),
    );

    const removed = oldTodos.filter(
      (oldTodo) => !newTodos.some((newTodo) => newTodo.id === oldTodo.id),
    );

    const statusChanges = newTodos.filter((newTodo) => {
      const oldTodo = oldTodos.find((t) => t.id === newTodo.id);
      return oldTodo && oldTodo.status !== newTodo.status;
    });

    if (added.length > 0) {
      output += `- Added: ${added.length} task${added.length !== 1 ? 's' : ''}\n`;
    }
    if (removed.length > 0) {
      output += `- Removed: ${removed.length} task${removed.length !== 1 ? 's' : ''}\n`;
    }
    if (statusChanges.length > 0) {
      output += `- Status changed: ${statusChanges.length} task${statusChanges.length !== 1 ? 's' : ''}\n`;
    }
    output += `- Total tasks: ${newTodos.length}\n\n`;

    // Task Statistics
    output += '### Task Statistics\n\n';
    const stats = this.calculateStatistics(newTodos);
    output += `- In Progress: ${stats.inProgress}\n`;
    output += `- Pending: ${stats.pending}\n`;
    output += `- Completed: ${stats.completed}\n`;
    output += `- Total: ${stats.total}\n\n`;

    // Priority Breakdown
    output += 'Priority Breakdown:\n';
    output += `- High: ${stats.highPriority}\n`;
    output += `- Medium: ${stats.mediumPriority}\n`;
    output += `- Low: ${stats.lowPriority}\n\n`;

    // Next Action
    output += '### Next Action\n\n';
    const nextAction = this.determineNextAction(newTodos);
    if (nextAction.type === 'all-complete') {
      output += 'All tasks completed\n';
    } else if (nextAction.type === 'continue') {
      output += `Continue with: ${nextAction.taskContent}\n`;
    } else if (nextAction.type === 'start') {
      output += `Start with: ${nextAction.taskContent}\n`;
    }

    return output;
  }

  private calculateStatistics(todos: Todo[]): {
    total: number;
    inProgress: number;
    pending: number;
    completed: number;
    highPriority: number;
    mediumPriority: number;
    lowPriority: number;
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

  private determineNextAction(todos: Todo[]): {
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
