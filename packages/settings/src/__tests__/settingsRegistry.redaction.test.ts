/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import {
  redactSensitiveValues,
  REDACTED_VALUE,
} from '../settings/settingsRegistry.js';

describe('redactSensitiveValues', () => {
  it('redacts the canonical auth-key setting', () => {
    expect(redactSensitiveValues({ 'auth-key': 'secret' })).toStrictEqual({
      'auth-key': REDACTED_VALUE,
    });
  });

  it('no longer redacts legacy auth-key spellings (#2533 C1: migrated at load)', () => {
    // Legacy spellings are not registry keys anymore; they are rewritten to
    // 'auth-key' by migrateLegacySettingKeys before values reach storage.
    // After migration the canonical key is what gets redacted.
    expect(
      redactSensitiveValues({ apiKey: 'first', 'api-key': 'second' }),
    ).toStrictEqual({
      apiKey: 'first',
      'api-key': 'second',
    });
  });

  it('redacts a dotted provider auth-key event path', () => {
    expect(
      redactSensitiveValues({ 'providers.openai.auth-key': 'secret' }),
    ).toStrictEqual({
      'providers.openai.auth-key': REDACTED_VALUE,
    });
  });

  it('preserves non-sensitive values without mutating the input', () => {
    const input = { model: 'gpt-4', 'base-url': 'https://example.com' };
    const result = redactSensitiveValues(input);

    expect({ input, result }).toStrictEqual({
      input: { model: 'gpt-4', 'base-url': 'https://example.com' },
      result: { model: 'gpt-4', 'base-url': 'https://example.com' },
    });
  });
});
