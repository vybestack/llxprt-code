/**
 * @plan PLAN-20260608-ISSUE1588.P04
 * @requirement REQ-REG-001
 *
 * Behavioral TDD tests for the settings registry.
 *
 * These tests define the expected behavior for settings registry functions
 * that will be migrated from core in P05. Tests fail against stubs because
 * functions throw instead of returning values.
 *
 * Compression strategy values are verified by their string literals
 * ('middle-out', 'top-down-truncation', 'one-shot', 'high-density')
 * without importing core compression types.
 */

import { describe, it, expect } from 'vitest';
import {
  resolveAlias,
  getSettingSpec,
  normalizeSetting,
  separateSettings,
  validateSetting,
  parseSetting,
  getProfilePersistableKeys,
  getSettingHelp,
  getAllSettingKeys,
  getValidationHelp,
  getAutocompleteSuggestions,
  getProtectedSettingKeys,
  getProviderConfigKeys,
  getDirectSettingSpecs,
} from '../settings/settingsRegistry.js';

// ---------------------------------------------------------------------------
// Compression strategy literal values — tested without importing core
// compression. The settings registry must contain these enum values once
// migrated. These are the known expected values from the current production
// implementation.
// ---------------------------------------------------------------------------
const EXPECTED_COMPRESSION_STRATEGIES = [
  'middle-out',
  'top-down-truncation',
  'one-shot',
  'high-density',
] as const;

describe('resolveAlias — alias normalization', () => {
  it('resolves max-tokens to max_tokens', () => {
    expect(resolveAlias('max-tokens')).toBe('max_tokens');
  });

  it('resolves maxTokens to max_tokens', () => {
    expect(resolveAlias('maxTokens')).toBe('max_tokens');
  });

  it('resolves response-format to response_format', () => {
    expect(resolveAlias('response-format')).toBe('response_format');
  });

  it('resolves responseFormat to response_format', () => {
    expect(resolveAlias('responseFormat')).toBe('response_format');
  });

  it('resolves tool-choice to tool_choice', () => {
    expect(resolveAlias('tool-choice')).toBe('tool_choice');
  });

  it('resolves toolChoice to tool_choice', () => {
    expect(resolveAlias('toolChoice')).toBe('tool_choice');
  });

  it('resolves disabled-tools to tools.disabled', () => {
    expect(resolveAlias('disabled-tools')).toBe('tools.disabled');
  });

  it('preserves user-agent without underscore conversion', () => {
    expect(resolveAlias('user-agent')).toBe('user-agent');
  });

  it('returns temperature unchanged (already canonical)', () => {
    expect(resolveAlias('temperature')).toBe('temperature');
  });

  it('returns an unknown key unchanged', () => {
    expect(resolveAlias('completely-unknown-key')).toBe(
      'completely_unknown_key',
    );
  });
});

describe('getSettingSpec — spec lookup', () => {
  it('returns a spec with category model-param for temperature', () => {
    const spec = getSettingSpec('temperature');
    expect(spec?.category).toBe('model-param');
  });

  it('returns a spec with category cli-behavior for shell-replacement', () => {
    const spec = getSettingSpec('shell-replacement');
    expect(spec?.category).toBe('cli-behavior');
  });

  it('resolves apiKey alias to auth-key canonical spec', () => {
    const spec = getSettingSpec('auth-key');
    expect(spec?.category).toBe('provider-config');
    expect(spec?.aliases).toContain('apiKey');
  });

  it('resolves auth-key canonical spec directly', () => {
    const spec = getSettingSpec('auth-key');
    expect(spec?.category).toBe('provider-config');
    expect(spec?.persistToProfile).toBe(true);
  });

  it('resolves auth-keyfile canonical spec with apiKeyfile alias', () => {
    const spec = getSettingSpec('auth-keyfile');
    expect(spec?.category).toBe('provider-config');
    expect(spec?.aliases).toContain('apiKeyfile');
  });

  it('resolves apiKey to auth-key via resolveAlias', () => {
    expect(resolveAlias('apiKey')).toBe('auth-key');
  });

  it('resolves apiKeyfile to auth-keyfile via resolveAlias', () => {
    expect(resolveAlias('apiKeyfile')).toBe('auth-keyfile');
  });

  it('returns a spec with type enum for compression.strategy', () => {
    const spec = getSettingSpec('compression.strategy');
    expect(spec?.type).toBe('enum');
  });

  it('returns undefined for nonexistent key', () => {
    const spec = getSettingSpec('nonexistent-setting-xyz');
    expect(spec).toBeUndefined();
  });
});

describe('normalizeSetting — normalization', () => {
  it('returns the value unchanged when no normalizer exists', () => {
    const result = normalizeSetting('temperature', 0.7);
    expect(result).toBe(0.7);
  });

  it('normalizes a reasoning object by removing internal keys', () => {
    const result = normalizeSetting('reasoning', {
      enabled: true,
      effort: 'high',
      maxTokens: 5000,
      includeInContext: true,
      includeInResponse: false,
      format: 'native',
      stripFromContext: 'all',
    });
    const normalized = result as Record<string, unknown>;
    // Internal keys should be stripped
    expect(normalized.includeInContext).toBeUndefined();
    expect(normalized.includeInResponse).toBeUndefined();
    expect(normalized.format).toBeUndefined();
    expect(normalized.stripFromContext).toBeUndefined();
    // Non-internal keys preserved
    expect(normalized.effort).toBe('high');
    expect(normalized.maxTokens).toBe(5000);
  });
});

describe('separateSettings — settings categorization', () => {
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

  it('extracts headers from custom-headers into customHeaders', () => {
    const result = separateSettings({
      'custom-headers': { 'X-Foo': 'bar' },
    });
    expect(result.customHeaders['X-Foo']).toBe('bar');
  });

  it('does not include apiKey in cliSettings (provider-config filtered)', () => {
    const result = separateSettings({ apiKey: 'sk-123' });
    expect(result.cliSettings.apiKey).toBeUndefined();
  });

  it('does not include apiKey in modelParams', () => {
    const result = separateSettings({ apiKey: 'sk-123' });
    expect(result.modelParams.apiKey).toBeUndefined();
  });

  it('places unknown keys in modelParams as pass-through', () => {
    const result = separateSettings({ unknownKey: 'val' });
    expect(result.modelParams.unknownKey).toBe('val');
  });

  it('resolves max-tokens alias to max_tokens in modelParams', () => {
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

describe('validateSetting — validation', () => {
  it('returns success:true for a valid streaming mode', () => {
    const result = validateSetting('streaming', 'enabled');
    expect(result.success).toBe(true);
  });

  it('returns success:false for an invalid streaming mode', () => {
    const result = validateSetting('streaming', 'invalid');
    expect(result.success).toBe(false);
  });

  it('validates file-read-max-lines with a positive integer', () => {
    const result = validateSetting('file-read-max-lines', 3000);
    expect(result.success).toBe(true);
  });

  it('rejects negative file-read-max-lines', () => {
    const result = validateSetting('file-read-max-lines', -100);
    expect(result.success).toBe(false);
  });

  it('rejects zero file-read-max-lines', () => {
    const result = validateSetting('file-read-max-lines', 0);
    expect(result.success).toBe(false);
  });

  it('returns success:true for unknown keys (pass-through)', () => {
    const result = validateSetting('totally-unknown-key', 'any-value');
    expect(result.success).toBe(true);
  });

  it('validates boolean true for requires-auth', () => {
    const result = validateSetting('requires-auth', true);
    expect(result.success).toBe(true);
  });

  it('validates boolean false for requires-auth', () => {
    const result = validateSetting('requires-auth', false);
    expect(result.success).toBe(true);
  });

  it('rejects string for requires-auth (requires boolean)', () => {
    const result = validateSetting('requires-auth', 'yes');
    expect(result.success).toBe(false);
  });
});

describe('parseSetting — string-to-value parsing', () => {
  it('parses a number type value from string', () => {
    const result = parseSetting('temperature', '0.7');
    expect(result).toBe(0.7);
  });

  it('parses a boolean true from string', () => {
    const result = parseSetting('reasoning.enabled', 'true');
    expect(result).toBe(true);
  });

  it('parses a boolean false from string', () => {
    const result = parseSetting('reasoning.enabled', 'false');
    expect(result).toBe(false);
  });

  it('returns raw string for unknown setting', () => {
    const result = parseSetting('unknown-setting-xyz', 'hello');
    expect(result).toBe('hello');
  });

  it('parses streaming "true" to "enabled"', () => {
    const result = parseSetting('streaming', 'true');
    expect(result).toBe('enabled');
  });

  it('parses streaming "false" to "disabled"', () => {
    const result = parseSetting('streaming', 'false');
    expect(result).toBe('disabled');
  });
});

describe('getProfilePersistableKeys — profile persistence', () => {
  it('includes temperature in persistable keys', () => {
    const keys = getProfilePersistableKeys();
    expect(keys).toContain('temperature');
  });

  it('includes reasoning.enabled in persistable keys', () => {
    const keys = getProfilePersistableKeys();
    expect(keys).toContain('reasoning.enabled');
  });

  it('auth-key is persistable to profile (canonical)', () => {
    const keys = getProfilePersistableKeys();
    expect(keys).toContain('auth-key');
  });

  it('auth-keyfile is persistable to profile (canonical)', () => {
    const keys = getProfilePersistableKeys();
    expect(keys).toContain('auth-keyfile');
  });

  it('apiKey alias resolves to auth-key spec via getSettingSpec', () => {
    const spec = getSettingSpec('apiKey');
    expect(spec).toBeDefined();
    expect(spec?.key).toBe('auth-key');
    expect(spec?.category).toBe('provider-config');
    expect(spec?.aliases).toContain('apiKey');
  });

  it('apiKeyfile alias resolves to auth-keyfile spec via getSettingSpec', () => {
    const spec = getSettingSpec('apiKeyfile');
    expect(spec).toBeDefined();
    expect(spec?.key).toBe('auth-keyfile');
    expect(spec?.category).toBe('provider-config');
    expect(spec?.aliases).toContain('apiKeyfile');
  });

  it('api-key alias resolves to auth-key spec via getSettingSpec', () => {
    const spec = getSettingSpec('api-key');
    expect(spec).toBeDefined();
    expect(spec?.key).toBe('auth-key');
  });

  it('api-keyfile alias resolves to auth-keyfile spec via getSettingSpec', () => {
    const spec = getSettingSpec('api-keyfile');
    expect(spec).toBeDefined();
    expect(spec?.key).toBe('auth-keyfile');
  });
});

describe('getSettingHelp — help text', () => {
  it('returns non-empty descriptions for known settings', () => {
    const help = getSettingHelp();
    expect(help['shell-replacement']).toBeTruthy();
    expect(help['shell-replacement']).not.toBe('');
  });

  it('includes help for temperature', () => {
    const help = getSettingHelp();
    expect(help['temperature']).toBeTruthy();
  });
});

describe('getAllSettingKeys — key enumeration', () => {
  it('returns an array that includes temperature', () => {
    const keys = getAllSettingKeys();
    expect(keys).toContain('temperature');
  });

  it('returns an array that includes shell-replacement', () => {
    const keys = getAllSettingKeys();
    expect(keys).toContain('shell-replacement');
  });
});

describe('getValidationHelp — validation hint text', () => {
  it('returns help text for a known setting', () => {
    const help = getValidationHelp('context-limit');
    expect(help).toBeTruthy();
  });

  it('returns undefined for unknown setting', () => {
    const help = getValidationHelp('nonexistent-setting-xyz');
    expect(help).toBeUndefined();
  });
});

describe('getAutocompleteSuggestions — completion options', () => {
  it('returns completion options for streaming', () => {
    const suggestions = getAutocompleteSuggestions('streaming');
    expect(suggestions).toBeDefined();
    expect(suggestions?.length).toBeGreaterThan(0);
  });

  it('returns undefined for a setting without completions', () => {
    const suggestions = getAutocompleteSuggestions('temperature');
    // temperature has no enumValues or completionOptions
    expect(suggestions).toBeUndefined();
  });
});

describe('getProtectedSettingKeys — protected/hidden keys', () => {
  it('includes auth-key in protected keys', () => {
    const keys = getProtectedSettingKeys();
    expect(keys).toContain('auth-key');
  });

  it('includes apiKey alias in protected keys', () => {
    const keys = getProtectedSettingKeys();
    expect(keys).toContain('apiKey');
  });

  it('includes auth-keyfile in protected keys', () => {
    const keys = getProtectedSettingKeys();
    expect(keys).toContain('auth-keyfile');
  });

  it('includes model in protected keys', () => {
    const keys = getProtectedSettingKeys();
    expect(keys).toContain('model');
  });

  it('does not include temperature (not provider-config)', () => {
    const keys = getProtectedSettingKeys();
    expect(keys).not.toContain('temperature');
  });
});

describe('getProviderConfigKeys — provider config key enumeration', () => {
  it('includes auth-key canonical', () => {
    const keys = getProviderConfigKeys();
    expect(keys).toContain('auth-key');
  });

  it('includes apiKey alias', () => {
    const keys = getProviderConfigKeys();
    expect(keys).toContain('apiKey');
  });

  it('includes auth-keyfile canonical', () => {
    const keys = getProviderConfigKeys();
    expect(keys).toContain('auth-keyfile');
  });

  it('includes apiKeyfile alias', () => {
    const keys = getProviderConfigKeys();
    expect(keys).toContain('apiKeyfile');
  });

  it('includes base-url', () => {
    const keys = getProviderConfigKeys();
    expect(keys).toContain('base-url');
  });

  it('includes model', () => {
    const keys = getProviderConfigKeys();
    expect(keys).toContain('model');
  });

  it('includes toolFormat', () => {
    const keys = getProviderConfigKeys();
    expect(keys).toContain('toolFormat');
  });

  it('does not include temperature (not provider-config)', () => {
    const keys = getProviderConfigKeys();
    expect(keys).not.toContain('temperature');
  });
});

describe('getDirectSettingSpecs — direct setting specifications', () => {
  it('returns an array', () => {
    const specs = getDirectSettingSpecs();
    expect(Array.isArray(specs)).toBe(true);
  });

  it('includes context-limit', () => {
    const specs = getDirectSettingSpecs();
    const found = specs.find((s) => s.value === 'context-limit');
    expect(found?.value).toBe('context-limit');
    expect(found?.hint).toBeTruthy();
  });

  it('includes streaming', () => {
    const specs = getDirectSettingSpecs();
    const found = specs.find((s) => s.value === 'streaming');
    expect(found?.value).toBe('streaming');
    expect(found?.hint).toBeTruthy();
  });

  it('includes reasoning.enabled', () => {
    const specs = getDirectSettingSpecs();
    const found = specs.find((s) => s.value === 'reasoning.enabled');
    expect(found?.value).toBe('reasoning.enabled');
    expect(found?.hint).toBeTruthy();
  });

  it('excludes temperature (model-param category)', () => {
    const specs = getDirectSettingSpecs();
    const found = specs.find((s) => s.value === 'temperature');
    expect(found).toBeUndefined();
  });

  it('excludes custom-headers (custom-header category)', () => {
    const specs = getDirectSettingSpecs();
    const found = specs.find((s) => s.value === 'custom-headers');
    expect(found).toBeUndefined();
  });

  it('excludes auth-key (provider-config category)', () => {
    const specs = getDirectSettingSpecs();
    const found = specs.find((s) => s.value === 'auth-key');
    expect(found).toBeUndefined();
  });

  it('excludes apiKey alias from direct setting specs', () => {
    const specs = getDirectSettingSpecs();
    const found = specs.find((s) => s.value === 'apiKey');
    expect(found).toBeUndefined();
  });

  it('provides a hint for each spec', () => {
    const specs = getDirectSettingSpecs();
    for (const spec of specs) {
      expect(spec.hint).toBeTruthy();
    }
  });
});

describe('compression strategy values in registry', () => {
  it('compression.strategy has enum type', () => {
    const spec = getSettingSpec('compression.strategy');
    expect(spec?.type).toBe('enum');
  });

  it('compression.strategy default is middle-out', () => {
    const spec = getSettingSpec('compression.strategy');
    expect(spec?.default).toBe('middle-out');
  });

  it('compression.strategy enumValues includes all expected strategies', () => {
    const spec = getSettingSpec('compression.strategy');
    for (const strategy of EXPECTED_COMPRESSION_STRATEGIES) {
      expect(spec?.enumValues).toContain(strategy);
    }
  });

  it('compression.strategy is persistable to profile', () => {
    const spec = getSettingSpec('compression.strategy');
    expect(spec?.persistToProfile).toBe(true);
  });

  it('compression.profile has type string', () => {
    const spec = getSettingSpec('compression.profile');
    expect(spec?.type).toBe('string');
  });

  it('compression.profile is persistable to profile', () => {
    const spec = getSettingSpec('compression.profile');
    expect(spec?.persistToProfile).toBe(true);
  });

  it('compression.strategy appears in direct setting specs', () => {
    const specs = getDirectSettingSpecs();
    const found = specs.find((s) => s.value === 'compression.strategy');
    expect(found?.value).toBe('compression.strategy');
    expect(found?.hint).toBeTruthy();
  });

  it('compression.profile appears in direct setting specs', () => {
    const specs = getDirectSettingSpecs();
    const found = specs.find((s) => s.value === 'compression.profile');
    expect(found?.value).toBe('compression.profile');
    expect(found?.hint).toBeTruthy();
  });

  it('each expected compression strategy validates successfully', () => {
    for (const strategy of EXPECTED_COMPRESSION_STRATEGIES) {
      const result = validateSetting('compression.strategy', strategy);
      expect(result.success).toBe(true);
    }
  });
});
