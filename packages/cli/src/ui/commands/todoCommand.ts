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
 * Parsed position result for /todo add and /todo delete
 * @plan PLAN-20260129-TODOPERSIST.P06
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
  if (diffHours < 24) return `${diffHours} hours ago`;
  if (diffDays === 1) return '1 day ago';
  return `${diffDays} days ago`;
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
      name: 'add',
      description:
        'Add a TODO at the specified position. Usage: /todo add <position> <description>',
      kind: CommandKind.BUILT_IN,
      /**
       * /todo add <pos> <desc> - Add TODO at position
       * @plan PLAN-20260129-TODOPERSIST.P09
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
              type: MessageType.ERROR,
              text: 'Usage: /todo add <position> <description>',
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
            const parent = newTodos[parsed.parentIndex];

            if (!parent.subtasks) {
              parent.subtasks = [];
            }

            const newSubtask = {
              id: `${newId}-${parsed.subtaskIndex}`,
              content: description,
            };

            // Insert at position
            parent.subtasks.splice(parsed.subtaskIndex, 0, newSubtask);

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
      name: 'delete',
      description:
        'Delete a TODO at the specified position. Usage: /todo delete <position>',
      kind: CommandKind.BUILT_IN,
      /**
       * /todo delete <pos> - Remove TODO at position
       * @plan PLAN-20260129-TODOPERSIST.P09
       * @requirement REQ-006
       * @pseudocode position parsing (same as add)
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
              type: MessageType.ERROR,
              text: 'Usage: /todo delete <position>',
            },
            Date.now(),
          );
          return;
        }

        const posStr = args.trim().split(/\s+/)[0];
        const { todos } = context.todoContext;

        try {
          const parsed = parsePosition(posStr, todos);

          if (parsed.subtaskIndex !== undefined) {
            // Delete subtask
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

            parent.subtasks.splice(parsed.subtaskIndex, 1);

            context.todoContext.updateTodos(newTodos);
            context.ui.addItem(
              {
                type: MessageType.INFO,
                text: `Deleted subtask at ${posStr}`,
              },
              Date.now(),
            );
          } else {
            // Delete task
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
                text: `Deleted TODO at ${posStr}`,
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
          // Line 80: SCAN directory ~/.llxprt/todos/
          const todoDir = path.join(os.homedir(), '.llxprt', 'todos');

          if (!fs.existsSync(todoDir)) {
            context.ui.addItem(
              {
                type: MessageType.INFO,
                text: 'No saved TODO lists found',
              },
              Date.now(),
            );
            return;
          }

          // Line 81: READ file stats for all todo-*.json files
          const files = fs
            .readdirSync(todoDir)
            .filter((f) => f.startsWith('todo-') && f.endsWith('.json'))
            .map((f) => {
              const filePath = path.join(todoDir, f);
              const stats = fs.statSync(filePath);
              return { name: f, path: filePath, mtime: stats.mtime };
            });

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

          // Line 83-85: SORT files (current first, then by mtime descending)
          // Note: We don't have sessionId in context yet, so skip current detection
          files.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

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
  ],
};
