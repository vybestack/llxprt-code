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
      debug: null,
    };

    const parsed = parseArgsWithMeta(args, {
      settingsService: mockSettingsService,
      config: mockConfig,
      oauthManager: mockOAuthManager,
    });

    const result = createTestingBootstrapResult(
      parsed.bootstrapArgs,
      parsed.runtimeMetadata,
    );

    expect(result.providerName).toBe('openai');
    expect(result.modelName).toBe('gpt-4');
    expect(result.warnings).toStrictEqual([]);
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
      debug: null,
    };

    const parsed = parseArgsWithMeta(args, {
      settingsService: mockSettingsService,
      config: mockConfig,
      oauthManager: mockOAuthManager,
    });

    const result = createTestingBootstrapResult(
      parsed.bootstrapArgs,
      parsed.runtimeMetadata,
    );

    expect(result.providerName).toBe('anthropic');
    expect(result.modelName).toBe('claude-3-5-sonnet-20241022');
    expect(result.warnings).toStrictEqual([]);
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
      debug: null,
    };

    const parsed = parseArgsWithMeta(args, {
      settingsService: mockSettingsService,
      config: mockConfig,
      oauthManager: mockOAuthManager,
    });

    const result = createTestingBootstrapResult(
      parsed.bootstrapArgs,
      parsed.runtimeMetadata,
    );

    expect(result.providerName).toBe('openai');
    expect(result.modelName).toBe('gpt-4');
    expect(result.warnings).toStrictEqual([]);
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
      debug: null,
    };

    const parsed = parseArgsWithMeta(args, {
      settingsService: mockSettingsService,
      config: mockConfig,
      oauthManager: mockOAuthManager,
    });

    const result = createTestingBootstrapResult(
      parsed.bootstrapArgs,
      parsed.runtimeMetadata,
    );

    expect(result.providerName).toBeNull();
    expect(result.modelName).toBeNull();
    expect(result.warnings).toStrictEqual([]);
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
      debug: null,
    };

    const parsed = parseArgsWithMeta(args, {
      settingsService: mockSettingsService,
      config: mockConfig,
      oauthManager: mockOAuthManager,
    });

    const result = createTestingBootstrapResult(
      parsed.bootstrapArgs,
      parsed.runtimeMetadata,
    );

    expect(result.providerName).toBe('openai');
    expect(result.modelName).toBe('gpt-3.5-turbo');
    expect(result.warnings).toStrictEqual([]);
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
      debug: null,
    };

    const parsed = parseArgsWithMeta(args, {
      settingsService: mockSettingsService,
      config: mockConfig,
      oauthManager: mockOAuthManager,
    });

    const result = createTestingBootstrapResult(
      parsed.bootstrapArgs,
      parsed.runtimeMetadata,
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
      debug: null,
    };

    const parsed = parseArgsWithMeta(args, {
      settingsService: mockSettingsService,
      config: mockConfig,
      oauthManager: mockOAuthManager,
    });

    const result = createTestingBootstrapResult(
      parsed.bootstrapArgs,
      parsed.runtimeMetadata,
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
      debug: null,
    };

    const parsed = parseArgsWithMeta(args, {
      settingsService: mockSettingsService,
      config: mockConfig,
      oauthManager: mockOAuthManager,
    });

    const result = createTestingBootstrapResult(
      parsed.bootstrapArgs,
      parsed.runtimeMetadata,
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
      debug: null,
    };

    expect(() => {
      parseArgsWithMeta(args, {
        settingsService: mockSettingsService,
        config: mockConfig,
        oauthManager: mockOAuthManager,
      });
    }).toThrow(/JSON/);
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
      debug: null,
    };

    expect(() => {
      parseArgsWithMeta(args, {
        settingsService: mockSettingsService,
        config: mockConfig,
        oauthManager: mockOAuthManager,
      });
    }).toThrow(/provider/);
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
      debug: null,
    };

    const parsed = parseArgsWithMeta(args, {
      settingsService: mockSettingsService,
      config: mockConfig,
      oauthManager: mockOAuthManager,
    });

    const result = createTestingBootstrapResult(
      parsed.bootstrapArgs,
      parsed.runtimeMetadata,
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
      debug: null,
    };

    const parsed = parseArgsWithMeta(args, {
      settingsService: mockSettingsService,
      config: mockConfig,
      oauthManager: mockOAuthManager,
    });

    const result = createTestingBootstrapResult(
      parsed.bootstrapArgs,
      parsed.runtimeMetadata,
    );

    expect(result.providerName).toBe('openai');
    expect(result.modelName).toBe('gpt-4');
    expect(result.warnings).toStrictEqual([]);
  });
});
