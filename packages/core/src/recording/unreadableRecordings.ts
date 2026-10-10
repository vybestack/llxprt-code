/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as path from 'node:path';
import { resumeSessionNotFoundMessage } from './resumeNotFoundMessages.js';
import type { UnreadableRecording } from './types.js';

/** `<file>: <reason>`, the form every caller shows for a skipped recording. */
export function describeUnreadableRecording(
  recording: UnreadableRecording,
): string {
  return `${recording.filePath}: ${recording.reason}`;
}

/**
 * Unreadable recordings that an unresolved continue reference points at: by
 * recording file name or path, or by session id prefix when the recording has
 * a valid id. Only a plain "not found" resolution failure qualifies (an
 * ambiguous reference is a different problem), and numeric references are
 * list indices, never recording identifiers.
 */
export function matchUnreadableRecordings(
  ref: string,
  resolutionError: string,
  unreadableRecordings: readonly UnreadableRecording[],
): UnreadableRecording[] {
  if (resolutionError !== resumeSessionNotFoundMessage(ref)) return [];
  if (ref.length === 0 || /^\d+$/.test(ref)) return [];
  return unreadableRecordings.filter(
    (recording) =>
      recording.sessionId?.startsWith(ref) === true ||
      recording.filePath === ref ||
      path.basename(recording.filePath) === ref,
  );
}
