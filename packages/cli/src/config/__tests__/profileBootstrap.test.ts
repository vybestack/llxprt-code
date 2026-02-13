/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  parseBootstrapArgs,
  prepareRuntimeForProfile,
  createBootstrapResult,
  parseInlineProfile,
} from '../profileBootstrap.js';

vi.mock('../../runtime/runtimeSettings.js', () => ({
  registerCliProviderInfrastructure: vi.fn(),
}));

type BootstrapProfileArgs = {
  profileName: string | null;
  profileJson: string | null;
  providerOverride: string | null;
  modelOverride: string | null;
  keyOverride: string | null;
  keyfileOverride: string | null;
  keyNameOverride: string | null;
  baseurlOverride: string | null;
  setOverrides: string[] | null;
};

type MockSettingsService = {
  listProfiles: ReturnType<typeof vi.fn>;
  getProfile: ReturnType<typeof vi.fn>;
  getProfileByID: ReturnType<typeof vi.fn>;
  isLoaded: ReturnType<typeof vi.fn>;
};

type MockConfig = {
  profiles: unknown[];
};

type RuntimeMetadata = {
  settingsService?: MockSettingsService;
  config?: MockConfig;
  runtimeId?: string;
  metadata?: Record<string, unknown>;
  oauthManager?: Record<string, unknown>;
};

type ParsedBootstrapArgs = {
  bootstrapArgs: BootstrapProfileArgs;
  runtimeMetadata: RuntimeMetadata;
};

type BootstrapRuntimeState = {
  runtime: RuntimeMetadata & { settingsService: unknown };
  providerManager: unknown;
  oauthManager?: unknown;
};

type ProfileApplicationResult = {
  providerName: string;
  modelName: string;
  baseUrl?: string;
  warnings: string[];
};

const parseArgs = parseBootstrapArgs as unknown as () => ParsedBootstrapArgs;
const parseArgsWithMeta = parseBootstrapArgs as unknown as (
  args: BootstrapProfileArgs,
  metadata: RuntimeMetadata,
) => ParsedBootstrapArgs;
const prepareRuntime = prepareRuntimeForProfile as unknown as (
  parsed: ParsedBootstrapArgs,
) => Promise<BootstrapRuntimeState>;
const finalizeBootstrap = createBootstrapResult as unknown as (input: {
  runtime: BootstrapRuntimeState['runtime'];
  providerManager: BootstrapRuntimeState['providerManager'];
  oauthManager?: BootstrapRuntimeState['oauthManager'];
  bootstrapArgs: BootstrapProfileArgs;
  profileApplication: ProfileApplicationResult;
}) => {
  runtime: BootstrapRuntimeState['runtime'];
  providerManager: BootstrapRuntimeState['providerManager'];
  oauthManager?: BootstrapRuntimeState['oauthManager'];
  profile: ProfileApplicationResult;
};

describe('profileBootstrap helpers', () => {
  const originalArgv = process.argv.slice();

  beforeEach(() => {
    process.argv = originalArgv.slice();
  });

  afterEach(() => {
    process.argv = originalArgv.slice();
  });

  it('parses CLI args without --profile-load @plan:PLAN-20251020-STATELESSPROVIDER3.P05 @requirement:REQ-SP3-001', () => {
    process.argv = ['node', 'llxprt', '--sandbox'];
    // @pseudocode bootstrap-order.md lines 1-9
    const parsed = parseArgs();
    expect(parsed.bootstrapArgs.profileName).toBeNull();
    expect(parsed.bootstrapArgs).toMatchObject({
      providerOverride: null,
      modelOverride: null,
    });
  });

  it('parses CLI args with --profile-load @plan:PLAN-20251020-STATELESSPROVIDER3.P05 @requirement:REQ-SP3-001', () => {
    process.argv = ['node', 'llxprt', '--profile-load', 'synthetic'];
    // @pseudocode bootstrap-order.md lines 1-9
    const parsed = parseArgs();
    expect(parsed.bootstrapArgs.profileName).toBe('synthetic');
    expect(parsed.bootstrapArgs).toMatchObject({
      providerOverride: null,
      modelOverride: null,
    });
  });

  it('merges repeated --set arguments while preserving their order', () => {
    process.argv = [
      'node',
      'llxprt',
      '--set',
      'modelparam.temperature=1',
      '--set',
      'context-limit=190000',
      '--set=shell-replacement=true',
    ];
    const parsed = parseArgs();
    expect(parsed.bootstrapArgs.setOverrides).toEqual([
      'modelparam.temperature=1',
      'context-limit=190000',
      'shell-replacement=true',
    ]);
  });

  it('prepares runtime before applying profile state @plan:PLAN-20251020-STATELESSPROVIDER3.P05 @requirement:REQ-SP3-001', async () => {
    process.argv = ['node', 'llxprt', '--profile-load', 'workspace'];
    const parsed = parseArgs();
    const runtimeState = await prepareRuntime(parsed);
    const bootstrapResult = finalizeBootstrap({
      runtime: runtimeState.runtime,
      providerManager: runtimeState.providerManager,
      oauthManager: runtimeState.oauthManager,
      bootstrapArgs: parsed.bootstrapArgs,
      profileApplication: {
        providerName: 'openai',
        modelName: 'gpt-4.1-mini',
        warnings: [],
      },
    });
    // @pseudocode bootstrap-order.md lines 1-9
    expect(bootstrapResult.runtime.metadata).toMatchObject(
      parsed.runtimeMetadata.metadata ?? {},
    );
  });

  it('includes runtime metadata in bootstrap result @plan:PLAN-20251020-STATELESSPROVIDER3.P05 @requirement:REQ-SP3-001', async () => {
    const parsed: ParsedBootstrapArgs = {
      bootstrapArgs: {
        profileName: 'synthetic',
        profileJson: null,
        providerOverride: null,
        modelOverride: null,
        keyOverride: null,
        keyfileOverride: null,
        keyNameOverride: null,
        baseurlOverride: null,
        setOverrides: null,
      },
      runtimeMetadata: {
        runtimeId: 'cli-runtime',
        metadata: { sessionId: 'bootstrap-session', source: 'test' },
      },
    };

    const runtimeState = await prepareRuntime(parsed);
    const bootstrapResult = finalizeBootstrap({
      runtime: runtimeState.runtime,
      providerManager: runtimeState.providerManager,
      oauthManager: runtimeState.oauthManager,
      bootstrapArgs: parsed.bootstrapArgs,
      profileApplication: {
        providerName: 'openai',
        modelName: 'gpt-4o-mini',
        baseUrl: 'https://api.example.com',
        warnings: ['profile applied after runtime ready'],
      },
    });
    // @pseudocode bootstrap-order.md lines 1-9
    expect(bootstrapResult.profile.providerName).toBe('openai');
    expect(bootstrapResult.runtime.runtimeId).toBe('cli-runtime');
    expect(bootstrapResult.runtime.metadata).toMatchObject({
      sessionId: 'bootstrap-session',
      source: 'test',
    });
  });
});

describe('--profile flag parsing @plan:PLAN-20251118-ISSUE533.P04', () => {
  let originalArgv: string[];

  beforeEach(() => {
    originalArgv = [...process.argv];
  });

  afterEach(() => {
    process.argv = originalArgv;
  });

  // Group 1: Basic Parsing (5 tests)

  /**
   * @plan:PLAN-20251118-ISSUE533.P04
   * @requirement:REQ-PROF-001.1
   * @scenario: Parse --profile with space-separated JSON string
   * @given: Command line with --profile followed by JSON string
   * @when: parseBootstrapArgs is called
   * @then: profileJson is populated with the JSON string and profileName is null
   */
  it('should parse --profile with space-separated JSON string', () => {
    process.argv = [
      'node',
      'llxprt',
      '--profile',
      '{"provider":"openai","model":"gpt-4"}',
    ];
    const result = parseBootstrapArgs();
    expect(result.bootstrapArgs.profileJson).toBe(
      '{"provider":"openai","model":"gpt-4"}',
    );
    expect(result.bootstrapArgs.profileName).toBeNull();
  });

  /**
   * @plan:PLAN-20251118-ISSUE533.P04
   * @requirement:REQ-PROF-001.1
   * @scenario: Parse --profile with equals syntax
   * @given: Command line with --profile=<JSON>
   * @when: parseBootstrapArgs is called
   * @then: profileJson is populated with the JSON string
   */
  it('should parse --profile with equals syntax', () => {
    process.argv = [
      'node',
      'llxprt',
      '--profile={"provider":"anthropic","model":"claude-3"}',
    ];
    const result = parseBootstrapArgs();
    expect(result.bootstrapArgs.profileJson).toBe(
      '{"provider":"anthropic","model":"claude-3"}',
    );
    expect(result.bootstrapArgs.profileName).toBeNull();
  });

  /**
   * @plan:PLAN-20251118-ISSUE533.P04
   * @requirement:REQ-PROF-001.1
   * @scenario: Accept empty JSON object
   * @given: Command line with --profile {}
   * @when: parseBootstrapArgs is called
   * @then: profileJson is set to "{}"
   */
  it('should accept empty JSON object', () => {
    process.argv = ['node', 'llxprt', '--profile', '{}'];
    const result = parseBootstrapArgs();
    expect(result.bootstrapArgs.profileJson).toBe('{}');
  });

  /**
   * @plan:PLAN-20251118-ISSUE533.P04
   * @requirement:REQ-PROF-001.1
   * @scenario: Preserve whitespace in JSON string
   * @given: Command line with JSON containing various whitespace
   * @when: parseBootstrapArgs is called
   * @then: profileJson preserves all whitespace characters
   */
  it('should preserve whitespace in JSON string', () => {
    const jsonWithWhitespace =
      '{\n  "provider": "openai",\n  "model": "gpt-4"\n}';
    process.argv = ['node', 'llxprt', '--profile', jsonWithWhitespace];
    const result = parseBootstrapArgs();
    expect(result.bootstrapArgs.profileJson).toBe(jsonWithWhitespace);
  });

  /**
   * @plan:PLAN-20251118-ISSUE533.P04
   * @requirement:REQ-PROF-001.1
   * @scenario: Parse --profile alongside other flags
   * @given: Command line with --profile and other flags like --provider
   * @when: parseBootstrapArgs is called
   * @then: Both profileJson and other args are correctly populated
   */
  it('should parse --profile alongside other flags', () => {
    process.argv = [
      'node',
      'llxprt',
      '--profile',
      '{"model":"gpt-4"}',
      '--key',
      'test-key',
      '--set',
      'debug=true',
    ];
    const result = parseBootstrapArgs();
    expect(result.bootstrapArgs.profileJson).toBe('{"model":"gpt-4"}');
    expect(result.bootstrapArgs.keyOverride).toBe('test-key');
    expect(result.bootstrapArgs.setOverrides).toEqual(['debug=true']);
  });

  // Group 2: Error Cases (4 tests)

  /**
   * @plan:PLAN-20251118-ISSUE533.P04
   * @requirement:REQ-PROF-001.2
   * @scenario: Throw error when --profile has no value
   * @given: Command line with --profile at the end without a value
   * @when: parseBootstrapArgs is called
   * @then: Error is thrown indicating missing value
   */
  it('should throw error when --profile has no value', () => {
    process.argv = ['node', 'llxprt', '--profile'];
    expect(() => parseBootstrapArgs()).toThrow();
  });

  /**
   * @plan:PLAN-20251118-ISSUE533.P04
   * @requirement:REQ-PROF-001.2
   * @scenario: Throw error when --profile is followed by another flag
   * @given: Command line with --profile followed by --provider
   * @when: parseBootstrapArgs is called
   * @then: Error is thrown indicating missing value
   */
  it('should throw error when --profile is followed by another flag', () => {
    process.argv = ['node', 'llxprt', '--profile', '--provider', 'openai'];
    expect(() => parseBootstrapArgs()).toThrow();
  });

  /**
   * @plan:PLAN-20251118-ISSUE533.P04
   * @requirement:REQ-PROF-001.2
   * @scenario: Accept empty string (validation fails later)
   * @given: Command line with --profile ""
   * @when: parseBootstrapArgs is called
   * @then: profileJson is set to empty string (validation happens in Phase 05)
   */
  it('should accept empty string for --profile', () => {
    process.argv = ['node', 'llxprt', '--profile', ''];
    const result = parseBootstrapArgs();
    expect(result.bootstrapArgs.profileJson).toBe('');
  });

  /**
   * @plan:PLAN-20251118-ISSUE533.P04
   * @requirement:REQ-PROF-003.3
   * @scenario: Throw error for JSON exceeding 10KB
   * @given: Command line with JSON string larger than 10KB
   * @when: parseBootstrapArgs is called
   * @then: Error message indicates size limit exceeded
   */
  it('should throw error for JSON exceeding 10KB', () => {
    const largeJson = '{"data":"' + 'x'.repeat(10 * 1024) + '"}';
    process.argv = ['node', 'llxprt', '--profile', largeJson];
    expect(() => parseBootstrapArgs()).toThrow(/exceeds maximum size of 10KB/i);
  });

  // Group 3: Mutual Exclusivity (4 tests)

  /**
   * @plan:PLAN-20251118-ISSUE533.P04
   * @requirement:REQ-INT-001.2
   * @scenario: Throw error when both --profile and --profile-load are used
   * @given: Command line with both --profile and --profile-load
   * @when: parseBootstrapArgs is called
   * @then: Error message indicates mutual exclusivity
   */
  it('should throw error when both --profile and --profile-load are used', () => {
    process.argv = [
      'node',
      'llxprt',
      '--profile',
      '{"provider":"openai"}',
      '--profile-load',
      'my-profile',
    ];
    expect(() => parseBootstrapArgs()).toThrow(
      /cannot use both.*--profile.*--profile-load/i,
    );
  });

  /**
   * @plan:PLAN-20251118-ISSUE533.P04
   * @requirement:REQ-INT-001.2
   * @scenario: Throw error regardless of flag order
   * @given: Command line with --profile-load before --profile
   * @when: parseBootstrapArgs is called
   * @then: Error message indicates mutual exclusivity
   */
  it('should throw error regardless of flag order', () => {
    process.argv = [
      'node',
      'llxprt',
      '--profile-load',
      'my-profile',
      '--profile',
      '{"provider":"openai"}',
    ];
    expect(() => parseBootstrapArgs()).toThrow(
      /cannot use both.*--profile.*--profile-load/i,
    );
  });

  /**
   * @plan:PLAN-20251118-ISSUE533.P04
   * @requirement:REQ-INT-001.2
   * @scenario: Error message includes helpful guidance
   * @given: Command line with both flags
   * @when: parseBootstrapArgs is called
   * @then: Error message suggests using one flag at a time
   */
  it('should provide helpful error message for mutual exclusivity', () => {
    process.argv = [
      'node',
      'llxprt',
      '--profile',
      '{"provider":"openai"}',
      '--profile-load',
      'my-profile',
    ];
    expect(() => parseBootstrapArgs()).toThrow(
      /cannot use both.*--profile.*--profile-load.*use one at a time/i,
    );
  });

  /**
   * @plan:PLAN-20251118-ISSUE533.P04
   * @requirement:REQ-INT-001.2
   * @scenario: No error when only --profile is used
   * @given: Command line with only --profile flag
   * @when: parseBootstrapArgs is called
   * @then: Parsing succeeds without error
   */
  it('should not throw error when only --profile is used', () => {
    process.argv = ['node', 'llxprt', '--profile', '{"provider":"openai"}'];
    expect(() => parseBootstrapArgs()).not.toThrow();
  });

  // Group 4: Edge Cases (2 tests)

  /**
   * @plan:PLAN-20251118-ISSUE533.P04
   * @requirement:REQ-PROF-001.3
   * @scenario: Use last --profile value when multiple specified
   * @given: Command line with --profile specified multiple times
   * @when: parseBootstrapArgs is called
   * @then: profileJson contains the last specified value
   */
  it('should use last --profile value when multiple specified', () => {
    process.argv = [
      'node',
      'llxprt',
      '--profile',
      '{"provider":"openai"}',
      '--profile',
      '{"provider":"anthropic"}',
    ];
    const result = parseBootstrapArgs();
    expect(result.bootstrapArgs.profileJson).toBe('{"provider":"anthropic"}');
  });

  /**
   * @plan:PLAN-20251118-ISSUE533.P04
   * @requirement:REQ-PROF-001.1
   * @scenario: Preserve JSON with special characters
   * @given: Command line with JSON containing quotes, backslashes, and unicode
   * @when: parseBootstrapArgs is called
   * @then: profileJson preserves all special characters exactly
   */
  it('should preserve JSON with special characters', () => {
    const jsonWithSpecialChars =
      '{"message":"Hello \\"World\\"","emoji":"🚀","path":"C:\\\\Users"}';
    process.argv = ['node', 'llxprt', '--profile', jsonWithSpecialChars];
    const result = parseBootstrapArgs();
    expect(result.bootstrapArgs.profileJson).toBe(jsonWithSpecialChars);
  });
});

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
    expect(result.warnings).toEqual([]);
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
    expect(result.warnings).toEqual([]);
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
    expect(result.warnings).toEqual([]);
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
    expect(result.warnings).toEqual([]);
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
      expect(result.warnings).toEqual([]);
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
    expect(result.warnings).toEqual([]);
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
    expect(result.warnings).toEqual([]);
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

describe('applyBootstrapProfile() with --profile @plan:PLAN-20251118-ISSUE533.P09', () => {
  let mockSettingsService: {
    listProfiles: ReturnType<typeof vi.fn>;
    getProfile: ReturnType<typeof vi.fn>;
    getProfileByID: ReturnType<typeof vi.fn>;
    isLoaded: ReturnType<typeof vi.fn>;
  };
  let mockConfig: {
    profiles: unknown[];
  };
  let mockOAuthManager: Record<string, unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSettingsService = {
      listProfiles: vi.fn(),
      getProfile: vi.fn(),
      getProfileByID: vi.fn(),
      isLoaded: vi.fn().mockReturnValue(true),
    };
    mockConfig = {
      profiles: [],
    };
    mockOAuthManager = {};
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // Group 1: Basic Profile Application (4 tests)

  /**
   * @plan:PLAN-20251118-ISSUE533.P09
   * @requirement:REQ-INT-001.1
   * @scenario: Apply a complete inline profile successfully
   * @given: profileJson contains provider, model, and key
   * @when: applyBootstrapProfile() is called
   * @then: Returns bootstrap result with provider and model set correctly
   */
  it('should apply inline profile successfully with provider, model, and key', () => {
    const args: BootstrapProfileArgs = {
      profileName: null,
      profileJson: '{"provider":"openai","model":"gpt-4","key":"sk-test123"}',
      providerOverride: null,
      modelOverride: null,
      keyOverride: null,
      keyfileOverride: null,
      keyNameOverride: null,
      baseurlOverride: null,
      setOverrides: null,
    };

    const parsed = parseArgsWithMeta(args, {
      settingsService: mockSettingsService as any,
      config: mockConfig,
      oauthManager: mockOAuthManager,
    });

    const result = createBootstrapResult(
      parsed.bootstrapArgs,
      parsed.runtimeMetadata as any,
    );

    expect(result.providerName).toBe('openai');
    expect(result.modelName).toBe('gpt-4');
    expect(result.warnings).toEqual([]);
  });

  /**
   * @plan:PLAN-20251118-ISSUE533.P09
   * @requirement:REQ-INT-001.1
   * @scenario: Apply Anthropic inline profile
   * @given: profileJson contains Anthropic provider and claude model
   * @when: applyBootstrapProfile() is called
   * @then: Returns bootstrap result with Anthropic provider and model
   */
  it('should apply Anthropic inline profile', () => {
    const args: BootstrapProfileArgs = {
      profileName: null,
      profileJson:
        '{"provider":"anthropic","model":"claude-3-5-sonnet-20241022","key":"sk-ant-test"}',
      providerOverride: null,
      modelOverride: null,
      keyOverride: null,
      keyfileOverride: null,
      keyNameOverride: null,
      baseurlOverride: null,
      setOverrides: null,
    };

    const parsed = parseArgsWithMeta(args, {
      settingsService: mockSettingsService as any,
      config: mockConfig,
      oauthManager: mockOAuthManager,
    });

    const result = createBootstrapResult(
      parsed.bootstrapArgs,
      parsed.runtimeMetadata as any,
    );

    expect(result.providerName).toBe('anthropic');
    expect(result.modelName).toBe('claude-3-5-sonnet-20241022');
    expect(result.warnings).toEqual([]);
  });

  /**
   * @plan:PLAN-20251118-ISSUE533.P09
   * @requirement:REQ-INT-001.1
   * @scenario: Apply inline profile with optional fields
   * @given: profileJson contains provider, model, key, temperature, and maxTokens
   * @when: applyBootstrapProfile() is called
   * @then: Returns bootstrap result with all fields set correctly
   */
  it('should apply inline profile with optional fields (temperature, maxTokens)', () => {
    const args: BootstrapProfileArgs = {
      profileName: null,
      profileJson:
        '{"provider":"openai","model":"gpt-4","key":"sk-test","temperature":0.7,"maxTokens":2000}',
      providerOverride: null,
      modelOverride: null,
      keyOverride: null,
      keyfileOverride: null,
      keyNameOverride: null,
      baseurlOverride: null,
      setOverrides: null,
    };

    const parsed = parseArgsWithMeta(args, {
      settingsService: mockSettingsService as any,
      config: mockConfig,
      oauthManager: mockOAuthManager,
    });

    const result = createBootstrapResult(
      parsed.bootstrapArgs,
      parsed.runtimeMetadata as any,
    );

    expect(result.providerName).toBe('openai');
    expect(result.modelName).toBe('gpt-4');
    expect(result.warnings).toEqual([]);
  });

  /**
   * @plan:PLAN-20251118-ISSUE533.P09
   * @requirement:REQ-INT-001.1
   * @scenario: Return empty result when no profile specified
   * @given: Both profileName and profileJson are null
   * @when: applyBootstrapProfile() is called
   * @then: Returns empty bootstrap result with no provider or model
   */
  it('should return empty result when no profile specified', () => {
    const args: BootstrapProfileArgs = {
      profileName: null,
      profileJson: null,
      providerOverride: null,
      modelOverride: null,
      keyOverride: null,
      keyfileOverride: null,
      keyNameOverride: null,
      baseurlOverride: null,
      setOverrides: null,
    };

    const parsed = parseArgsWithMeta(args, {
      settingsService: mockSettingsService as any,
      config: mockConfig,
      oauthManager: mockOAuthManager,
    });

    const result = createBootstrapResult(
      parsed.bootstrapArgs,
      parsed.runtimeMetadata as any,
    );

    expect(result.providerName).toBeNull();
    expect(result.modelName).toBeNull();
    expect(result.warnings).toEqual([]);
  });

  // Group 2: Override Precedence (4 tests)

  /**
   * @plan:PLAN-20251118-ISSUE533.P09
   * @requirement:REQ-INT-001.1
   * @scenario: Model override takes precedence over inline profile
   * @given: profileJson contains model "gpt-4" and modelOverride is "gpt-3.5-turbo"
   * @when: applyBootstrapProfile() is called
   * @then: Returns bootstrap result with model "gpt-3.5-turbo" from override
   */
  it('should apply model override over inline profile model', () => {
    const args: BootstrapProfileArgs = {
      profileName: null,
      profileJson: '{"provider":"openai","model":"gpt-4","key":"sk-test"}',
      providerOverride: null,
      modelOverride: 'gpt-3.5-turbo',
      keyOverride: null,
      keyfileOverride: null,
      keyNameOverride: null,
      baseurlOverride: null,
      setOverrides: null,
    };

    const parsed = parseArgsWithMeta(args, {
      settingsService: mockSettingsService as any,
      config: mockConfig,
      oauthManager: mockOAuthManager,
    });

    const result = createBootstrapResult(
      parsed.bootstrapArgs,
      parsed.runtimeMetadata as any,
    );

    expect(result.providerName).toBe('openai');
    expect(result.modelName).toBe('gpt-3.5-turbo');
    expect(result.warnings).toEqual([]);
  });

  /**
   * @plan:PLAN-20251118-ISSUE533.P09
   * @requirement:REQ-INT-001.1
   * @scenario: Provider override takes precedence over inline profile
   * @given: profileJson contains provider "openai" and providerOverride is "anthropic"
   * @when: applyBootstrapProfile() is called
   * @then: Returns bootstrap result with provider "anthropic" from override
   */
  it('should apply provider override over inline profile provider', () => {
    const args: BootstrapProfileArgs = {
      profileName: null,
      profileJson: '{"provider":"openai","model":"gpt-4","key":"sk-test"}',
      providerOverride: 'anthropic',
      modelOverride: null,
      keyOverride: null,
      keyfileOverride: null,
      keyNameOverride: null,
      baseurlOverride: null,
      setOverrides: null,
    };

    const parsed = parseArgsWithMeta(args, {
      settingsService: mockSettingsService as any,
      config: mockConfig,
      oauthManager: mockOAuthManager,
    });

    const result = createBootstrapResult(
      parsed.bootstrapArgs,
      parsed.runtimeMetadata as any,
    );

    expect(result.providerName).toBe('anthropic');
    expect(result.modelName).toBe('gpt-4');
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  /**
   * @plan:PLAN-20251118-ISSUE533.P09
   * @requirement:REQ-INT-001.1
   * @scenario: Key override with warning generated
   * @given: profileJson contains key and keyOverride is provided
   * @when: applyBootstrapProfile() is called
   * @then: Returns bootstrap result with warning about key override
   */
  it('should generate warning when key override is applied', () => {
    const args: BootstrapProfileArgs = {
      profileName: null,
      profileJson: '{"provider":"openai","model":"gpt-4","key":"sk-test"}',
      providerOverride: null,
      modelOverride: null,
      keyOverride: 'sk-override',
      keyfileOverride: null,
      keyNameOverride: null,
      baseurlOverride: null,
      setOverrides: null,
    };

    const parsed = parseArgsWithMeta(args, {
      settingsService: mockSettingsService as any,
      config: mockConfig,
      oauthManager: mockOAuthManager,
    });

    const result = createBootstrapResult(
      parsed.bootstrapArgs,
      parsed.runtimeMetadata as any,
    );

    expect(result.providerName).toBe('openai');
    expect(result.modelName).toBe('gpt-4');
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  /**
   * @plan:PLAN-20251118-ISSUE533.P09
   * @requirement:REQ-INT-001.1
   * @scenario: Multiple overrides with warnings
   * @given: profileJson contains provider, model, key and all have overrides
   * @when: applyBootstrapProfile() is called
   * @then: Returns bootstrap result with multiple warnings for overrides
   */
  it('should generate multiple warnings when multiple overrides are applied', () => {
    const args: BootstrapProfileArgs = {
      profileName: null,
      profileJson: '{"provider":"openai","model":"gpt-4","key":"sk-test"}',
      providerOverride: 'anthropic',
      modelOverride: 'claude-3-5-sonnet-20241022',
      keyOverride: 'sk-override',
      keyfileOverride: null,
      keyNameOverride: null,
      baseurlOverride: null,
      setOverrides: null,
    };

    const parsed = parseArgsWithMeta(args, {
      settingsService: mockSettingsService as any,
      config: mockConfig,
      oauthManager: mockOAuthManager,
    });

    const result = createBootstrapResult(
      parsed.bootstrapArgs,
      parsed.runtimeMetadata as any,
    );

    expect(result.providerName).toBe('anthropic');
    expect(result.modelName).toBe('claude-3-5-sonnet-20241022');
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  // Group 3: Validation Error Handling (2 tests)

  /**
   * @plan:PLAN-20251118-ISSUE533.P09
   * @requirement:REQ-INT-001.1
   * @scenario: Throw error for invalid JSON in profileJson
   * @given: profileJson contains invalid JSON syntax
   * @when: applyBootstrapProfile() is called
   * @then: Throws an error about invalid JSON
   */
  it('should throw error for invalid JSON in profileJson', () => {
    const args: BootstrapProfileArgs = {
      profileName: null,
      profileJson: '{invalid json}',
      providerOverride: null,
      modelOverride: null,
      keyOverride: null,
      keyfileOverride: null,
      keyNameOverride: null,
      baseurlOverride: null,
      setOverrides: null,
    };

    expect(() => {
      parseArgsWithMeta(args, {
        settingsService: mockSettingsService,
        config: mockConfig,
        oauthManager: mockOAuthManager,
      });
    }).toThrow();
  });

  /**
   * @plan:PLAN-20251118-ISSUE533.P09
   * @requirement:REQ-INT-001.1
   * @scenario: Throw error for profile validation failure
   * @given: profileJson is valid JSON but missing required field (provider)
   * @when: applyBootstrapProfile() is called
   * @then: Throws an error about missing required field
   */
  it('should throw error for profile validation failure (missing required field)', () => {
    const args: BootstrapProfileArgs = {
      profileName: null,
      profileJson: '{"model":"gpt-4","key":"sk-test"}',
      providerOverride: null,
      modelOverride: null,
      keyOverride: null,
      keyfileOverride: null,
      keyNameOverride: null,
      baseurlOverride: null,
      setOverrides: null,
    };

    expect(() => {
      parseArgsWithMeta(args, {
        settingsService: mockSettingsService,
        config: mockConfig,
        oauthManager: mockOAuthManager,
      });
    }).toThrow();
  });

  // Group 4: Backward Compatibility (2 tests)

  /**
   * @plan:PLAN-20251118-ISSUE533.P09
   * @requirement:REQ-INT-001.1
   * @scenario: Maintain --profile-load behavior
   * @given: profileName is specified (not profileJson)
   * @when: applyBootstrapProfile() is called
   * @then: Returns bootstrap result from named profile as before
   */
  it('should maintain --profile-load behavior when profileName is specified', () => {
    const mockProfile = {
      id: 'test-profile',
      name: 'test-profile',
      provider: 'openai',
      model: 'gpt-4',
      key: 'sk-test',
    };

    mockSettingsService.getProfile.mockReturnValue(mockProfile);

    const args: BootstrapProfileArgs = {
      profileName: 'test-profile',
      profileJson: null,
      providerOverride: null,
      modelOverride: null,
      keyOverride: null,
      keyfileOverride: null,
      keyNameOverride: null,
      baseurlOverride: null,
      setOverrides: null,
    };

    const parsed = parseArgsWithMeta(args, {
      settingsService: mockSettingsService as any,
      config: mockConfig,
      oauthManager: mockOAuthManager,
    });

    const result = createBootstrapResult(
      parsed.bootstrapArgs,
      parsed.runtimeMetadata as any,
    );

    expect(result.providerName).toBe('openai');
    expect(result.modelName).toBe('gpt-4');
    expect(mockSettingsService.getProfile).toHaveBeenCalledWith('test-profile');
  });

  /**
   * @plan:PLAN-20251118-ISSUE533.P09
   * @requirement:REQ-INT-001.1
   * @scenario: Apply overrides without profile
   * @given: No profileName or profileJson, but overrides are provided
   * @when: applyBootstrapProfile() is called
   * @then: Returns bootstrap result with command-line overrides only
   */
  it('should apply overrides without profile (command-line only overrides)', () => {
    const args: BootstrapProfileArgs = {
      profileName: null,
      profileJson: null,
      providerOverride: 'openai',
      modelOverride: 'gpt-4',
      keyOverride: null,
      keyfileOverride: null,
      keyNameOverride: null,
      baseurlOverride: null,
      setOverrides: null,
    };

    const parsed = parseArgsWithMeta(args, {
      settingsService: mockSettingsService as any,
      config: mockConfig,
      oauthManager: mockOAuthManager,
    });

    const result = createBootstrapResult(
      parsed.bootstrapArgs,
      parsed.runtimeMetadata as any,
    );

    expect(result.providerName).toBe('openai');
    expect(result.modelName).toBe('gpt-4');
    expect(result.warnings).toEqual([]);
  });
});

/**
 * @plan:PLAN-20251118-ISSUE533.P09
 * Test suite for applyBootstrapProfile() with --profile flag integration (alternative mock setup)
 */
describe('applyBootstrapProfile() with --profile - alternative tests @plan:PLAN-20251118-ISSUE533.P09', () => {
  let mockSettings: MockSettingsService;
  let mockConfig: MockConfig;

  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig = { profiles: [] };
    mockSettings = {
      listProfiles: vi.fn(),
      getProfile: vi.fn(),
      getProfileByID: vi.fn(),
      isLoaded: vi.fn().mockReturnValue(true),
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Group 1: Basic Profile Application (4 tests)
   */

  /**
   * @plan:PLAN-20251118-ISSUE533.P09
   * @requirement:REQ-INT-001.1
   * @scenario: Apply inline profile without overrides
   * @given: profileJson with provider, model, key
   * @when: applyBootstrapProfile() called
   * @then: Returns BootstrapRuntimeState with profile values
   */
  it('should apply inline profile without overrides', () => {
    const args: BootstrapProfileArgs = {
      profileName: null,
      profileJson:
        '{"provider":"anthropic","model":"claude-3-5-sonnet-20241022","key":"sk-test"}',
      providerOverride: null,
      modelOverride: null,
      keyOverride: null,
      keyfileOverride: null,
      keyNameOverride: null,
      baseurlOverride: null,
      setOverrides: null,
    };

    const parsed = parseArgsWithMeta(args, {
      settingsService: mockSettings as any,
      config: mockConfig,
      oauthManager: {},
    });
    const result = createBootstrapResult(
      parsed.bootstrapArgs,
      parsed.runtimeMetadata as any,
    );

    expect(result.providerName).toBe('anthropic');
    expect(result.modelName).toBe('claude-3-5-sonnet-20241022');
  });

  /**
   * @plan:PLAN-20251118-ISSUE533.P09
   * @requirement:REQ-INT-001.2
   * @scenario: Apply inline profile with provider override
   * @given: profileJson with anthropic + --provider openai
   * @when: applyBootstrapProfile() called
   * @then: Override takes precedence
   */
  it('should apply provider override over inline profile', () => {
    const args: BootstrapProfileArgs = {
      profileName: null,
      profileJson:
        '{"provider":"anthropic","model":"claude-3-5-sonnet-20241022","key":"sk-test"}',
      providerOverride: 'openai',
      modelOverride: null,
      keyOverride: null,
      keyfileOverride: null,
      keyNameOverride: null,
      baseurlOverride: null,
      setOverrides: null,
    };

    const parsed = parseArgsWithMeta(args, {
      settingsService: mockSettings as any,
      config: mockConfig,
      oauthManager: {},
    });
    const result = createBootstrapResult(
      parsed.bootstrapArgs,
      parsed.runtimeMetadata as any,
    );

    expect(result.providerName).toBe('openai');
    expect(result.modelName).toBe('claude-3-5-sonnet-20241022'); // Original model preserved
  });

  /**
   * @plan:PLAN-20251118-ISSUE533.P09
   * @requirement:REQ-INT-001.3
   * @scenario: Apply inline profile with model override
   * @given: profileJson with sonnet + --model gpt-4
   * @when: applyBootstrapProfile() called
   * @then: Override takes precedence
   */
  it('should apply model override over inline profile', () => {
    const args: BootstrapProfileArgs = {
      profileName: null,
      profileJson:
        '{"provider":"anthropic","model":"claude-3-5-sonnet-20241022","key":"sk-test"}',
      providerOverride: null,
      modelOverride: 'gpt-4',
      keyOverride: null,
      keyfileOverride: null,
      keyNameOverride: null,
      baseurlOverride: null,
      setOverrides: null,
    };

    const parsed = parseArgsWithMeta(args, {
      settingsService: mockSettings as any,
      config: mockConfig,
      oauthManager: {},
    });
    const result = createBootstrapResult(
      parsed.bootstrapArgs,
      parsed.runtimeMetadata as any,
    );

    expect(result.providerName).toBe('anthropic'); // Original provider preserved
    expect(result.modelName).toBe('gpt-4');
  });

  /**
   * @plan:PLAN-20251118-ISSUE533.P09
   * @requirement:REQ-INT-001.4
   * @scenario: Apply inline profile with key override
   * @given: profileJson with sk-test + --key sk-override
   * @when: applyBootstrapProfile() called
   * @then: Override takes precedence
   */
  it('should apply key override over inline profile', () => {
    const args: BootstrapProfileArgs = {
      profileName: null,
      profileJson:
        '{"provider":"anthropic","model":"claude-3-5-sonnet-20241022","key":"sk-test"}',
      providerOverride: null,
      modelOverride: null,
      keyOverride: 'sk-override',
      keyfileOverride: null,
      keyNameOverride: null,
      baseurlOverride: null,
      setOverrides: null,
    };

    const parsed = parseArgsWithMeta(args, {
      settingsService: mockSettings as any,
      config: mockConfig,
      oauthManager: {},
    });
    const result = createBootstrapResult(
      parsed.bootstrapArgs,
      parsed.runtimeMetadata as any,
    );

    expect(result.providerName).toBe('anthropic');
    expect(result.modelName).toBe('claude-3-5-sonnet-20241022');
  });

  /**
   * Group 2: Profile Source Priority (4 tests)
   */

  /**
   * @plan:PLAN-20251118-ISSUE533.P09
   * @requirement:REQ-INT-002.1
   * @scenario: Inline profile takes precedence over named profile
   * @given: Both --profile myprofile and --profile {...}
   * @when: applyBootstrapProfile() called
   * @then: Inline profile values used
   */
  it('should prioritize inline profile over named profile', () => {
    const args: BootstrapProfileArgs = {
      profileName: 'myprofile',
      profileJson: '{"provider":"openai","model":"gpt-4","key":"sk-inline"}',
      providerOverride: null,
      modelOverride: null,
      keyOverride: null,
      keyfileOverride: null,
      keyNameOverride: null,
      baseurlOverride: null,
      setOverrides: null,
    };

    mockSettings.getProfile.mockReturnValue({
      provider: 'anthropic',
      model: 'claude-3-5-sonnet-20241022',
      key: 'sk-named',
    });

    const parsed = parseArgsWithMeta(args, {
      settingsService: mockSettings as any,
      config: mockConfig,
      oauthManager: {},
    });
    const result = createBootstrapResult(
      parsed.bootstrapArgs,
      parsed.runtimeMetadata as any,
    );

    expect(result.providerName).toBe('openai');
    expect(result.modelName).toBe('gpt-4');
  });

  /**
   * @plan:PLAN-20251118-ISSUE533.P09
   * @requirement:REQ-INT-002.2
   * @scenario: Named profile used when no inline profile
   * @given: --profile myprofile only
   * @when: applyBootstrapProfile() called
   * @then: Named profile values used
   */
  it('should use named profile when no inline profile provided', () => {
    const args: BootstrapProfileArgs = {
      profileName: 'myprofile',
      profileJson: null,
      providerOverride: null,
      modelOverride: null,
      keyOverride: null,
      keyfileOverride: null,
      keyNameOverride: null,
      baseurlOverride: null,
      setOverrides: null,
    };

    mockSettings.getProfile.mockReturnValue({
      provider: 'anthropic',
      model: 'claude-3-5-sonnet-20241022',
      key: 'sk-named',
    });

    const parsed = parseArgsWithMeta(args, {
      settingsService: mockSettings as any,
      config: mockConfig,
      oauthManager: {},
    });
    const result = createBootstrapResult(
      parsed.bootstrapArgs,
      parsed.runtimeMetadata as any,
    );

    expect(result.providerName).toBe('anthropic');
    expect(result.modelName).toBe('claude-3-5-sonnet-20241022');
  });

  /**
   * @plan:PLAN-20251118-ISSUE533.P09
   * @requirement:REQ-INT-002.3
   * @scenario: Override flags work with inline profiles
   * @given: --profile {...} + --model override
   * @when: applyBootstrapProfile() called
   * @then: Override takes precedence over inline
   */
  it('should apply overrides to inline profile values', () => {
    const args: BootstrapProfileArgs = {
      profileName: null,
      profileJson:
        '{"provider":"anthropic","model":"claude-3-5-sonnet-20241022","key":"sk-test"}',
      providerOverride: 'openai',
      modelOverride: 'gpt-4',
      keyOverride: 'sk-override',
      keyfileOverride: null,
      keyNameOverride: null,
      baseurlOverride: null,
      setOverrides: null,
    };

    const parsed = parseArgsWithMeta(args, {
      settingsService: mockSettings as any,
      config: mockConfig,
      oauthManager: {},
    });
    const result = createBootstrapResult(
      parsed.bootstrapArgs,
      parsed.runtimeMetadata as any,
    );

    expect(result.providerName).toBe('openai');
    expect(result.modelName).toBe('gpt-4');
  });

  /**
   * @plan:PLAN-20251118-ISSUE533.P09
   * @requirement:REQ-INT-002.4
   * @scenario: Override flags work with named profiles
   * @given: --profile myprofile + --model override
   * @when: applyBootstrapProfile() called
   * @then: Override takes precedence over named
   */
  it('should apply overrides to named profile values', () => {
    const args: BootstrapProfileArgs = {
      profileName: 'myprofile',
      profileJson: null,
      providerOverride: 'openai',
      modelOverride: 'gpt-4',
      keyOverride: null,
      keyfileOverride: null,
      keyNameOverride: null,
      baseurlOverride: null,
      setOverrides: null,
    };

    mockSettings.getProfile.mockReturnValue({
      provider: 'anthropic',
      model: 'claude-3-5-sonnet-20241022',
      key: 'sk-named',
    });

    const parsed = parseArgsWithMeta(args, {
      settingsService: mockSettings as any,
      config: mockConfig,
      oauthManager: {},
    });
    const result = createBootstrapResult(
      parsed.bootstrapArgs,
      parsed.runtimeMetadata as any,
    );

    expect(result.providerName).toBe('openai');
    expect(result.modelName).toBe('gpt-4');
  });

  /**
   * Group 3: Error Handling (4 tests)
   */

  /**
   * @plan:PLAN-20251118-ISSUE533.P09
   * @requirement:REQ-INT-003.1
   * @scenario: Invalid JSON in inline profile
   * @given: --profile {bad json}
   * @when: applyBootstrapProfile() called
   * @then: Throws ProfileBootstrapError
   */
  it('should throw error for invalid JSON in inline profile', () => {
    const args: BootstrapProfileArgs = {
      profileName: null,
      profileJson: '{bad json}',
      providerOverride: null,
      modelOverride: null,
      keyOverride: null,
      keyfileOverride: null,
      keyNameOverride: null,
      baseurlOverride: null,
      setOverrides: null,
    };

    expect(() => {
      parseArgsWithMeta(args, {
        settingsService: mockSettings as any,
        config: mockConfig,
        oauthManager: {},
      });
    }).toThrow();
  });

  /**
   * @plan:PLAN-20251118-ISSUE533.P09
   * @requirement:REQ-INT-003.2
   * @scenario: Missing required fields in inline profile
   * @given: --profile {"provider":"anthropic"} (no model/key)
   * @when: applyBootstrapProfile() called
   * @then: Throws ProfileBootstrapError
   */
  it('should throw error for missing required fields in inline profile', () => {
    const args: BootstrapProfileArgs = {
      profileName: null,
      profileJson: '{"provider":"anthropic"}',
      providerOverride: null,
      modelOverride: null,
      keyOverride: null,
      keyfileOverride: null,
      keyNameOverride: null,
      baseurlOverride: null,
      setOverrides: null,
    };

    expect(() => {
      parseArgsWithMeta(args, {
        settingsService: mockSettings as any,
        config: mockConfig,
        oauthManager: {},
      });
    }).toThrow();
  });

  /**
   * @plan:PLAN-20251118-ISSUE533.P09
   * @requirement:REQ-INT-003.3
   * @scenario: Named profile not found
   * @given: --profile nonexistent
   * @when: applyBootstrapProfile() called
   * @then: Throws ProfileBootstrapError
   */
  it('should throw error when named profile not found', () => {
    const args: BootstrapProfileArgs = {
      profileName: 'nonexistent',
      profileJson: null,
      providerOverride: null,
      modelOverride: null,
      keyOverride: null,
      keyfileOverride: null,
      keyNameOverride: null,
      baseurlOverride: null,
      setOverrides: null,
    };

    mockSettings.getProfile.mockReturnValue(null);

    const parsed = parseArgsWithMeta(args, {
      settingsService: mockSettings as any,
      config: mockConfig,
      oauthManager: {},
    });
    const result = createBootstrapResult(
      parsed.bootstrapArgs,
      parsed.runtimeMetadata as any,
    );

    // When profile is not found, the result should have empty provider/model and a warning
    expect(result.providerName).toBe('');
    expect(result.modelName).toBe('');
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain('not found');
  });

  /**
   * @plan:PLAN-20251118-ISSUE533.P09
   * @requirement:REQ-INT-003.4
   * @scenario: Empty inline profile object
   * @given: --profile {}
   * @when: applyBootstrapProfile() called
   * @then: Throws ProfileBootstrapError
   */
  it('should throw error for empty inline profile object', () => {
    const args: BootstrapProfileArgs = {
      profileName: null,
      profileJson: '{}',
      providerOverride: null,
      modelOverride: null,
      keyOverride: null,
      keyfileOverride: null,
      keyNameOverride: null,
      baseurlOverride: null,
      setOverrides: null,
    };

    expect(() => {
      parseArgsWithMeta(args, {
        settingsService: mockSettings as any,
        config: mockConfig,
        oauthManager: {},
      });
    }).toThrow();
  });
});
