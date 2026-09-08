/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import {
  getProfilePersistableKeys,
  getSettingSpec,
  validateSetting,
} from '../settings/settingsRegistry.js';

const MEDIA_BUDGET_DEFAULTS = {
  'image-payload-budget-bytes': 15 * 1024 * 1024,
  'media-store-quota-bytes': 4 * 1024 * 1024 * 1024,
  'session-recording-queue-max-bytes': 16 * 1024 * 1024,
  'session-persistence-queue-max-bytes': 16 * 1024 * 1024,
} as const;

describe('issue 3199 media settings', () => {
  it('registers finite non-negative integer budgets with one profile-visible default', () => {
    for (const [key, expectedDefault] of Object.entries(
      MEDIA_BUDGET_DEFAULTS,
    )) {
      expect(getSettingSpec(key)).toMatchObject({
        key,
        type: 'number',
        default: expectedDefault,
        persistToProfile: true,
      });
      expect(validateSetting(key, 0)).toStrictEqual({
        success: true,
        value: 0,
      });
    }
  });

  it('rejects malformed and non-finite media budgets without coercion', () => {
    const malformedValues: readonly unknown[] = [
      -1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.MAX_SAFE_INTEGER + 1,
      '1048576',
      null,
    ];

    for (const key of Object.keys(MEDIA_BUDGET_DEFAULTS)) {
      for (const value of malformedValues) {
        expect(validateSetting(key, value).success).toBe(false);
      }
    }
  });

  it('persists every media policy and budget through the registry profile path', () => {
    const persistable = new Set(getProfilePersistableKeys());
    const mediaKeys = [
      ...Object.keys(MEDIA_BUDGET_DEFAULTS),
      'provider-files',
      'provider-files-retention-ms',
      'provider-files-delete',
      'provider-files-zdr',
      'media.semantic-purge',
    ];

    for (const key of mediaKeys) {
      expect(persistable.has(key)).toBe(true);
    }
  });

  it('accepts only exact semantic purge modes', () => {
    for (const mode of ['off', 'remove', 'summary']) {
      expect(validateSetting('media.semantic-purge', mode)).toStrictEqual({
        success: true,
        value: mode,
      });
    }

    for (const malformed of ['REMOVE', '', true, { mode: 'remove' }]) {
      expect(validateSetting('media.semantic-purge', malformed).success).toBe(
        false,
      );
    }
  });
});
