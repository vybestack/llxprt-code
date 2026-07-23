/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { type Todo, TodoArraySchema } from '../types/todo-schemas.js';
import * as fs from 'fs';
import * as path from 'path';

export const DEFAULT_AGENT_ID = 'primary';

/**
 * Resolves the canonical global data directory for todo storage.
 *
 * Tools is a leaf package and must NOT import the central Storage singleton
 * (dependency boundary). The composition root therefore injects the canonical
 * data directory (or a resolver returning it) at every construction site,
 * pointing it at `Storage.getGlobalDataDir()`. This keeps Storage the sole
 * OS-platform path authority while preserving the leaf-package boundary.
 *
 * There is intentionally NO duplicate platform algorithm and NO module-level
 * mutable resolver here: every runtime and test construction must supply the
 * dependency explicitly. Omitting it fails at the construction boundary
 * rather than silently falling back to a parallel default.
 */
export type TodoDataDirResolver = () => string;

/**
 * File format for task storage.
 * Supports both legacy format (just an array) and new format with metadata for tasks.
 */
interface TodoFileData {
  todos: Todo[];
  paused: boolean;
}

/**
 * Options for constructing a {@link TodoStore}.
 *
 * Exactly one of `dataDirResolver` / `dataDir` MUST be supplied (XOR union).
 * There is no implicit fallback. The composition root injects the canonical
 * Storage data dir so Storage remains the sole OS-platform path authority.
 *
 * The XOR union is enforced at compile time via a discriminated union: each
 * member has exactly one of the two properties (and not the other), so
 * supplying both or neither is a type error. At runtime, {@link resolveDataDir}
 * re-evaluates the resolver on every operation when `dataDirResolver` is
 * supplied, so a dynamic profile/category change during runtime is honored
 * (matching the docs' dynamic-resolution promise). When `dataDir` (fixed) is
 * supplied, the path is resolved once at construction and never changes.
 */
export type TodoStoreOptions =
  | {
      readonly dataDirResolver: TodoDataDirResolver;
      readonly dataDir?: undefined;
    }
  | { readonly dataDir: string; readonly dataDirResolver?: undefined };

/**
 * Resolves the canonical global data directory for todo storage at
 * construction time. The returned resolver is re-evaluated on every operation
 * when `dataDirResolver` was supplied, so a dynamic profile/category change
 * during runtime is honored. When `dataDir` (fixed) was supplied, the path is
 * resolved once and never changes.
 */
function resolveDataDir(options: TodoStoreOptions): TodoDataDirResolver {
  if (options.dataDirResolver !== undefined) {
    return options.dataDirResolver;
  }
  // The XOR union guarantees dataDir is a string when dataDirResolver is
  // undefined — no runtime fallback to a duplicate platform algorithm.
  const fixed = options.dataDir;
  return () => fixed;
}

export class TodoStore {
  private readonly dataDirResolver: TodoDataDirResolver;
  private readonly sessionId: string;
  private readonly scopedAgentId: string | undefined;

  constructor(sessionId: string, options: TodoStoreOptions, agentId?: string) {
    this.dataDirResolver = resolveDataDir(options);
    this.sessionId = sessionId;
    this.scopedAgentId =
      agentId && agentId !== DEFAULT_AGENT_ID ? agentId : undefined;
    // Ensure the base directory exists at construction so a missing root is
    // detected early. Per-operation re-evaluation happens in resolveFilePath.
    const todoDir = path.join(this.dataDirResolver(), 'todos');
    fs.mkdirSync(todoDir, { recursive: true });
  }

  /**
   * Resolves the current file path by re-evaluating the data-dir resolver.
   * When a dynamic resolver was supplied, profile/category changes during
   * runtime are honored on every read/write (matching the docs' dynamic
   * resolution promise). When a fixed dir was supplied, this is stable.
   */
  private resolveFilePath(): string {
    const todoDir = path.join(this.dataDirResolver(), 'todos');
    const fileName = this.scopedAgentId
      ? `todo-${this.sessionId}-${this.scopedAgentId}.json`
      : `todo-${this.sessionId}.json`;
    return path.join(todoDir, fileName);
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
   *
   * Resolves the file path exactly once for the entire operation and threads
   * that captured path through both the exists-check and the read.
   * This guarantees a dynamic resolver that changes between calls cannot split
   * the exists/read across different directories.
   */
  private async readFileData(): Promise<TodoFileData> {
    const filePath = this.resolveFilePath();
    return this.readFileDataAt(filePath);
  }

  /**
   * Reads file data at a specific captured path. The path is resolved once by
   * the caller and threaded through so a dynamic resolver cannot split a
   * single logical operation across directories.
   */
  private async readFileDataAt(filePath: string): Promise<TodoFileData> {
    try {
      if (!fs.existsSync(filePath)) {
        return { todos: [], paused: false };
      }

      const content = await fs.promises.readFile(filePath, 'utf8');
      return this.parseFileContent(content);
    } catch {
      // Reading persisted task-list data failed; return empty state.
      return { todos: [], paused: false };
    }
  }

  /**
   * Writes file data to a specific captured path. The path is resolved once by
   * the caller and threaded through so a dynamic resolver cannot split a
   * single logical operation across directories.
   */
  private async writeFileDataAt(
    filePath: string,
    data: TodoFileData,
  ): Promise<void> {
    const todosResult = TodoArraySchema.safeParse(data.todos);
    if (!todosResult.success) {
      throw new Error('Invalid todo data');
    }

    const dir = path.dirname(filePath);
    await fs.promises.mkdir(dir, { recursive: true });

    const fileData: TodoFileData = {
      todos: todosResult.data,
      paused: data.paused,
    };

    const content = JSON.stringify(fileData, null, 2);
    await fs.promises.writeFile(filePath, content, 'utf8');
  }

  async readTodos(): Promise<Todo[]> {
    const data = await this.readFileData();
    return data.todos;
  }

  /**
   * Writes todos, preserving the existing paused state.
   *
   * Resolves the file path exactly once for the whole logical operation
   * (read-existing + write) so a dynamic resolver cannot split the read and
   * write across different directories.
   */
  async writeTodos(todos: Todo[]): Promise<void> {
    const filePath = this.resolveFilePath();
    const existingData = await this.readFileDataAt(filePath);
    await this.writeFileDataAt(filePath, {
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
   * Write the paused state to the task file, preserving existing todos.
   *
   * Resolves the file path exactly once for the whole logical operation
   * (read-existing + write) so a dynamic resolver cannot split the read and
   * write across different directories.
   */
  async writePausedState(paused: boolean): Promise<void> {
    const filePath = this.resolveFilePath();
    const existingData = await this.readFileDataAt(filePath);
    await this.writeFileDataAt(filePath, {
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
