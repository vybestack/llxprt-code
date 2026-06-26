/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { type Todo, TodoArraySchema } from '../types/todo-schemas.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export const DEFAULT_AGENT_ID = 'primary';

// Inline platform config path matching Storage.getGlobalLlxprtDir() without
// importing the storage package (tools is a workspace that must not declare
// extra @vybestack/ dependencies to avoid lock-file churn in CI).
function getGlobalConfigDir(): string {
  const override = process.env['LLXPRT_CONFIG_HOME'];
  if (override) return override;
  const home = os.homedir();
  if (!home) {
    return path.join(os.tmpdir(), 'llxprt-code', 'configuration');
  }
  const p = process.platform;
  let dataDir: string;
  if (p === 'darwin') {
    dataDir = path.join(home, 'Library', 'Application Support', 'llxprt-code');
  } else if (p === 'win32') {
    const rawLocalAppData = process.env['LOCALAPPDATA'] ?? '';
    dataDir = path.join(
      rawLocalAppData !== ''
        ? rawLocalAppData
        : path.join(home, 'AppData', 'Local'),
      'llxprt-code',
      'Data',
    );
  } else {
    const rawXdg = process.env['XDG_DATA_HOME'] ?? '';
    dataDir = path.join(
      rawXdg !== '' ? rawXdg : path.join(home, '.local', 'share'),
      'llxprt-code',
    );
  }
  return path.join(dataDir, 'configuration');
}

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
    const todoDir = path.join(getGlobalConfigDir(), 'todos');
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
    if (isNewTodoFormat(rawData)) {
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

/**
 * Type guard: is the parsed data a new-format ({ todos, ... }) object?
 * Extracts the compound truthiness/type check into a named function to keep
 * conditional operator count within the linter limit.
 */
function isNewTodoFormat(data: unknown): data is Record<string, unknown> {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return false;
  }
  return 'todos' in data;
}
