/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { BaseTool, ToolResult } from './tools.js';
import { Todo, TodoArraySchema } from './todo-schemas.js';
import { TodoStore } from './todo-store.js';
import { Type } from '@google/genai';

export interface TodoWriteParams {
  todos: Todo[];
}

export class TodoWrite extends BaseTool<TodoWriteParams, ToolResult> {
  static readonly Name = 'todo_write';

  constructor() {
    super(
      TodoWrite.Name,
      'TodoWrite',
      'Create and manage a structured task list for the current coding session. Updates the entire todo list.',
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
    const sessionId =
      (this as unknown as { sessionId?: string }).sessionId || 'default';
    const agentId = (this as unknown as { agentId?: string }).agentId;

    const store = new TodoStore(sessionId, agentId);

    // Read old todos for diff tracking
    const oldTodos = await store.readTodos();

    // Write new todos
    await store.writeTodos(params.todos);

    // Generate output
    const output = this.generateOutput(oldTodos, params.todos);

    return {
      llmContent: output,
      returnDisplay: output,
    };
  }

  private generateOutput(oldTodos: Todo[], newTodos: Todo[]): string {
    let output = 'Todo list updated successfully\n\n';

    output += `Previous: ${oldTodos.length} todos\n`;
    output += `Updated: ${newTodos.length} todos\n\n`;

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
      output += `Added: ${added.length}\n`;
    }
    if (removed.length > 0) {
      output += `Removed: ${removed.length}\n`;
    }
    if (statusChanges.length > 0) {
      output += `Status changes: ${statusChanges.length}\n`;
    }

    return output;
  }
}
