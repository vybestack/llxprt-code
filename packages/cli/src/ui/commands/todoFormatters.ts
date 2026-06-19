/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'fs';
import type { Todo } from '@vybestack/llxprt-code-core';
import { LIST_ITEM_LABEL, type TodoSessionFile } from './todoOperations.js';

/**
 * Get the icon for a task-list status.
 */
export function getStatusIcon(status: Todo['status']): string {
  if (status === 'completed') return '✓';
  if (status === 'in_progress') return '▸';
  return '○';
}

/**
 * Helper: Format time ago from Date
 * @plan PLAN-20260129-TODOPERSIST.P06
 */
export function formatAge(date: Date): string {
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
 * Format the current task list into display lines.
 */
export function formatTodoList(todos: Todo[]): string {
  if (todos.length === 0) {
    return `No active ${LIST_ITEM_LABEL}s`;
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

  return lines.join('\n');
}

interface SessionCounts {
  readonly pending: number;
  readonly in_progress: number;
  readonly completed: number;
}

function countStatuses(todos: Todo[]): SessionCounts {
  return {
    pending: todos.filter((t) => t.status === 'pending').length,
    in_progress: todos.filter((t) => t.status === 'in_progress').length,
    completed: todos.filter((t) => t.status === 'completed').length,
  };
}

function buildStatusSummary(counts: SessionCounts): string {
  return [
    counts.in_progress > 0 ? `${counts.in_progress} in_progress` : '',
    counts.pending > 0 ? `${counts.pending} pending` : '',
    counts.completed > 0 ? `${counts.completed} completed` : '',
  ]
    .filter((s) => s !== '')
    .join(', ');
}

/**
 * Format a single session file entry for the list display.
 */
export function formatSessionEntry(
  file: TodoSessionFile,
  idx: number,
): string[] {
  try {
    const content = fs.readFileSync(file.path, 'utf8');
    const todos: Todo[] = JSON.parse(content);

    const counts = countStatuses(todos);
    const firstTitle = todos[0]?.content || '(empty)';
    const age = formatAge(file.mtime);
    const statusSummary = buildStatusSummary(counts);

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
// Help text constants
// ---------------------------------------------------------------------------

export const SET_HELP = `Usage: /todo set <position>

Sets the ${LIST_ITEM_LABEL} at the specified position to 'in_progress' status.

Position formats:
  1, 2, 3    - Position number (1-based)

Examples:
  /todo set 1
  /todo set 3`;

export const UNSET_HELP = `Usage: /todo unset <position>

Sets the ${LIST_ITEM_LABEL} at the specified position to 'pending' status.
This is the opposite of /todo set (which sets to 'in_progress').

Position formats:
  1, 2, 3    - Position number (1-based)

Examples:
  /todo unset 1
  /todo unset 3`;

export const ADD_HELP = `Usage: /todo add <position> <description>

Position formats:
  1, 2, 3    - Insert at specific position (1-based)
  last       - Append to end of list
  1.1, 1.2   - Insert subtask under parent ${LIST_ITEM_LABEL} 1
  1.last     - Append subtask to parent ${LIST_ITEM_LABEL} 1

Examples:
  /todo add 1 Fix login bug
  /todo add last Write documentation
  /todo add 2.1 Add unit tests`;

export const REMOVE_HELP = `Usage: /todo remove <position>

Position formats:
  2          - Remove ${LIST_ITEM_LABEL} at position 2
  1-5        - Remove ${LIST_ITEM_LABEL}s 1 through 5 (inclusive)
  all        - Remove all ${LIST_ITEM_LABEL}s

Examples:
  /todo remove 3
  /todo remove 1-5
  /todo remove all`;

export const DELETE_HELP = `Usage: /todo delete <number|range|all>

Deletes saved ${LIST_ITEM_LABEL} sessions from disk. Use /todo list to see sessions.

Formats:
  3          - Delete session #3
  1-5        - Delete sessions 1 through 5
  all        - Delete all saved sessions

Examples:
  /todo delete 2
  /todo delete 1-3
  /todo delete all`;

export const UNDO_HELP = `Usage: /todo undo <position|range|all>

Resets ${LIST_ITEM_LABEL} status back to 'pending'.

Formats:
  2          - Reset ${LIST_ITEM_LABEL} at position 2
  1-5        - Reset ${LIST_ITEM_LABEL}s 1 through 5
  all        - Reset all ${LIST_ITEM_LABEL}s

Examples:
  /todo undo 3
  /todo undo 1-5
  /todo undo all`;

export const LOAD_HELP = `Usage: /todo load <number>

Loads a saved ${LIST_ITEM_LABEL} session. Use /todo list to see available sessions.

Examples:
  /todo list       - Show saved sessions with numbers
  /todo load 1     - Load the most recent session
  /todo load 3     - Load the third session`;
