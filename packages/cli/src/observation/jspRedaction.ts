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
  // A negative bound would silently return the empty string; a negative entry
  // cap would make Array.slice count from the end. Neither is a meaningful
  // request, so fail rather than publish a quietly wrong document.
  if (!Number.isInteger(maxBytes) || maxBytes < 0) {
    throw new RangeError('maxBytes must be a non-negative integer');
  }
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
  // The search works in UTF-16 code units, so the boundary can land between a
  // surrogate pair. A lone high surrogate encodes as 3 replacement bytes and
  // can therefore fit the budget the full 4-byte character exceeded, which
  // would publish an unpaired surrogate. Drop it.
  const end =
    lower > 0 && isHighSurrogate(input.charCodeAt(lower - 1))
      ? lower - 1
      : lower;
  return input.slice(0, end);
}

function isHighSurrogate(unit: number): boolean {
  return unit >= 0xd800 && unit <= 0xdbff;
}

interface TodoBounds {
  readonly todoTextBytes: number;
  readonly todoEntries: number;
}

export function buildTodoItems(
  todos: readonly TodoLike[],
  bounds: TodoBounds,
): Array<{ text: string; completed: boolean }> {
  if (!Number.isInteger(bounds.todoEntries) || bounds.todoEntries < 0) {
    throw new RangeError('todoEntries must be a non-negative integer');
  }
  const capped = todos.slice(0, bounds.todoEntries);
  return capped.map((todo) => ({
    text: truncateToByteBound(todo.content, bounds.todoTextBytes),
    completed: mapTodoCompleted(todo.status),
  }));
}

/**
 * Map a native task status to the published completion flag.
 *
 * The native status set is open, so an unrecognised value is published as not
 * completed rather than guessed at. The known values are listed explicitly so
 * that decision stays visible instead of being implied by a bare equality
 * check against `'completed'`.
 */
function mapTodoCompleted(status: string): boolean {
  switch (status) {
    case 'completed':
      return true;
    case 'pending':
    case 'in_progress':
      return false;
    default:
      return false;
  }
}
