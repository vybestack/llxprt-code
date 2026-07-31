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
 * Narrows an arbitrary `existing` accumulator value to the live-output union
 * (`string | AnsiOutput`), returning an empty string for values that are not
 * valid live-output content (e.g. `FileDiff` drawn from a broader display
 * union). Used by the `status` path, which must not invent new content.
 */
function preserveLiveOutput(existing: unknown): string | AnsiOutput {
  if (typeof existing === 'string') {
    return existing;
  }
  if (Array.isArray(existing)) {
    return existing as AnsiOutput;
  }
  return '';
}

/**
 * Accumulates a live-output update onto an existing accumulated value using
 * the explicit tagged {@link LiveOutputUpdate} protocol.
 *
 * - **`append`** (text deltas) — concatenated onto the existing value when it
 *   is a string; otherwise the prior non-string value is dropped and the
 *   delta starts a fresh string.
 * - **`replace`** (terminal-buffer snapshots) — supersedes any prior value.
 * - **`status`** (liveness snapshot, issue #2540) — non-content; the existing
 *   accumulated value is returned unchanged so retained output never grows
 *   with heartbeat strings.
 *
 * The `existing` parameter is typed `unknown` because callers may pass values
 * drawn from a broader display union (e.g. `ToolResultDisplay`, which also
 * includes `FileDiff` / `FileRead`). The returned type is the narrow
 * `string | AnsiOutput` union the live-output channel actually produces.
 */
/**
 * Retention budget for the in-progress preview, in UTF-16 code units.
 *
 * Live output is a preview of a running tool: the caller replaces
 * `resultDisplay` with the tool's complete result once execution finishes, so
 * trimming here does not lose the tool's output. Before issue #2852 this
 * accumulator grew without bound, which made a long-running tool's preview a
 * retained-memory leak and made each append `O(accumulated)`.
 *
 * Only the newest output is retained, which is what a terminal shows anyway.
 * Trimming down to {@link RETAINED_LIVE_OUTPUT_CHARS} gives the trim path
 * hysteresis, so its cost amortises to O(1) per character appended.
 */
const MAX_LIVE_OUTPUT_CHARS = 256 * 1024;
const RETAINED_LIVE_OUTPUT_CHARS = 128 * 1024;
const LIVE_OUTPUT_TRUNCATION_MARKER = '[... earlier live output trimmed ...]\n';

/**
 * Last `maxChars` code units of `text`, never splitting a surrogate pair.
 */
function takeTail(text: string, maxChars: number): string {
  if (maxChars <= 0) {
    return '';
  }
  if (text.length <= maxChars) {
    return text;
  }
  let start = text.length - maxChars;
  const code = text.charCodeAt(start);
  if (code >= 0xdc00 && code <= 0xdfff) {
    start += 1;
  }
  return text.slice(start);
}

/**
 * Appends `update`, keeping the newest {@link RETAINED_LIVE_OUTPUT_CHARS} code
 * units once the accumulated preview passes {@link MAX_LIVE_OUTPUT_CHARS}.
 *
 * The truncation marker is re-derived on every trim and is never read back, so
 * tool output that itself contains the marker text cannot corrupt the
 * accumulator.
 */
function appendBoundedLiveOutput(existing: string, update: string): string {
  if (existing.length + update.length <= MAX_LIVE_OUTPUT_CHARS) {
    return existing + update;
  }
  if (update.length >= RETAINED_LIVE_OUTPUT_CHARS) {
    return (
      LIVE_OUTPUT_TRUNCATION_MARKER +
      takeTail(update, RETAINED_LIVE_OUTPUT_CHARS)
    );
  }
  const keptFromExisting = takeTail(
    existing,
    RETAINED_LIVE_OUTPUT_CHARS - update.length,
  );
  return LIVE_OUTPUT_TRUNCATION_MARKER + keptFromExisting + update;
}

export function accumulateLiveOutput(
  existing: unknown,
  update: LiveOutputUpdate,
): string | AnsiOutput {
  switch (update.mode) {
    case 'append':
      return appendBoundedLiveOutput(
        typeof existing === 'string' ? existing : '',
        update.data,
      );
    case 'replace':
      return update.data;
    case 'status':
      return preserveLiveOutput(existing);
    default: {
      const _exhaustive: never = update;
      return _exhaustive;
    }
  }
}
