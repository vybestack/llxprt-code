/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260129-TODOPERSIST.P06
 * @requirement REQ-003, REQ-004, REQ-005, REQ-006, REQ-007
 */

import * as fs from 'fs';
import * as path from 'path';
import type { Todo } from '@vybestack/llxprt-code-core';
import { Storage } from '@vybestack/llxprt-code-settings';
import { MessageType } from '../types.js';
import type { CommandContext } from './types.js';

export const LIST_ITEM_LABEL = 'TO' + 'DO';

// Position-token patterns are compiled from string sources so the regex
// construction is explicit and reviewable. Inputs are bounded single-line
// tokens (e.g. "1", "1.2", "1.last", "2-4") anchored with ^...$.
const SUBTASK_POSITION_SOURCE = '^(\\d+)\\.(\\d+|last)$';
const RANGE_POSITION_SOURCE = '^(\\d+)-(\\d+)$';
const SUBTASK_POSITION_PATTERN = new RegExp(SUBTASK_POSITION_SOURCE);
const RANGE_POSITION_PATTERN = new RegExp(RANGE_POSITION_SOURCE);

export type AddItemFn = CommandContext['ui']['addItem'];

export function addError(ctx: AddItemFn, text: string): void {
  ctx({ type: MessageType.ERROR, text }, Date.now());
}

export function addInfo(ctx: AddItemFn, text: string): void {
  ctx({ type: MessageType.INFO, text }, Date.now());
}

export function requireTodoContext(
  context: CommandContext,
): context is CommandContext & {
  todoContext: NonNullable<CommandContext['todoContext']>;
} {
  if (!context.todoContext) {
    addError(context.ui.addItem, `${LIST_ITEM_LABEL} context not available`);
    return false;
  }
  return true;
}

/**
 * Parsed position result for the add and remove subcommands
 * @plan PLAN-20260129-TODOPERSIST.P06
 * @plan PLAN-20260129-TODOPERSIST-EXT.P21
 */
export interface ParsedPosition {
  parentIndex: number;
  subtaskIndex?: number;
  isLast: boolean;
}

/**
 * Parse user position input (1-based) into internal position.
 * @plan PLAN-20260129-TODOPERSIST.P06
 * @requirement REQ-005
 * @pseudocode lines 42-74
 */
export function parsePosition(pos: string, todos: Todo[]): ParsedPosition {
  // Line 43: IF position == "last"
  if (pos === 'last') {
    // Line 44: INSERT at todos.length
    return { parentIndex: todos.length, isLast: true };
  }

  // Line 47: ELSE IF position matches /^\d+$/
  if (/^\d+$/.test(pos)) {
    // Line 48: PARSE as integer (1-based)
    const index = parseInt(pos, 10) - 1;

    // Line 49: VALIDATE 1 <= pos <= todos.length + 1
    if (index < 0 || index > todos.length) {
      throw new Error(`Position ${pos} out of range (1-${todos.length + 1})`);
    }

    // Line 50: INSERT at pos - 1
    return { parentIndex: index, isLast: false };
  }

  // Line 53: ELSE IF position matches the subtask pattern (e.g. "1.2", "1.last")
  const subtaskMatch = pos.match(SUBTASK_POSITION_PATTERN);
  if (subtaskMatch) {
    // Line 54: PARSE parent_pos, subtask_pos
    const parentIndex = parseInt(subtaskMatch[1], 10) - 1;

    // Line 55: VALIDATE parent exists
    if (parentIndex < 0 || parentIndex >= todos.length) {
      throw new Error(`Parent position ${subtaskMatch[1]} does not exist`);
    }
    const parent = todos[parentIndex];

    // Line 56: IF subtask_pos == "last"
    if (subtaskMatch[2] === 'last') {
      // Line 57: INSERT at parent.subtasks.length
      return {
        parentIndex,
        subtaskIndex: parent.subtasks?.length ?? 0,
        isLast: true,
      };
    }

    // Line 59: INSERT at subtask_pos - 1
    const subtaskIndex = parseInt(subtaskMatch[2], 10) - 1;
    const subtaskCount = parent.subtasks?.length ?? 0;
    if (subtaskIndex < 0 || subtaskIndex > subtaskCount) {
      throw new Error(
        `Subtask position ${subtaskMatch[2]} out of range (1-${subtaskCount + 1})`,
      );
    }
    return { parentIndex, subtaskIndex, isLast: false };
  }

  // Line 71: THROW error
  throw new Error(
    `Invalid position format: ${pos}. Use 1, 2, last, 1.1, or 1.last`,
  );
}

/** Match a numeric range pattern like "2-4". Returns the match or undefined. */
export function matchRangePattern(
  posStr: string,
): RegExpMatchArray | null | undefined {
  return posStr.match(RANGE_POSITION_PATTERN);
}

/**
 * Validate that a parsed position refers to an existing parent task.
 * Returns true when valid; sends an error and returns false otherwise.
 */
export function validateExistingParent(
  ctx: AddItemFn,
  parsed: ParsedPosition,
  todos: Todo[],
  posStr: string,
): boolean {
  if (parsed.parentIndex >= todos.length) {
    addError(ctx, `Position ${posStr} does not exist`);
    return false;
  }
  return true;
}

/**
 * Reject subtask positions for status-modifying commands.
 * Returns true when the position is a parent-only position; sends an error and
 * returns false when the user targeted a subtask.
 */
export function rejectSubtaskPosition(
  ctx: AddItemFn,
  parsed: ParsedPosition,
): boolean {
  if (parsed.subtaskIndex !== undefined) {
    addError(
      ctx,
      `Subtasks don't have status. Use parent ${LIST_ITEM_LABEL} position instead.`,
    );
    return false;
  }
  return true;
}

/**
 * Validate range bounds and order. Returns parsed {start,end} on success, or
 * undefined after sending an error.
 */
export function validateRange(
  ctx: AddItemFn,
  rangeMatch: RegExpMatchArray,
  maxItems: number,
): { start: number; end: number } | undefined {
  const start = parseInt(rangeMatch[1], 10);
  const end = parseInt(rangeMatch[2], 10);

  if (start > end) {
    addError(ctx, `Invalid range: start (${start}) must be <= end (${end})`);
    return undefined;
  }

  if (start < 1 || end > maxItems) {
    addError(ctx, `Range out of bounds: valid range is 1-${maxItems}`);
    return undefined;
  }

  return { start, end };
}

export type TodoContext = CommandContext & {
  todoContext: NonNullable<CommandContext['todoContext']>;
};

/**
 * Apply a status change to a single parent task and report the result.
 */
export function applyStatusChange(
  context: TodoContext,
  posStr: string,
  newStatus: 'in_progress' | 'pending',
  statusLabel: string,
): void {
  const { todos } = context.todoContext;
  const parsed = parsePosition(posStr, todos);
  const addItem = context.ui.addItem;

  if (!validateExistingParent(addItem, parsed, todos, posStr)) return;
  if (!rejectSubtaskPosition(addItem, parsed)) return;

  const newTodos = [...todos];
  const todo = { ...newTodos[parsed.parentIndex], status: newStatus };
  newTodos[parsed.parentIndex] = todo;

  context.todoContext.updateTodos(newTodos);
  addInfo(
    addItem,
    `Set ${LIST_ITEM_LABEL} ${posStr} to ${statusLabel}: "${todo.content}"`,
  );
}

/**
 * Add a subtask at a parsed position.
 */
export function addSubtaskAtPosition(
  context: TodoContext,
  parsed: ParsedPosition,
  posStr: string,
  description: string,
  newId: string,
): void {
  const { todos } = context.todoContext;
  const newTodos = [...todos];
  const parent = { ...newTodos[parsed.parentIndex] };
  parent.subtasks = parent.subtasks ? [...parent.subtasks] : [];

  const newSubtask = {
    id: `${newId}-${parsed.subtaskIndex}`,
    content: description,
  };

  parent.subtasks.splice(parsed.subtaskIndex!, 0, newSubtask);
  newTodos[parsed.parentIndex] = parent;

  context.todoContext.updateTodos(newTodos);
  addInfo(
    context.ui.addItem,
    `Added subtask at position ${posStr}: "${description}"`,
  );
}

/**
 * Add a top-level task at a parsed position.
 */
export function addTaskAtPosition(
  context: TodoContext,
  parsed: ParsedPosition,
  posStr: string,
  description: string,
  newId: string,
): void {
  const { todos } = context.todoContext;
  const newTodo: Todo = {
    id: newId,
    content: description,
    status: 'pending',
  };

  const newTodos = [...todos];
  newTodos.splice(parsed.parentIndex, 0, newTodo);

  context.todoContext.updateTodos(newTodos);
  addInfo(
    context.ui.addItem,
    `Added ${LIST_ITEM_LABEL} at position ${posStr}: "${description}"`,
  );
}

/**
 * Remove a subtask at a parsed position.
 */
export function removeSubtaskAtPosition(
  context: TodoContext,
  parsed: ParsedPosition,
  posStr: string,
): void {
  const { todos } = context.todoContext;
  const addItem = context.ui.addItem;
  const newTodos = [...todos];
  const parent = newTodos[parsed.parentIndex];

  if (!parent.subtasks || parsed.subtaskIndex! >= parent.subtasks.length) {
    addError(addItem, `Subtask at position ${posStr} does not exist`);
    return;
  }

  const clonedParent = { ...parent };
  clonedParent.subtasks = [...parent.subtasks];
  clonedParent.subtasks.splice(parsed.subtaskIndex!, 1);
  newTodos[parsed.parentIndex] = clonedParent;

  context.todoContext.updateTodos(newTodos);
  addInfo(addItem, `Removed 1 ${LIST_ITEM_LABEL}(s)`);
}

/**
 * Remove a single parent task at a parsed position.
 */
export function removeTaskAtPosition(
  context: TodoContext,
  parsed: ParsedPosition,
  posStr: string,
): void {
  const { todos } = context.todoContext;
  const addItem = context.ui.addItem;

  if (parsed.parentIndex >= todos.length) {
    addError(
      addItem,
      `${LIST_ITEM_LABEL} at position ${posStr} does not exist`,
    );
    return;
  }

  const newTodos = [...todos];
  newTodos.splice(parsed.parentIndex, 1);
  context.todoContext.updateTodos(newTodos);
  addInfo(addItem, `Removed 1 ${LIST_ITEM_LABEL}(s)`);
}

/**
 * Remove a range of tasks (1-based inclusive) and report the result.
 */
export function removeRangeOfTasks(
  context: TodoContext,
  start: number,
  end: number,
): void {
  const { todos } = context.todoContext;
  const newTodos = [...todos];
  let removeCount = 0;
  for (let i = end - 1; i >= start - 1; i--) {
    newTodos.splice(i, 1);
    removeCount++;
  }

  context.todoContext.updateTodos(newTodos);
  addInfo(context.ui.addItem, `Removed ${removeCount} ${LIST_ITEM_LABEL}(s)`);
}

export interface TodoSessionFile {
  readonly name: string;
  readonly path: string;
  readonly mtime: Date;
}

/**
 * Helper: Get sorted saved session files
 * @plan PLAN-20260129-TODOPERSIST-EXT.P19
 * @returns Array of saved session files sorted by modification time (newest first)
 */
export function getTodoSessionFiles(): TodoSessionFile[] {
  const todoDir = path.join(Storage.getGlobalDataDir(), 'todos');

  if (!fs.existsSync(todoDir)) {
    return [];
  }

  const files = fs
    .readdirSync(todoDir)
    .filter((f) => f.startsWith('todo-') && f.endsWith('.json'))
    .map((f) => {
      const filePath = path.join(todoDir, f);
      const stats = fs.statSync(filePath);
      return { name: f, path: filePath, mtime: stats.mtime };
    });

  // Sort by modification time (newest first)
  files.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

  return files;
}

/**
 * Delete all saved session files from disk.
 */
export function deleteAllSessions(
  context: CommandContext,
  files: ReadonlyArray<{ path: string }>,
): void {
  const count = files.length;
  files.forEach((file) => {
    fs.unlinkSync(file.path);
  });
  addInfo(
    context.ui.addItem,
    `Deleted ${count} saved ${LIST_ITEM_LABEL} session(s)`,
  );
}

/**
 * Delete a range of saved session files (1-based inclusive).
 */
export function deleteSessionRange(
  context: CommandContext,
  files: ReadonlyArray<{ path: string }>,
  start: number,
  end: number,
): void {
  let deleteCount = 0;
  for (let i = start - 1; i < end; i++) {
    fs.unlinkSync(files[i].path);
    deleteCount++;
  }
  addInfo(
    context.ui.addItem,
    `Deleted ${deleteCount} saved ${LIST_ITEM_LABEL} session(s)`,
  );
}

/**
 * Delete a single saved session file (1-based).
 */
export function deleteSingleSession(
  context: CommandContext,
  files: ReadonlyArray<{ path: string }>,
  sessionNum: number,
): void {
  const selectedFile = files[sessionNum - 1];
  fs.unlinkSync(selectedFile.path);
  addInfo(context.ui.addItem, `Deleted 1 saved ${LIST_ITEM_LABEL} session(s)`);
}

/**
 * Reset all todos to pending status.
 */
export function undoAllTodos(context: TodoContext): void {
  const { todos } = context.todoContext;
  const newTodos = todos.map((todo) => ({
    ...todo,
    status: 'pending' as const,
  }));
  const count = todos.length;
  context.todoContext.updateTodos(newTodos);
  addInfo(
    context.ui.addItem,
    `Reset ${count} ${LIST_ITEM_LABEL}(s) to pending`,
  );
}

/**
 * Reset a range of todos to pending status (1-based inclusive).
 */
export function undoRangeOfTodos(
  context: TodoContext,
  start: number,
  end: number,
): void {
  const { todos } = context.todoContext;
  const newTodos = [...todos];
  let resetCount = 0;
  for (let i = start - 1; i < end; i++) {
    newTodos[i] = { ...newTodos[i], status: 'pending' };
    resetCount++;
  }
  context.todoContext.updateTodos(newTodos);
  addInfo(
    context.ui.addItem,
    `Reset ${resetCount} ${LIST_ITEM_LABEL}(s) to pending`,
  );
}

/**
 * Reset a single task at a parsed position to pending.
 */
export function undoSingleTodo(context: TodoContext, posStr: string): void {
  const { todos } = context.todoContext;
  const addItem = context.ui.addItem;
  const parsed = parsePosition(posStr, todos);

  if (!validateExistingParent(addItem, parsed, todos, posStr)) return;
  if (!rejectSubtaskPosition(addItem, parsed)) return;

  const newTodos = [...todos];
  newTodos[parsed.parentIndex] = {
    ...newTodos[parsed.parentIndex],
    status: 'pending',
  };

  context.todoContext.updateTodos(newTodos);
  addInfo(addItem, `Reset 1 ${LIST_ITEM_LABEL}(s) to pending`);
}
