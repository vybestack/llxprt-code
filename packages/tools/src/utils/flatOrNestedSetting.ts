/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Read a setting that may live under its full dotted key or as a nested
 * object tree. SettingsService.set() stores dotted keys nested
 * (global['image-resize'].maxLongEdge) while other producers of the plural
 * ephemeral map (alias modelDefaults output, stubs, user settings files)
 * use the flat dotted key. Readers of that map must accept both shapes or
 * silently see undefined for one of them (issue #3477).
 *
 * The flat key wins when both shapes are present.
 */
export function readSettingFlatOrNested(
  settings: Readonly<Record<string, unknown>>,
  dottedKey: string,
): unknown {
  if (dottedKey in settings) {
    return settings[dottedKey];
  }
  let current: unknown = settings;
  for (const part of dottedKey.split('.')) {
    if (!isRecord(current) || !(part in current)) {
      return undefined;
    }
    current = current[part];
  }
  return current;
}
