/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { SETTINGS_SCHEMA } from './settingsSchema.js';

describe('dump retention settings', () => {
  it('defines positive user-level caps with the planned defaults', () => {
    const retention = SETTINGS_SCHEMA.dumpRetention;

    expect(retention.default).toStrictEqual({
      maxBytes: 2_147_483_648,
      maxAgeDays: 14,
    });
    expect(retention.requiresRestart).toBe(true);
    expect(retention.properties.maxBytes).toMatchObject({
      type: 'number',
      minimum: 1,
      multipleOf: 1,
      default: 2_147_483_648,
    });
    expect(retention.properties.maxAgeDays).toMatchObject({
      type: 'number',
      minimum: Number.MIN_VALUE,
      default: 14,
    });
  });
});
