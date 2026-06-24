/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Returns the first non-empty string argument, or `''` if none are found.
 *
 * Empty strings are treated as missing because MCP display and local fallback
 * paths intentionally preserve legacy empty-string-falls-through behavior.
 */
export function firstTruthyString(
  ...values: ReadonlyArray<string | null | undefined>
): string {
  for (const value of values) {
    if (value !== null && value !== undefined && value !== '') {
      return value;
    }
  }
  return '';
}
