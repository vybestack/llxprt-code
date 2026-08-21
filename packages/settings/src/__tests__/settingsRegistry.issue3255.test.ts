/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import {
  getProfilePersistableKeys,
  getSettingSpec,
  parseSetting,
  separateSettings,
  validateSetting,
} from '../settings/settingsRegistry.js';

const EFFORT_WIRE_FORMATS = [
  'auto',
  'openai',
  'openai-responses',
  'anthropic',
  'anthropic-budget',
  'openrouter',
  'gemini',
  'template-kwargs',
  'none',
] as const;

const ENABLED_WIRE_FORMATS = [
  'auto',
  'openai',
  'openai-responses',
  'openrouter',
  'thinking',
  'gemini',
  'template-kwargs',
  'none',
] as const;

const REASONING_WIRE_SETTING_KEYS = [
  'reasoning.effortWireFormat',
  'reasoning.enabledWireFormat',
  'reasoning.effortMap',
  'reasoning.enabledMap',
] as const;

describe('reasoning wire settings registry contract', () => {
  it('parses and validates every effort wire format', () => {
    for (const wireFormat of EFFORT_WIRE_FORMATS) {
      const parsed = parseSetting('reasoning.effortWireFormat', wireFormat);
      expect(
        validateSetting('reasoning.effortWireFormat', parsed),
      ).toStrictEqual({
        success: true,
        value: wireFormat,
      });
    }
  });

  it('parses and validates every enabled wire format', () => {
    for (const wireFormat of ENABLED_WIRE_FORMATS) {
      const parsed = parseSetting('reasoning.enabledWireFormat', wireFormat);
      expect(
        validateSetting('reasoning.enabledWireFormat', parsed),
      ).toStrictEqual({ success: true, value: wireFormat });
    }
  });

  it('rejects unsupported wire formats', () => {
    expect(
      validateSetting('reasoning.effortWireFormat', 'custom'),
    ).toMatchObject({ success: false });
    expect(
      validateSetting('reasoning.enabledWireFormat', 'anthropic'),
    ).toMatchObject({ success: false });
  });

  it('rejects whitespace-padded wire formats without trimming', () => {
    expect(
      validateSetting('reasoning.effortWireFormat', ' openai '),
    ).toMatchObject({ success: false });
    expect(
      validateSetting('reasoning.enabledWireFormat', ' thinking '),
    ).toMatchObject({ success: false });
  });

  it('parses and validates an effort map with every allowed key and value type', () => {
    const parsed = parseSetting(
      'reasoning.effortMap',
      '{"minimal":"none","low":1024,"medium":2048,"high":"high","xhigh":null,"max":8192}',
    );

    expect(validateSetting('reasoning.effortMap', parsed)).toStrictEqual({
      success: true,
      value: {
        minimal: 'none',
        low: 1024,
        medium: 2048,
        high: 'high',
        xhigh: null,
        max: 8192,
      },
    });
  });

  it('rejects invalid effort maps', () => {
    const invalidMaps: readonly unknown[] = [
      null,
      undefined,
      [],
      { ultra: 'high' },
      { low: '' },
      { low: 1023 },
      { low: 1024.5 },
      { low: true },
    ];

    for (const invalidMap of invalidMaps) {
      expect(validateSetting('reasoning.effortMap', invalidMap)).toMatchObject({
        success: false,
      });
    }
  });

  it('rejects non-plain effort and enabled map objects', () => {
    class CustomReasoningMap {
      readonly low = 'high';
    }
    const nonPlainObjects: readonly unknown[] = [
      new CustomReasoningMap(),
      new Map([['low', 'high']]),
      new Set(['low']),
      new Date(0),
    ];

    for (const nonPlainObject of nonPlainObjects) {
      expect(
        validateSetting('reasoning.effortMap', nonPlainObject),
      ).toMatchObject({ success: false });
      expect(
        validateSetting('reasoning.enabledMap', nonPlainObject),
      ).toMatchObject({ success: false });
    }
  });

  it('parses and validates an enabled map with every allowed key and value type', () => {
    const parsed = parseSetting(
      'reasoning.enabledMap',
      '{"true":"adaptive","false":null}',
    );

    expect(validateSetting('reasoning.enabledMap', parsed)).toStrictEqual({
      success: true,
      value: { true: 'adaptive', false: null },
    });
    expect(
      validateSetting('reasoning.enabledMap', { true: true, false: false }),
    ).toStrictEqual({
      success: true,
      value: { true: true, false: false },
    });
  });

  it('rejects invalid enabled maps', () => {
    const invalidMaps: readonly unknown[] = [
      null,
      undefined,
      [],
      { enabled: true },
      { true: 1 },
      { false: '' },
    ];

    for (const invalidMap of invalidMaps) {
      expect(validateSetting('reasoning.enabledMap', invalidMap)).toMatchObject(
        {
          success: false,
        },
      );
    }
  });

  it('classifies all four settings as model behavior without dotted-name leakage', () => {
    const settings = {
      'reasoning.effortWireFormat': 'openai',
      'reasoning.enabledWireFormat': 'thinking',
      'reasoning.effortMap': { minimal: 'low' },
      'reasoning.enabledMap': { true: 'enabled' },
    };

    const separated = separateSettings(settings, 'openai');

    expect(separated.modelBehavior).toStrictEqual(settings);
    expect(separated.modelParams).toStrictEqual({});
  });

  it('removes nested reasoning wire settings from the reasoning model parameter', () => {
    const separated = separateSettings({
      reasoning: {
        effortWireFormat: 'template-kwargs',
        enabledWireFormat: 'template-kwargs',
        effortMap: { low: 'low' },
        enabledMap: { false: null },
        exclude: true,
      },
    });

    expect(separated.modelBehavior).toStrictEqual({
      'reasoning.effortWireFormat': 'template-kwargs',
      'reasoning.enabledWireFormat': 'template-kwargs',
      'reasoning.effortMap': { low: 'low' },
      'reasoning.enabledMap': { false: null },
    });
    expect(separated.modelParams).toStrictEqual({
      reasoning: { exclude: true },
    });
  });

  it('marks all four settings as profile-persistable', () => {
    const persistableKeys = getProfilePersistableKeys();

    for (const key of REASONING_WIRE_SETTING_KEYS) {
      expect(persistableKeys).toContain(key);
    }
  });

  it('declares exactly the effort wire formats this test accepts', () => {
    const spec = getSettingSpec('reasoning.effortWireFormat');

    expect(new Set(spec?.enumValues)).toEqual(new Set(EFFORT_WIRE_FORMATS));
    expect(spec?.enumValues?.length).toBe(EFFORT_WIRE_FORMATS.length);
  });

  it('declares exactly the enabled wire formats this test accepts', () => {
    const spec = getSettingSpec('reasoning.enabledWireFormat');

    expect(new Set(spec?.enumValues)).toEqual(new Set(ENABLED_WIRE_FORMATS));
    expect(spec?.enumValues?.length).toBe(ENABLED_WIRE_FORMATS.length);
  });

  it('registers all four settings as profile-persistable model behavior', () => {
    for (const key of REASONING_WIRE_SETTING_KEYS) {
      expect(getSettingSpec(key)).toMatchObject({
        key,
        category: 'model-behavior',
        persistToProfile: true,
      });
    }
  });
});
