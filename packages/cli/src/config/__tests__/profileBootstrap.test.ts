/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_RUNTIME_ID,
  parseBootstrapArgs,
  prepareRuntimeForProfile,
  createBootstrapResult,
} from '../profileBootstrap.js';
import { assembleCliProviderRuntime } from '@vybestack/llxprt-code-providers/runtime.js';

// The pre-Config provider-runtime assembly (identity binding → session
// MessageBus construction → provider/OAuth manager → CLI infra registration,
// with the issue-#2300 ordering) is OWNED by the providers package
// (#2378). It is behaviorally tested at that boundary in
// packages/providers/src/runtime/assembleCliProviderRuntime.test.ts. Here it
// is the external boundary: stub it so prepareRuntimeForProfile is exercised
// as a thin client that supplies declarative context and adopts the result.
vi.mock('@vybestack/llxprt-code-providers/runtime.js', () => ({
  registerAgentRuntimeFactories: vi.fn(),
  resetAgentRuntimeFactories: vi.fn(),
  ephemeralSettingHelp: {},
  parseEphemeralSettingValue: vi.fn((_key: string, rawValue: string) => ({
    success: true,
    value: rawValue,
  })),
  applyCliSetArguments: vi.fn(() => ({ modelParams: {} })),
  assembleCliProviderRuntime: vi.fn(
    (input: {
      settingsService: unknown;
      config: unknown;
      runtimeId: string;
      metadata?: Record<string, unknown>;
    }) => ({
      runtime: {
        settingsService: input.settingsService,
        config: input.config,
        runtimeId: input.runtimeId,
        metadata: input.metadata,
      },
      runtimeMessageBus: { kind: 'session-bus' },
      providerManager: { id: 'provider-manager' },
      oauthManager: { id: 'oauth-manager' },
    }),
  ),
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
  debug: string | boolean | null;
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
  runtimeMessageBus: unknown;
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
    expect(parsed.bootstrapArgs.setOverrides).toStrictEqual([
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
        debug: null,
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

describe('prepareRuntimeForProfile delegates assembly to the providers boundary (#2378, issue #2300)', () => {
  const mockedAssemble = vi.mocked(assembleCliProviderRuntime);

  beforeEach(() => {
    mockedAssemble.mockClear();
  });

  it('supplies the resolved runtimeId + declarative context to the owned assembly and adopts its result', async () => {
    const explicitRuntimeId = 'cli.runtime.bootstrap.ordering-test';
    const parsed: ParsedBootstrapArgs = {
      bootstrapArgs: {
        profileName: 'workspace',
        profileJson: null,
        providerOverride: null,
        modelOverride: null,
        keyOverride: null,
        keyfileOverride: null,
        keyNameOverride: null,
        baseurlOverride: null,
        setOverrides: null,
        debug: null,
      },
      runtimeMetadata: {
        runtimeId: explicitRuntimeId,
        metadata: { source: 'ordering-test' },
      },
    };

    const result = await prepareRuntime(parsed);

    // The identity-binding-before-registration ordering (issue #2300) now lives
    // inside assembleCliProviderRuntime; prepareRuntimeForProfile's contract is
    // that it forwards the resolved runtimeId + declarative context ONCE and
    // adopts the returned runtime state (no CLI-side bus construction).
    expect(mockedAssemble).toHaveBeenCalledTimes(1);
    const assembleArg = mockedAssemble.mock.calls[0][0];
    expect(assembleArg.runtimeId).toBe(explicitRuntimeId);
    expect(assembleArg.metadata).toMatchObject({ source: 'ordering-test' });
    expect(assembleArg.settingsService).toBeDefined();

    expect(result.runtime.runtimeId).toBe(explicitRuntimeId);
    // The adopted runtime state comes straight from the owned assembly result.
    expect(result.runtimeMessageBus).toMatchObject({ kind: 'session-bus' });
    expect(result.providerManager).toMatchObject({ id: 'provider-manager' });
  });

  it('supplies a deterministic default runtimeId to the assembly when metadata omits one', async () => {
    const parsed: ParsedBootstrapArgs = {
      bootstrapArgs: {
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
      },
      runtimeMetadata: {
        // No runtimeId supplied — prepareRuntimeForProfile must choose a
        // deterministic default rather than a process-derived random id.
      },
    };

    await prepareRuntime(parsed);

    expect(mockedAssemble).toHaveBeenCalledTimes(1);
    expect(mockedAssemble.mock.calls[0][0].runtimeId).toBe(DEFAULT_RUNTIME_ID);
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
