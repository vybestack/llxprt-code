/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import {
  REASONING_EFFORTS,
  readEffortMap,
  readEffortWireFormat,
  readEnabledMap,
  readEnabledWireFormat,
  readModelBehaviorRecord,
  readOptionalBoolean,
  readOptionalEffort,
  readOptionalPositiveInteger,
  selectBehaviorValue,
} from './reasoning-behavior-parsing.js';

describe('readModelBehaviorRecord: invocation snapshot contract', () => {
  it('reads a missing record as empty', () => {
    expect(readModelBehaviorRecord(undefined)).toStrictEqual({});
  });

  it('accepts a plain JSON record unchanged', () => {
    const record = { 'reasoning.effort': 'high', unrelated: 1 };
    expect(readModelBehaviorRecord(record)).toStrictEqual(record);
  });

  it('accepts a null-prototype record like structured JSON input', () => {
    const record = Object.create(null) as Record<string, unknown>;
    record['reasoning.enabled'] = true;
    expect(readModelBehaviorRecord(record)).toStrictEqual({
      'reasoning.enabled': true,
    });
  });

  it.each([
    ['an array', ['reasoning.effort']],
    ['a Map instance', new Map([['reasoning.effort', 'high']])],
    [
      'a class instance',
      new (class ModelBehavior {
        readonly effort = 'high';
      })(),
    ],
    ['null', null],
    ['a string', 'reasoning'],
  ])('rejects %s as the model behavior record', (_label, value) => {
    expect(() => readModelBehaviorRecord(value)).toThrow(
      'invocation model behavior must be a JSON object',
    );
  });
});

describe('readEffortMap: generic effort map contract', () => {
  it('reads an absent map as undefined', () => {
    expect(readEffortMap(undefined)).toBeUndefined();
  });

  it('accepts an empty plain record', () => {
    expect(readEffortMap({})).toStrictEqual({});
  });

  it('accepts string, numeric, and null values for known efforts', () => {
    expect(readEffortMap({ low: 'low', high: 8192, max: null })).toStrictEqual({
      low: 'low',
      high: 8192,
      max: null,
    });
  });

  it('rejects an unknown effort key', () => {
    expect(() => readEffortMap({ turbo: 'high' })).toThrow(
      "reasoning.effortMap contains unsupported key 'turbo'",
    );
  });

  it.each([
    ['an array', ['high']],
    ['a Map instance', new Map([['high', 'max']])],
    [
      'a class instance',
      new (class EffortMap {
        readonly high = 'max';
      })(),
    ],
  ])('rejects %s as an effort map', (_label, value) => {
    expect(() => readEffortMap(value)).toThrow(
      'reasoning.effortMap must be a JSON object',
    );
  });

  it('trims surrounding whitespace from a mapped string', () => {
    expect(readEffortMap({ high: ' max ' })).toStrictEqual({ high: 'max' });
  });

  it('rejects a whitespace-only mapped string', () => {
    expect(() => readEffortMap({ high: '   ' })).toThrow(
      'reasoning.effortMap values must be non-empty strings, integer budgets of at least 1024, or null',
    );
  });

  it('accepts a mapped budget at the 1024 floor', () => {
    expect(readEffortMap({ high: 1024 })).toStrictEqual({ high: 1024 });
  });

  it.each([
    ['below the floor', 1023],
    ['a small integer', 64],
    ['a non-integer number', 2048.5],
    ['a boolean', true],
  ])('rejects a mapped budget %s', (_label, value) => {
    expect(() => readEffortMap({ high: value })).toThrow(
      'reasoning.effortMap values must be non-empty strings, integer budgets of at least 1024, or null',
    );
  });
});

describe('readEnabledMap: generic enablement map contract', () => {
  it('reads an absent map as undefined', () => {
    expect(readEnabledMap(undefined)).toBeUndefined();
  });

  it('accepts string, boolean, and null values for true and false', () => {
    expect(readEnabledMap({ true: 'enabled', false: false })).toStrictEqual({
      true: 'enabled',
      false: false,
    });
    expect(readEnabledMap({ true: null })).toStrictEqual({ true: null });
  });

  it('rejects an unknown enablement key', () => {
    expect(() => readEnabledMap({ maybe: true })).toThrow(
      "reasoning.enabledMap contains unsupported key 'maybe'",
    );
  });

  it.each([
    ['an array', ['true']],
    ['a Map instance', new Map([['true', 'enabled']])],
  ])('rejects %s as an enabled map', (_label, value) => {
    expect(() => readEnabledMap(value)).toThrow(
      'reasoning.enabledMap must be a JSON object',
    );
  });

  it('trims surrounding whitespace from a mapped string', () => {
    expect(readEnabledMap({ true: ' enabled ' })).toStrictEqual({
      true: 'enabled',
    });
  });

  it.each([
    ['a whitespace-only string', '   '],
    ['a number', 1],
  ])('rejects a mapped enablement value %s', (_label, value) => {
    expect(() => readEnabledMap({ true: value })).toThrow(
      'reasoning.enabledMap values must be non-empty strings, booleans, or null',
    );
  });
});

describe('readOptionalEffort: generic effort validation', () => {
  it('reads an absent effort as undefined', () => {
    expect(readOptionalEffort(undefined)).toBeUndefined();
  });

  it.each([...REASONING_EFFORTS])('accepts the generic effort %s', (effort) => {
    expect(readOptionalEffort(effort)).toBe(effort);
  });

  it.each([
    ['an unknown effort', 'ultra'],
    ['an uppercase effort', 'HIGH'],
    ['a number', 3],
  ])('rejects %s', (_label, value) => {
    expect(() => readOptionalEffort(value)).toThrow(
      "reasoning.effort must be one of 'minimal', 'low', 'medium', 'high', 'xhigh', or 'max'",
    );
  });
});

describe('wire-format selector validation', () => {
  it('defaults an absent effort selector to auto', () => {
    expect(readEffortWireFormat(undefined)).toBe('auto');
  });

  it.each([
    'auto',
    'openai',
    'openai-responses',
    'anthropic',
    'anthropic-budget',
    'openrouter',
    'gemini',
    'template-kwargs',
    'none',
  ])('accepts the effort wire format %s', (format) => {
    expect(readEffortWireFormat(format)).toBe(format);
  });

  it.each(['custom', 'OpenAI', 7])(
    'rejects an invalid effort wire format %s',
    (value) => {
      expect(() => readEffortWireFormat(value)).toThrow(
        "reasoning.effortWireFormat must be one of 'auto', 'openai', 'openai-responses', 'anthropic', 'anthropic-budget', 'openrouter', 'gemini', 'template-kwargs', or 'none'",
      );
    },
  );

  it('defaults an absent enabled selector to auto', () => {
    expect(readEnabledWireFormat(undefined)).toBe('auto');
  });

  it.each([
    'auto',
    'openai',
    'openai-responses',
    'openrouter',
    'thinking',
    'gemini',
    'template-kwargs',
    'none',
  ])('accepts the enabled wire format %s', (format) => {
    expect(readEnabledWireFormat(format)).toBe(format);
  });

  it.each(['custom', 'Thinking', null])(
    'rejects an invalid enabled wire format %s',
    (value) => {
      expect(() => readEnabledWireFormat(value)).toThrow(
        "reasoning.enabledWireFormat must be one of 'auto', 'openai', 'openai-responses', 'openrouter', 'thinking', 'gemini', 'template-kwargs', or 'none'",
      );
    },
  );
});

describe('scalar behavior readers', () => {
  it('reads an optional boolean strictly', () => {
    expect(readOptionalBoolean(undefined, 'reasoning.enabled')).toBeUndefined();
    expect(readOptionalBoolean(true, 'reasoning.enabled')).toBe(true);
    expect(() => readOptionalBoolean('true', 'reasoning.enabled')).toThrow(
      'reasoning.enabled must be a boolean',
    );
  });

  it('reads an optional positive integer strictly', () => {
    expect(
      readOptionalPositiveInteger(undefined, 'reasoning.maxTokens'),
    ).toBeUndefined();
    expect(readOptionalPositiveInteger(4096, 'reasoning.maxTokens')).toBe(4096);
    expect(() => readOptionalPositiveInteger(0, 'reasoning.maxTokens')).toThrow(
      'reasoning.maxTokens must be a positive integer',
    );
    expect(() =>
      readOptionalPositiveInteger(1.5, 'reasoning.maxTokens'),
    ).toThrow('reasoning.maxTokens must be a positive integer');
  });
});

describe('selectBehaviorValue: model behavior precedence', () => {
  const modelBehavior: Readonly<Record<string, unknown>> = {
    'reasoning.effort': 'high',
  };

  it('lets the model behavior record win over the fallback', () => {
    expect(selectBehaviorValue(modelBehavior, 'reasoning.effort', 'low')).toBe(
      'high',
    );
  });

  it('falls through to the fallback when the key is absent', () => {
    expect(
      selectBehaviorValue(modelBehavior, 'reasoning.summary', 'auto'),
    ).toBe('auto');
  });

  it('falls through only on undefined, preserving explicit false and null', () => {
    const behavior: Readonly<Record<string, unknown>> = {
      'reasoning.enabled': false,
      'reasoning.effortMap': null,
    };
    expect(selectBehaviorValue(behavior, 'reasoning.enabled', true)).toBe(
      false,
    );
    expect(
      selectBehaviorValue(behavior, 'reasoning.effortMap', { high: 'high' }),
    ).toBeNull();
  });
});
