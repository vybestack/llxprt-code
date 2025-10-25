/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  applyCliSetArguments,
  EphemeralSettingTarget,
} from './cliEphemeralSettings.js';

class TestTarget implements EphemeralSettingTarget {
  private readonly values = new Map<string, unknown>();

  setEphemeralSetting(key: string, value: unknown): void {
    this.values.set(key, value);
  }

  getValue(key: string): unknown {
    return this.values.get(key);
  }
}

describe('applyCliSetArguments', () => {
  it('applies parsed values for valid key=value pairs', () => {
    const target = new TestTarget();

    applyCliSetArguments(target, [
      'context-limit=32000',
      'tool-output-max-tokens=4096',
    ]);

    expect(target.getValue('context-limit')).toBe(32000);
    expect(target.getValue('tool-output-max-tokens')).toBe(4096);
  });

  it('throws if an entry is missing the "=" separator', () => {
    const target = new TestTarget();

    expect(() => applyCliSetArguments(target, ['context-limit32000'])).toThrow(
      /expected key=value/i,
    );
  });

  it('throws if the key is not a supported ephemeral setting', () => {
    const target = new TestTarget();

    expect(() => applyCliSetArguments(target, ['unknown-setting=1'])).toThrow(
      /unknown-setting/,
    );
  });
});
