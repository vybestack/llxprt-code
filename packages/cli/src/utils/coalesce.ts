/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Returns the first candidate that is a non-empty string. An empty string is
 * treated as "absent" and falls through to the next candidate, mirroring the
 * historical `a || b` precedence used throughout the CLI for string fallbacks.
 *
 * Using this helper keeps that intent explicit (instead of relying on `||`,
 * which conflates empty strings with `null`/`undefined`).
 */
export function firstNonEmptyString(
  ...candidates: [...Array<string | undefined | null>, string]
): string;
export function firstNonEmptyString(
  ...candidates: Array<string | undefined | null>
): string | undefined;
export function firstNonEmptyString(
  ...candidates: Array<string | undefined | null>
): string | undefined {
  for (const candidate of candidates) {
    if (candidate !== null && candidate !== undefined && candidate !== '') {
      return candidate;
    }
  }
  return undefined;
}
