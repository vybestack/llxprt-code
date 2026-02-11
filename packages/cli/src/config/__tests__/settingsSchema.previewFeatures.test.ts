/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { SETTINGS_SCHEMA } from '../settingsSchema.js';

describe('settingsSchema previewFeatures removal', () => {
  it('previewFeatures setting is removed from schema', () => {
    expect(
      (SETTINGS_SCHEMA as Record<string, unknown>)['previewFeatures'],
    ).toBeUndefined();
  });
});
