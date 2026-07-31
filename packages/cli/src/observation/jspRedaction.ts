/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { utf8ByteLength } from './jspBounds.js';

export const NO_CONTENT = '';

interface TodoLike {
  readonly content: string;
  readonly status: string;
}

export function redactAssistantContent(
  content: string,
  maxBytes: number,
  noContent = false,
): string {
  if (noContent) return NO_CONTENT;
  return truncateToByteBound(content, maxBytes);
}

export function truncateToByteBound(input: string, maxBytes: number): string {
  if (utf8ByteLength(input) <= maxBytes) return input;
  let lower = 0;
  let upper = input.length;
  while (lower < upper) {
    const mid = Math.floor((lower + upper + 1) / 2);
    if (utf8ByteLength(input.slice(0, mid)) <= maxBytes) {
      lower = mid;
    } else {
      upper = mid - 1;
    }
  }
  return input.slice(0, lower);
}

interface TodoBounds {
  readonly todoTextBytes: number;
  readonly todoEntries: number;
}

export function buildTodoItems(
  todos: readonly TodoLike[],
  bounds: TodoBounds,
): Array<{ text: string; completed: boolean }> {
  const capped = todos.slice(0, bounds.todoEntries);
  return capped.map((todo) => ({
    text: truncateToByteBound(todo.content, bounds.todoTextBytes),
    completed: todo.status === 'completed',
  }));
}
