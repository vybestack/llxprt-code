/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Returns `fallback` when `value` is `undefined`, an empty string, or a
 * whitespace-only string.  Use this instead of `||` when the intent is to
 * treat empty/blank strings as "absent" rather than the stricter nullish
 * semantics of `??`.
 *
 * This keeps `@typescript-eslint/prefer-nullish-coalescing` satisfied without
 * resorting to inline lint suppression comments.
 */
export function stringOrDefault(
  value: string | undefined,
  fallback: string,
): string {
  return value !== undefined && value.trim() !== '' ? value : fallback;
}
