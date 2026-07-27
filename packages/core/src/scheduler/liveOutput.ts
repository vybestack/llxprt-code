/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AnsiOutput,
  LiveOutputUpdate,
} from '../utils/terminalSerializer.js';

/**
 * Accumulates a live-output update onto an existing accumulated value using
 * the explicit tagged {@link LiveOutputUpdate} protocol.
 *
 * - **`append`** (text deltas) — concatenated onto the existing value when it
 *   is a string; otherwise the prior non-string value is dropped and the
 *   delta starts a fresh string.
 * - **`replace`** (terminal-buffer snapshots) — supersedes any prior value.
 *
 * The `existing` parameter is typed `unknown` because callers may pass values
 * drawn from a broader display union (e.g. `ToolResultDisplay`, which also
 * includes `FileDiff` / `FileRead`). The returned type is the narrow
 * `string | AnsiOutput` union the live-output channel actually produces.
 */
export function accumulateLiveOutput(
  existing: unknown,
  update: LiveOutputUpdate,
): string | AnsiOutput {
  switch (update.mode) {
    case 'append':
      return typeof existing === 'string'
        ? existing + update.data
        : update.data;
    case 'replace':
      return update.data;
    default: {
      const _exhaustive: never = update;
      return _exhaustive;
    }
  }
}
