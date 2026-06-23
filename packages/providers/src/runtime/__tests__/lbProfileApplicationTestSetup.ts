/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shared mock infrastructure for LoadBalancingProvider profile application tests.
 * Extracted from profileApplication.lb.test.ts during #2092 lint hardening so
 * split test files can share the same stubs without exceeding max-lines.
 */

import { vi } from 'vitest';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { LoadBalancingProvider } from '@vybestack/llxprt-code-providers';
import type {
  Profile,
  LoadBalancerProfile,
} from '@vybestack/llxprt-code-settings';

export type ProfileApplicationResult = {
  providerName: string;
  modelName: string;
  warnings: string[];
};

type ProviderManagerStub = {
  providers: Map<string, unknown>;
  activeProviderName: string | null;
  registerProvider: (provider: unknown) => void;
  getProviderByName: (name: string) => unknown | null;
  switchProvider: (name: string) => void;
  listProviders: () => string[];
  getActiveProvider: () => unknown | null;
  getActiveProviderName: () => string | null;
};

type ProfileManagerStub = {
  loadProfile: (profileName: string) => Promise<Profile>;
};

type RuntimeServices = {
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
  providerManager: ProviderManagerStub;
  profileManager?: ProfileManagerStub;
};

export const switchActiveProviderMock = vi.fn<
  (providerName: string) => Promise<{
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
export const getCliRuntimeServicesMock = vi.fn<() => RuntimeServices>();
export const getActiveProviderOrThrowMock = vi.fn<() => { name: string }>();
export const isCliStatelessProviderModeEnabledMock = vi
  .fn<() => boolean>()
  .mockReturnValue(false);
export const isCliRuntimeStatelessReadyMock = vi
  .fn<() => boolean>()
  .mockReturnValue(true);
export const createProviderKeyStorageMock =
  vi.fn<() => { getKey: (name: string) => Promise<string | null> }>();

export const keyStorageStub = {
  getKey: vi.fn<(name: string) => Promise<string | null>>(),
};

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

export const providerManagerStub: ProviderManagerStub = {
  providers: new Map<string, unknown>(),
  activeProviderName: null,
  registerProvider(provider: unknown) {
    const providerWithName = provider as { name: string };
    this.providers.set(providerWithName.name, provider);
  },
  getProviderByName(name: string) {
    return this.providers.get(name) ?? null;
  },
  switchProvider(name: string) {
    this.activeProviderName = name;
  },
  listProviders() {
    return Array.from(this.providers.keys());
  },
  getActiveProvider() {
    return this.activeProviderName
      ? (this.providers.get(this.activeProviderName) ?? null)
      : null;
  },
  getActiveProviderName() {
    return this.activeProviderName;
  },
};

export const profileManagerStub: ProfileManagerStub = {
  loadProfile: vi.fn<(profileName: string) => Promise<Profile>>(),
};

const originalRegisterProvider = providerManagerStub.registerProvider;

/**
 * Wraps registerProvider on the shared providerManagerStub so tests can
 * capture the LoadBalancingProvider instance that gets registered. Each
 * call returns an independent capture handle.
 */
export function wrapRegisterProviderToCaptureLB(): {
  getLBProvider: () => LoadBalancingProvider | null;
} {
  let capturedLBProvider: LoadBalancingProvider | null = null;
  const original =
    providerManagerStub.registerProvider.bind(providerManagerStub);
  providerManagerStub.registerProvider = vi.fn((provider: unknown) => {
    const providerWithName = provider as { name: string };
    if (providerWithName.name === 'load-balancer') {
      capturedLBProvider = provider as LoadBalancingProvider;
    }
    return original(provider);
  });
  return { getLBProvider: () => capturedLBProvider };
}

/**
 * Resets all shared stubs to the standard baseline used by every
 * LoadBalancingProvider profile application test. Call from beforeEach.
 */
export function resetLbProfileApplicationStubs(): void {
  configStub.model = undefined;
  configStub.ephemerals.clear();
  settingsServiceStub.currentProfile = null;
  settingsServiceStub.providerSettings.clear();
  providerManagerStub.providers.clear();
  providerManagerStub.activeProviderName = null;
  providerManagerStub.registerProvider = originalRegisterProvider;

  providerManagerStub.registerProvider({
    name: 'gemini',
    getDefaultModel: () => 'gemini-2.0-flash-exp',
  });
  providerManagerStub.registerProvider({
    name: 'openai',
    getDefaultModel: () => 'gpt-4o-mini',
  });

  switchActiveProviderMock.mockImplementation(async (providerName: string) => {
    providerManagerStub.switchProvider(providerName);
    return {
      infoMessages: [],
      changed: true,
    };
  });
  setActiveModelMock.mockResolvedValue({ nextModel: 'test-model' });
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
    profileManager: profileManagerStub,
  });
  keyStorageStub.getKey.mockResolvedValue(null);
  createProviderKeyStorageMock.mockReturnValue(keyStorageStub);
  getActiveProviderOrThrowMock.mockReturnValue({ name: 'gemini' });
  isCliStatelessProviderModeEnabledMock.mockReturnValue(true);
  isCliRuntimeStatelessReadyMock.mockReturnValue(true);
}

/**
 * Creates a minimal LoadBalancerProfile with the given sub-profile names and
 * optional top-level ephemeral settings.
 */
export function makeLbProfile(
  profiles: string[],
  ephemeralSettings: Record<string, unknown> = {},
): LoadBalancerProfile {
  return {
    version: 1,
    type: 'loadbalancer',
    policy: 'roundrobin',
    profiles,
    provider: '',
    model: '',
    modelParams: {},
    ephemeralSettings,
  };
}

/**
 * Creates a temp directory containing a key file with the given content and
 * returns the keyfile path. The caller is responsible for cleaning up tempDir.
 */
export async function createTempKeyfile(
  content: string,
): Promise<{ tempDir: string; keyfilePath: string }> {
  const tempDir = await fs.mkdtemp(path.join(tmpdir(), 'llxprt-lb-keyfile-'));
  const keyfilePath = path.join(tempDir, 'api-key.txt');
  await fs.writeFile(keyfilePath, content);
  return { tempDir, keyfilePath };
}

/**
 * Reads the subProfiles config array from a captured LoadBalancingProvider.
 */
export function getLbSubProfiles(
  lbProvider: LoadBalancingProvider | null,
): Array<{ authToken?: string; name: string }> {
  if (!lbProvider) {
    return [];
  }
  const config = (
    lbProvider as unknown as {
      config: { subProfiles: Array<{ authToken?: string; name: string }> };
    }
  ).config;
  return config.subProfiles;
}
