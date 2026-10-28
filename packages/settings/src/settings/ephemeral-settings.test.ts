/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import {
  ephemeralSettingHelp,
  isValidEphemeralSetting,
  parseEphemeralSettingValue,
} from './ephemeral-settings.js';
import { getSettingHelp } from './settingsRegistry.js';

describe('settings-owned ephemeral parsing and help', () => {
  it('publishes the registry help without allowing callers to replace it', () => {
    expect(Object.isFrozen(ephemeralSettingHelp)).toBe(true);
    expect(
      Reflect.set(ephemeralSettingHelp, 'context-limit', 'replaced help'),
    ).toBe(false);
    expect(ephemeralSettingHelp).toStrictEqual(getSettingHelp());
  });

  it('rejects unknown keys with the supported setting names', () => {
    const parsed = parseEphemeralSettingValue('unknown-setting', '1');
    expect(parsed.success).toBe(false);
    if (parsed.success) throw new Error('Unknown setting was accepted');
    expect(parsed.message).toContain('Invalid setting key: unknown-setting');
    expect(parsed.message).toContain('context-limit');
    expect(isValidEphemeralSetting('unknown-setting', 1)).toBe(false);
  });

  it('parses typed values and rejects invalid values before owner mutation', () => {
    expect(parseEphemeralSettingValue('context-limit', '32000')).toStrictEqual({
      success: true,
      value: 32000,
    });
    expect(parseEphemeralSettingValue('authOnly', 'false')).toStrictEqual({
      success: true,
      value: false,
    });
    expect(parseEphemeralSettingValue('streaming', 'maybe').success).toBe(
      false,
    );
  });
});
