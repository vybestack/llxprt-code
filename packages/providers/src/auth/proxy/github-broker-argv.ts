/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared argv construction helpers for broker operations.
 *
 * These were previously duplicated across the op modules, which let the
 * label and assignee helpers drift apart: one accepted only arrays and the
 * other only scalars, while the validator accepted both. A caller passing
 * the shape the validator allowed had it silently dropped from argv. A
 * single definition removes that class of mismatch.
 *
 * @plan PLAN-20260731-GHBROKER.P19
 * @requirement REQ-002, REQ-009
 * @pseudocode 003-github-broker.md lines 13-31
 */

/** Appends `--repo owner/name` when a repo parameter is present. */
export function appendRepo(
  argv: string[],
  params: Record<string, unknown>,
): void {
  if (typeof params.repo === 'string') argv.push('--repo', params.repo);
}

/** Appends `flag value` when the value is a non-empty string. */
export function appendString(
  argv: string[],
  flag: string,
  value: unknown,
): void {
  if (typeof value === 'string' && value.length > 0) argv.push(flag, value);
}

/**
 * Appends one `flag value` pair per entry, accepting either a single string
 * or an array of strings.
 *
 * Accepting both matters: the validators for label and assignee permit
 * either shape, so a helper that handled only one would silently discard
 * input the caller was told was valid.
 */
export function appendMulti(
  argv: string[],
  flag: string,
  value: unknown,
): void {
  if (typeof value === 'string') {
    if (value.length > 0) argv.push(flag, value);
    return;
  }
  if (!Array.isArray(value)) return;
  for (const entry of value) {
    if (typeof entry === 'string' && entry.length > 0) argv.push(flag, entry);
  }
}
