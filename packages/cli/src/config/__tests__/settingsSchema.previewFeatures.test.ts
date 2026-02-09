/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { SETTINGS_SCHEMA } from '../settingsSchema.js';

describe('settingsSchema previewFeatures', () => {
  it('previewFeatures setting exists in the schema', () => {
    expect(SETTINGS_SCHEMA.previewFeatures).toBeDefined();
  });

  it('previewFeatures has type boolean', () => {
    expect(SETTINGS_SCHEMA.previewFeatures.type).toBe('boolean');
  });

  it('previewFeatures defaults to false', () => {
    expect(SETTINGS_SCHEMA.previewFeatures.default).toBe(false);
  });

  it('previewFeatures requires restart', () => {
    expect(SETTINGS_SCHEMA.previewFeatures.requiresRestart).toBe(true);
  });

  it('previewFeatures is shown in dialog', () => {
    expect(SETTINGS_SCHEMA.previewFeatures.showInDialog).toBe(true);
  });

  it('previewFeatures has category General', () => {
    expect(SETTINGS_SCHEMA.previewFeatures.category).toBe('General');
  });
});
