/**
 * @plan PLAN-20251020-STATELESSPROVIDER3.P08
 * @requirement REQ-SP3-002
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Profile, LoadBalancerProfile } from '@vybestack/llxprt-code-core';
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

type ProfileApplicationResult = {
  providerName: string;
  modelName: string;
  baseUrl?: string;
  warnings: string[];
  didFallback?: boolean;
};

const switchActiveProviderMock = vi.fn<
  (
    providerName: string,
    options?: { preserveEphemerals?: string[] },
  ) => Promise<{
    infoMessages: string[];
    changed: boolean;
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
      getContentGeneratorConfig: () => Record<string, unknown> | undefined;
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
    profileManager?: {
      loadProfile: (profileName: string) => Promise<Profile>;
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
    return { provider: 'stub' };
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
  registerProvider(provider: { name: string }) {
    this.providerLookup.set(provider.name, provider);
  },
};
const isCliStatelessProviderModeEnabledMock = vi
  .fn<() => boolean>()
  .mockReturnValue(false);
const isCliRuntimeStatelessReadyMock = vi
  .fn<() => boolean>()
  .mockReturnValue(true);

const mockProfileManager = {
  loadProfile: vi.fn<(profileName: string) => Promise<Profile>>(),
};

let savedGcpProject: string | undefined;
let savedGcpLocation: string | undefined;

beforeEach(() => {
  savedGcpProject = process.env.GOOGLE_CLOUD_PROJECT;
  savedGcpLocation = process.env.GOOGLE_CLOUD_LOCATION;
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

  switchActiveProviderMock.mockImplementation(async (providerName: string) => {
    providerManagerStub.activeProviderName = providerName;
    return {
      infoMessages: [],
      changed: true,
    };
  });

  setActiveModelMock.mockResolvedValue({ nextModel: 'default-model' });
  updateActiveProviderBaseUrlMock.mockResolvedValue({});
  updateActiveProviderApiKeyMock.mockResolvedValue({});
  getActiveModelParamsMock.mockReturnValue({});
  setEphemeralSettingMock.mockImplementation((key, value) => {
    configStub.setEphemeralSetting(key, value);
  });

  getCliRuntimeServicesMock.mockReturnValue({
    config: configStub,
    settingsService: settingsServiceStub,
    providerManager: providerManagerStub,
    profileManager: mockProfileManager,
  });
  getActiveProviderOrThrowMock.mockReturnValue({ name: 'gemini' });
  isCliStatelessProviderModeEnabledMock.mockReturnValue(true);
  isCliRuntimeStatelessReadyMock.mockReturnValue(true);
});

afterEach(() => {
  if (savedGcpProject === undefined) {
    delete process.env.GOOGLE_CLOUD_PROJECT;
  } else {
    process.env.GOOGLE_CLOUD_PROJECT = savedGcpProject;
  }

  if (savedGcpLocation === undefined) {
    delete process.env.GOOGLE_CLOUD_LOCATION;
  } else {
    process.env.GOOGLE_CLOUD_LOCATION = savedGcpLocation;
  }

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

const { applyProfileWithGuards } = await import('../profileApplication.js');

describe('Profile application basics', () => {
  it('preserves reasoning settings during provider switch (issue #890)', async () => {
    let capturedPreserveEphemerals: string[] = [];

    switchActiveProviderMock.mockImplementation(
      async (providerName, options) => {
        providerManagerStub.activeProviderName = providerName;
        capturedPreserveEphemerals = options?.preserveEphemerals ?? [];
        return {
          infoMessages: [],
          changed: true,
        };
      },
    );

    const profile: Profile = {
      version: 1,
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      modelParams: {},
      ephemeralSettings: {},
    };

    await applyProfileWithGuards(profile, {
      profileName: 'opusthinking',
    });

    expect(capturedPreserveEphemerals).toContain('reasoning.enabled');
    expect(capturedPreserveEphemerals).toContain('reasoning.budgetTokens');
    expect(capturedPreserveEphemerals).toContain('reasoning.stripFromContext');
    expect(capturedPreserveEphemerals).toContain('reasoning.includeInContext');
  });

  it('reports the actual profile model instead of the provider default in info messages', async () => {
    const profile: Profile = {
      version: 1,
      provider: 'openai',
      model: 'glm-4.6',
      modelParams: {},
      ephemeralSettings: {},
    };

    switchActiveProviderMock.mockResolvedValueOnce({
      infoMessages: [
        "Active model is 'gpt-5' for provider 'openai'.",
        'Use /key to set API key if needed.',
      ],
      changed: true,
    });
    setActiveModelMock.mockResolvedValueOnce({ nextModel: 'glm-4.6' });

    const result = await applyProfileWithGuards(profile, {
      profileName: 'synthetic',
    });

    expect(result.infoMessages).toContain(
      "Model set to 'glm-4.6' for provider 'openai'.",
    );
    expect(
      result.infoMessages.some((message) =>
        message.includes("Active model is 'gpt-5'"),
      ),
    ).toBe(false);
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
      async (
        providerName: string,
        options?: { preserveEphemerals?: string[]; autoOAuth?: boolean },
      ) => {
        if (options && 'autoOAuth' in options) {
          switchWasCalledWithAutoOAuth = options.autoOAuth === true;
        }
        providerManagerStub.activeProviderName = providerName;
        return {
          infoMessages: [],
          changed: true,
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
    expect(configStub.getEphemeralSetting('auth-key')).toBeUndefined();
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

  it('hydrates legacy modelParams auth entries into ephemerals', async () => {
    providerManagerStub.available = ['anthropic'];
    providerManagerStub.providerLookup = new Map([
      ['anthropic', { name: 'anthropic' }],
    ]);

    const profile: Profile = {
      version: 1,
      provider: 'anthropic',
      model: 'claude-sonnet-4',
      modelParams: {
        'auth-key': 'legacy-auth-key',
        'base-url': 'https://legacy.example.com/v1',
        temperature: 0.25,
      },
      ephemeralSettings: {},
    };

    await applyProfileWithGuards(profile, {
      profileName: 'legacy-profile',
    });

    expect(configStub.getEphemeralSetting('auth-key')).toBe('legacy-auth-key');
    expect(configStub.getEphemeralSetting('base-url')).toBe(
      'https://legacy.example.com/v1',
    );
    expect(updateActiveProviderApiKeyMock).toHaveBeenCalledWith(
      'legacy-auth-key',
    );
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

describe('LoadBalancer profile integration', () => {
  beforeEach(() => {
    mockProfileManager.loadProfile.mockClear();
  });

  it('registers LoadBalancingProvider for LoadBalancer profiles', async () => {
    const standardProfile1: Profile = {
      version: 1,
      provider: 'openai',
      model: 'gpt-4o-mini',
      modelParams: { temperature: 0.5 },
      ephemeralSettings: {},
    };

    const standardProfile2: Profile = {
      version: 1,
      provider: 'anthropic',
      model: 'claude-3-opus',
      modelParams: { temperature: 0.7 },
      ephemeralSettings: {},
    };

    mockProfileManager.loadProfile.mockImplementation(
      async (name: string): Promise<Profile> => {
        if (name === 'profile1') return standardProfile1;
        if (name === 'profile2') return standardProfile2;
        throw new Error(`Profile ${name} not found`);
      },
    );

    // Mock setActiveModel to return the model being set (including 'load-balancer')
    setActiveModelMock.mockImplementation(async (model: string) => ({
      nextModel: model,
    }));

    const lbProfile: LoadBalancerProfile = {
      version: 1,
      type: 'loadbalancer',
      policy: 'roundrobin',
      profiles: ['profile1', 'profile2'],
      provider: '',
      model: '',
      modelParams: {},
      ephemeralSettings: {},
    };

    providerManagerStub.available = ['openai', 'anthropic'];
    providerManagerStub.providerLookup = new Map([
      ['openai', { name: 'openai' }],
      ['anthropic', { name: 'anthropic' }],
    ]);

    const result = (await applyProfileWithGuards(lbProfile, {
      profileName: 'lb-profiles',
    })) as unknown as ProfileApplicationResult;

    // NEW behavior: LoadBalancingProvider is registered with 'load-balancer' as the model
    expect(result.modelName).toBe('load-balancer');

    // Verify setActiveModel was called with 'load-balancer'
    expect(setActiveModelMock).toHaveBeenCalledWith('load-balancer');

    // Verify LoadBalancingProvider is registered
    const loadBalancingProvider =
      providerManagerStub.getProviderByName('load-balancer');
    expect(loadBalancingProvider).toBeTruthy();
    expect(loadBalancingProvider?.name).toBe('load-balancer');
  });

  it('standard profiles still work unchanged (backward compatibility)', async () => {
    const standardProfile: Profile = {
      version: 1,
      provider: 'openai',
      model: 'gpt-4o',
      modelParams: { temperature: 0.3 },
      ephemeralSettings: {},
    };

    providerManagerStub.available = ['openai'];
    providerManagerStub.providerLookup = new Map([
      ['openai', { name: 'openai' }],
    ]);

    setActiveModelMock.mockResolvedValueOnce({ nextModel: 'gpt-4o' });

    const result = (await applyProfileWithGuards(standardProfile, {
      profileName: 'standard-profile',
    })) as unknown as ProfileApplicationResult;

    expect(mockProfileManager.loadProfile).not.toHaveBeenCalled();
    expect(result.providerName).toBe('openai');
    expect(result.modelName).toBe('gpt-4o');
  });
});

describe('STEP 2 workflow: pre-switch auth wiring', () => {
  it('sets auth-keyfile ephemeral and provider setting from keyfile before switch', async () => {
    vi.mocked(mockFs.readFile).mockResolvedValue('keyfile-api-key');

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
        'auth-keyfile': '~/.my-key',
      },
    };

    await applyProfileWithGuards(profile);

    expect(settingsServiceStub.getProviderSettings('anthropic')['apiKey']).toBe(
      'keyfile-api-key',
    );
    expect(
      settingsServiceStub.getProviderSettings('anthropic')['apiKeyfile'],
    ).toBeDefined();
  });

  it('sets base-url in both ephemeral and provider settings before switch', async () => {
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
        'base-url': 'https://custom.api.com/v1',
        'auth-key': 'some-key',
      },
    };

    await applyProfileWithGuards(profile);

    const provSettings = settingsServiceStub.getProviderSettings('anthropic');
    expect(provSettings['baseUrl']).toBe('https://custom.api.com/v1');
    expect(provSettings['baseURL']).toBe('https://custom.api.com/v1');
  });

  it('sets GOOGLE_CLOUD_PROJECT and GOOGLE_CLOUD_LOCATION as ephemerals and env vars', async () => {
    providerManagerStub.available = ['gemini'];
    providerManagerStub.providerLookup = new Map([
      ['gemini', { name: 'gemini' }],
    ]);
    providerManagerStub.activeProviderName = 'gemini';

    const profile: Profile = {
      version: 1,
      provider: 'gemini',
      model: 'gemini-2.0-flash',
      modelParams: {},
      ephemeralSettings: {
        GOOGLE_CLOUD_PROJECT: 'my-project',
        GOOGLE_CLOUD_LOCATION: 'us-central1',
      },
    };

    await applyProfileWithGuards(profile);

    expect(configStub.getEphemeralSetting('GOOGLE_CLOUD_PROJECT')).toBe(
      'my-project',
    );
    expect(configStub.getEphemeralSetting('GOOGLE_CLOUD_LOCATION')).toBe(
      'us-central1',
    );
    expect(process.env.GOOGLE_CLOUD_PROJECT).toBe('my-project');
    expect(process.env.GOOGLE_CLOUD_LOCATION).toBe('us-central1');
  });

  it('falls back to direct auth-key when keyfile read returns empty content', async () => {
    vi.mocked(mockFs.readFile).mockResolvedValue('   ');

    providerManagerStub.available = ['openai'];
    providerManagerStub.providerLookup = new Map([
      ['openai', { name: 'openai' }],
    ]);

    const profile: Profile = {
      version: 1,
      provider: 'openai',
      model: 'gpt-4o',
      modelParams: {},
      ephemeralSettings: {
        'auth-keyfile': '/some/keyfile',
        'auth-key': 'direct-fallback-key',
      },
    };

    await applyProfileWithGuards(profile);

    expect(configStub.getEphemeralSetting('auth-key')).toBe(
      'direct-fallback-key',
    );
  });
});

describe('STEP 5 workflow: non-auth ephemerals', () => {
  it('applies non-auth ephemeral settings after provider switch', async () => {
    providerManagerStub.available = ['openai'];
    providerManagerStub.providerLookup = new Map([
      ['openai', { name: 'openai' }],
    ]);

    const profile = {
      version: 1 as const,
      provider: 'openai',
      model: 'gpt-4o',
      modelParams: {},
      ephemeralSettings: {
        'context-limit': 200000,
        streaming: 'enabled' as const,
        'custom-setting': 'value',
      },
    } as unknown as Profile;

    await applyProfileWithGuards(profile);

    expect(configStub.getEphemeralSetting('context-limit')).toBe(200000);
    expect(configStub.getEphemeralSetting('streaming')).toBe('enabled');
    expect(configStub.getEphemeralSetting('custom-setting')).toBe('value');
  });

  it('does not re-apply auth-key, auth-keyfile, base-url, or GCP settings in non-auth step', async () => {
    const ephemeralSetCalls: Array<{ key: string; value: unknown }> = [];
    setEphemeralSettingMock.mockImplementation((key, value) => {
      ephemeralSetCalls.push({ key, value });
      configStub.setEphemeralSetting(key, value);
    });

    providerManagerStub.available = ['openai'];
    providerManagerStub.providerLookup = new Map([
      ['openai', { name: 'openai' }],
    ]);

    const profile: Profile = {
      version: 1,
      provider: 'openai',
      model: 'gpt-4o',
      modelParams: {},
      ephemeralSettings: {
        'auth-key': 'my-key',
        'base-url': 'https://example.com',
        GOOGLE_CLOUD_PROJECT: 'proj',
        GOOGLE_CLOUD_LOCATION: 'loc',
        'context-limit': 100000,
      },
    };

    await applyProfileWithGuards(profile);

    const nonClearCalls = ephemeralSetCalls.filter(
      (c) => c.value !== undefined,
    );
    const contextLimitSets = nonClearCalls.filter(
      (c) => c.key === 'context-limit',
    );
    expect(contextLimitSets.length).toBe(1);
    expect(contextLimitSets[0].value).toBe(100000);

    const authKeyNonClearSets = nonClearCalls.filter(
      (c) => c.key === 'auth-key',
    );
    const baseUrlNonClearSets = nonClearCalls.filter(
      (c) => c.key === 'base-url',
    );
    const gcpProjectNonClearSets = nonClearCalls.filter(
      (c) => c.key === 'GOOGLE_CLOUD_PROJECT',
    );
    const gcpLocationNonClearSets = nonClearCalls.filter(
      (c) => c.key === 'GOOGLE_CLOUD_LOCATION',
    );
    expect(authKeyNonClearSets.length).toBe(1);
    expect(baseUrlNonClearSets.length).toBe(1);
    expect(gcpProjectNonClearSets.length).toBe(1);
    expect(gcpLocationNonClearSets.length).toBe(1);
  });

  it('clears previously-set ephemerals that are not in the new profile', async () => {
    configStub.setEphemeralSetting('old-custom-setting', 'old-value');
    configStub.setEphemeralSetting('context-limit', 50000);

    providerManagerStub.available = ['openai'];
    providerManagerStub.providerLookup = new Map([
      ['openai', { name: 'openai' }],
    ]);

    const profile: Profile = {
      version: 1,
      provider: 'openai',
      model: 'gpt-4o',
      modelParams: {},
      ephemeralSettings: {
        streaming: 'enabled',
      },
    };

    await applyProfileWithGuards(profile);

    expect(
      configStub.getEphemeralSetting('old-custom-setting'),
    ).toBeUndefined();
    expect(configStub.getEphemeralSetting('context-limit')).toBeUndefined();
    expect(configStub.getEphemeralSetting('streaming')).toBe('enabled');
  });
});

describe('STEP 6 workflow: model and modelParams application', () => {
  it('sets the requested model and returns it in result', async () => {
    providerManagerStub.available = ['openai'];
    providerManagerStub.providerLookup = new Map([
      ['openai', { name: 'openai' }],
    ]);
    setActiveModelMock.mockResolvedValueOnce({ nextModel: 'gpt-4o-mini' });

    const profile: Profile = {
      version: 1,
      provider: 'openai',
      model: 'gpt-4o-mini',
      modelParams: {},
      ephemeralSettings: {},
    };

    const result = await applyProfileWithGuards(profile);

    expect(setActiveModelMock).toHaveBeenCalledWith('gpt-4o-mini');
    expect(result.modelName).toBe('gpt-4o-mini');
  });

  it('falls back to provider default model when profile model is empty', async () => {
    providerManagerStub.available = ['openai'];
    providerManagerStub.providerLookup = new Map([
      [
        'openai',
        {
          name: 'openai',
          getDefaultModel: () => 'gpt-4o',
        },
      ],
    ]);
    setActiveModelMock.mockResolvedValueOnce({ nextModel: 'gpt-4o' });

    const profile: Profile = {
      version: 1,
      provider: 'openai',
      model: '',
      modelParams: {},
      ephemeralSettings: {},
    };

    const result = await applyProfileWithGuards(profile);

    expect(setActiveModelMock).toHaveBeenCalledWith('gpt-4o');
    expect(result.modelName).toBe('gpt-4o');
  });

  it('throws when no model is available and profile has no model', async () => {
    providerManagerStub.available = ['openai'];
    providerManagerStub.providerLookup = new Map([
      ['openai', { name: 'openai' }],
    ]);
    configStub.model = undefined;

    const profile: Profile = {
      version: 1,
      provider: 'openai',
      model: '',
      modelParams: {},
      ephemeralSettings: {},
    };

    await expect(applyProfileWithGuards(profile)).rejects.toThrow(
      /does not specify a model/,
    );
  });

  it('applies profile modelParams and clears stale params', async () => {
    getActiveModelParamsMock.mockReturnValue({
      temperature: 0.5,
      'max-tokens': 1000,
      'old-param': 'stale',
    });

    providerManagerStub.available = ['openai'];
    providerManagerStub.providerLookup = new Map([
      ['openai', { name: 'openai' }],
    ]);

    const profile: Profile = {
      version: 1,
      provider: 'openai',
      model: 'gpt-4o',
      modelParams: {
        temperature: 0.9,
        'top-p': 0.95,
      },
      ephemeralSettings: {},
    };

    await applyProfileWithGuards(profile);

    expect(setActiveModelParamMock).toHaveBeenCalledWith('temperature', 0.9);
    expect(setActiveModelParamMock).toHaveBeenCalledWith('top-p', 0.95);
    expect(clearActiveModelParamMock).toHaveBeenCalledWith('max-tokens');
    expect(clearActiveModelParamMock).toHaveBeenCalledWith('old-param');
  });

  it('includes model info message in result', async () => {
    providerManagerStub.available = ['openai'];
    providerManagerStub.providerLookup = new Map([
      ['openai', { name: 'openai' }],
    ]);
    setActiveModelMock.mockResolvedValueOnce({ nextModel: 'gpt-4o-mini' });

    const profile: Profile = {
      version: 1,
      provider: 'openai',
      model: 'gpt-4o-mini',
      modelParams: {},
      ephemeralSettings: {},
    };

    const result = await applyProfileWithGuards(profile);

    expect(result.infoMessages).toContain(
      "Model set to 'gpt-4o-mini' for provider 'openai'.",
    );
  });

  it('throws when active provider is not registered after model set', async () => {
    providerManagerStub.available = ['openai'];
    providerManagerStub.providerLookup = new Map([
      ['openai', { name: 'openai' }],
    ]);

    const origGetActiveProvider = providerManagerStub.getActiveProvider;
    switchActiveProviderMock.mockImplementation(async (providerName) => {
      providerManagerStub.activeProviderName = providerName;
      providerManagerStub.providerLookup.delete(providerName);
      providerManagerStub.getActiveProvider = () => null as never;
      return { infoMessages: [], changed: true };
    });

    const profile: Profile = {
      version: 1,
      provider: 'openai',
      model: 'gpt-4o',
      modelParams: {},
      ephemeralSettings: {},
    };

    await expect(applyProfileWithGuards(profile)).rejects.toThrow(
      /Active provider.*is not registered/,
    );
    providerManagerStub.getActiveProvider = origGetActiveProvider;
  });
});
