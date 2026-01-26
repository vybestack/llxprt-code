/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { type Todo, type TodoToolCall } from '../tools/todo-schemas.js';

export interface GroupedToolCall {
  toolCall: TodoToolCall;
  count: number;
}

export interface TodoFormatterOptions {
  header?: string;
  includeSummary?: boolean;
  maxToolCalls?: number;
  getLiveToolCalls?: (todoId: string) => TodoToolCall[];
}

const STATUS_ICONS: Record<Todo['status'], string> = {
  in_progress: '→',
  pending: '○',
  completed: '',
};

const STATUS_ORDER: Record<Todo['status'], number> = {
  in_progress: 0,
  pending: 1,
  completed: 2,
};

const DEFAULT_HEADER = '## Todo Progress';
const DEFAULT_MAX_TOOL_CALLS = 5;

/**
 * Groups consecutive identical tool calls to create a concise textual representation.
 */
export const groupToolCalls = (
  toolCalls: TodoToolCall[],
): GroupedToolCall[] => {
  if (toolCalls.length === 0) {
    return [];
  }

  const grouped: GroupedToolCall[] = [];
  let currentGroup: GroupedToolCall = {
    toolCall: toolCalls[0],
    count: 1,
  };

  for (let i = 1; i < toolCalls.length; i++) {
    const current = toolCalls[i];
    const previous = currentGroup.toolCall;
    if (
      current.name === previous.name &&
      JSON.stringify(current.parameters) === JSON.stringify(previous.parameters)
    ) {
      currentGroup.count++;
    } else {
      grouped.push(currentGroup);
      currentGroup = {
        toolCall: current,
        count: 1,
      };
    }
  }
  grouped.push(currentGroup);
  return grouped;
};

const formatParameters = (parameters: Record<string, unknown>): string => {
  const segments: string[] = [];
  const MAX_LENGTH = 40;

  for (const [key, value] of Object.entries(parameters)) {
    if (typeof value === 'string') {
      let displayValue = value;

      if (
        key === 'file_path' ||
        key === 'absolute_path' ||
        value.includes('/')
      ) {
        if (displayValue.length > MAX_LENGTH) {
          displayValue = '...' + displayValue.slice(-(MAX_LENGTH - 3));
        }
      } else if (displayValue.length > MAX_LENGTH) {
        displayValue = `${displayValue.substring(0, MAX_LENGTH - 3)}...`;
      }

      segments.push(`${key}: '${displayValue}'`);
    } else {
      const jsonValue = JSON.stringify(value);
      const displayValue =
        jsonValue.length > MAX_LENGTH
          ? `${jsonValue.substring(0, MAX_LENGTH - 3)}...`
          : jsonValue;
      segments.push(`${key}: ${displayValue}`);
    }
  }

  return segments.join(', ');
};

const pushToolCalls = (
  lines: string[],
  toolCalls: TodoToolCall[],
  indent: string,
  maxToolCalls: number,
) => {
  if (toolCalls.length === 0) {
    return;
  }

  const grouped = groupToolCalls(toolCalls);
  if (grouped.length > maxToolCalls) {
    const overflow = grouped.length - maxToolCalls;
    lines.push(`${indent}↳ ...${overflow} more tool calls...`);
  }

  const visible = grouped.slice(-maxToolCalls);
  for (const group of visible) {
    const params = formatParameters(group.toolCall.parameters);
    const countText = group.count > 1 ? ` ${group.count}x` : '';
    lines.push(
      `${indent}↳ ${group.toolCall.name}(${params})${countText}`.trimEnd(),
    );
  }
};

const calculateStats = (todos: Todo[]) => ({
  total: todos.length,
  completed: todos.filter((todo) => todo.status === 'completed').length,
  inProgress: todos.filter((todo) => todo.status === 'in_progress').length,
  pending: todos.filter((todo) => todo.status === 'pending').length,
});

const formatTodoEntry = (todo: Todo): string => {
  const marker = STATUS_ICONS[todo.status];
  const currentSuffix = todo.status === 'in_progress' ? ' ← current' : '';
  return `${marker} ${todo.content}${currentSuffix}`;
};

const mergeToolCalls = (
  todo: Todo,
  getLiveToolCalls?: (todoId: string) => TodoToolCall[],
): TodoToolCall[] => {
  const baseCalls = todo.toolCalls ?? [];
  if (!getLiveToolCalls) {
    return baseCalls;
  }

  const seen = new Set(baseCalls.map((call) => call.id));
  const liveCalls = (getLiveToolCalls(todo.id) ?? []).filter((call) => {
    if (seen.has(call.id)) {
      return false;
    }
    seen.add(call.id);
    return true;
  });
  return [...baseCalls, ...liveCalls];
};

/**
 * Produces a textual representation of todos that mirrors the information shown in the Ink Todo panel.
 */
export const formatTodoListForDisplay = (
  todos: Todo[],
  options: TodoFormatterOptions = {},
): string => {
  const header = options.header ?? DEFAULT_HEADER;
  const maxToolCalls = options.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS;
  const includeSummary = options.includeSummary ?? true;

  if (todos.length === 0) {
    return `${header}\n\nNo todos found.\n\nUse todo_write to create a task list when working on multi-step projects.`;
  }

  const lines: string[] = [header, ''];
  if (includeSummary) {
    const stats = calculateStats(todos);
    lines.push(
      `${stats.total} tasks: ${stats.completed} completed, ${stats.inProgress} in progress, ${stats.pending} pending`,
    );
    lines.push('');
  }

  const orderedTodos = orderTodos(todos);

  for (const todo of orderedTodos) {
    lines.push(formatTodoEntry(todo));

    if (todo.subtasks) {
      for (const subtask of todo.subtasks) {
        lines.push(`  • ${subtask.content}`);
        if (subtask.toolCalls && subtask.toolCalls.length > 0) {
          pushToolCalls(lines, subtask.toolCalls, '    ', maxToolCalls);
        }
      }
    }

    const combinedToolCalls = mergeToolCalls(todo, options.getLiveToolCalls);
    pushToolCalls(lines, combinedToolCalls, '  ', maxToolCalls);
    lines.push('');
  }

  return lines.join('\n').trimEnd();
};
const orderTodos = (todos: Todo[]): Todo[] =>
  // Sort by status only, preserving original array order within each status group
  [...todos].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
