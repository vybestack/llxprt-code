/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Accepted terminal response event types for the OpenAI Responses API.
 *
 * A stream that reaches one of these events has produced a well-formed,
 * complete (or explicitly incomplete) response. The parser yields terminal
 * metadata for these, so a subsequent connection close must not be treated as
 * a truncation.
 *
 * Shared by the WebSocket transport (terminal assertion) and the SSE parser
 * (HTTP abrupt-EOF detection, issue #3049).
 */
export const ACCEPTED_TERMINAL_EVENT_TYPES: ReadonlySet<string> = new Set([
  'response.completed',
  'response.done',
  'response.incomplete',
]);

/**
 * Terminal event types that signal a protocol failure. The parser raises its
 * own specific provider error for these, so they are never confused with an
 * accepted terminal.
 */
export const PROTOCOL_FAILURE_TERMINAL_EVENT_TYPES: ReadonlySet<string> =
  new Set(['response.failed', 'error']);

/** True when the event type is one of the accepted terminal events. */
export function isAcceptedTerminalEventType(type: string | undefined): boolean {
  return type !== undefined && ACCEPTED_TERMINAL_EVENT_TYPES.has(type);
}

/** True when the event type is any terminal event (accepted or failure). */
export function isTerminalEventType(type: string | undefined): boolean {
  return (
    type !== undefined &&
    (ACCEPTED_TERMINAL_EVENT_TYPES.has(type) ||
      PROTOCOL_FAILURE_TERMINAL_EVENT_TYPES.has(type))
  );
}
