/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Resolves a timestamp for task status updates: prefers an explicitly
 * provided timestamp and falls back to the current wall-clock time.
 */
export function resolveTimestamp(timestamp?: string): string {
  // Legacy parity: a present-but-empty timestamp is treated as absent —
  // publishing '' would emit a malformed status update.
  return timestamp !== undefined && timestamp !== ''
    ? timestamp
    : new Date().toISOString();
}
