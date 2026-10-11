/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  describeUnreadableRecording,
  type UnreadableRecording,
} from '@vybestack/llxprt-code-core';
import { debugLogger } from '@vybestack/llxprt-code-telemetry';

/**
 * Report recordings that session discovery skipped on the CLI's debug log, for
 * callers whose own result has no room for them (completions, listings). The
 * caller still gets every readable session.
 */
export function warnUnreadableRecordings(
  operation: string,
  recordings: readonly UnreadableRecording[],
): void {
  if (recordings.length === 0) return;
  debugLogger.warn(
    `${operation}: skipped ${recordings.length} unreadable session recording(s): ${recordings.map(describeUnreadableRecording).join('; ')}`,
  );
}
