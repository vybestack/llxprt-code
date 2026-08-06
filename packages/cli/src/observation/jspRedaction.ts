/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { utf8ByteLength, withinByteBound } from './jspBounds.js';

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
  readonly todoStateBytes: number;
}

/**
 * Project native todos onto the published `{text, state}` shape.
 *
 * The status is published exactly as the native model reports it. A derived
 * boolean used to collapse `pending` and `in_progress` into the same value, so
 * the item the agent was actually working on did not survive the wire; the
 * consumer degrades an unrecognised label to neither completed nor active, and
 * coercing an unfamiliar status onto a recognised one here would reintroduce
 * that loss as a guess presented as fact.
 */
export function buildTodoItems(
  todos: readonly TodoLike[],
  bounds: TodoBounds,
): Array<{ text: string; state: string }> {
  if (!Number.isInteger(bounds.todoEntries) || bounds.todoEntries < 0) {
    throw new RangeError('todoEntries must be a non-negative integer');
  }
  if (!Number.isInteger(bounds.todoStateBytes) || bounds.todoStateBytes < 0) {
    throw new RangeError('todoStateBytes must be a non-negative integer');
  }
  const capped = todos.slice(0, bounds.todoEntries);
  return capped.map((todo) => ({
    text: truncateToByteBound(todo.content, bounds.todoTextBytes),
    state: boundedTodoState(todo.status, bounds.todoStateBytes),
  }));
}

/**
 * Return the status unchanged, or fail if it does not fit the published bound.
 *
 * Text is truncated because it is free-form content whose tail carries no
 * contract. A status is the opposite: it is an opaque label the consumer
 * compares for equality, so a truncated one is a label the source never
 * reported. Publishing it would put a value the producer invented into the one
 * field that exists to stop the producer guessing. The native status set is a
 * closed three-value enum well inside the bound, so an over-bound status is an
 * impossible state rather than input to accommodate; failing here surfaces that
 * bug instead of smuggling it onto the wire. The observation boundary isolates
 * producer failures, so the cost is a dropped telemetry update, never a
 * disrupted foreground session.
 */
function boundedTodoState(status: string, maxBytes: number): string {
  if (!withinByteBound(status, maxBytes)) {
    throw new RangeError('todo state exceeds the published byte bound');
  }
  return status;
}
