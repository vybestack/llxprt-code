/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #4093: `stream-timeout-retries` is a profile-persistable ephemeral
 * setting. `/set` reaches it through `parseEphemeralSettingValue`, so the
 * tests drive that entry point with the raw text a user types.
 */

import { describe, expect, it } from 'bun:test';
import { parseEphemeralSettingValue } from '../settings/ephemeral-settings.js';
import {
  getProfilePersistableKeys,
  getSettingSpec,
  separateSettings,
} from '../settings/settingsRegistry.js';

const KEY = 'stream-timeout-retries';

describe('stream-timeout-retries (issue #4093)', () => {
  it('persists into profiles and declares a default of 2', () => {
    expect(getSettingSpec(KEY)?.persistToProfile).toBe(true);
    expect(getProfilePersistableKeys()).toContain(KEY);
    expect(getSettingSpec(KEY)?.default).toBe(2);
  });

  it('stays out of model parameters', () => {
    const separated = separateSettings({ [KEY]: 3 });

    expect(separated.modelParams).toStrictEqual({});
    expect(separated.cliSettings).toMatchObject({ [KEY]: 3 });
  });

  it('accepts the whole range 0 to 10', () => {
    for (const raw of ['0', '2', '10']) {
      const result = parseEphemeralSettingValue(KEY, raw);
      expect(result).toStrictEqual({ success: true, value: Number(raw) });
    }
  });

  it('rejects values outside the range and non-integers', () => {
    for (const raw of ['-1', '11', '1.5', 'many']) {
      expect(parseEphemeralSettingValue(KEY, raw).success).toBe(false);
    }
  });
});
