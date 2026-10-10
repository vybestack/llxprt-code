/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SettingsService } from '@vybestack/llxprt-code-settings';
import {
  normalizeContextLimit,
  normalizeStreamingValue,
} from '@vybestack/llxprt-code-core/config/ephemeralSettingsHelpers.js';

export function normalizeSessionSetting(key: string, value: unknown): unknown {
  if (key === 'streaming') {
    const normalized = normalizeStreamingValue(value);
    if (normalized !== undefined && typeof normalized !== 'string')
      throw new Error(
        'Streaming setting must resolve to "enabled" or "disabled"',
      );
    return normalized;
  }
  if (key === 'context-limit')
    return value === undefined ? undefined : normalizeContextLimit(value);
  return value;
}

export function readSessionSetting(
  settings: SettingsService,
  key: string,
): unknown {
  const value = settings.get(key);
  const normalized = normalizeSessionSetting(key, value);
  if (normalized !== undefined && normalized !== value)
    settings.set(key, normalized);
  return normalized;
}

export function captureSessionSettings(
  settings: SettingsService,
): Readonly<Record<string, unknown>> {
  const values = settings.getAllGlobalSettings();
  if ('streaming' in values) {
    const normalized = readSessionSetting(settings, 'streaming');
    if (normalized !== undefined) values.streaming = normalized;
  }
  return values;
}
