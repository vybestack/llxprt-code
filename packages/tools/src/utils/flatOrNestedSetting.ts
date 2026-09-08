/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Own-property check for settings lookups. `in` would also match inherited
 * properties, letting prototype values supply settings the user never
 * configured.
 */
function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

/**
 * Key segments that must never be traversed. Following them lets a lookup
 * walk into Object.prototype machinery (or an own `__proto__` data property
 * planted by a JSON producer), so settings reads treat them as missing.
 */
const PROTOTYPE_KEY_SEGMENTS: ReadonlySet<string> = new Set([
  '__proto__',
  'constructor',
  'prototype',
]);

/**
 * Read a setting that may live under its full dotted key or as a nested
 * object tree. SettingsService.set() stores dotted keys nested
 * (global['image-resize'].maxLongEdge) while other producers of the plural
 * ephemeral map (alias modelDefaults output, stubs, user settings files)
 * use the flat dotted key. Readers of that map must accept both shapes or
 * silently see undefined for one of them (issue #3477).
 *
 * Only own properties are considered; values inherited from a prototype
 * never supply a setting.
 *
 * The flat key wins when both shapes are present.
 */
export function readSettingFlatOrNested(
  settings: Readonly<Record<string, unknown>>,
  dottedKey: string,
): unknown {
  if (hasOwn(settings, dottedKey)) {
    return settings[dottedKey];
  }
  let current: unknown = settings;
  for (const part of dottedKey.split('.')) {
    if (
      !isRecord(current) ||
      PROTOTYPE_KEY_SEGMENTS.has(part) ||
      !hasOwn(current, part)
    ) {
      return undefined;
    }
    current = current[part];
  }
  return current;
}
