/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The `token-usage-log` level (#4068).
 *
 * - `off` writes no token-usage records.
 * - `summary` writes one scalar-only record per model request (the default).
 * - `debug` adds tool attribution, the per-component prompt split, the prefix
 *   fingerprint and estimator internals.
 *
 * The setting used to be a boolean. Persisted settings files and profiles may
 * still carry `true`/`false`, so those map to `summary`/`off` wherever the
 * value is read. Any other value is rejected.
 */
export type TokenUsageLogLevel = 'off' | 'summary' | 'debug';

export const TOKEN_USAGE_LOG_LEVELS: readonly TokenUsageLogLevel[] =
  Object.freeze(['off', 'summary', 'debug']);

export const DEFAULT_TOKEN_USAGE_LOG_LEVEL: TokenUsageLogLevel = 'summary';

function isTokenUsageLogLevel(value: unknown): value is TokenUsageLogLevel {
  return TOKEN_USAGE_LOG_LEVELS.some((level) => level === value);
}

/**
 * Normalize a stored `token-usage-log` value to a level, mapping the legacy
 * booleans. Returns `undefined` for anything that is not a valid value.
 */
export function normalizeTokenUsageLogLevel(
  value: unknown,
): TokenUsageLogLevel | undefined {
  if (value === true) return 'summary';
  if (value === false) return 'off';
  return isTokenUsageLogLevel(value) ? value : undefined;
}

export function invalidTokenUsageLogLevelMessage(value: unknown): string {
  return `token-usage-log must be off, summary, or debug (legacy true/false are accepted as summary/off); received ${typeof value === 'string' ? JSON.stringify(value) : String(value)}`;
}

/**
 * The single accessor every reader of `token-usage-log` goes through. An unset
 * value (`undefined`, or JSON `null`) resolves to the default level; an invalid
 * value throws, because a stored value outside the setting's domain is a
 * configuration error that the user has to fix, not something to guess around.
 */
export function resolveTokenUsageLogLevel(value: unknown): TokenUsageLogLevel {
  if (value === undefined || value === null) {
    return DEFAULT_TOKEN_USAGE_LOG_LEVEL;
  }
  const level = normalizeTokenUsageLogLevel(value);
  if (level === undefined) {
    throw new Error(invalidTokenUsageLogLevelMessage(value));
  }
  return level;
}
