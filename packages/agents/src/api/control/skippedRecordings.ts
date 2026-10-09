/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  describeUnreadableRecording,
  type UnreadableRecording,
} from '@vybestack/llxprt-code-core';
import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';

/** Report recordings session discovery skipped; healthy sessions still work. */
export function warnSkippedRecordings(
  logger: DebugLogger,
  recordings: readonly UnreadableRecording[],
): void {
  if (recordings.length === 0) return;
  logger.warn(
    () =>
      `skipped ${recordings.length} unreadable session recording(s): ${recordings.map(describeUnreadableRecording).join('; ')}`,
  );
}
