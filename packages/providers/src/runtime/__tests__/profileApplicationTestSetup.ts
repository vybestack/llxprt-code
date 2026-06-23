/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shared mock infrastructure for profileApplication tests (non-LB variant).
 * Extracted from profileApplication.test.ts during #2092 lint hardening so
 * split test files can share the same stubs without exceeding max-lines.
 */

import { vi } from 'vitest';
import type { Profile } from '@vybestack/llxprt-code-settings';

export type ProfileApplicationResult = {
  providerName: string;
  modelName: string;
  baseUrl?: string;
  warnings: string[];
  didFallback?: boolean;
};

export const switchActiveProviderMock = vi.fn<
  (
    providerName: string,
    options?: { preserveEphemerals?: string[] },
  ) => Promise<{
    infoMessages: string[];
    changed: boolean;
  }>
>();
export const setActiveModelMock =
  vi.fn<(model: string) => Promise<{ nextModel: string }>>();
export const updateActiveProviderBaseUrlMock =
  vi.fn<(baseUrl: string | null) => Promise<{ message?: string }>>();
export const updateActiveProviderApiKeyMock =
  vi.fn<(apiKey: string | null) => Promise<{ message?: string }>>();
export const setActiveModelParamMock =
  vi.fn<(key: string, value: unknown) => void>();
export const clearActiveModelParamMock = vi.fn<(key: string) => void>();
export const getActiveModelParamsMock = vi.fn<() => Record<string, unknown>>();
export const setEphemeralSettingMock =
  vi.fn<(key: string, value: unknown) => void>();
export const createProviderKeyStorageMock = vi.fn<
  () => {
    getKey: (name: string) => Promise<string | null>;
  }
>();
export const getCliRuntimeServicesMock = vi.fn<
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
export const getActiveProviderOrThrowMock = vi.fn<() => { name: string }>();

export const configStub = {
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

export const settingsServiceStub = {
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

export const providerManagerStub = {
  available: [] as string[],
  activeProviderName: 'openai',
  providerLookup: new Map<
    string,
    { name: string; getDefaultModel?: () => string }
  >(),
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
export const isCliStatelessProviderModeEnabledMock = vi
  .fn<() => boolean>()
  .mockReturnValue(false);
export const isCliRuntimeStatelessReadyMock = vi
  .fn<() => boolean>()
  .mockReturnValue(true);

export const mockProfileManager = {
  loadProfile: vi.fn<(profileName: string) => Promise<Profile>>(),
};

export const keyStorageStub = {
  getKey: vi.fn<(name: string) => Promise<string | null>>(),
};

/**
 * Resets all shared stubs to the standard baseline. Call from beforeEach.
 * Saves and restores GCP env vars.
 */
export function resetProfileApplicationStubs(): {
  savedGcpProject: string | undefined;
  savedGcpLocation: string | undefined;
} {
  const savedGcpProject = process.env.GOOGLE_CLOUD_PROJECT;
  const savedGcpLocation = process.env.GOOGLE_CLOUD_LOCATION;
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
  keyStorageStub.getKey.mockResolvedValue(null);
  createProviderKeyStorageMock.mockReturnValue(keyStorageStub);
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

  return { savedGcpProject, savedGcpLocation };
}

/**
 * Restores GCP env vars saved by resetProfileApplicationStubs. Call from
 * afterEach with the values returned by resetProfileApplicationStubs.
 */
export function restoreGcpEnvVars(
  savedGcpProject?: string,
  savedGcpLocation?: string,
): void {
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
}
