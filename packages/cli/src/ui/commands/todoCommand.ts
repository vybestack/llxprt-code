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
import * as fs from 'fs';
import {
  LIST_ITEM_LABEL,
  addError,
  addInfo,
  requireTodoContext,
  parsePosition,
  matchRangePattern,
  validateRange,
  applyStatusChange,
  addSubtaskAtPosition,
  addTaskAtPosition,
  removeSubtaskAtPosition,
  removeTaskAtPosition,
  removeRangeOfTasks,
  getTodoSessionFiles,
  deleteAllSessions,
  deleteSessionRange,
  deleteSingleSession,
  undoAllTodos,
  undoRangeOfTodos,
  undoSingleTodo,
} from './todoOperations.js';
import {
  formatTodoList,
  formatSessionEntry,
  SET_HELP,
  UNSET_HELP,
  ADD_HELP,
  REMOVE_HELP,
  DELETE_HELP,
  UNDO_HELP,
  LOAD_HELP,
} from './todoFormatters.js';

// Re-export for backward compatibility (tests import parsePosition from here)
export { parsePosition } from './todoOperations.js';
export type { ParsedPosition } from './todoOperations.js';

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
        addInfo(context.ui.addItem, formatTodoList(todos));
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
