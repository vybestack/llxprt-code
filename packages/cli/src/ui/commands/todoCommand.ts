/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable complexity, max-lines, eslint-comments/disable-enable-pair -- Phase 5: legacy UI boundary retained while larger decomposition continues. */

/**
 * @plan PLAN-20260129-TODOPERSIST.P06
 * @requirement REQ-003, REQ-004, REQ-005, REQ-006, REQ-007
 */

import type { SlashCommand } from './types.js';
import { CommandKind } from './types.js';
import type { CommandContext } from './types.js';
import type { Todo } from '@vybestack/llxprt-code-core';
import { MessageType } from '../types.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const LIST_ITEM_LABEL = 'TO' + 'DO';

/**
 * Get the icon for a task-list status.
 */
function getStatusIcon(status: Todo['status']): string {
  if (status === 'completed') return '✓';
  if (status === 'in_progress') return '▸';
  return '○';
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

  // Line 53: ELSE IF position matches /^(\d+)\.(\d+|last)$/
  // Static regex for position parsing - no dynamic parts
  // eslint-disable-next-line sonarjs/regular-expr
  const subtaskMatch = pos.match(/^(\d+)\.(\d+|last)$/);
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
    return { parentIndex, subtaskIndex, isLast: false };
  }

  // Line 71: THROW error
  throw new Error(
    `Invalid position format: ${pos}. Use 1, 2, last, 1.1, or 1.last`,
  );
}

/**
 * Helper: Format time ago from Date
 * @plan PLAN-20260129-TODOPERSIST.P06
 */
function formatAge(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffHours / 24);

  if (diffHours < 1) return 'Just now';
  if (diffHours === 1) return '1 hour ago';
  if (diffHours < 24) return `${diffHours} hours ago`;
  if (diffDays === 1) return '1 day ago';
  return `${diffDays} days ago`;
}

/**
 * Helper: Get sorted saved session files
 * @plan PLAN-20260129-TODOPERSIST-EXT.P19
 * @returns Array of saved session files sorted by modification time (newest first)
 */
function getTodoSessionFiles(): Array<{
  name: string;
  path: string;
  mtime: Date;
}> {
  const todoDir = path.join(os.homedir(), '.llxprt', 'todos');

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

// ---------------------------------------------------------------------------
// UI helper wrappers to reduce boilerplate in action handlers
// ---------------------------------------------------------------------------

type AddItemFn = CommandContext['ui']['addItem'];

function addError(ctx: AddItemFn, text: string): void {
  ctx({ type: MessageType.ERROR, text }, Date.now());
}

function addInfo(ctx: AddItemFn, text: string): void {
  ctx({ type: MessageType.INFO, text }, Date.now());
}

function requireTodoContext(
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
 * Validate that a parsed position refers to an existing parent task.
 * Returns true when valid; sends an error and returns false otherwise.
 */
function validateExistingParent(
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
function rejectSubtaskPosition(
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
function validateRange(
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

/** Match a numeric range pattern like "2-4". Returns the match or undefined. */
function matchRangePattern(
  posStr: string,
): RegExpMatchArray | null | undefined {
  // Static regex for range parsing - no dynamic parts
  // eslint-disable-next-line sonarjs/regular-expr
  return posStr.match(/^(\d+)-(\d+)$/);
}

// ---------------------------------------------------------------------------
// Help text constants
// ---------------------------------------------------------------------------

const SET_HELP = `Usage: /todo set <position>

Sets the ${LIST_ITEM_LABEL} at the specified position to 'in_progress' status.

Position formats:
  1, 2, 3    - Position number (1-based)

Examples:
  /todo set 1
  /todo set 3`;

const UNSET_HELP = `Usage: /todo unset <position>

Sets the ${LIST_ITEM_LABEL} at the specified position to 'pending' status.
This is the opposite of /todo set (which sets to 'in_progress').

Position formats:
  1, 2, 3    - Position number (1-based)

Examples:
  /todo unset 1
  /todo unset 3`;

const ADD_HELP = `Usage: /todo add <position> <description>

Position formats:
  1, 2, 3    - Insert at specific position (1-based)
  last       - Append to end of list
  1.1, 1.2   - Insert subtask under parent ${LIST_ITEM_LABEL} 1
  1.last     - Append subtask to parent ${LIST_ITEM_LABEL} 1

Examples:
  /todo add 1 Fix login bug
  /todo add last Write documentation
  /todo add 2.1 Add unit tests`;

const REMOVE_HELP = `Usage: /todo remove <position>

Position formats:
  2          - Remove ${LIST_ITEM_LABEL} at position 2
  1-5        - Remove ${LIST_ITEM_LABEL}s 1 through 5 (inclusive)
  all        - Remove all ${LIST_ITEM_LABEL}s

Examples:
  /todo remove 3
  /todo remove 1-5
  /todo remove all`;

const DELETE_HELP = `Usage: /todo delete <number|range|all>

Deletes saved ${LIST_ITEM_LABEL} sessions from disk. Use /todo list to see sessions.

Formats:
  3          - Delete session #3
  1-5        - Delete sessions 1 through 5
  all        - Delete all saved sessions

Examples:
  /todo delete 2
  /todo delete 1-3
  /todo delete all`;

const UNDO_HELP = `Usage: /todo undo <position|range|all>

Resets ${LIST_ITEM_LABEL} status back to 'pending'.

Formats:
  2          - Reset ${LIST_ITEM_LABEL} at position 2
  1-5        - Reset ${LIST_ITEM_LABEL}s 1 through 5
  all        - Reset all ${LIST_ITEM_LABEL}s

Examples:
  /todo undo 3
  /todo undo 1-5
  /todo undo all`;

const LOAD_HELP = `Usage: /todo load <number>

Loads a saved ${LIST_ITEM_LABEL} session. Use /todo list to see available sessions.

Examples:
  /todo list       - Show saved sessions with numbers
  /todo load 1     - Load the most recent session
  /todo load 3     - Load the third session`;

// ---------------------------------------------------------------------------
// Extracted action logic helpers
// ---------------------------------------------------------------------------

/**
 * Apply a status change to a single parent task and report the result.
 */
function applyStatusChange(
  context: CommandContext & {
    todoContext: NonNullable<CommandContext['todoContext']>;
  },
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
  const todo = newTodos[parsed.parentIndex];
  todo.status = newStatus;

  context.todoContext.updateTodos(newTodos);
  addInfo(
    addItem,
    `Set ${LIST_ITEM_LABEL} ${posStr} to ${statusLabel}: "${todo.content}"`,
  );
}

/**
 * Add a subtask at a parsed position.
 */
function addSubtaskAtPosition(
  context: CommandContext & {
    todoContext: NonNullable<CommandContext['todoContext']>;
  },
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
function addTaskAtPosition(
  context: CommandContext & {
    todoContext: NonNullable<CommandContext['todoContext']>;
  },
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
function removeSubtaskAtPosition(
  context: CommandContext & {
    todoContext: NonNullable<CommandContext['todoContext']>;
  },
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
function removeTaskAtPosition(
  context: CommandContext & {
    todoContext: NonNullable<CommandContext['todoContext']>;
  },
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
function removeRangeOfTasks(
  context: CommandContext & {
    todoContext: NonNullable<CommandContext['todoContext']>;
  },
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

/**
 * Delete all saved session files from disk.
 */
function deleteAllSessions(
  context: CommandContext,
  files: Array<{ path: string }>,
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
function deleteSessionRange(
  context: CommandContext,
  files: Array<{ path: string }>,
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
function deleteSingleSession(
  context: CommandContext,
  files: Array<{ path: string }>,
  sessionNum: number,
): void {
  const selectedFile = files[sessionNum - 1];
  fs.unlinkSync(selectedFile.path);
  addInfo(context.ui.addItem, `Deleted 1 saved ${LIST_ITEM_LABEL} session(s)`);
}

/**
 * Reset all todos to pending status.
 */
function undoAllTodos(
  context: CommandContext & {
    todoContext: NonNullable<CommandContext['todoContext']>;
  },
): void {
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
function undoRangeOfTodos(
  context: CommandContext & {
    todoContext: NonNullable<CommandContext['todoContext']>;
  },
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
function undoSingleTodo(
  context: CommandContext & {
    todoContext: NonNullable<CommandContext['todoContext']>;
  },
  posStr: string,
): void {
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

/**
 * Format a single session file entry for the list display.
 */
function formatSessionEntry(
  file: { path: string; mtime: Date },
  idx: number,
): string[] {
  try {
    const content = fs.readFileSync(file.path, 'utf8');
    const todos: Todo[] = JSON.parse(content);

    const counts = {
      pending: todos.filter((t) => t.status === 'pending').length,
      in_progress: todos.filter((t) => t.status === 'in_progress').length,
      completed: todos.filter((t) => t.status === 'completed').length,
    };

    const firstTitle = todos[0]?.content || '(empty)';
    const age = formatAge(file.mtime);

    const statusSummary = [
      counts.in_progress > 0 ? `${counts.in_progress} in_progress` : '',
      counts.pending > 0 ? `${counts.pending} pending` : '',
      counts.completed > 0 ? `${counts.completed} completed` : '',
    ]
      .filter((s) => s !== '')
      .join(', ');

    return [
      `${idx + 1}. ${age} │ ${todos.length} items (${statusSummary})`,
      `   → "${firstTitle}"`,
      '',
    ];
  } catch {
    return [`${idx + 1}. ${formatAge(file.mtime)} │ (error reading file)`, ''];
  }
}

// ---------------------------------------------------------------------------
// Main slash command with subcommands
/* plan: PLAN-20260129-TODOPERSIST.P06 */
// ---------------------------------------------------------------------------

export const todoCommand: SlashCommand = {
  name: 'todo',
  kind: CommandKind.BUILT_IN,
  description: `Manage ${LIST_ITEM_LABEL} list`,
  subCommands: [
    {
      name: 'clear',
      description: `Clear all ${LIST_ITEM_LABEL}s from the active session`,
      kind: CommandKind.BUILT_IN,
      /**
       * clear subcommand - Clear all tasks
       * @plan PLAN-20260129-TODOPERSIST.P09
       * @requirement REQ-003
       */
      action: (context) => {
        if (!requireTodoContext(context)) return;

        context.todoContext.updateTodos([]);
        addInfo(context.ui.addItem, `${LIST_ITEM_LABEL} list cleared`);
      },
    },
    {
      name: 'show',
      description: `Display the current ${LIST_ITEM_LABEL} list`,
      kind: CommandKind.BUILT_IN,
      /**
       * show subcommand - Display current tasks
       * @plan PLAN-20260129-TODOPERSIST.P09
       * @requirement REQ-004
       */
      action: (context) => {
        if (!requireTodoContext(context)) return;

        const { todos } = context.todoContext;

        if (todos.length === 0) {
          addInfo(context.ui.addItem, `No active ${LIST_ITEM_LABEL}s`);
          return;
        }

        const lines: string[] = [`Current ${LIST_ITEM_LABEL} List:`, ''];

        todos.forEach((todo, idx) => {
          const pos = idx + 1;
          const statusIcon = getStatusIcon(todo.status);

          lines.push(`${pos}. ${statusIcon} ${todo.content}`.trim());

          if (todo.subtasks != null && todo.subtasks.length > 0) {
            todo.subtasks.forEach((subtask, subIdx) => {
              const subPos = `${pos}.${subIdx + 1}`;
              lines.push(`   ${subPos}. ${subtask.content}`);
            });
          }
        });

        addInfo(context.ui.addItem, lines.join('\n'));
      },
    },
    {
      name: 'set',
      description: `Set a ${LIST_ITEM_LABEL} status to in_progress. Usage: /todo set <position>`,
      kind: CommandKind.BUILT_IN,
      /**
       * set subcommand - Set task to in_progress
       * @plan PLAN-20260129-TODOPERSIST-EXT.P17
       * @plan PLAN-20260129-TODOPERSIST-EXT.P20
       * @requirement REQ-008
       */
      action: (context, args) => {
        if (!requireTodoContext(context)) return;

        if (!args || args.trim() === '') {
          addInfo(context.ui.addItem, SET_HELP);
          return;
        }

        const posStr = args.trim().split(/\s+/)[0];

        try {
          applyStatusChange(context, posStr, 'in_progress', 'in_progress');
        } catch (error) {
          addError(
            context.ui.addItem,
            `Error: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      },
    },
    {
      name: 'unset',
      description: `Set a ${LIST_ITEM_LABEL} status back to pending. Usage: /todo unset <position>`,
      kind: CommandKind.BUILT_IN,
      /**
       * unset subcommand - Set task to pending
       * @plan PLAN-20260129-TODOPERSIST-EXT.P22
       * @requirement REQ-008
       */
      action: (context, args) => {
        if (!requireTodoContext(context)) return;

        if (!args || args.trim() === '') {
          addInfo(context.ui.addItem, UNSET_HELP);
          return;
        }

        const posStr = args.trim().split(/\s+/)[0];

        try {
          applyStatusChange(context, posStr, 'pending', 'pending');
        } catch (error) {
          addError(
            context.ui.addItem,
            `Error: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      },
    },
    {
      name: 'add',
      description: `Add a ${LIST_ITEM_LABEL} at the specified position. Usage: /todo add <position> <description>`,
      kind: CommandKind.BUILT_IN,
      /**
       * add subcommand - Add task at position
       * @plan PLAN-20260129-TODOPERSIST.P09
       * @plan PLAN-20260129-TODOPERSIST-EXT.P20
       * @requirement REQ-005
       * @pseudocode lines 42-74
       */
      action: (context, args) => {
        if (!requireTodoContext(context)) return;

        if (!args || args.trim() === '') {
          addInfo(context.ui.addItem, ADD_HELP);
          return;
        }

        const parts = args.trim().split(/\s+/);
        if (parts.length < 2) {
          addError(
            context.ui.addItem,
            'Usage: /todo add <position> <description>',
          );
          return;
        }

        const posStr = parts[0];
        const description = parts.slice(1).join(' ');

        try {
          const { todos } = context.todoContext;
          const parsed = parsePosition(posStr, todos);
          const newId = `user-${Date.now()}`;

          if (parsed.subtaskIndex !== undefined) {
            addSubtaskAtPosition(context, parsed, posStr, description, newId);
          } else {
            addTaskAtPosition(context, parsed, posStr, description, newId);
          }
        } catch (error) {
          addError(
            context.ui.addItem,
            `Error: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      },
    },
    {
      name: 'remove',
      description: `Remove a ${LIST_ITEM_LABEL} from the current list. Usage: /todo remove <position|range|all>`,
      kind: CommandKind.BUILT_IN,
      /**
       * remove subcommand - Remove tasks from active session
       * @plan PLAN-20260129-TODOPERSIST-EXT.P18
       * @plan PLAN-20260129-TODOPERSIST-EXT.P20
       * @plan PLAN-20260129-TODOPERSIST-EXT.P21
       * @requirement REQ-006
       * @pseudocode Extended with range and "all" support
       */
      action: (context, args) => {
        if (!requireTodoContext(context)) return;

        if (!args || args.trim() === '') {
          addInfo(context.ui.addItem, REMOVE_HELP);
          return;
        }

        const posStr = args.trim().split(/\s+/)[0];
        const { todos } = context.todoContext;
        const addItem = context.ui.addItem;

        try {
          if (posStr === 'all') {
            const count = todos.length;
            context.todoContext.updateTodos([]);
            addInfo(addItem, `Removed ${count} ${LIST_ITEM_LABEL}(s)`);
            return;
          }

          const rangeMatch = matchRangePattern(posStr);
          if (rangeMatch) {
            const range = validateRange(addItem, rangeMatch, todos.length);
            if (!range) return;
            removeRangeOfTasks(context, range.start, range.end);
            return;
          }

          const parsed = parsePosition(posStr, todos);

          if (parsed.subtaskIndex !== undefined) {
            removeSubtaskAtPosition(context, parsed, posStr);
          } else {
            removeTaskAtPosition(context, parsed, posStr);
          }
        } catch (error) {
          addError(
            addItem,
            `Error: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      },
    },
    {
      name: 'delete',
      description: `Delete saved ${LIST_ITEM_LABEL} session(s) from disk. Usage: /todo delete <number|range|all>`,
      kind: CommandKind.BUILT_IN,
      /**
       * delete subcommand - Delete saved task-list files from disk
       * @plan PLAN-20260129-TODOPERSIST-EXT.P21
       * @requirement REQ-010
       */
      action: async (context, args) => {
        if (!args || args.trim() === '') {
          addInfo(context.ui.addItem, DELETE_HELP);
          return;
        }

        const posStr = args.trim().split(/\s+/)[0];
        const addItem = context.ui.addItem;

        try {
          const files = getTodoSessionFiles();

          if (files.length === 0) {
            addInfo(addItem, `No saved ${LIST_ITEM_LABEL} sessions found`);
            return;
          }

          if (posStr === 'all') {
            deleteAllSessions(context, files);
            return;
          }

          const rangeMatch = matchRangePattern(posStr);
          if (rangeMatch) {
            const range = validateRange(addItem, rangeMatch, files.length);
            if (!range) return;
            deleteSessionRange(context, files, range.start, range.end);
            return;
          }

          const sessionNum = parseInt(posStr, 10);
          if (isNaN(sessionNum) || sessionNum < 1) {
            addError(
              addItem,
              'Invalid number format. Usage: /todo delete <number|range|all>',
            );
            return;
          }

          if (sessionNum > files.length) {
            addError(
              addItem,
              `Session ${sessionNum} does not exist. Valid range: 1-${files.length}`,
            );
            return;
          }

          deleteSingleSession(context, files, sessionNum);
        } catch (error) {
          addError(
            addItem,
            `Error deleting session: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      },
    },
    {
      name: 'undo',
      description: `Reset ${LIST_ITEM_LABEL} status to pending. Usage: /todo undo <position|range|all>`,
      kind: CommandKind.BUILT_IN,
      /**
       * undo subcommand - Reset task status to pending
       * @plan PLAN-20260129-TODOPERSIST-EXT.P21
       * @requirement REQ-011
       */
      action: (context, args) => {
        if (!requireTodoContext(context)) return;

        if (!args || args.trim() === '') {
          addInfo(context.ui.addItem, UNDO_HELP);
          return;
        }

        const posStr = args.trim().split(/\s+/)[0];
        const { todos } = context.todoContext;
        const addItem = context.ui.addItem;

        try {
          if (posStr === 'all') {
            undoAllTodos(context);
            return;
          }

          const rangeMatch = matchRangePattern(posStr);
          if (rangeMatch) {
            const range = validateRange(addItem, rangeMatch, todos.length);
            if (!range) return;
            undoRangeOfTodos(context, range.start, range.end);
            return;
          }

          undoSingleTodo(context, posStr);
        } catch (error) {
          addError(
            addItem,
            `Error: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      },
    },

    {
      name: 'list',
      description: `List all saved ${LIST_ITEM_LABEL} sessions`,
      kind: CommandKind.BUILT_IN,
      /**
       * list subcommand - Show saved task-list history
       * @plan PLAN-20260129-TODOPERSIST.P06
       * @requirement REQ-007
       * @pseudocode lines 80-95
       */
      action: async (context) => {
        try {
          const files = getTodoSessionFiles();

          if (files.length === 0) {
            addInfo(
              context.ui.addItem,
              `No saved ${LIST_ITEM_LABEL} lists found`,
            );
            return;
          }

          const lines = [
            `Saved ${LIST_ITEM_LABEL} Lists:`,
            '────────────────────────────────────────',
          ];

          files.forEach((file, idx) => {
            lines.push(...formatSessionEntry(file, idx));
          });

          lines.push('────────────────────────────────────────');

          addInfo(context.ui.addItem, lines.join('\n'));
        } catch (error) {
          addError(
            context.ui.addItem,
            `Error: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      },
    },
    {
      name: 'load',
      description: `Load a saved ${LIST_ITEM_LABEL} session. Usage: /todo load <number>`,
      kind: CommandKind.BUILT_IN,
      /**
       * load subcommand - Load saved session by number
       * @plan PLAN-20260129-TODOPERSIST-EXT.P19
       * @plan PLAN-20260129-TODOPERSIST-EXT.P20
       * @requirement REQ-009
       */
      action: async (context, args) => {
        if (!requireTodoContext(context)) return;

        if (!args || args.trim() === '') {
          addInfo(context.ui.addItem, LOAD_HELP);
          return;
        }

        const sessionNum = parseInt(args.trim(), 10);
        if (isNaN(sessionNum) || sessionNum < 1) {
          addError(
            context.ui.addItem,
            'Invalid number format. Usage: /todo load <number>',
          );
          return;
        }

        try {
          const files = getTodoSessionFiles();

          if (files.length === 0) {
            addInfo(
              context.ui.addItem,
              `No saved ${LIST_ITEM_LABEL} lists found`,
            );
            return;
          }

          if (sessionNum > files.length) {
            addError(
              context.ui.addItem,
              `Session ${sessionNum} does not exist. Valid range: 1-${files.length}`,
            );
            return;
          }

          const selectedFile = files[sessionNum - 1];
          const content = fs.readFileSync(selectedFile.path, 'utf8');
          const todos: Todo[] = JSON.parse(content);

          context.todoContext.updateTodos(todos);

          const firstTitle = todos[0]?.content || '(empty)';
          addInfo(
            context.ui.addItem,
            `Loaded ${todos.length} ${LIST_ITEM_LABEL}(s) from session: "${firstTitle}"`,
          );
        } catch (error) {
          addError(
            context.ui.addItem,
            `Error loading session: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      },
    },
  ],
};
