/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { BaseTool, ToolResult, Icon } from './tools.js';
import { TodoStore } from './todo-store.js';
import { Todo } from './todo-schemas.js';
import { Type } from '@google/genai';

export type TodoReadParams = Record<string, never>;

export class TodoRead extends BaseTool<TodoReadParams, ToolResult> {
  static readonly Name = 'todo_read';

  constructor() {
    super(
      TodoRead.Name,
      'TodoRead',
      'Read the current todo list for the session. Returns all todos with their status, priority, and content.',
      Icon.LightBulb,
      {
        type: Type.OBJECT,
        properties: {},
      },
      true, // isOutputMarkdown
      false, // canUpdateOutput
    );
  }

  getDescription(_params: TodoReadParams): string {
    return 'Read current todo list';
  }

  async execute(
    _params: TodoReadParams,
    _signal: AbortSignal,
    _updateOutput?: (output: string) => void,
  ): Promise<ToolResult> {
    // Get session and agent IDs from context
    const sessionId =
      (this as unknown as { sessionId?: string }).sessionId || 'default';
    const agentId = (this as unknown as { agentId?: string }).agentId;

    const store = new TodoStore(sessionId, agentId);
    const todos = await store.readTodos();

    if (todos.length === 0) {
      return {
        llmContent: 'No todos found',
        returnDisplay: 'No todos found',
      };
    }

    // Sort todos
    const sortedTodos = this.sortTodos(todos);

    // Format output
    const output = this.formatTodos(sortedTodos);

    return {
      llmContent: output,
      returnDisplay: output,
    };
  }

  private sortTodos(todos: Todo[]): Todo[] {
    const statusOrder = { in_progress: 0, pending: 1, completed: 2 };
    const priorityOrder = { high: 0, medium: 1, low: 2 };

    return [...todos].sort((a, b) => {
      const statusDiff = statusOrder[a.status] - statusOrder[b.status];
      if (statusDiff !== 0) return statusDiff;
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });
  }

  private formatTodos(todos: Todo[]): string {
    const statusIcons = {
      in_progress: '⏳',
      pending: '○',
      completed: '✓',
    };

    let output = '# Todo List\n\n';

    for (const todo of todos) {
      const icon = statusIcons[todo.status];
      output += `${icon} **${todo.content}** (${todo.priority})\n`;
    }

    return output;
  }
}
