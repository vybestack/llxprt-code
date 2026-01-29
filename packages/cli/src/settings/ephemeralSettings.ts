/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  getSettingHelp,
  validateSetting,
  parseSetting,
  resolveAlias,
  SETTINGS_REGISTRY,
} from '@vybestack/llxprt-code-core';

export const ephemeralSettingHelp: Record<string, string> = getSettingHelp();

const validEphemeralKeys = SETTINGS_REGISTRY.map((s: { key: string }) => s.key);

export type EphemeralSettingKey = keyof typeof ephemeralSettingHelp;

export interface EphemeralParseSuccess {
  success: true;
  value: unknown;
}

export interface EphemeralParseFailure {
  success: false;
  message: string;
}

export type EphemeralParseResult =
  | EphemeralParseSuccess
  | EphemeralParseFailure;

export function parseEphemeralSettingValue(
  key: string,
  rawValue: string,
): EphemeralParseResult {
  const resolved = resolveAlias(key);
  if (!validEphemeralKeys.includes(resolved)) {
    return {
      success: false,
      message: `Invalid setting key: ${key}. Valid keys are: ${validEphemeralKeys.join(', ')}`,
    };
  }

  const parsed = parseSetting(resolved, rawValue);
  const validation = validateSetting(resolved, parsed);

  if (!validation.success) {
    return {
      success: false,
      message: validation.message ?? `Validation failed for ${key}`,
    };
  }

  return {
    success: true,
    value: validation.value ?? parsed,
  };
}

/**
 * Validates whether a given key-value pair is a valid ephemeral setting.
 * Used for runtime validation of ephemeral settings.
 * @param key - The ephemeral setting key
 * @param value - The value to validate
 * @returns true if the setting is valid, false otherwise
 */
export function isValidEphemeralSetting(key: string, value: unknown): boolean {
  // Resolve aliases first so 'max-tokens' etc. work the same as in parseEphemeralSettingValue
  const resolved = resolveAlias(key);
  if (!validEphemeralKeys.includes(resolved)) {
    return false;
  }
  const result = parseEphemeralSettingValue(resolved, String(value));
  return result.success;
}
