/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import { parseInlineProfile } from '../profileBootstrap.js';

vi.mock('@vybestack/llxprt-code-providers/runtime/runtimeSettings.js', () => ({
  registerAgentRuntimeFactories: vi.fn(),
  resetAgentRuntimeFactories: vi.fn(),
  registerCliProviderInfrastructure: vi.fn(),
}));

describe('parseInlineProfile() @plan:PLAN-20251118-ISSUE533.P07', () => {
  /**
   * @plan:PLAN-20251118-ISSUE533.P07
   * @requirement:REQ-PROF-002.1
   * @scenario: Parse minimal valid profile with only required fields
   * @given: JSON string with provider, model, and key
   * @when: parseInlineProfile() is called
   * @then: Returns ProfileApplicationResult with provider and model names
   */
  it('should parse minimal valid profile with required fields', () => {
    const jsonString = JSON.stringify({
      provider: 'anthropic',
      model: 'claude-3-5-sonnet-20241022',
      key: 'sk-test-key-123',
    });

    const result = parseInlineProfile(jsonString);

    expect(result.providerName).toBe('anthropic');
    expect(result.modelName).toBe('claude-3-5-sonnet-20241022');
    expect(result.warnings).toStrictEqual([]);
  });

  /**
   * @plan:PLAN-20251118-ISSUE533.P07
   * @requirement:REQ-PROF-002.1
   * @scenario: Parse profile with optional configuration fields
   * @given: JSON string with provider, model, key, temperature, and maxTokens
   * @when: parseInlineProfile() is called
   * @then: Returns ProfileApplicationResult with provider and model names
   */
  it('should parse profile with optional fields like temperature and maxTokens', () => {
    const jsonString = JSON.stringify({
      provider: 'openai',
      model: 'gpt-4',
      key: 'sk-test-key-456',
      temperature: 0.7,
      maxTokens: 2000,
    });

    const result = parseInlineProfile(jsonString);

    expect(result.providerName).toBe('openai');
    expect(result.modelName).toBe('gpt-4');
    expect(result.warnings).toStrictEqual([]);
  });

  /**
   * @plan:PLAN-20251118-ISSUE533.P07
   * @requirement:REQ-PROF-002.1
   * @scenario: Parse profile with whitespace formatting
   * @given: JSON string with extra whitespace and newlines
   * @when: parseInlineProfile() is called
   * @then: Returns ProfileApplicationResult ignoring whitespace
   */
  it('should parse profile with whitespace formatting', () => {
    const jsonString = `
    {
      "provider": "anthropic",
      "model": "claude-3-5-sonnet-20241022",
      "key": "sk-test-key-789"
    }
    `;

    const result = parseInlineProfile(jsonString);

    expect(result.providerName).toBe('anthropic');
    expect(result.modelName).toBe('claude-3-5-sonnet-20241022');
    expect(result.warnings).toStrictEqual([]);
  });

  /**
   * @plan:PLAN-20251118-ISSUE533.P07
   * @requirement:REQ-PROF-002.1
   * @scenario: Parse profile with nested objects
   * @given: JSON string with nested tool_choice configuration
   * @when: parseInlineProfile() is called
   * @then: Returns ProfileApplicationResult with provider and model names
   */
  it('should parse profile with nested objects like tool_choice', () => {
    const jsonString = JSON.stringify({
      provider: 'openai',
      model: 'gpt-4',
      key: 'sk-test-key-abc',
      tool_choice: {
        type: 'function',
        function: { name: 'get_weather' },
      },
    });

    const result = parseInlineProfile(jsonString);

    expect(result.providerName).toBe('openai');
    expect(result.modelName).toBe('gpt-4');
    expect(result.warnings).toStrictEqual([]);
  });

  /**
   * @plan:PLAN-20251118-ISSUE533.P07
   * @requirement:REQ-PROF-002.1
   * @scenario: Parse profiles for all supported providers
   * @given: JSON strings for openai, anthropic, google, and azure providers
   * @when: parseInlineProfile() is called for each
   * @then: Returns correct provider and model names for each
   */
  it('should parse profiles for all supported providers', () => {
    const providers = [
      { provider: 'openai', model: 'gpt-4', key: 'key1' },
      {
        provider: 'anthropic',
        model: 'claude-3-5-sonnet-20241022',
        key: 'key2',
      },
      { provider: 'google', model: 'gemini-pro', key: 'key3' },
      { provider: 'azure', model: 'gpt-4', key: 'key4' },
    ];

    providers.forEach((profile) => {
      const result = parseInlineProfile(JSON.stringify(profile));
      expect(result.providerName).toBe(profile.provider);
      expect(result.modelName).toBe(profile.model);
      expect(result.warnings).toStrictEqual([]);
    });
  });

  /**
   * @plan:PLAN-20251118-ISSUE533.P07
   * @requirement:REQ-PROF-001.3
   * @scenario: Handle invalid JSON syntax
   * @given: Malformed JSON string with syntax errors
   * @when: parseInlineProfile() is called
   * @then: Returns error in ProfileApplicationResult
   */
  it('should handle invalid JSON syntax', () => {
    const invalidJson = '{provider: "anthropic", invalid syntax}';

    const result = parseInlineProfile(invalidJson);

    expect(result.providerName).toBe('');
    expect(result.modelName).toBe('');
    expect(result.error).toBeDefined();
    expect(result.error).toContain('JSON');
  });

  /**
   * @plan:PLAN-20251118-ISSUE533.P07
   * @requirement:REQ-PROF-001.3
   * @scenario: Handle empty string input
   * @given: Empty string
   * @when: parseInlineProfile() is called
   * @then: Returns error in ProfileApplicationResult
   */
  it('should handle empty string', () => {
    const result = parseInlineProfile('');

    expect(result.providerName).toBe('');
    expect(result.modelName).toBe('');
    expect(result.error).toBeDefined();
    expect(result.error).toContain('JSON');
  });

  /**
   * @plan:PLAN-20251118-ISSUE533.P07
   * @requirement:REQ-PROF-001.3
   * @scenario: Handle whitespace-only string input
   * @given: String containing only whitespace
   * @when: parseInlineProfile() is called
   * @then: Returns error in ProfileApplicationResult
   */
  it('should handle whitespace-only string', () => {
    const result = parseInlineProfile('   \n\t  ');

    expect(result.providerName).toBe('');
    expect(result.modelName).toBe('');
    expect(result.error).toBeDefined();
    expect(result.error).toContain('JSON');
  });

  /**
   * @plan:PLAN-20251118-ISSUE533.P07
   * @requirement:REQ-PROF-002.3
   * @scenario: Validate missing provider field
   * @given: JSON string without provider field
   * @when: parseInlineProfile() is called
   * @then: Returns validation error in ProfileApplicationResult
   */
  it('should reject profile missing provider field', () => {
    const jsonString = JSON.stringify({
      model: 'claude-3-5-sonnet-20241022',
      key: 'sk-test-key-missing-provider',
    });

    const result = parseInlineProfile(jsonString);

    expect(result.providerName).toBe('');
    expect(result.modelName).toBe('');
    expect(result.error).toBeDefined();
    expect(result.error).toContain('provider');
  });

  /**
   * @plan:PLAN-20251118-ISSUE533.P07
   * @requirement:REQ-PROF-002.3
   * @scenario: Validate missing model field
   * @given: JSON string without model field
   * @when: parseInlineProfile() is called
   * @then: Returns validation error in ProfileApplicationResult
   */
  it('should reject profile missing model field', () => {
    const jsonString = JSON.stringify({
      provider: 'anthropic',
      key: 'sk-test-key-missing-model',
    });

    const result = parseInlineProfile(jsonString);

    expect(result.providerName).toBe('');
    expect(result.modelName).toBe('');
    expect(result.error).toBeDefined();
    expect(result.error).toContain('model');
  });

  /**
   * @plan:PLAN-20251118-ISSUE533.P07
   * @requirement:REQ-PROF-002.3
   * @scenario: Accept custom/alias provider names
   * @given: JSON string with custom provider name (e.g., alias like "Synthetic")
   * @when: parseInlineProfile() is called
   * @then: Parses successfully - provider validation happens later during application
   */
  it('should accept custom provider names for aliases', () => {
    const jsonString = JSON.stringify({
      provider: 'Synthetic',
      model: 'hf:zai-org/GLM-4.6',
      key: 'sk-test-key-custom-provider',
    });

    const result = parseInlineProfile(jsonString);

    expect(result.error).toBeUndefined();
    expect(result.providerName).toBe('Synthetic');
    expect(result.modelName).toBe('hf:zai-org/GLM-4.6');
    expect(result.warnings).toStrictEqual([]);
  });

  /**
   * @plan:PLAN-20251118-ISSUE533.P07
   * @requirement:REQ-PROF-002.3
   * @scenario: Validate invalid field types
   * @given: JSON string with temperature as string instead of number
   * @when: parseInlineProfile() is called
   * @then: Returns validation error in ProfileApplicationResult
   */
  it('should reject profile with invalid field types', () => {
    const jsonString = JSON.stringify({
      provider: 'anthropic',
      model: 'claude-3-5-sonnet-20241022',
      key: 'sk-test-key-type-error',
      temperature: 'hot',
    });

    const result = parseInlineProfile(jsonString);

    expect(result.providerName).toBe('');
    expect(result.modelName).toBe('');
    expect(result.error).toBeDefined();
    expect(result.error).toContain('temperature');
  });

  /**
   * @plan:PLAN-20251118-ISSUE533.P07
   * @requirement:REQ-PROF-003.3
   * @scenario: Reject nesting depth exceeding limit
   * @given: JSON string with >5 levels of nesting
   * @when: parseInlineProfile() is called
   * @then: Returns security error in ProfileApplicationResult
   */
  it('should reject nesting depth exceeding limit of 5 levels', () => {
    const deeplyNested = {
      provider: 'anthropic',
      model: 'claude-3-5-sonnet-20241022',
      key: 'sk-test-key-deep',
      level1: {
        level2: {
          level3: {
            level4: {
              level5: {
                level6: 'too deep',
              },
            },
          },
        },
      },
    };

    const result = parseInlineProfile(JSON.stringify(deeplyNested));

    expect(result.providerName).toBe('');
    expect(result.modelName).toBe('');
    expect(result.error).toBeDefined();
    expect(result.error).toContain('nesting');
  });

  /**
   * @plan:PLAN-20251118-ISSUE533.P07
   * @requirement:REQ-PROF-003.3
   * @scenario: Accept nesting depth at limit
   * @given: JSON string with exactly 5 levels of nesting
   * @when: parseInlineProfile() is called
   * @then: Returns successful ProfileApplicationResult
   */
  it('should accept nesting depth at limit of 5 levels', () => {
    const atLimitNested = {
      provider: 'anthropic',
      model: 'claude-3-5-sonnet-20241022',
      key: 'sk-test-key-limit',
      level1: {
        level2: {
          level3: {
            level4: {
              level5: 'at limit',
            },
          },
        },
      },
    };

    const result = parseInlineProfile(JSON.stringify(atLimitNested));

    expect(result.providerName).toBe('anthropic');
    expect(result.modelName).toBe('claude-3-5-sonnet-20241022');
    expect(result.warnings).toStrictEqual([]);
  });

  /**
   * @plan:PLAN-20251118-ISSUE533.P07
   * @requirement:REQ-PROF-003.2
   * @scenario: Reject profile with __proto__ field
   * @given: JSON string containing __proto__ field
   * @when: parseInlineProfile() is called
   * @then: Returns security error in ProfileApplicationResult
   */
  it('should reject profile with disallowed __proto__ field', () => {
    // JSON.stringify does not serialize __proto__, so construct the string directly
    const jsonString =
      '{"provider":"anthropic","model":"claude-3-5-sonnet-20241022","key":"sk-test-key-proto","__proto__":{"isAdmin":true}}';

    const result = parseInlineProfile(jsonString);

    expect(result.providerName).toBe('');
    expect(result.modelName).toBe('');
    expect(result.error).toBeDefined();
    expect(result.error).toContain('__proto__');
  });

  /**
   * @plan:PLAN-20251118-ISSUE533.P07
   * @requirement:REQ-PROF-003.2
   * @scenario: Reject profile with constructor field
   * @given: JSON string containing constructor field
   * @when: parseInlineProfile() is called
   * @then: Returns security error in ProfileApplicationResult
   */
  it('should reject profile with disallowed constructor field', () => {
    const jsonString = JSON.stringify({
      provider: 'anthropic',
      model: 'claude-3-5-sonnet-20241022',
      key: 'sk-test-key-constructor',
      constructor: { prototype: {} },
    });

    const result = parseInlineProfile(jsonString);

    expect(result.providerName).toBe('');
    expect(result.modelName).toBe('');
    expect(result.error).toBeDefined();
    expect(result.error).toContain('constructor');
  });
});
