/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

const MAX_REPLAY_DIAGNOSTIC_DEPTH = 32;

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function appendReplayDiagnostic(
  error: unknown,
  messages: string[],
  seen: Set<object>,
  depth: number,
): void {
  if (depth >= MAX_REPLAY_DIAGNOSTIC_DEPTH) return;
  if (typeof error !== 'object' || error === null) {
    messages.push(String(error));
    return;
  }
  if (seen.has(error)) return;
  seen.add(error);
  if (error instanceof Error) messages.push(error.message);
  const nestedErrors = Reflect.get(error, 'errors');
  if (isUnknownArray(nestedErrors)) {
    for (const nested of nestedErrors) {
      appendReplayDiagnostic(nested, messages, seen, depth + 1);
    }
  }
  const cause = Reflect.get(error, 'cause');
  if (cause !== undefined) {
    appendReplayDiagnostic(cause, messages, seen, depth + 1);
  }
}

export function formatReplayDiagnostic(error: unknown): string {
  const messages: string[] = [];
  appendReplayDiagnostic(error, messages, new Set<object>(), 0);
  return messages.length > 0 ? messages.join(': ') : String(error);
}
