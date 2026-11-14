/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import {
  getSettingSpec,
  normalizeSetting,
  validateSetting,
} from '../settings/settingsRegistry.js';
import { parseEphemeralSettingValue } from '../settings/ephemeral-settings.js';
import { resolveTokenUsageLogLevel } from '../settings/tokenUsageLogLevel.js';

describe('token-usage-log setting (#4068)', () => {
  it('defaults to the summary level', () => {
    expect(getSettingSpec('token-usage-log')?.default).toBe('summary');
    expect(resolveTokenUsageLogLevel(undefined)).toBe('summary');
    expect(resolveTokenUsageLogLevel(null)).toBe('summary');
  });

  it('maps legacy booleans persisted in settings files and profiles', () => {
    expect(validateSetting('token-usage-log', true)).toStrictEqual({
      success: true,
      value: 'summary',
    });
    expect(validateSetting('token-usage-log', false)).toStrictEqual({
      success: true,
      value: 'off',
    });
    expect(normalizeSetting('token-usage-log', true)).toBe('summary');
    expect(normalizeSetting('token-usage-log', false)).toBe('off');
    expect(resolveTokenUsageLogLevel(true)).toBe('summary');
    expect(resolveTokenUsageLogLevel(false)).toBe('off');
  });

  it('maps legacy true/false typed at the /set prompt and accepts levels in any case', () => {
    expect(parseEphemeralSettingValue('token-usage-log', 'true')).toStrictEqual(
      {
        success: true,
        value: 'summary',
      },
    );
    expect(
      parseEphemeralSettingValue('token-usage-log', 'FALSE'),
    ).toStrictEqual({
      success: true,
      value: 'off',
    });
    expect(
      parseEphemeralSettingValue('token-usage-log', 'Debug'),
    ).toStrictEqual({
      success: true,
      value: 'debug',
    });
  });

  it('rejects any other value with a message naming the valid levels', () => {
    const fromPrompt = parseEphemeralSettingValue('token-usage-log', 'verbose');
    expect(fromPrompt.success).toBe(false);
    expect(fromPrompt.success ? '' : fromPrompt.message).toContain(
      'token-usage-log must be off, summary, or debug',
    );

    const persisted = validateSetting('token-usage-log', 1);
    expect(persisted.success).toBe(false);
    expect(persisted.message).toContain('received 1');

    expect(() => resolveTokenUsageLogLevel('verbose')).toThrow(
      'token-usage-log must be off, summary, or debug',
    );
  });
});
