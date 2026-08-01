/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @issue #2896 - Behavioral tests for settings-registry numeric coercion
 * (Bug 1, acceptance rows A7/A8) and reasoning-dialect leak prevention
 * (Bug 2, acceptance rows B1/B2).
 */

import { describe, it, expect } from 'vitest';
import {
  separateSettings,
  normalizeSetting,
  parseSetting,
} from '../settings/settingsRegistry.js';

describe('issue #2896 A7: legacy-profile numeric repair at egress', () => {
  it('coerces a string ".95" to the number 0.95 for top_p through separateSettings', () => {
    const result = separateSettings({ top_p: '.95' }, 'openai');
    expect(result.modelParams.top_p).toBe(0.95);
    expect(typeof result.modelParams.top_p).toBe('number');
  });

  it('coerces a numeric string for temperature through separateSettings', () => {
    const result = separateSettings({ temperature: '0.7' }, 'openai');
    expect(result.modelParams.temperature).toBe(0.7);
    expect(typeof result.modelParams.temperature).toBe('number');
  });

  it('coerces a leading-dot numeric string via normalizeSetting directly', () => {
    expect(normalizeSetting('top_p', '.95')).toBe(0.95);
    expect(normalizeSetting('temperature', '-0.5')).toBe(-0.5);
  });
});

describe('issue #2896 A8: non-numeric strings are not silently dropped', () => {
  it('leaves a non-numeric string "abc" untouched for top_p', () => {
    expect(normalizeSetting('top_p', 'abc')).toBe('abc');
    const result = separateSettings({ top_p: 'abc' }, 'openai');
    expect(result.modelParams.top_p).toBe('abc');
  });

  it('does not coerce empty string to a number', () => {
    expect(normalizeSetting('top_p', '')).toBe('');
  });

  it('does not coerce "Infinity"', () => {
    expect(normalizeSetting('top_p', 'Infinity')).toBe('Infinity');
  });

  it('does not coerce "NaN"', () => {
    expect(normalizeSetting('top_p', 'NaN')).toBe('NaN');
  });

  it('does not coerce "0x10"', () => {
    expect(normalizeSetting('top_p', '0x10')).toBe('0x10');
  });

  it('does not coerce a numeric string that overflows to Infinity', () => {
    // '1e400' is syntactically a number but Number('1e400') === Infinity,
    // which JSON-serializes to null. The guard must preserve the string so
    // the provider rejects it visibly instead.
    expect(normalizeSetting('top_p', '1e400')).toBe('1e400');
    expect(normalizeSetting('temperature', '-1e400')).toBe('-1e400');
  });
});

describe('issue #2896: parseSetting keeps the same finite invariant as egress', () => {
  it('parses ordinary numeric input for a number-typed param', () => {
    expect(parseSetting('top_p', '.95')).toBe(0.95);
    expect(parseSetting('max_tokens', '32000')).toBe(32000);
  });

  it.each(['abc', '', 'Infinity', 'NaN', '0x10', '0o10', '1_000', ' 1 ', '1.'])(
    'leaves %j alone at ingress, exactly as normalizeSetting does at egress',
    (raw) => {
      expect(parseSetting('top_p', raw)).toBe(raw);
      expect(normalizeSetting('top_p', raw)).toBe(raw);
    },
  );

  it('does not admit an overflow literal as Infinity at ingress', () => {
    // Number('1e400') is Infinity, which JSON-serializes to null. Admitting it
    // here would bypass the egress guard, so a stored value never becomes an
    // unusable request parameter.
    expect(parseSetting('top_p', '1e400')).not.toBe(Number.POSITIVE_INFINITY);
    expect(parseSetting('top_p', '-1e400')).not.toBe(Number.NEGATIVE_INFINITY);
  });
});

describe('issue #2896 B1: reasoning.* must not fan out into modelParams', () => {
  it('removes all registered reasoning sub-keys from the retained container', () => {
    const result = separateSettings(
      { reasoning: { enabled: true, effort: 'high' } },
      'openai',
    );
    expect(result.modelParams.reasoning).toBeUndefined();
    expect(result.modelBehavior['reasoning.enabled']).toBe(true);
    expect(result.modelBehavior['reasoning.effort']).toBe('high');
  });

  it('deletes the reasoning container entirely when all sub-keys are registered', () => {
    const result = separateSettings(
      { reasoning: { enabled: true, effort: 'high', maxTokens: 4096 } },
      'openai',
    );
    expect(result.modelParams.reasoning).toBeUndefined();
  });
});

describe('issue #2896 B2: unregistered sub-keys pass through', () => {
  it('preserves an unregistered sub-key (exclude) in the reasoning container', () => {
    const result = separateSettings(
      { reasoning: { enabled: true, exclude: true } },
      'openai',
    );
    // enabled is registered -> stripped from container and sent to modelBehavior
    expect(result.modelBehavior['reasoning.enabled']).toBe(true);
    // exclude is unregistered -> survives in the retained container
    expect(result.modelParams.reasoning).toStrictEqual({ exclude: true });
  });

  it('emits only the container when all sub-keys are unregistered', () => {
    const result = separateSettings({ reasoning: { exclude: true } }, 'openai');
    expect(result.modelParams.reasoning).toStrictEqual({ exclude: true });
  });

  it.each([true, 'high', 42, null, ['high']])(
    'does not throw when reasoning is the non-object value %j',
    (value) => {
      expect(() =>
        separateSettings({ reasoning: value }, 'openai'),
      ).not.toThrow();
    },
  );
});
