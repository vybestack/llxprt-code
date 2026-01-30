/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260129-TODOPERSIST.P06
 * @requirement REQ-003, REQ-004, REQ-005, REQ-006, REQ-007
 */

import type { SlashCommand } from './types.js';
import { CommandKind } from './types.js';
import type { Todo } from '@vybestack/llxprt-code-core';
import { MessageType } from '../types.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Parsed position result for /todo add and /todo remove
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
  const subtaskMatch = pos.match(/^(\d+)\.(\d+|last)$/);
  if (subtaskMatch) {
    // Line 54: PARSE parent_pos, subtask_pos
    const parentIndex = parseInt(subtaskMatch[1], 10) - 1;

    // Line 55: VALIDATE parent exists
    const parent = todos[parentIndex];
    if (!parent) {
      throw new Error(`Parent position ${subtaskMatch[1]} does not exist`);
    }

    // Line 56: IF subtask_pos == "last"
    if (subtaskMatch[2] === 'last') {
      // Line 57: INSERT at parent.subtasks.length
      return {
        parentIndex,
        subtaskIndex: parent.subtasks?.length || 0,
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
 * Helper: Get sorted TODO session files
 * @plan PLAN-20260129-TODOPERSIST-EXT.P19
 * @returns Array of TODO session files sorted by modification time (newest first)
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

/**
 * Main /todo command with subcommands
 * @plan PLAN-20260129-TODOPERSIST.P06
 */
export const todoCommand: SlashCommand = {
  name: 'todo',
  kind: CommandKind.BUILT_IN,
  description: 'Manage TODO list',
  subCommands: [
    {
      name: 'clear',
      description: 'Clear all TODOs from the active session',
      kind: CommandKind.BUILT_IN,
      /**
       * /todo clear - Clear all TODOs
       * @plan PLAN-20260129-TODOPERSIST.P09
       * @requirement REQ-003
       */
      action: (context) => {
        if (!context.todoContext) {
          context.ui.addItem(
            {
              type: MessageType.ERROR,
              text: 'TODO context not available',
            },
            Date.now(),
          );
          return;
        }

        context.todoContext.updateTodos([]);
        context.ui.addItem(
          {
            type: MessageType.INFO,
            text: 'TODO list cleared',
          },
          Date.now(),
        );
      },
    },
    {
      name: 'show',
      description: 'Display the current TODO list',
      kind: CommandKind.BUILT_IN,
      /**
       * /todo show - Display current TODOs
       * @plan PLAN-20260129-TODOPERSIST.P09
       * @requirement REQ-004
       */
      action: (context) => {
        if (!context.todoContext) {
          context.ui.addItem(
            {
              type: MessageType.ERROR,
              text: 'TODO context not available',
            },
            Date.now(),
          );
          return;
        }

        const { todos } = context.todoContext;

        if (todos.length === 0) {
          context.ui.addItem(
            {
              type: MessageType.INFO,
              text: 'No active TODOs',
            },
            Date.now(),
          );
          return;
        }

        // Format TODOs with positions
        const lines: string[] = ['Current TODO List:', ''];

        todos.forEach((todo, idx) => {
          const pos = idx + 1;
          const statusIcon =
            todo.status === 'completed'
              ? '[OK]'
              : todo.status === 'in_progress'
                ? '▸'
                : '○';

          lines.push(`${pos}. ${statusIcon} ${todo.content}`.trim());

          // Display subtasks if present
          if (todo.subtasks && todo.subtasks.length > 0) {
            todo.subtasks.forEach((subtask, subIdx) => {
              const subPos = `${pos}.${subIdx + 1}`;
              lines.push(`   ${subPos}. ${subtask.content}`);
            });
          }
        });

        context.ui.addItem(
          {
            type: MessageType.INFO,
            text: lines.join('\n'),
          },
          Date.now(),
        );
      },
    },
    {
      name: 'set',
      description:
        'Set a TODO status to in_progress. Usage: /todo set <position>',
      kind: CommandKind.BUILT_IN,
      /**
       * /todo set <pos> - Set TODO to in_progress
       * @plan PLAN-20260129-TODOPERSIST-EXT.P17
       * @plan PLAN-20260129-TODOPERSIST-EXT.P20
       * @requirement REQ-008
       */
      action: (context, args) => {
        if (!context.todoContext) {
          context.ui.addItem(
            {
              type: MessageType.ERROR,
              text: 'TODO context not available',
            },
            Date.now(),
          );
          return;
        }

        if (!args || args.trim() === '') {
          context.ui.addItem(
            {
              type: MessageType.INFO,
              text: `Usage: /todo set <position>

Sets the TODO at the specified position to 'in_progress' status.

Position formats:
  1, 2, 3    - Position number (1-based)

Examples:
  /todo set 1
  /todo set 3`,
            },
            Date.now(),
          );
          return;
        }

        const posStr = args.trim().split(/\s+/)[0];
        const { todos } = context.todoContext;

        try {
          const parsed = parsePosition(posStr, todos);

          // Validate position exists (parsePosition allows insertion beyond current length)
          if (parsed.parentIndex >= todos.length) {
            context.ui.addItem(
              {
                type: MessageType.ERROR,
                text: `Position ${posStr} does not exist`,
              },
              Date.now(),
            );
            return;
          }

          // Subtasks don't have status field - only parent TODOs do
          if (parsed.subtaskIndex !== undefined) {
            context.ui.addItem(
              {
                type: MessageType.ERROR,
                text: `Subtasks don't have status. Use parent TODO position instead.`,
              },
              Date.now(),
            );
            return;
          }

          // Update the TODO status
          const newTodos = [...todos];
          const todo = newTodos[parsed.parentIndex];
          todo.status = 'in_progress';

          context.todoContext.updateTodos(newTodos);
          context.ui.addItem(
            {
              type: MessageType.INFO,
              text: `Set TODO ${posStr} to in_progress: "${todo.content}"`,
            },
            Date.now(),
          );
        } catch (error) {
          context.ui.addItem(
            {
              type: MessageType.ERROR,
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
            Date.now(),
          );
        }
      },
    },
    {
      name: 'unset',
      description:
        'Set a TODO status back to pending. Usage: /todo unset <position>',
      kind: CommandKind.BUILT_IN,
      /**
       * /todo unset <pos> - Set TODO to pending
       * @plan PLAN-20260129-TODOPERSIST-EXT.P22
       * @requirement REQ-008
       */
      action: (context, args) => {
        if (!context.todoContext) {
          context.ui.addItem(
            {
              type: MessageType.ERROR,
              text: 'TODO context not available',
            },
            Date.now(),
          );
          return;
        }

        if (!args || args.trim() === '') {
          context.ui.addItem(
            {
              type: MessageType.INFO,
              text: `Usage: /todo unset <position>

Sets the TODO at the specified position to 'pending' status.
This is the opposite of /todo set (which sets to 'in_progress').

Position formats:
  1, 2, 3    - Position number (1-based)

Examples:
  /todo unset 1
  /todo unset 3`,
            },
            Date.now(),
          );
          return;
        }

        const posStr = args.trim().split(/\s+/)[0];
        const { todos } = context.todoContext;

        try {
          const parsed = parsePosition(posStr, todos);

          // Validate position exists (parsePosition allows insertion beyond current length)
          if (parsed.parentIndex >= todos.length) {
            context.ui.addItem(
              {
                type: MessageType.ERROR,
                text: `Position ${posStr} does not exist`,
              },
              Date.now(),
            );
            return;
          }

          // Subtasks don't have status field - only parent TODOs do
          if (parsed.subtaskIndex !== undefined) {
            context.ui.addItem(
              {
                type: MessageType.ERROR,
                text: `Subtasks don't have status. Use parent TODO position instead.`,
              },
              Date.now(),
            );
            return;
          }

          // Update the TODO status
          const newTodos = [...todos];
          const todo = newTodos[parsed.parentIndex];
          todo.status = 'pending';

          context.todoContext.updateTodos(newTodos);
          context.ui.addItem(
            {
              type: MessageType.INFO,
              text: `Set TODO ${posStr} to pending: "${todo.content}"`,
            },
            Date.now(),
          );
        } catch (error) {
          context.ui.addItem(
            {
              type: MessageType.ERROR,
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
            Date.now(),
          );
        }
      },
    },
    {
      name: 'add',
      description:
        'Add a TODO at the specified position. Usage: /todo add <position> <description>',
      kind: CommandKind.BUILT_IN,
      /**
       * /todo add <pos> <desc> - Add TODO at position
       * @plan PLAN-20260129-TODOPERSIST.P09
       * @plan PLAN-20260129-TODOPERSIST-EXT.P20
       * @requirement REQ-005
       * @pseudocode lines 42-74
       */
      action: (context, args) => {
        if (!context.todoContext) {
          context.ui.addItem(
            {
              type: MessageType.ERROR,
              text: 'TODO context not available',
            },
            Date.now(),
          );
          return;
        }

        if (!args || args.trim() === '') {
          context.ui.addItem(
            {
              type: MessageType.INFO,
              text: `Usage: /todo add <position> <description>

Position formats:
  1, 2, 3    - Insert at specific position (1-based)
  last       - Append to end of list
  1.1, 1.2   - Insert subtask under parent TODO 1
  1.last     - Append subtask to parent TODO 1

Examples:
  /todo add 1 Fix login bug
  /todo add last Write documentation
  /todo add 2.1 Add unit tests`,
            },
            Date.now(),
          );
          return;
        }

        const parts = args.trim().split(/\s+/);
        if (parts.length < 2) {
          context.ui.addItem(
            {
              type: MessageType.ERROR,
              text: 'Usage: /todo add <position> <description>',
            },
            Date.now(),
          );
          return;
        }

        const posStr = parts[0];
        const description = parts.slice(1).join(' ');
        const { todos } = context.todoContext;

        try {
          const parsed = parsePosition(posStr, todos);

          // Generate unique ID
          const newId = `user-${Date.now()}`;

          if (parsed.subtaskIndex !== undefined) {
            // Add as subtask
            const newTodos = [...todos];
            // Clone the parent object and its subtasks to avoid mutation
            const parent = { ...newTodos[parsed.parentIndex] };
            parent.subtasks = parent.subtasks ? [...parent.subtasks] : [];

            const newSubtask = {
              id: `${newId}-${parsed.subtaskIndex}`,
              content: description,
            };

            // Insert at position
            parent.subtasks.splice(parsed.subtaskIndex, 0, newSubtask);

            // Assign the cloned parent back into newTodos
            newTodos[parsed.parentIndex] = parent;

            context.todoContext.updateTodos(newTodos);
            context.ui.addItem(
              {
                type: MessageType.INFO,
                text: `Added subtask at position ${posStr}: "${description}"`,
              },
              Date.now(),
            );
          } else {
            // Add as task
            const newTodo: Todo = {
              id: newId,
              content: description,
              status: 'pending',
            };

            const newTodos = [...todos];
            newTodos.splice(parsed.parentIndex, 0, newTodo);

            context.todoContext.updateTodos(newTodos);
            context.ui.addItem(
              {
                type: MessageType.INFO,
                text: `Added TODO at position ${posStr}: "${description}"`,
              },
              Date.now(),
            );
          }
        } catch (error) {
          context.ui.addItem(
            {
              type: MessageType.ERROR,
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
            Date.now(),
          );
        }
      },
    },
    {
      name: 'remove',
      description:
        'Remove a TODO from the current list. Usage: /todo remove <position|range|all>',
      kind: CommandKind.BUILT_IN,
      /**
       * /todo remove <pos|range|all> - Remove TODO(s) from active session
       * @plan PLAN-20260129-TODOPERSIST-EXT.P18
       * @plan PLAN-20260129-TODOPERSIST-EXT.P20
       * @plan PLAN-20260129-TODOPERSIST-EXT.P21
       * @requirement REQ-006
       * @pseudocode Extended with range and "all" support
       */
      action: (context, args) => {
        if (!context.todoContext) {
          context.ui.addItem(
            {
              type: MessageType.ERROR,
              text: 'TODO context not available',
            },
            Date.now(),
          );
          return;
        }

        if (!args || args.trim() === '') {
          context.ui.addItem(
            {
              type: MessageType.INFO,
              text: `Usage: /todo remove <position>

Position formats:
  2          - Remove TODO at position 2
  1-5        - Remove TODOs 1 through 5 (inclusive)
  all        - Remove all TODOs

Examples:
  /todo remove 3
  /todo remove 1-5
  /todo remove all`,
            },
            Date.now(),
          );
          return;
        }

        const posStr = args.trim().split(/\s+/)[0];
        const { todos } = context.todoContext;

        try {
          // Check for "all" keyword
          if (posStr === 'all') {
            const count = todos.length;
            context.todoContext.updateTodos([]);
            context.ui.addItem(
              {
                type: MessageType.INFO,
                text: `Removed ${count} TODO(s)`,
              },
              Date.now(),
            );
            return;
          }

          // Check for range pattern (e.g., "2-4")
          const rangeMatch = posStr.match(/^(\d+)-(\d+)$/);
          if (rangeMatch) {
            const start = parseInt(rangeMatch[1], 10);
            const end = parseInt(rangeMatch[2], 10);

            // Validate range
            if (start > end) {
              context.ui.addItem(
                {
                  type: MessageType.ERROR,
                  text: `Invalid range: start (${start}) must be <= end (${end})`,
                },
                Date.now(),
              );
              return;
            }

            if (start < 1 || end > todos.length) {
              context.ui.addItem(
                {
                  type: MessageType.ERROR,
                  text: `Range out of bounds: valid range is 1-${todos.length}`,
                },
                Date.now(),
              );
              return;
            }

            // Remove in reverse order (highest index first)
            const newTodos = [...todos];
            let removeCount = 0;
            for (let i = end - 1; i >= start - 1; i--) {
              newTodos.splice(i, 1);
              removeCount++;
            }

            context.todoContext.updateTodos(newTodos);
            context.ui.addItem(
              {
                type: MessageType.INFO,
                text: `Removed ${removeCount} TODO(s)`,
              },
              Date.now(),
            );
            return;
          }

          // Fall back to single position parsing
          const parsed = parsePosition(posStr, todos);

          if (parsed.subtaskIndex !== undefined) {
            // Remove subtask
            const newTodos = [...todos];
            const parent = newTodos[parsed.parentIndex];

            if (
              !parent.subtasks ||
              parsed.subtaskIndex >= parent.subtasks.length
            ) {
              context.ui.addItem(
                {
                  type: MessageType.ERROR,
                  text: `Subtask at position ${posStr} does not exist`,
                },
                Date.now(),
              );
              return;
            }

            // Clone the parent object and its subtasks to avoid mutation
            const clonedParent = { ...parent };
            clonedParent.subtasks = [...parent.subtasks];

            // Remove the subtask
            clonedParent.subtasks.splice(parsed.subtaskIndex, 1);

            // Assign the cloned parent back into newTodos
            newTodos[parsed.parentIndex] = clonedParent;

            context.todoContext.updateTodos(newTodos);
            context.ui.addItem(
              {
                type: MessageType.INFO,
                text: `Removed 1 TODO(s)`,
              },
              Date.now(),
            );
          } else {
            // Remove task
            if (parsed.parentIndex >= todos.length) {
              context.ui.addItem(
                {
                  type: MessageType.ERROR,
                  text: `TODO at position ${posStr} does not exist`,
                },
                Date.now(),
              );
              return;
            }

            const newTodos = [...todos];
            newTodos.splice(parsed.parentIndex, 1);

            context.todoContext.updateTodos(newTodos);
            context.ui.addItem(
              {
                type: MessageType.INFO,
                text: `Removed 1 TODO(s)`,
              },
              Date.now(),
            );
          }
        } catch (error) {
          context.ui.addItem(
            {
              type: MessageType.ERROR,
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
            Date.now(),
          );
        }
      },
    },
    {
      name: 'delete',
      description:
        'Delete saved TODO session(s) from disk. Usage: /todo delete <number|range|all>',
      kind: CommandKind.BUILT_IN,
      /**
       * /todo delete <num|range|all> - Delete saved TODO files from disk
       * @plan PLAN-20260129-TODOPERSIST-EXT.P21
       * @requirement REQ-010
       */
      action: async (context, args) => {
        if (!args || args.trim() === '') {
          context.ui.addItem(
            {
              type: MessageType.INFO,
              text: `Usage: /todo delete <number|range|all>

Deletes saved TODO sessions from disk. Use /todo list to see sessions.

Formats:
  3          - Delete session #3
  1-5        - Delete sessions 1 through 5
  all        - Delete all saved sessions

Examples:
  /todo delete 2
  /todo delete 1-3
  /todo delete all`,
            },
            Date.now(),
          );
          return;
        }

        const posStr = args.trim().split(/\s+/)[0];

        try {
          const files = getTodoSessionFiles();

          if (files.length === 0) {
            context.ui.addItem(
              {
                type: MessageType.INFO,
                text: 'No saved TODO sessions found',
              },
              Date.now(),
            );
            return;
          }

          // Check for "all" keyword
          if (posStr === 'all') {
            const count = files.length;
            files.forEach((file) => {
              fs.unlinkSync(file.path);
            });
            context.ui.addItem(
              {
                type: MessageType.INFO,
                text: `Deleted ${count} saved TODO session(s)`,
              },
              Date.now(),
            );
            return;
          }

          // Check for range pattern (e.g., "1-3")
          const rangeMatch = posStr.match(/^(\d+)-(\d+)$/);
          if (rangeMatch) {
            const start = parseInt(rangeMatch[1], 10);
            const end = parseInt(rangeMatch[2], 10);

            // Validate range
            if (start > end) {
              context.ui.addItem(
                {
                  type: MessageType.ERROR,
                  text: `Invalid range: start (${start}) must be <= end (${end})`,
                },
                Date.now(),
              );
              return;
            }

            if (start < 1 || end > files.length) {
              context.ui.addItem(
                {
                  type: MessageType.ERROR,
                  text: `Range out of bounds: valid range is 1-${files.length}`,
                },
                Date.now(),
              );
              return;
            }

            // Delete files in range
            let deleteCount = 0;
            for (let i = start - 1; i < end; i++) {
              fs.unlinkSync(files[i].path);
              deleteCount++;
            }

            context.ui.addItem(
              {
                type: MessageType.INFO,
                text: `Deleted ${deleteCount} saved TODO session(s)`,
              },
              Date.now(),
            );
            return;
          }

          // Single session number
          const sessionNum = parseInt(posStr, 10);
          if (isNaN(sessionNum) || sessionNum < 1) {
            context.ui.addItem(
              {
                type: MessageType.ERROR,
                text: 'Invalid number format. Usage: /todo delete <number|range|all>',
              },
              Date.now(),
            );
            return;
          }

          if (sessionNum > files.length) {
            context.ui.addItem(
              {
                type: MessageType.ERROR,
                text: `Session ${sessionNum} does not exist. Valid range: 1-${files.length}`,
              },
              Date.now(),
            );
            return;
          }

          // Delete the selected session file (1-based indexing)
          const selectedFile = files[sessionNum - 1];
          fs.unlinkSync(selectedFile.path);

          context.ui.addItem(
            {
              type: MessageType.INFO,
              text: `Deleted 1 saved TODO session(s)`,
            },
            Date.now(),
          );
        } catch (error) {
          context.ui.addItem(
            {
              type: MessageType.ERROR,
              text: `Error deleting session: ${error instanceof Error ? error.message : String(error)}`,
            },
            Date.now(),
          );
        }
      },
    },
    {
      name: 'undo',
      description:
        'Reset TODO status to pending. Usage: /todo undo <position|range|all>',
      kind: CommandKind.BUILT_IN,
      /**
       * /todo undo <pos|range|all> - Reset TODO status to pending
       * @plan PLAN-20260129-TODOPERSIST-EXT.P21
       * @requirement REQ-011
       */
      action: (context, args) => {
        if (!context.todoContext) {
          context.ui.addItem(
            {
              type: MessageType.ERROR,
              text: 'TODO context not available',
            },
            Date.now(),
          );
          return;
        }

        if (!args || args.trim() === '') {
          context.ui.addItem(
            {
              type: MessageType.INFO,
              text: `Usage: /todo undo <position|range|all>

Resets TODO status back to 'pending'.

Formats:
  2          - Reset TODO at position 2
  1-5        - Reset TODOs 1 through 5
  all        - Reset all TODOs

Examples:
  /todo undo 3
  /todo undo 1-5
  /todo undo all`,
            },
            Date.now(),
          );
          return;
        }

        const posStr = args.trim().split(/\s+/)[0];
        const { todos } = context.todoContext;

        try {
          // Check for "all" keyword
          if (posStr === 'all') {
            const newTodos = todos.map((todo) => ({
              ...todo,
              status: 'pending' as const,
            }));
            const count = todos.length;
            context.todoContext.updateTodos(newTodos);
            context.ui.addItem(
              {
                type: MessageType.INFO,
                text: `Reset ${count} TODO(s) to pending`,
              },
              Date.now(),
            );
            return;
          }

          // Check for range pattern (e.g., "1-3")
          const rangeMatch = posStr.match(/^(\d+)-(\d+)$/);
          if (rangeMatch) {
            const start = parseInt(rangeMatch[1], 10);
            const end = parseInt(rangeMatch[2], 10);

            // Validate range
            if (start > end) {
              context.ui.addItem(
                {
                  type: MessageType.ERROR,
                  text: `Invalid range: start (${start}) must be <= end (${end})`,
                },
                Date.now(),
              );
              return;
            }

            if (start < 1 || end > todos.length) {
              context.ui.addItem(
                {
                  type: MessageType.ERROR,
                  text: `Range out of bounds: valid range is 1-${todos.length}`,
                },
                Date.now(),
              );
              return;
            }

            // Reset status in range
            const newTodos = [...todos];
            let resetCount = 0;
            for (let i = start - 1; i < end; i++) {
              newTodos[i] = { ...newTodos[i], status: 'pending' };
              resetCount++;
            }

            context.todoContext.updateTodos(newTodos);
            context.ui.addItem(
              {
                type: MessageType.INFO,
                text: `Reset ${resetCount} TODO(s) to pending`,
              },
              Date.now(),
            );
            return;
          }

          // Fall back to single position parsing
          const parsed = parsePosition(posStr, todos);

          // Validate position exists
          if (parsed.parentIndex >= todos.length) {
            context.ui.addItem(
              {
                type: MessageType.ERROR,
                text: `Position ${posStr} does not exist`,
              },
              Date.now(),
            );
            return;
          }

          // Subtasks don't have status field - only parent TODOs do
          if (parsed.subtaskIndex !== undefined) {
            context.ui.addItem(
              {
                type: MessageType.ERROR,
                text: `Subtasks don't have status. Use parent TODO position instead.`,
              },
              Date.now(),
            );
            return;
          }

          // Reset the TODO status
          const newTodos = [...todos];
          newTodos[parsed.parentIndex] = {
            ...newTodos[parsed.parentIndex],
            status: 'pending',
          };

          context.todoContext.updateTodos(newTodos);
          context.ui.addItem(
            {
              type: MessageType.INFO,
              text: `Reset 1 TODO(s) to pending`,
            },
            Date.now(),
          );
        } catch (error) {
          context.ui.addItem(
            {
              type: MessageType.ERROR,
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
            Date.now(),
          );
        }
      },
    },

    {
      name: 'list',
      description: 'List all saved TODO sessions',
      kind: CommandKind.BUILT_IN,
      /**
       * /todo list - Show saved TODO history
       * @plan PLAN-20260129-TODOPERSIST.P06
       * @requirement REQ-007
       * @pseudocode lines 80-95
       */
      action: async (context) => {
        try {
          const files = getTodoSessionFiles();

          if (files.length === 0) {
            context.ui.addItem(
              {
                type: MessageType.INFO,
                text: 'No saved TODO lists found',
              },
              Date.now(),
            );
            return;
          }

          // Line 86-90: Format display
          const lines = [
            'Saved TODO Lists:',
            '────────────────────────────────────────',
          ];

          files.forEach((file, idx) => {
            try {
              const content = fs.readFileSync(file.path, 'utf8');
              const todos: Todo[] = JSON.parse(content);

              // Count by status
              const counts = {
                pending: todos.filter((t) => t.status === 'pending').length,
                in_progress: todos.filter((t) => t.status === 'in_progress')
                  .length,
                completed: todos.filter((t) => t.status === 'completed').length,
              };

              const firstTitle = todos[0]?.content || '(empty)';
              const age = formatAge(file.mtime);

              const statusSummary = [
                counts.in_progress && `${counts.in_progress} in_progress`,
                counts.pending && `${counts.pending} pending`,
                counts.completed && `${counts.completed} completed`,
              ]
                .filter(Boolean)
                .join(', ');

              lines.push(
                `${idx + 1}. ${age} │ ${todos.length} items (${statusSummary})`,
                `   → "${firstTitle}"`,
                '',
              );
            } catch (_error) {
              // Skip files that can't be read/parsed
              lines.push(
                `${idx + 1}. ${formatAge(file.mtime)} │ (error reading file)`,
                '',
              );
            }
          });

          lines.push('────────────────────────────────────────');

          // Line 91: DISPLAY formatted list
          // Note: Selection/loading functionality is DEFERRED to future work
          const output = lines.join('\n');

          context.ui.addItem(
            {
              type: MessageType.INFO,
              text: output,
            },
            Date.now(),
          );
        } catch (error) {
          context.ui.addItem(
            {
              type: MessageType.ERROR,
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
            Date.now(),
          );
        }
      },
    },
    {
      name: 'load',
      description: 'Load a saved TODO session. Usage: /todo load <number>',
      kind: CommandKind.BUILT_IN,
      /**
       * /todo load <num> - Load TODO session by number
       * @plan PLAN-20260129-TODOPERSIST-EXT.P19
       * @plan PLAN-20260129-TODOPERSIST-EXT.P20
       * @requirement REQ-009
       */
      action: async (context, args) => {
        if (!context.todoContext) {
          context.ui.addItem(
            {
              type: MessageType.ERROR,
              text: 'TODO context not available',
            },
            Date.now(),
          );
          return;
        }

        if (!args || args.trim() === '') {
          context.ui.addItem(
            {
              type: MessageType.INFO,
              text: `Usage: /todo load <number>

Loads a saved TODO session. Use /todo list to see available sessions.

Examples:
  /todo list       - Show saved sessions with numbers
  /todo load 1     - Load the most recent session
  /todo load 3     - Load the third session`,
            },
            Date.now(),
          );
          return;
        }

        const sessionNum = parseInt(args.trim(), 10);
        if (isNaN(sessionNum) || sessionNum < 1) {
          context.ui.addItem(
            {
              type: MessageType.ERROR,
              text: 'Invalid number format. Usage: /todo load <number>',
            },
            Date.now(),
          );
          return;
        }

        try {
          const files = getTodoSessionFiles();

          if (files.length === 0) {
            context.ui.addItem(
              {
                type: MessageType.INFO,
                text: 'No saved TODO lists found',
              },
              Date.now(),
            );
            return;
          }

          // Validate session number is in range
          if (sessionNum > files.length) {
            context.ui.addItem(
              {
                type: MessageType.ERROR,
                text: `Session ${sessionNum} does not exist. Valid range: 1-${files.length}`,
              },
              Date.now(),
            );
            return;
          }

          // Load the selected session file (1-based indexing)
          const selectedFile = files[sessionNum - 1];
          const content = fs.readFileSync(selectedFile.path, 'utf8');
          const todos: Todo[] = JSON.parse(content);

          // Update the TODO context with loaded TODOs
          context.todoContext.updateTodos(todos);

          // Display success message
          const firstTitle = todos[0]?.content || '(empty)';
          context.ui.addItem(
            {
              type: MessageType.INFO,
              text: `Loaded ${todos.length} TODO(s) from session: "${firstTitle}"`,
            },
            Date.now(),
          );
        } catch (error) {
          context.ui.addItem(
            {
              type: MessageType.ERROR,
              text: `Error loading session: ${error instanceof Error ? error.message : String(error)}`,
            },
            Date.now(),
          );
        }
      },
    },
  ],
};
