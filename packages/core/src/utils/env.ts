/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Return the given environment variable value when it is present and non-empty,
 * otherwise return the fallback. An explicitly-empty (or whitespace-only)
 * value is treated as absent so that misconfigured environment variables fall
 * back to the default instead of producing malformed partial paths.
 */
export function envOr(value: string | undefined, fallback: string): string {
  return value?.trim() ? value : fallback;
}
