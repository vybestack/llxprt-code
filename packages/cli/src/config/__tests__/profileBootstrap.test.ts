/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import {
  DEFAULT_RUNTIME_ID,
  parseBootstrapArgs,
  prepareRuntimeForProfile,
  createBootstrapResult,
} from '../profileBootstrap.js';

function profileArgs() {
  return {
    profileName: null,
    profileJson: null,
    providerOverride: null,
    modelOverride: null,
    keyOverride: null,
    keyfileOverride: null,
    keyNameOverride: null,
    baseurlOverride: null,
    setOverrides: null,
    debug: null,
  };
}

describe('profileBootstrap helpers', () => {
  const originalArgv = process.argv;
  beforeEach(() => {
    process.argv = [...originalArgv];
  });
  afterEach(() => {
    process.argv = originalArgv;
  });

  it('parses CLI args without --profile-load', () => {
    process.argv = ['bun', 'llxprt', '--sandbox'];
    expect(parseBootstrapArgs().bootstrapArgs).toMatchObject({
      profileName: null,
      providerOverride: null,
      modelOverride: null,
    });
  });

  it('parses CLI args with --profile-load', () => {
    process.argv = ['bun', 'llxprt', '--profile-load', 'synthetic'];
    expect(parseBootstrapArgs().bootstrapArgs).toMatchObject({
      profileName: 'synthetic',
      providerOverride: null,
      modelOverride: null,
    });
  });

  it('merges repeated --set arguments while preserving their order', () => {
    process.argv = [
      'bun',
      'llxprt',
      '--set',
      'modelparam.temperature=1',
      '--set',
      'context-limit=190000',
      '--set=shell-replacement=true',
    ];
    expect(parseBootstrapArgs().bootstrapArgs.setOverrides).toStrictEqual([
      'modelparam.temperature=1',
      'context-limit=190000',
      'shell-replacement=true',
    ]);
  });

  it('prepares runtime before applying profile state', async () => {
    const parsed = parseBootstrapArgs(profileArgs(), {});
    const operation = await prepareRuntimeForProfile(
      parsed,
      new CredentialAuthority(),
      new SettingsService(),
      undefined,
      undefined,
    );
    try {
      operation.chooseProviderModel('openai', 'selected-model');
      const result = createBootstrapResult(
        {
          ...parsed.bootstrapArgs,
          profileJson: '{"provider":"openai","model":"profile-model"}',
        },
        undefined,
      );
      expect(result).toMatchObject({
        providerName: 'openai',
        modelName: 'profile-model',
      });
      expect('runtime' in operation).toBe(false);
      expect('providerManager' in operation).toBe(false);
    } finally {
      await operation.dispose();
    }
  });

  it('includes runtime metadata in the preflight data', async () => {
    const operation = await prepareRuntimeForProfile(
      parseBootstrapArgs(profileArgs(), {
        runtimeId: 'cli-runtime',
        metadata: { sessionId: 'bootstrap-session', source: 'test' },
      }),
      new CredentialAuthority(),
      undefined,
      undefined,
      undefined,
    );
    try {
      expect(operation.captureInput()).toMatchObject({
        runtimeId: 'cli-runtime',
        metadata: {
          sessionId: 'bootstrap-session',
          source: 'test',
          stage: 'prepareRuntimeForProfile',
        },
      });
    } finally {
      await operation.dispose();
    }
  });
});

describe('prepareRuntimeForProfile agents preflight', () => {
  it('supplies the resolved runtimeId and declarative context without returning services', async () => {
    const operation = await prepareRuntimeForProfile(
      parseBootstrapArgs(profileArgs(), {
        runtimeId: 'cli.runtime.bootstrap.ordering-test',
        metadata: { source: 'ordering-test' },
      }),
      new CredentialAuthority(),
      undefined,
      undefined,
      undefined,
    );
    try {
      expect(operation.captureInput()).toMatchObject({
        runtimeId: 'cli.runtime.bootstrap.ordering-test',
        metadata: { source: 'ordering-test' },
      });
      expect('registration' in operation).toBe(false);
      expect('runtimeMessageBus' in operation).toBe(false);
    } finally {
      await operation.dispose();
    }
  });

  it('supplies a deterministic default runtimeId when metadata omits one', async () => {
    const operation = await prepareRuntimeForProfile(
      parseBootstrapArgs(profileArgs(), {}),
      new CredentialAuthority(),
      undefined,
      undefined,
      undefined,
    );
    try {
      expect(operation.captureInput().runtimeId).toBe(DEFAULT_RUNTIME_ID);
    } finally {
      await operation.dispose();
    }
  });

  it('fails before provider construction without a credential authority', async () => {
    await expect(
      prepareRuntimeForProfile(
        parseBootstrapArgs(profileArgs(), {}),
        undefined,
        undefined,
        undefined,
        undefined,
      ),
    ).rejects.toThrow('requires a credential authority');
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
    expect(result.bootstrapArgs.setOverrides).toStrictEqual(['debug=true']);
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
    expect(() => parseBootstrapArgs()).toThrow(/--profile requires a value/);
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
    expect(() => parseBootstrapArgs()).toThrow(/--profile requires a value/);
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
      'Cannot use both --profile and --profile-load',
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
      'Cannot use both --profile and --profile-load',
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
    expect(() => parseBootstrapArgs()).toThrow('Use one at a time');
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
