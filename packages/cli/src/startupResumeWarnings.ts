/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import chalk from 'chalk';
import {
  CONTINUE_LATEST,
  SessionDiscovery,
  describeUnreadableRecording,
  matchUnreadableRecordings,
  type ContinueTarget,
  type UnreadableRecording,
} from '@vybestack/llxprt-code-core';
import { debugLogger } from '@vybestack/llxprt-code-telemetry';

/**
 * Record a startup warning for the caller to show the user, and mirror it to
 * the debug log. DebugLogger.warn is silent unless debug logging is enabled, so
 * the collected string is the user-visible path.
 */
export function recordStartupWarning(sink: string[], message: string): void {
  sink.push(message);
  debugLogger.warn(chalk.yellow(message));
}

export function describeUnreadableRecordings(
  unreadableRecordings: readonly UnreadableRecording[],
): string {
  return unreadableRecordings
    .map((recording) => `  ${describeUnreadableRecording(recording)}`)
    .join('\n');
}

/** One visible warning naming every unreadable recording discovery skipped. */
export function warnSkippedRecordings(
  unreadableRecordings: readonly UnreadableRecording[],
  startupWarnings: string[],
): void {
  if (unreadableRecordings.length === 0) return;
  recordStartupWarning(
    startupWarnings,
    `Skipped ${unreadableRecordings.length} unreadable session recording(s):\n` +
      describeUnreadableRecordings(unreadableRecordings),
  );
}

/**
 * Where a startup --continue reference lands once unreadable recordings are
 * accounted for: a readable session id to resume, the unreadable recordings the
 * reference names (nothing readable matches it), or neither.
 */
export function classifyContinueRef(
  continueRef: string,
  targets: readonly ContinueTarget[],
  unreadableRecordings: readonly UnreadableRecording[],
): {
  resumeRef: string;
  namedUnreadable: readonly UnreadableRecording[];
} {
  if (continueRef === CONTINUE_LATEST) {
    return { resumeRef: continueRef, namedUnreadable: [] };
  }
  const resolved = SessionDiscovery.resolveContinueRef(continueRef, targets);
  if ('target' in resolved) {
    // Pin the readable session's id so an index or name cannot be re-resolved
    // against a listing that still contains the unreadable recordings.
    const sessionId =
      resolved.target.kind === 'session'
        ? resolved.target.session.sessionId
        : continueRef;
    return { resumeRef: sessionId, namedUnreadable: [] };
  }
  const namedUnreadable = matchUnreadableRecordings(
    continueRef,
    resolved.error,
    unreadableRecordings,
  );
  return { resumeRef: continueRef, namedUnreadable };
}
