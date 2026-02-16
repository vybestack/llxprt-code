/**
 * Temporary module augmentation so CLI sees new exports from the core package
 * without requiring a full rebuild of @vybestack/llxprt-code-core.
 */

import type { Todo, TodoToolCall } from '@vybestack/llxprt-code-core';

declare module '@vybestack/llxprt-code-core' {
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

  export function groupToolCalls(toolCalls: TodoToolCall[]): GroupedToolCall[];

  export function formatTodoListForDisplay(
    todos: Todo[],
    options?: TodoFormatterOptions,
  ): string;
}
