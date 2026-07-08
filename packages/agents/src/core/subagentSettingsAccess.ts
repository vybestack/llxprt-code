/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { homedir } from 'node:os';
import type { Profile } from '@vybestack/llxprt-code-settings';

type EphemeralSettings = Profile['ephemeralSettings'];

/** Reads a raw ephemeral setting value by key. */
export function getSetting(settings: EphemeralSettings, key: string): unknown {
  return (settings as Record<string, unknown>)[key];
}

/** Expands a leading home-directory marker in a path-like ephemeral setting. */
export function expandTilde(pathValue: string): string {
  return pathValue.replace(/^~(?=$|[/\\])/, homedir());
}

/**
 * Returns the first finite numeric ephemeral setting among the given keys,
 * coercing numeric strings. Returns undefined when none match.
 */
export function getNumberSetting(
  settings: EphemeralSettings,
  keys: string[],
): number | undefined {
  for (const key of keys) {
    const value = getSetting(settings, key);
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string' && value.trim().length > 0) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return undefined;
}

/**
 * Returns the first non-empty string ephemeral setting among the given keys,
 * or undefined when none match.
 */
export function getStringSetting(
  settings: EphemeralSettings,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const value = getSetting(settings, key);
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }
  }
  return undefined;
}

/**
 * Returns the first non-empty string-only array among the given keys, filtering
 * out empty/whitespace-only items. Falls through to later keys when an earlier
 * array becomes empty after filtering, and returns undefined when none match.
 */
export function getStringArraySetting(
  settings: EphemeralSettings,
  keys: string[],
): string[] | undefined {
  for (const key of keys) {
    const value = getSetting(settings, key);
    if (!Array.isArray(value)) {
      continue;
    }
    const filtered = value.filter(
      (item): item is string =>
        typeof item === 'string' && item.trim().length > 0,
    );
    if (filtered.length > 0) {
      return filtered;
    }
  }
  return undefined;
}
