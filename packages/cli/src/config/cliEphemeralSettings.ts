/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { parseEphemeralSettingValue } from '../settings/ephemeralSettings.js';

export interface EphemeralSettingTarget {
  setEphemeralSetting(key: string, value: unknown): void;
}

export function applyCliSetArguments(
  target: EphemeralSettingTarget,
  setArgs: readonly string[] | undefined,
): void {
  if (!setArgs || setArgs.length === 0) {
    return;
  }

  for (const entry of setArgs) {
    const separatorIndex = entry.indexOf('=');
    if (separatorIndex === -1) {
      throw new Error(`Invalid --set format: ${entry}. Expected key=value`);
    }

    const key = entry.slice(0, separatorIndex).trim();
    const rawValue = entry.slice(separatorIndex + 1);

    if (!key) {
      throw new Error(`Invalid --set format: ${entry}. Expected key=value`);
    }

    const parseResult = parseEphemeralSettingValue(key, rawValue);

    if (!parseResult.success) {
      throw new Error(parseResult.message);
    }

    target.setEphemeralSetting(key, parseResult.value);
  }
}
