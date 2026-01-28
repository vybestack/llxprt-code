/**
 * @plan PLAN-20260126-SETTINGS-SEPARATION.P04
 * @requirement REQ-SEP-001, REQ-SEP-002, REQ-SEP-003, REQ-SEP-008, REQ-SEP-009, REQ-SEP-012
 *
 * RED phase of TDD: All tests written FIRST and FAIL because stubs throw "Not yet implemented"
 * These tests define the expected behavior of the settings registry functions.
 * Each test has a SINGLE assertion per dev-docs/RULES.md.
 */

import { describe, it, expect } from 'vitest';
import {
  resolveAlias,
  separateSettings,
  getSettingSpec,
  getProfilePersistableKeys,
  getSettingHelp,
  validateSetting,
} from '../settingsRegistry.js';

describe('resolveAlias', () => {
  it('resolves max-tokens alias to max_tokens', () => {
    expect(resolveAlias('max-tokens')).toBe('max_tokens');
  });

  it('resolves maxTokens alias to max_tokens', () => {
    expect(resolveAlias('maxTokens')).toBe('max_tokens');
  });

  it('resolves response-format alias to response_format', () => {
    expect(resolveAlias('response-format')).toBe('response_format');
  });

  it('resolves tool-choice alias to tool_choice', () => {
    expect(resolveAlias('tool-choice')).toBe('tool_choice');
  });

  it('preserves user-agent without underscore conversion', () => {
    expect(resolveAlias('user-agent')).toBe('user-agent');
  });

  it('returns temperature unchanged (already canonical)', () => {
    expect(resolveAlias('temperature')).toBe('temperature');
  });

  it('resolves disabled-tools alias to tools.disabled', () => {
    expect(resolveAlias('disabled-tools')).toBe('tools.disabled');
  });
});

describe('separateSettings', () => {
  it('places shell-replacement in cliSettings', () => {
    const result = separateSettings({ 'shell-replacement': 'none' });

    expect(result.cliSettings['shell-replacement']).toBe('none');
  });

  it('places temperature in modelParams', () => {
    const result = separateSettings({ temperature: 0.7 });

    expect(result.modelParams.temperature).toBe(0.7);
  });

  it('places reasoning.enabled in modelBehavior', () => {
    const result = separateSettings({ 'reasoning.enabled': true });

    expect(result.modelBehavior['reasoning.enabled']).toBe(true);
  });

  it('extracts X-Foo header from custom-headers to customHeaders', () => {
    const result = separateSettings({
      'custom-headers': { 'X-Foo': 'bar' },
    });

    expect(result.customHeaders['X-Foo']).toBe('bar');
  });

  it('does not include apiKey in any output bucket (provider-config filtered)', () => {
    const result = separateSettings({ apiKey: 'sk-123' });

    expect(result.cliSettings.apiKey).toBeUndefined();
  });

  it('does not include apiKey in modelParams', () => {
    const result = separateSettings({ apiKey: 'sk-123' });

    expect(result.modelParams.apiKey).toBeUndefined();
  });

  it('places unknown key in modelParams (pass-through to API)', () => {
    const result = separateSettings({ unknownKey: 'val' });

    expect(result.modelParams.unknownKey).toBe('val');
  });

  it('places max-tokens as max_tokens in modelParams after alias resolution', () => {
    const result = separateSettings({ 'max-tokens': 4096 });

    expect(result.modelParams.max_tokens).toBe(4096);
  });

  it('excludes seed from modelParams when provider is anthropic', () => {
    const result = separateSettings({ seed: 42 }, 'anthropic');

    expect(result.modelParams.seed).toBeUndefined();
  });

  it('includes seed in modelParams when provider is openai', () => {
    const result = separateSettings({ seed: 42 }, 'openai');

    expect(result.modelParams.seed).toBe(42);
  });
});

describe('getSettingSpec', () => {
  it('returns spec with category model-param for temperature', () => {
    const spec = getSettingSpec('temperature');

    expect(spec?.category).toBe('model-param');
  });

  it('returns spec with category cli-behavior for shell-replacement', () => {
    const spec = getSettingSpec('shell-replacement');

    expect(spec?.category).toBe('cli-behavior');
  });

  it('returns undefined for nonexistent key', () => {
    const spec = getSettingSpec('nonexistent');

    expect(spec).toBeUndefined();
  });
});

describe('getProfilePersistableKeys', () => {
  it('includes reasoning.enabled in persistable keys', () => {
    const keys = getProfilePersistableKeys();

    expect(keys).toContain('reasoning.enabled');
  });

  it('includes temperature in persistable keys', () => {
    const keys = getProfilePersistableKeys();

    expect(keys).toContain('temperature');
  });

  it('does not include apiKey (persistToProfile: false)', () => {
    const keys = getProfilePersistableKeys();

    expect(keys).not.toContain('apiKey');
  });
});

describe('getSettingHelp', () => {
  it('returns object with key shell-replacement', () => {
    const help = getSettingHelp();

    expect(help['shell-replacement']).toBeTruthy();
  });

  it('returns non-empty description for shell-replacement', () => {
    const help = getSettingHelp();

    expect(help['shell-replacement']).not.toBe('');
  });
});

describe('validateSetting', () => {
  it('returns success: true for valid streaming value', () => {
    const result = validateSetting('streaming', 'enabled');

    expect(result.success).toBe(true);
  });

  it('returns success: false for invalid streaming value', () => {
    const result = validateSetting('streaming', 'invalid');

    expect(result.success).toBe(false);
  });
});
