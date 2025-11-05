/**
 * @plan PLAN-20251020-STATELESSPROVIDER3.P08
 * @requirement REQ-SP3-002
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Profile } from '@vybestack/llxprt-code-core';
import path from 'node:path';

// Mock fs module for keyfile tests
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    readFile: vi.fn(),
  };
});

const mockFs = await import('node:fs/promises');

type ProviderSelectionResult = {
  providerName: string;
  didFallback: boolean;
  warnings: string[];
};

type ProfileApplicationResult = {
  providerName: string;
  modelName: string;
  baseUrl?: string;
  warnings: string[];
  didFallback?: boolean;
};

const switchActiveProviderMock = vi.fn<
  (providerName: string) => Promise<{
    infoMessages: string[];
    changed: boolean;
    authType?: string;
  }>
>();
const setActiveModelMock =
  vi.fn<(model: string) => Promise<{ nextModel: string }>>();
const updateActiveProviderBaseUrlMock =
  vi.fn<(baseUrl: string | null) => Promise<{ message?: string }>>();
const updateActiveProviderApiKeyMock =
  vi.fn<(apiKey: string | null) => Promise<{ message?: string }>>();
const setActiveModelParamMock = vi.fn<(key: string, value: unknown) => void>();
const clearActiveModelParamMock = vi.fn<(key: string) => void>();
const getActiveModelParamsMock = vi.fn<() => Record<string, unknown>>();
const setEphemeralSettingMock = vi.fn<(key: string, value: unknown) => void>();
const getCliRuntimeServicesMock = vi.fn<
  () => {
    config: {
      getModel: () => string | undefined;
      setModel: (value: string | undefined) => void;
      getEphemeralSetting: (key: string) => unknown;
      setEphemeralSetting: (key: string, value: unknown) => void;
      getEphemeralSettings: () => Record<string, unknown>;
      getContentGeneratorConfig: () => { authType?: string } | undefined;
    };
    settingsService: {
      setCurrentProfileName?: (name: string | null) => void;
      getCurrentProfileName?: () => string | null;
      set: (key: string, value: unknown) => void;
      get: (key: string) => unknown;
      getProviderSettings: (providerName: string) => Record<string, unknown>;
      setProviderSetting: (
        providerName: string,
        key: string,
        value: unknown,
      ) => void;
    };
    providerManager: {
      listProviders: () => string[];
      getProviderByName: (providerName: string) => { name: string } | null;
      getActiveProviderName: () => string | null;
      getActiveProvider: () => {
        name: string;
        getDefaultModel?: () => string;
      };
    };
  }
>();
const getActiveProviderOrThrowMock = vi.fn<() => { name: string }>();

const configStub = {
  model: undefined as string | undefined,
  ephemerals: new Map<string, unknown>(),
  getModel() {
    return this.model;
  },
  setModel(value: string | undefined) {
    this.model = value;
  },
  getEphemeralSetting(key: string) {
    return this.ephemerals.get(key);
  },
  setEphemeralSetting(key: string, value: unknown) {
    if (value === undefined) {
      this.ephemerals.delete(key);
      return;
    }
    this.ephemerals.set(key, value);
  },
  getEphemeralSettings() {
    return Object.fromEntries(this.ephemerals.entries());
  },
  getContentGeneratorConfig() {
    return { authType: 'key' as const };
  },
};

const settingsServiceStub = {
  currentProfile: null as string | null,
  providerSettings: new Map<string, Record<string, unknown>>(),
  setCurrentProfileName(name: string | null) {
    this.currentProfile = name;
  },
  getCurrentProfileName() {
    return this.currentProfile;
  },
  set(key: string, value: unknown) {
    if (key === 'currentProfile') {
      this.currentProfile = (value as string | null) ?? null;
    }
  },
  get(key: string) {
    if (key === 'currentProfile') {
      return this.currentProfile;
    }
    return undefined;
  },
  getProviderSettings(providerName: string) {
    return (
      this.providerSettings.get(providerName) ??
      this.providerSettings.set(providerName, {}).get(providerName)!
    );
  },
  setProviderSetting(providerName: string, key: string, value: unknown) {
    const settings = this.getProviderSettings(providerName);
    settings[key] = value;
  },
};

const providerManagerStub = {
  available: [] as string[],
  activeProviderName: 'openai',
  providerLookup: new Map<string, { name: string }>(),
  listProviders() {
    return this.available.slice();
  },
  getProviderByName(name: string) {
    return this.providerLookup.get(name) ?? null;
  },
  getActiveProviderName() {
    return this.activeProviderName;
  },
  getActiveProvider() {
    return (
      this.getProviderByName(this.activeProviderName) ?? {
        name: this.activeProviderName,
        getDefaultModel: () => 'default-model',
      }
    );
  },
};
const isCliStatelessProviderModeEnabledMock = vi
  .fn<() => boolean>()
  .mockReturnValue(false);
const isCliRuntimeStatelessReadyMock = vi
  .fn<() => boolean>()
  .mockReturnValue(true);

beforeEach(() => {
  configStub.model = undefined;
  configStub.ephemerals.clear();
  settingsServiceStub.currentProfile = null;
  settingsServiceStub.providerSettings.clear();
  providerManagerStub.available = ['openai', 'anthropic'];
  providerManagerStub.activeProviderName = 'openai';
  providerManagerStub.providerLookup = new Map([
    ['openai', { name: 'openai' }],
    ['anthropic', { name: 'anthropic' }],
  ]);

  switchActiveProviderMock.mockResolvedValue({
    infoMessages: [],
    changed: true,
    authType: 'key',
  });
  setActiveModelMock.mockResolvedValue({ nextModel: 'gpt-4o-mini' });
  updateActiveProviderBaseUrlMock.mockResolvedValue({
    message: 'Base URL set',
  });
  updateActiveProviderApiKeyMock.mockResolvedValue({ message: 'API key set' });
  setActiveModelParamMock.mockClear();
  clearActiveModelParamMock.mockClear();
  getActiveModelParamsMock.mockReturnValue({});
  setEphemeralSettingMock.mockImplementation((key, value) => {
    configStub.setEphemeralSetting(key, value);
  });

  getCliRuntimeServicesMock.mockReturnValue({
    config: configStub,
    settingsService: settingsServiceStub,
    providerManager: providerManagerStub,
  });
  getActiveProviderOrThrowMock.mockReturnValue({ name: 'openai' });
  isCliStatelessProviderModeEnabledMock.mockReturnValue(false);
  isCliRuntimeStatelessReadyMock.mockReturnValue(true);
});

afterEach(() => {
  vi.clearAllMocks();
});

vi.mock('../runtimeSettings.js', () => ({
  switchActiveProvider: switchActiveProviderMock,
  setActiveModel: setActiveModelMock,
  updateActiveProviderBaseUrl: updateActiveProviderBaseUrlMock,
  updateActiveProviderApiKey: updateActiveProviderApiKeyMock,
  setActiveModelParam: setActiveModelParamMock,
  clearActiveModelParam: clearActiveModelParamMock,
  getActiveModelParams: getActiveModelParamsMock,
  setEphemeralSetting: setEphemeralSettingMock,
  getCliRuntimeServices: getCliRuntimeServicesMock,
  getActiveProviderOrThrow: getActiveProviderOrThrowMock,
  isCliStatelessProviderModeEnabled: isCliStatelessProviderModeEnabledMock,
  isCliRuntimeStatelessReady: isCliRuntimeStatelessReadyMock,
}));

const { applyProfileWithGuards, selectAvailableProvider } = await import(
  '../profileApplication.js'
);

describe('profileApplication helpers', () => {
  it('selects fallback provider when requested provider is missing @plan:PLAN-20251020-STATELESSPROVIDER3.P08 @requirement:REQ-SP3-002', () => {
    // @pseudocode profile-application.md lines 5-9
    const result = selectAvailableProvider('deepseek', [
      'anthropic',
      'openai',
    ]) as unknown as ProviderSelectionResult;

    expect(result.providerName).toBe('anthropic');
    expect(result.didFallback).toBe(true);
    expect(result.warnings).toEqual([
      "Provider 'deepseek' unavailable, using 'anthropic'",
    ]);
  });

  it('preserves base URL and auth key when applying profile snapshot @plan:PLAN-20251020-STATELESSPROVIDER3.P08 @requirement:REQ-SP3-002', async () => {
    // @pseudocode profile-application.md lines 12-21
    const profile: Profile = {
      version: 1,
      provider: 'openai',
      model: 'gpt-4o-mini',
      modelParams: {
        temperature: 0.3,
      },
      ephemeralSettings: {
        'base-url': 'https://api.example.com/v1',
        'auth-key': 'secret-current-key',
        'auth-keyfile': '/tmp/keyfile',
      },
    };

    providerManagerStub.available = ['openai'];
    providerManagerStub.providerLookup.set('openai', { name: 'openai' });

    const result = (await applyProfileWithGuards(profile, {
      profileName: 'workspace',
    })) as unknown as ProfileApplicationResult;

    expect(result.providerName).toBe('openai');
    expect(result.baseUrl).toBe('https://api.example.com/v1');
    expect(updateActiveProviderBaseUrlMock).toHaveBeenCalledWith(
      'https://api.example.com/v1',
    );
    expect(updateActiveProviderApiKeyMock).toHaveBeenCalledWith(
      'secret-current-key',
    );
    expect(configStub.getEphemeralSetting('auth-keyfile')).toBe('/tmp/keyfile');
  });

  it('emits warnings when falling back to an available provider @plan:PLAN-20251020-STATELESSPROVIDER3.P08 @requirement:REQ-SP3-002', async () => {
    // @pseudocode profile-application.md lines 5-10
    const profile: Profile = {
      version: 1,
      provider: 'deepseek',
      model: 'distil-model',
      modelParams: {},
      ephemeralSettings: {},
    };

    providerManagerStub.available = ['openai'];
    providerManagerStub.providerLookup = new Map([
      ['openai', { name: 'openai' }],
    ]);

    const result = (await applyProfileWithGuards(profile, {
      profileName: 'fallback-profile',
    })) as unknown as ProfileApplicationResult;

    expect(result.providerName).toBe('openai');
    expect(result.warnings).toContain(
      "Provider 'deepseek' unavailable, using 'openai'",
    );
  });

  it('warns when profile application lacks call-scoped runtime context under stateless hardening @plan:PLAN-20251023-STATELESS-HARDENING.P07 @requirement:REQ-SP4-005 @pseudocode provider-runtime-handling.md lines 10-16', async () => {
    isCliStatelessProviderModeEnabledMock.mockReturnValue(true);
    isCliRuntimeStatelessReadyMock.mockReturnValue(false);

    providerManagerStub.available = ['openai'];
    providerManagerStub.providerLookup = new Map([
      ['openai', { name: 'openai' }],
    ]);

    const profile: Profile = {
      version: 1,
      provider: 'openai',
      model: 'gpt-4o',
      modelParams: {},
      ephemeralSettings: {},
    };

    const result = (await applyProfileWithGuards(profile, {
      profileName: 'stateless-warning',
    })) as unknown as ProfileApplicationResult;

    const warningMatchesRequirement = result.warnings.some((warning) =>
      /REQ-SP4-005/i.test(warning),
    );
    expect(warningMatchesRequirement).toBe(true);

    isCliStatelessProviderModeEnabledMock.mockReturnValue(false);
    isCliRuntimeStatelessReadyMock.mockReturnValue(true);
  });

  it('clears all ephemeral settings when loading profile without them - fixes issue #453', async () => {
    // Set up initial ephemeral settings as if they were set by a previous profile/provider
    configStub.setEphemeralSetting('auth-key', 'old-secret-key');
    configStub.setEphemeralSetting('auth-keyfile', '/old/path/keyfile');
    configStub.setEphemeralSetting('base-url', 'https://old-api.example.com');
    configStub.setEphemeralSetting('context-limit', 100000);
    configStub.setEphemeralSetting('custom-headers', 'X-Old-Header: value');

    providerManagerStub.available = ['anthropic'];
    providerManagerStub.providerLookup = new Map([
      ['anthropic', { name: 'anthropic' }],
    ]);

    // Load a new profile that does NOT include these ephemeral settings
    const profile: Profile = {
      version: 1,
      provider: 'anthropic',
      model: 'claude-sonnet-4',
      modelParams: {
        temperature: 0.7,
      },
      ephemeralSettings: {
        // Only set context-limit, nothing else
        'context-limit': 200000,
      },
    };

    await applyProfileWithGuards(profile, {
      profileName: 'clean-profile',
    });

    // Verify that old ephemeral settings that were NOT in the profile are cleared
    expect(configStub.getEphemeralSetting('auth-key')).toBeUndefined();
    expect(configStub.getEphemeralSetting('auth-keyfile')).toBeUndefined();
    expect(configStub.getEphemeralSetting('base-url')).toBeUndefined();
    expect(configStub.getEphemeralSetting('custom-headers')).toBeUndefined();

    // Verify that the one setting that WAS in the profile is set correctly
    expect(configStub.getEphemeralSetting('context-limit')).toBe(200000);
  });

  it('should read keyfile before switching provider (stash→switch→apply pattern)', async () => {
    // Mock fs.readFile to track when it's called
    const readFileSpy = vi.mocked(mockFs.readFile);
    readFileSpy.mockResolvedValue('test-api-key-from-file');

    // Track call order
    const callOrder: string[] = [];

    readFileSpy.mockImplementation(async () => {
      callOrder.push('readFile');
      return 'test-api-key-from-file';
    });

    switchActiveProviderMock.mockImplementation(async (providerName) => {
      callOrder.push(`switchActiveProvider:${providerName}`);
      providerManagerStub.activeProviderName = providerName;
      return {
        infoMessages: [],
        changed: true,
        authType: 'key',
      };
    });

    updateActiveProviderApiKeyMock.mockImplementation(async (apiKey) => {
      callOrder.push(`updateActiveProviderApiKey:${apiKey ? 'set' : 'null'}`);
      return { message: 'API key set' };
    });

    providerManagerStub.available = ['anthropic'];
    providerManagerStub.providerLookup = new Map([
      ['anthropic', { name: 'anthropic' }],
    ]);

    const profile: Profile = {
      version: 1,
      provider: 'anthropic',
      model: 'claude-sonnet-4',
      modelParams: {},
      ephemeralSettings: {
        'auth-keyfile': '/home/user/.anthropic_key',
      },
    };

    await applyProfileWithGuards(profile, {
      profileName: 'test-profile',
    });

    // Verify keyfile was read BEFORE provider switch
    const readFileIndex = callOrder.indexOf('readFile');
    const switchProviderIndex = callOrder.indexOf(
      'switchActiveProvider:anthropic',
    );
    const updateApiKeyIndex = callOrder.indexOf(
      'updateActiveProviderApiKey:set',
    );

    expect(readFileIndex).toBeGreaterThan(-1);
    expect(switchProviderIndex).toBeGreaterThan(-1);
    expect(updateApiKeyIndex).toBeGreaterThan(-1);

    // CRITICAL: keyfile read must happen BEFORE switch
    expect(readFileIndex).toBeLessThan(switchProviderIndex);

    // CRITICAL: API key update must happen AFTER switch
    expect(updateApiKeyIndex).toBeGreaterThan(switchProviderIndex);
  });

  it('should apply auth ephemerals using stash→switch→apply pattern', async () => {
    // Track call order
    const callOrder: string[] = [];

    switchActiveProviderMock.mockImplementation(async (providerName) => {
      callOrder.push(`switchActiveProvider:${providerName}`);
      providerManagerStub.activeProviderName = providerName;
      return {
        infoMessages: [],
        changed: true,
        authType: 'key',
      };
    });

    updateActiveProviderApiKeyMock.mockImplementation(async (apiKey) => {
      callOrder.push(`updateActiveProviderApiKey:${apiKey ? 'set' : 'null'}`);
      return { message: 'API key set' };
    });

    updateActiveProviderBaseUrlMock.mockImplementation(async (baseUrl) => {
      callOrder.push(`updateActiveProviderBaseUrl:${baseUrl ? 'set' : 'null'}`);
      return { message: 'Base URL set', baseUrl: baseUrl ?? undefined };
    });

    setEphemeralSettingMock.mockImplementation((key, value) => {
      if (key !== 'auth-key' && key !== 'auth-keyfile' && key !== 'base-url') {
        callOrder.push(`setEphemeralSetting:${key}`);
      }
      configStub.setEphemeralSetting(key, value);
    });

    providerManagerStub.available = ['anthropic'];
    providerManagerStub.providerLookup = new Map([
      ['anthropic', { name: 'anthropic' }],
    ]);

    const profile: Profile = {
      version: 1,
      provider: 'anthropic',
      model: 'claude-sonnet-4',
      modelParams: {},
      ephemeralSettings: {
        'auth-key': 'test-api-key',
        'base-url': 'https://api.example.com',
        'context-limit': 200000,
        streaming: 'enabled',
      },
    };

    await applyProfileWithGuards(profile, {
      profileName: 'test-profile',
    });

    // Verify correct order: switch → apply auth → apply other ephemerals
    const switchIndex = callOrder.indexOf('switchActiveProvider:anthropic');
    const apiKeyIndex = callOrder.indexOf('updateActiveProviderApiKey:set');
    const baseUrlIndex = callOrder.indexOf('updateActiveProviderBaseUrl:set');
    const contextLimitIndex = callOrder.indexOf(
      'setEphemeralSetting:context-limit',
    );

    expect(switchIndex).toBeGreaterThan(-1);
    expect(apiKeyIndex).toBeGreaterThan(-1);
    expect(baseUrlIndex).toBeGreaterThan(-1);
    expect(contextLimitIndex).toBeGreaterThan(-1);

    // Auth credentials must be applied AFTER switch
    expect(apiKeyIndex).toBeGreaterThan(switchIndex);
    expect(baseUrlIndex).toBeGreaterThan(switchIndex);

    // Other ephemerals can be applied any time (we don't care about their order relative to auth)
  });

  it('should not trigger OAuth when loading profile with keyfile', async () => {
    // Mock fs.readFile to return an API key
    vi.mocked(mockFs.readFile).mockResolvedValue('test-api-key-from-keyfile');

    // Track if OAuth would be triggered
    const authenticateSpy = vi.fn();
    let switchWasCalledWithAutoOAuth = false;

    switchActiveProviderMock.mockImplementation(
      async (providerName: string, options?: { autoOAuth?: boolean }) => {
        // Check if autoOAuth was explicitly set to false
        if (options && 'autoOAuth' in options) {
          switchWasCalledWithAutoOAuth = options.autoOAuth === true;
        }
        providerManagerStub.activeProviderName = providerName;
        return {
          infoMessages: [],
          changed: true,
          authType: 'key',
        };
      },
    );

    providerManagerStub.available = ['anthropic'];
    providerManagerStub.providerLookup = new Map([
      ['anthropic', { name: 'anthropic' }],
    ]);

    const profile: Profile = {
      version: 1,
      provider: 'anthropic',
      model: 'claude-sonnet-4',
      modelParams: {},
      ephemeralSettings: {
        'auth-keyfile': '/home/user/.anthropic_key',
      },
    };

    await applyProfileWithGuards(profile, {
      profileName: 'test-profile',
    });

    // Verify keyfile was loaded
    // Use path.resolve to handle Windows paths (D:\home\user\.anthropic_key) vs Unix (/home/user/.anthropic_key)
    const expectedPath = path.resolve('/home/user/.anthropic_key');
    expect(vi.mocked(mockFs.readFile)).toHaveBeenCalledWith(
      expectedPath,
      'utf-8',
    );

    // Verify API key was applied
    expect(updateActiveProviderApiKeyMock).toHaveBeenCalledWith(
      'test-api-key-from-keyfile',
    );

    // Verify OAuth was NOT triggered
    expect(switchWasCalledWithAutoOAuth).toBe(false);
    expect(authenticateSpy).not.toHaveBeenCalled();

    // Verify auth-keyfile ephemeral was set (use expectedPath for cross-platform compatibility)
    expect(configStub.getEphemeralSetting('auth-keyfile')).toBe(expectedPath);
  });
});

/**
 * Phase 3 tests: OAuth lazy loading timing
 * @plan PLAN-20251105-profilefixes/plan2.md Phase 3
 *
 * These tests verify that profile loading does NOT trigger OAuth when auth
 * credentials are provided via keyfile or auth-key.
 *
 * THE PROBLEM:
 * Profile loading currently does: stash ephemerals → switch provider → apply ephemerals
 * This triggers OAuth during provider switch because auth isn't available yet.
 *
 * THE SOLUTION:
 * Apply auth to SettingsService BEFORE provider switch, so auth is available
 * when getModels() is called during the switch.
 *
 * EXPECTED STATUS: These tests should FAIL until Phase 3 implementation is complete.
 */
describe('Phase 3: Profile loading auth timing (OAuth lazy loading)', () => {
  it('should apply auth-key to SettingsService BEFORE switching provider', async () => {
    // Track the timing of operations
    const operationOrder: string[] = [];

    // Track when auth-key is set in SettingsService
    const originalSetProviderSetting =
      settingsServiceStub.setProviderSetting.bind(settingsServiceStub);
    settingsServiceStub.setProviderSetting = vi.fn(
      (providerName: string, key: string, value: unknown) => {
        if (key === 'auth-key' || key === 'apiKey') {
          operationOrder.push(`settingsService.setProviderSetting:${key}`);
        }
        originalSetProviderSetting(providerName, key, value);
      },
    );

    // Track when setEphemeralSetting is called for auth-key
    setEphemeralSettingMock.mockImplementation((key, value) => {
      if (key === 'auth-key') {
        operationOrder.push(`setEphemeralSetting:auth-key`);
      }
      configStub.setEphemeralSetting(key, value);
    });

    // Track when switchActiveProvider is called
    switchActiveProviderMock.mockImplementation(
      async (providerName: string) => {
        operationOrder.push(`switchActiveProvider:${providerName}`);
        providerManagerStub.activeProviderName = providerName;
        return {
          infoMessages: [],
          changed: true,
          authType: 'key',
        };
      },
    );

    providerManagerStub.available = ['anthropic'];
    providerManagerStub.providerLookup = new Map([
      ['anthropic', { name: 'anthropic' }],
    ]);

    const profile: Profile = {
      version: 1,
      provider: 'anthropic',
      model: 'claude-sonnet-4',
      modelParams: {},
      ephemeralSettings: {
        'auth-key': 'test-direct-api-key',
      },
    };

    await applyProfileWithGuards(profile, {
      profileName: 'test-profile',
    });

    // CRITICAL ASSERTION: auth-key must be set BEFORE provider switch
    const authKeyIndex = operationOrder.indexOf('setEphemeralSetting:auth-key');
    const switchIndex = operationOrder.indexOf(
      'switchActiveProvider:anthropic',
    );

    expect(authKeyIndex).toBeGreaterThan(-1);
    expect(switchIndex).toBeGreaterThan(-1);
    expect(authKeyIndex).toBeLessThan(switchIndex);
  });

  it('should apply keyfile auth to SettingsService BEFORE switching provider', async () => {
    // Mock fs.readFile to return an API key
    vi.mocked(mockFs.readFile).mockResolvedValue('test-api-key-from-file');

    // Track the timing of operations
    const operationOrder: string[] = [];

    // Track when keyfile is read
    vi.mocked(mockFs.readFile).mockImplementation(async (filePath) => {
      operationOrder.push(`readFile:${filePath}`);
      return 'test-api-key-from-file';
    });

    // Track when auth-key is set in SettingsService
    setEphemeralSettingMock.mockImplementation((key, value) => {
      if (key === 'auth-key') {
        operationOrder.push(`setEphemeralSetting:auth-key`);
      }
      configStub.setEphemeralSetting(key, value);
    });

    // Track when switchActiveProvider is called
    switchActiveProviderMock.mockImplementation(
      async (providerName: string) => {
        operationOrder.push(`switchActiveProvider:${providerName}`);
        providerManagerStub.activeProviderName = providerName;
        return {
          infoMessages: [],
          changed: true,
          authType: 'key',
        };
      },
    );

    providerManagerStub.available = ['anthropic'];
    providerManagerStub.providerLookup = new Map([
      ['anthropic', { name: 'anthropic' }],
    ]);

    const profile: Profile = {
      version: 1,
      provider: 'anthropic',
      model: 'claude-sonnet-4',
      modelParams: {},
      ephemeralSettings: {
        'auth-keyfile': '/home/user/.anthropic_key',
      },
    };

    await applyProfileWithGuards(profile, {
      profileName: 'test-profile',
    });

    // CRITICAL ASSERTIONS:
    // 1. Keyfile must be read BEFORE provider switch
    // 2. Auth-key must be set BEFORE provider switch
    const readFileIndex = operationOrder.findIndex((op) =>
      op.startsWith('readFile:'),
    );
    const authKeyIndex = operationOrder.indexOf('setEphemeralSetting:auth-key');
    const switchIndex = operationOrder.indexOf(
      'switchActiveProvider:anthropic',
    );

    expect(readFileIndex).toBeGreaterThan(-1);
    expect(authKeyIndex).toBeGreaterThan(-1);
    expect(switchIndex).toBeGreaterThan(-1);

    // Auth must be available BEFORE switch (this is the Phase 3 fix)
    expect(readFileIndex).toBeLessThan(switchIndex);
    expect(authKeyIndex).toBeLessThan(switchIndex);
  });

  it('should apply base-url to SettingsService BEFORE switching provider', async () => {
    // Track the timing of operations
    const operationOrder: string[] = [];

    // Track when base-url is set
    setEphemeralSettingMock.mockImplementation((key, value) => {
      if (key === 'base-url') {
        operationOrder.push(`setEphemeralSetting:base-url`);
      }
      configStub.setEphemeralSetting(key, value);
    });

    // Track when switchActiveProvider is called
    switchActiveProviderMock.mockImplementation(
      async (providerName: string) => {
        operationOrder.push(`switchActiveProvider:${providerName}`);
        providerManagerStub.activeProviderName = providerName;
        return {
          infoMessages: [],
          changed: true,
          authType: 'key',
        };
      },
    );

    providerManagerStub.available = ['anthropic'];
    providerManagerStub.providerLookup = new Map([
      ['anthropic', { name: 'anthropic' }],
    ]);

    const profile: Profile = {
      version: 1,
      provider: 'anthropic',
      model: 'claude-sonnet-4',
      modelParams: {},
      ephemeralSettings: {
        'base-url': 'https://custom-api.example.com/v1',
        'auth-key': 'test-api-key',
      },
    };

    await applyProfileWithGuards(profile, {
      profileName: 'test-profile',
    });

    // CRITICAL ASSERTION: base-url must be set BEFORE provider switch
    const baseUrlIndex = operationOrder.indexOf('setEphemeralSetting:base-url');
    const switchIndex = operationOrder.indexOf(
      'switchActiveProvider:anthropic',
    );

    expect(baseUrlIndex).toBeGreaterThan(-1);
    expect(switchIndex).toBeGreaterThan(-1);
    expect(baseUrlIndex).toBeLessThan(switchIndex);
  });

  it('should verify SettingsService has auth available when switchActiveProvider is called', async () => {
    // Mock the scenario where switchActiveProvider checks for auth
    let authAvailableAtSwitchTime = false;

    switchActiveProviderMock.mockImplementation(
      async (providerName: string) => {
        // Simulate what happens inside switchActiveProvider:
        // It calls getModels() which checks for auth via SettingsService
        authAvailableAtSwitchTime = Boolean(
          configStub.getEphemeralSetting('auth-key'),
        );

        providerManagerStub.activeProviderName = providerName;
        return {
          infoMessages: [],
          changed: true,
          authType: 'key',
        };
      },
    );

    providerManagerStub.available = ['anthropic'];
    providerManagerStub.providerLookup = new Map([
      ['anthropic', { name: 'anthropic' }],
    ]);

    const profile: Profile = {
      version: 1,
      provider: 'anthropic',
      model: 'claude-sonnet-4',
      modelParams: {},
      ephemeralSettings: {
        'auth-key': 'test-api-key',
      },
    };

    await applyProfileWithGuards(profile, {
      profileName: 'test-profile',
    });

    // CRITICAL ASSERTION: auth must be available when switchActiveProvider is called
    // This prevents OAuth from being triggered during provider switch
    expect(authAvailableAtSwitchTime).toBe(true);
  });

  it('should NOT trigger OAuth when profile has keyfile and provider switch calls getModels', async () => {
    // Mock fs.readFile to return an API key
    vi.mocked(mockFs.readFile).mockResolvedValue('test-api-key-from-keyfile');

    // Track OAuth calls
    const oauthCalls: string[] = [];

    // Simulate what happens during provider switch:
    // getAvailableModels is called, which may trigger OAuth if auth is missing
    switchActiveProviderMock.mockImplementation(
      async (providerName: string) => {
        // At this point, check if auth is available
        const authKey = configStub.getEphemeralSetting('auth-key');

        if (!authKey) {
          // OAuth would be triggered here if auth is not available
          oauthCalls.push('OAuth triggered during switch');
        }

        providerManagerStub.activeProviderName = providerName;
        return {
          infoMessages: [],
          changed: true,
          authType: 'key',
        };
      },
    );

    providerManagerStub.available = ['anthropic'];
    providerManagerStub.providerLookup = new Map([
      ['anthropic', { name: 'anthropic' }],
    ]);

    const profile: Profile = {
      version: 1,
      provider: 'anthropic',
      model: 'claude-sonnet-4',
      modelParams: {},
      ephemeralSettings: {
        'auth-keyfile': '/home/user/.anthropic_key',
      },
    };

    await applyProfileWithGuards(profile, {
      profileName: 'test-profile',
    });

    // CRITICAL ASSERTION: OAuth must NOT be triggered
    expect(oauthCalls).toHaveLength(0);
  });

  it('should apply auth ephemerals in correct order: clear → apply-auth → switch → apply-other', async () => {
    // Set up initial state with old ephemerals
    configStub.setEphemeralSetting('old-setting', 'old-value');
    configStub.setEphemeralSetting('auth-key', 'old-auth-key');

    // Track operation order
    const operationOrder: string[] = [];

    // Track ephemeral clearing
    setEphemeralSettingMock.mockImplementation((key, value) => {
      if (value === undefined) {
        operationOrder.push(`clear:${key}`);
      } else {
        operationOrder.push(`set:${key}`);
      }
      configStub.setEphemeralSetting(key, value);
    });

    // Track provider switch
    switchActiveProviderMock.mockImplementation(
      async (providerName: string) => {
        operationOrder.push(`switchActiveProvider:${providerName}`);
        providerManagerStub.activeProviderName = providerName;
        return {
          infoMessages: [],
          changed: true,
          authType: 'key',
        };
      },
    );

    providerManagerStub.available = ['anthropic'];
    providerManagerStub.providerLookup = new Map([
      ['anthropic', { name: 'anthropic' }],
    ]);

    const profile: Profile = {
      version: 1,
      provider: 'anthropic',
      model: 'claude-sonnet-4',
      modelParams: {},
      ephemeralSettings: {
        'auth-key': 'new-auth-key',
        'base-url': 'https://custom.example.com',
        'context-limit': 200000,
      },
    };

    await applyProfileWithGuards(profile, {
      profileName: 'test-profile',
    });

    // CRITICAL ASSERTIONS:
    // 1. Old ephemerals must be cleared first
    // 2. Auth credentials must be set BEFORE switch
    // 3. Switch happens after auth is available
    // 4. Other ephemerals are set after switch

    const oldSettingClearIndex = operationOrder.indexOf('clear:old-setting');
    const oldAuthClearIndex = operationOrder.indexOf('clear:auth-key');
    const newAuthSetIndex = operationOrder.indexOf('set:auth-key');
    const switchIndex = operationOrder.indexOf(
      'switchActiveProvider:anthropic',
    );
    const contextLimitSetIndex = operationOrder.indexOf('set:context-limit');

    // Old settings should be cleared
    expect(oldSettingClearIndex).toBeGreaterThan(-1);
    expect(oldAuthClearIndex).toBeGreaterThan(-1);

    // New auth should be set BEFORE switch
    expect(newAuthSetIndex).toBeGreaterThan(-1);
    expect(switchIndex).toBeGreaterThan(-1);
    expect(newAuthSetIndex).toBeLessThan(switchIndex);

    // Other ephemerals should be set (timing relative to switch doesn't matter for non-auth)
    expect(contextLimitSetIndex).toBeGreaterThan(-1);
  });

  it('should handle keyfile loading failure gracefully without blocking provider switch', async () => {
    // Mock fs.readFile to fail
    vi.mocked(mockFs.readFile).mockRejectedValue(
      new Error('ENOENT: file not found'),
    );

    const operationOrder: string[] = [];

    switchActiveProviderMock.mockImplementation(
      async (providerName: string) => {
        operationOrder.push(`switchActiveProvider:${providerName}`);
        providerManagerStub.activeProviderName = providerName;
        return {
          infoMessages: [],
          changed: true,
          authType: 'key',
        };
      },
    );

    providerManagerStub.available = ['anthropic'];
    providerManagerStub.providerLookup = new Map([
      ['anthropic', { name: 'anthropic' }],
    ]);

    const profile: Profile = {
      version: 1,
      provider: 'anthropic',
      model: 'claude-sonnet-4',
      modelParams: {},
      ephemeralSettings: {
        'auth-keyfile': '/nonexistent/path/.anthropic_key',
      },
    };

    const result = await applyProfileWithGuards(profile, {
      profileName: 'test-profile',
    });

    // Should still switch provider even if keyfile fails
    const switchIndex = operationOrder.indexOf(
      'switchActiveProvider:anthropic',
    );
    expect(switchIndex).toBeGreaterThan(-1);

    // Should include warning about keyfile failure
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/Failed to load keyfile/i),
      ]),
    );
  });
});
