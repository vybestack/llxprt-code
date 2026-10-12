/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  describeUnreadableRecording,
  type UnreadableRecording,
} from '@vybestack/llxprt-code-core';

/** One `  <file>: <reason>` line per unreadable recording. */
export function describeUnreadableRecordings(
  unreadableRecordings: readonly UnreadableRecording[],
): string {
  return unreadableRecordings
    .map((recording) => `  ${describeUnreadableRecording(recording)}`)
    .join('\n');
}

/**
 * The single block naming every unreadable recording discovery skipped. Shared
 * by startup --continue and --list-sessions so both report it identically.
 */
export function formatSkippedRecordingsWarning(
  unreadableRecordings: readonly UnreadableRecording[],
): string {
  return (
    `Skipped ${unreadableRecordings.length} unreadable session recording(s):\n` +
    describeUnreadableRecordings(unreadableRecordings)
  );
}
