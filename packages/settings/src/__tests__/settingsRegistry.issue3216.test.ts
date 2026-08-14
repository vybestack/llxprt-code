/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #3216 — Configurable hard image budget settings.
 *
 * `max-image-dimension` and `max-image-pixels` are overridable ephemeral
 * settings that define a provider/model-specific hard limit enforced before
 * image bytes reach a model. These tests prove the registry accepts positive
 * integers, rejects invalid values, persists through profiles, and exposes the
 * keys through the standard registry surface.
 */

import { describe, it, expect } from 'bun:test';
import {
  getSettingSpec,
  validateSetting,
  getProfilePersistableKeys,
  getAllSettingKeys,
} from '../settings/settingsRegistry.js';

describe('max-image-dimension (@issue:3216)', () => {
  it('is registered as a number setting', () => {
    const spec = getSettingSpec('max-image-dimension');
    expect(spec).toBeDefined();
    expect(spec!.type).toBe('number');
    expect(spec!.persistToProfile).toBe(true);
  });

  it('accepts a positive integer', () => {
    const result = validateSetting('max-image-dimension', 2000);
    expect(result.success).toBe(true);
    expect(result.value).toBe(2000);
  });

  it('rejects zero, negatives, non-integers, and non-numbers', () => {
    expect(validateSetting('max-image-dimension', 0).success).toBe(false);
    expect(validateSetting('max-image-dimension', -5).success).toBe(false);
    expect(validateSetting('max-image-dimension', 1.5).success).toBe(false);
    expect(validateSetting('max-image-dimension', 'big').success).toBe(false);
  });

  it('appears in profile-persistable keys and all setting keys', () => {
    expect(getProfilePersistableKeys()).toContain('max-image-dimension');
    expect(getAllSettingKeys()).toContain('max-image-dimension');
  });
});

describe('max-image-pixels (@issue:3216)', () => {
  it('is registered as a number setting', () => {
    const spec = getSettingSpec('max-image-pixels');
    expect(spec).toBeDefined();
    expect(spec!.type).toBe('number');
    expect(spec!.persistToProfile).toBe(true);
  });

  it('accepts a positive integer', () => {
    const result = validateSetting('max-image-pixels', 4_000_000);
    expect(result.success).toBe(true);
    expect(result.value).toBe(4_000_000);
  });

  it('rejects zero, negatives, non-integers, and non-numbers', () => {
    expect(validateSetting('max-image-pixels', 0).success).toBe(false);
    expect(validateSetting('max-image-pixels', -1).success).toBe(false);
    expect(validateSetting('max-image-pixels', 2.5).success).toBe(false);
    expect(validateSetting('max-image-pixels', false).success).toBe(false);
  });

  it('appears in profile-persistable keys and all setting keys', () => {
    expect(getProfilePersistableKeys()).toContain('max-image-pixels');
    expect(getAllSettingKeys()).toContain('max-image-pixels');
  });
});
