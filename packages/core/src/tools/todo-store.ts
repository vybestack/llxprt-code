/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { type Todo, TodoArraySchema } from './todo-schemas.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DEFAULT_AGENT_ID } from '../core/turn.js';

/**
 * File format for task storage.
 * Supports both legacy format (just an array) and new format with metadata for tasks.
 */
interface TodoFileData {
  todos: Todo[];
  paused: boolean;
}

export class TodoStore {
  private readonly filePath: string;

  constructor(sessionId: string, agentId?: string) {
    const todoDir = path.join(os.homedir(), '.llxprt', 'todos');
    // Ensure directory exists
    fs.mkdirSync(todoDir, { recursive: true });

    const scopedAgentId =
      agentId && agentId !== DEFAULT_AGENT_ID ? agentId : undefined;

    // Create filename based on session and agent
    const fileName = scopedAgentId
      ? `todo-${sessionId}-${scopedAgentId}.json`
      : `todo-${sessionId}.json`;
    this.filePath = path.join(todoDir, fileName);
  }

  /**
   * Parse file content handling both legacy (array) and new ({ todos, paused }) task formats.
   */
  private parseFileContent(content: string): TodoFileData {
    const rawData = JSON.parse(content);

    // Check if it's the new format (object with todos property)
    if (
      rawData != null &&
      rawData !== false &&
      rawData !== 0 &&
      rawData !== '' &&
      !Number.isNaN(rawData) &&
      typeof rawData === 'object' &&
      !Array.isArray(rawData) &&
      'todos' in rawData
    ) {
      const todosResult = TodoArraySchema.safeParse(rawData.todos);
      if (todosResult.success) {
        return {
          todos: todosResult.data,
          paused: rawData.paused === true,
        };
      }
    }

    // Legacy format: just an array of todos
    const todosResult = TodoArraySchema.safeParse(rawData);
    if (todosResult.success) {
      return {
        todos: todosResult.data,
        paused: false,
      };
    }

    // Invalid format
    return { todos: [], paused: false };
  }

  /**
   * Read the full file data including todos and paused state.
   */
  private async readFileData(): Promise<TodoFileData> {
    try {
      if (!fs.existsSync(this.filePath)) {
        return { todos: [], paused: false };
      }

      const content = await fs.promises.readFile(this.filePath, 'utf8');
      return this.parseFileContent(content);
    } catch {
      // Reading persisted task-list data failed; return empty state.
      return { todos: [], paused: false };
    }
  }

  /**
   * Write the full file data including todos and paused state.
   */
  private async writeFileData(data: TodoFileData): Promise<void> {
    const todosResult = TodoArraySchema.safeParse(data.todos);
    if (!todosResult.success) {
      throw new Error('Invalid todo data');
    }

    const dir = path.dirname(this.filePath);
    await fs.promises.mkdir(dir, { recursive: true });

    const fileData: TodoFileData = {
      todos: todosResult.data,
      paused: data.paused,
    };

    const content = JSON.stringify(fileData, null, 2);
    await fs.promises.writeFile(this.filePath, content, 'utf8');
  }

  async readTodos(): Promise<Todo[]> {
    const data = await this.readFileData();
    return data.todos;
  }

  async writeTodos(todos: Todo[]): Promise<void> {
    // Preserve paused state when writing todos
    const existingData = await this.readFileData();
    await this.writeFileData({
      todos,
      paused: existingData.paused,
    });
  }

  /**
   * Read the paused state from the task file.
   * Returns false if file doesn't exist or is in legacy format.
   */
  async readPausedState(): Promise<boolean> {
    const data = await this.readFileData();
    return data.paused;
  }

  /**
   * Write the paused state to the task file.
   * Preserves existing todos.
   */
  async writePausedState(paused: boolean): Promise<void> {
    const existingData = await this.readFileData();
    await this.writeFileData({
      todos: existingData.todos,
      paused,
    });
  }
}
