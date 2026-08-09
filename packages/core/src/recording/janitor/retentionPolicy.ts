/**
 * Copyright 2026 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Retention configuration resolution, validation, and period parsing for the
 * session-recording janitor.
 *
 * Default policy (AC-2): cleanup is enabled with a global 4 GiB aggregate size
 * budget, no default age limit, and no default count limit.  A minimum
 * retention floor of 1 day prevents deleting very recent recordings.
 */

import type {
  ResolvedRetentionConfig,
  UserRetentionSettings,
} from './cleanupTypes.js';

/** Default global aggregate session budget: 4096 MiB = 4 GiB (AC-2). */
export const DEFAULT_MAX_TOTAL_SIZE_MB = 4096;

/** Default minimum retention safety floor (AC-2). */
export const DEFAULT_MIN_RETENTION = '1d';

/** 1 MiB in bytes. */
const MIB = 1024 * 1024;

/** Validate that a maxTotalSizeMB value is a positive finite number with a safe byte conversion. */
function isValidMaxTotalSizeMB(value: number): boolean {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value > 0 &&
    Number.isSafeInteger(Math.round(value * MIB))
  );
}

const PERIOD_MULTIPLIERS: Readonly<Record<string, number>> = {
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
  w: 7 * 24 * 60 * 60 * 1000,
  m: 30 * 24 * 60 * 60 * 1000,
};

/**
 * Parse a human-readable retention period string like `"30d"` or `"24h"` into
 * milliseconds.  Supported units: h, d, w, m.  Throws on malformed input or
 * a zero value (zero retention is semantically invalid).
 *
 * @throws {Error} When `period` is not a valid `<number><unit>` string.
 */
export function parseRetentionPeriod(period: string): number {
  const match = period.match(/^(\d+)([hdwm])$/);
  if (!match) {
    throw new Error(
      `Invalid retention period format: ${period}. Expected format: <number><unit> where unit is h, d, w, or m`,
    );
  }
  const value = Number(match[1]);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(
      `Invalid retention period: ${period}. Value must be greater than 0`,
    );
  }
  // Compute in a finite-safe manner so an absurdly large value cannot produce
  // a non-integer or overflowing millisecond period (finding D).
  const multiplier = PERIOD_MULTIPLIERS[match[2]];
  const result = value * multiplier;
  if (!Number.isSafeInteger(result)) {
    throw new Error(
      `Invalid retention period: ${period}. Converted value overflows the safe integer range`,
    );
  }
  return result;
}

/**
 * Validate a user-provided retention settings object *before* merging with
 * defaults.  Invalid values fail fast with a clear error message rather than
 * being silently normalized into a different policy (AC-3, AC-11).
 *
 * @throws {Error} When any supplied field is invalid (e.g. bad period format,
 *                  negative size, maxAge shorter than minRetention).
 */
export function validateRetentionConfig(
  userConfig: UserRetentionSettings | undefined,
): void {
  if (userConfig === undefined) return;

  if (
    userConfig.maxTotalSizeMB !== undefined &&
    !isValidMaxTotalSizeMB(userConfig.maxTotalSizeMB)
  ) {
    throw new Error(
      `Invalid sessionRetention.maxTotalSizeMB: must be a positive number whose byte conversion is a finite safe integer, got ${String(userConfig.maxTotalSizeMB)}`,
    );
  }

  if (
    userConfig.maxCount !== undefined &&
    (typeof userConfig.maxCount !== 'number' ||
      !Number.isSafeInteger(userConfig.maxCount) ||
      userConfig.maxCount < 1)
  ) {
    throw new Error(
      `Invalid sessionRetention.maxCount: must be a positive safe integer, got ${String(userConfig.maxCount)}`,
    );
  }

  if (userConfig.minRetention !== undefined) {
    parseRetentionPeriod(userConfig.minRetention);
  }

  if (userConfig.maxAge !== undefined) {
    const maxAgeMs = parseRetentionPeriod(userConfig.maxAge);
    const minRetentionMs = parseRetentionPeriod(
      userConfig.minRetention ?? DEFAULT_MIN_RETENTION,
    );
    if (maxAgeMs < minRetentionMs) {
      throw new Error(
        `sessionRetention.maxAge (${userConfig.maxAge}) cannot be less than minRetention (${userConfig.minRetention ?? DEFAULT_MIN_RETENTION})`,
      );
    }
  }
}

/**
 * Resolve a (possibly partial or absent) user retention settings object into a
 * fully concrete {@link ResolvedRetentionConfig}.  Defaults are applied at the
 * consumer so a partial object cannot accidentally remove default-on size
 * bounding (AC-2).
 *
 * - When `userConfig` is `undefined` → defaults (enabled, 4 GiB, 1d floor).
 * - When `userConfig.enabled` is explicitly `false` → disabled.
 * - Explicit `maxAge` / `maxCount` are honoured; absence means "no limit".
 */
export function resolveRetentionConfig(
  userConfig: UserRetentionSettings | undefined,
): ResolvedRetentionConfig {
  validateRetentionConfig(userConfig);

  const enabled = userConfig?.enabled !== false;
  const maxTotalSizeMB =
    userConfig?.maxTotalSizeMB ?? DEFAULT_MAX_TOTAL_SIZE_MB;
  const maxTotalSizeBytes = Math.round(maxTotalSizeMB * MIB);

  // Safety net (finding D): the resolved byte limit must be a finite safe
  // positive integer so downstream arithmetic cannot overflow.
  if (!Number.isSafeInteger(maxTotalSizeBytes) || maxTotalSizeBytes <= 0) {
    throw new Error(
      `Invalid sessionRetention.maxTotalSizeMB: must be a positive number whose byte conversion is a finite safe integer, got ${String(maxTotalSizeMB)}`,
    );
  }

  const maxAgeMs =
    userConfig?.maxAge !== undefined
      ? parseRetentionPeriod(userConfig.maxAge)
      : null;

  const maxCount = userConfig?.maxCount ?? null;

  const minRetentionMs = parseRetentionPeriod(
    userConfig?.minRetention ?? DEFAULT_MIN_RETENTION,
  );

  return { enabled, maxTotalSizeBytes, maxAgeMs, maxCount, minRetentionMs };
}
