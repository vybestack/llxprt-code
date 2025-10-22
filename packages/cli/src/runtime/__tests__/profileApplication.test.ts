/**
 * @plan PLAN-20251020-STATELESSPROVIDER3.P08
 * @requirement REQ-SP3-002
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Profile } from '@vybestack/llxprt-code-core';

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
});
