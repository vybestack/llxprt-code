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
const MAX_LIVE_OUTPUT_BYTES = 1024 * 1024;
const RETAINED_LIVE_OUTPUT_SIDE_BYTES = 64 * 1024;
const LIVE_OUTPUT_TRUNCATION_MARKER = '\n[... live output truncated ...]\n';

function takeUtf8(text: string, maxBytes: number, fromEnd: boolean): string {
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.length <= maxBytes) {
    return text;
  }
  if (!fromEnd) {
    let end = maxBytes;
    while (end > 0 && (bytes[end] & 0xc0) === 0x80) {
      end -= 1;
    }
    return bytes.subarray(0, end).toString('utf8');
  }
  let start = bytes.length - maxBytes;
  while (start < bytes.length && (bytes[start] & 0xc0) === 0x80) {
    start += 1;
  }
  return bytes.subarray(start).toString('utf8');
}

function appendBoundedLiveOutput(existing: string, update: string): string {
  const markerIndex = existing.indexOf(LIVE_OUTPUT_TRUNCATION_MARKER);
  if (markerIndex >= 0) {
    const suffixStart = markerIndex + LIVE_OUTPUT_TRUNCATION_MARKER.length;
    const suffix = existing.slice(suffixStart) + update;
    return `${existing.slice(0, markerIndex)}${LIVE_OUTPUT_TRUNCATION_MARKER}${takeUtf8(suffix, RETAINED_LIVE_OUTPUT_SIDE_BYTES, true)}`;
  }
  const existingBytes = Buffer.byteLength(existing, 'utf8');
  const updateBytes = Buffer.byteLength(update, 'utf8');
  const totalBytes = existingBytes + updateBytes;
  if (totalBytes <= MAX_LIVE_OUTPUT_BYTES) {
    return existing + update;
  }
  // Avoid materializing the full combined string; take from each side.
  const halfBudget = RETAINED_LIVE_OUTPUT_SIDE_BYTES;
  return `${takeUtf8(existing, halfBudget, false)}${LIVE_OUTPUT_TRUNCATION_MARKER}${takeUtf8(update, halfBudget, true)}`;
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
