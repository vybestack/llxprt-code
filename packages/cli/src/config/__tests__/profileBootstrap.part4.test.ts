/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  parseBootstrapArgs,
  createBootstrapResult,
} from '../profileBootstrap.js';

vi.mock('@vybestack/llxprt-code-providers/runtime/runtimeSettings.js', () => ({
  registerAgentRuntimeFactories: vi.fn(),
  resetAgentRuntimeFactories: vi.fn(),
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

type ProfileApplicationResult = {
  providerName: string;
  modelName: string;
  baseUrl?: string;
  warnings: string[];
  error?: string;
};

const parseArgsWithMeta = parseBootstrapArgs as unknown as (
  args: BootstrapProfileArgs,
  metadata: RuntimeMetadata,
) => ParsedBootstrapArgs;

const createTestingBootstrapResult = createBootstrapResult as unknown as (
  args: BootstrapProfileArgs,
  metadata: RuntimeMetadata,
) => ProfileApplicationResult;

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
      debug: null,
    };

    const parsed = parseArgsWithMeta(args, {
      settingsService: mockSettings,
      config: mockConfig,
      oauthManager: {},
    });
    const result = createTestingBootstrapResult(
      parsed.bootstrapArgs,
      parsed.runtimeMetadata,
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
      debug: null,
    };

    const parsed = parseArgsWithMeta(args, {
      settingsService: mockSettings,
      config: mockConfig,
      oauthManager: {},
    });
    const result = createTestingBootstrapResult(
      parsed.bootstrapArgs,
      parsed.runtimeMetadata,
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
      debug: null,
    };

    const parsed = parseArgsWithMeta(args, {
      settingsService: mockSettings,
      config: mockConfig,
      oauthManager: {},
    });
    const result = createTestingBootstrapResult(
      parsed.bootstrapArgs,
      parsed.runtimeMetadata,
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
      debug: null,
    };

    const parsed = parseArgsWithMeta(args, {
      settingsService: mockSettings,
      config: mockConfig,
      oauthManager: {},
    });
    const result = createTestingBootstrapResult(
      parsed.bootstrapArgs,
      parsed.runtimeMetadata,
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
      debug: null,
    };

    mockSettings.getProfile.mockReturnValue({
      provider: 'anthropic',
      model: 'claude-3-5-sonnet-20241022',
      key: 'sk-named',
    });

    const parsed = parseArgsWithMeta(args, {
      settingsService: mockSettings,
      config: mockConfig,
      oauthManager: {},
    });
    const result = createTestingBootstrapResult(
      parsed.bootstrapArgs,
      parsed.runtimeMetadata,
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
      debug: null,
    };

    mockSettings.getProfile.mockReturnValue({
      provider: 'anthropic',
      model: 'claude-3-5-sonnet-20241022',
      key: 'sk-named',
    });

    const parsed = parseArgsWithMeta(args, {
      settingsService: mockSettings,
      config: mockConfig,
      oauthManager: {},
    });
    const result = createTestingBootstrapResult(
      parsed.bootstrapArgs,
      parsed.runtimeMetadata,
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
      debug: null,
    };

    const parsed = parseArgsWithMeta(args, {
      settingsService: mockSettings,
      config: mockConfig,
      oauthManager: {},
    });
    const result = createTestingBootstrapResult(
      parsed.bootstrapArgs,
      parsed.runtimeMetadata,
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
      debug: null,
    };

    mockSettings.getProfile.mockReturnValue({
      provider: 'anthropic',
      model: 'claude-3-5-sonnet-20241022',
      key: 'sk-named',
    });

    const parsed = parseArgsWithMeta(args, {
      settingsService: mockSettings,
      config: mockConfig,
      oauthManager: {},
    });
    const result = createTestingBootstrapResult(
      parsed.bootstrapArgs,
      parsed.runtimeMetadata,
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
      debug: null,
    };

    expect(() => {
      parseArgsWithMeta(args, {
        settingsService: mockSettings,
        config: mockConfig,
        oauthManager: {},
      });
    }).toThrow(/JSON/);
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
      debug: null,
    };

    expect(() => {
      parseArgsWithMeta(args, {
        settingsService: mockSettings,
        config: mockConfig,
        oauthManager: {},
      });
    }).toThrow(/model/);
  });

  /**
   * @plan:PLAN-20251118-ISSUE533.P09
   * @requirement:REQ-INT-003.3
   * @scenario: Named profile not found returns empty result with warning
   * @given: --profile nonexistent
   * @when: applyBootstrapProfile() called
   * @then: Returns empty provider/model and warning
   */
  it('should return empty result with warning when named profile is not found', () => {
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
      debug: null,
    };

    mockSettings.getProfile.mockReturnValue(null);

    const parsed = parseArgsWithMeta(args, {
      settingsService: mockSettings,
      config: mockConfig,
      oauthManager: {},
    });
    const result = createTestingBootstrapResult(
      parsed.bootstrapArgs,
      parsed.runtimeMetadata,
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
      debug: null,
    };

    expect(() => {
      parseArgsWithMeta(args, {
        settingsService: mockSettings,
        config: mockConfig,
        oauthManager: {},
      });
    }).toThrow(/provider/);
  });
});
