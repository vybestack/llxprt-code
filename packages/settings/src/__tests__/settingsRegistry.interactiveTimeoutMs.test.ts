/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';

import {
  getSettingSpec,
  validateSetting,
} from '../settings/settingsRegistry.js';

/**
 * @plan PLAN-20260827-ISSUE2562.P03
 * @requirement REQ-2562-4
 */
describe('interactive authentication timeout registry setting', () => {
  const key = 'auth.interactiveTimeoutMs';

  it('registers the numeric setting with the session timeout default', () => {
    const spec = getSettingSpec(key);

    expect(spec).toBeDefined();
    expect(spec?.type).toBe('number');
    expect(spec?.default).toBe(1_200_000);
  });

  it('accepts numeric timeout values', () => {
    expect(validateSetting(key, 45_000)).toStrictEqual({
      success: true,
      value: 45_000,
    });
  });
});
