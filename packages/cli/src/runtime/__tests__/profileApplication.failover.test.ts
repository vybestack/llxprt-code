/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * @plan PLAN-20251212issue488
 * Phase 1: Profile Application Failover Tests (TDD - RED)
 *
 * Tests MUST be written FIRST, implementation SECOND.
 * These tests verify that the profile application system correctly maps
 * the failover policy to the failover strategy.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  LoadBalancingProvider,
  Profile,
  LoadBalancerProfile,
} from '@vybestack/llxprt-code-core';

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

const switchActiveProviderMock = vi.fn<
  (providerName: string) => Promise<{
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
const getCliRuntimeServicesMock = vi.fn<() => RuntimeServices>();
const getActiveProviderOrThrowMock = vi.fn<() => { name: string }>();
const isCliStatelessProviderModeEnabledMock = vi
  .fn<() => boolean>()
  .mockReturnValue(false);
const isCliRuntimeStatelessReadyMock = vi
  .fn<() => boolean>()
  .mockReturnValue(true);

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

const providerManagerStub: ProviderManagerStub = {
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

const profileManagerStub: ProfileManagerStub = {
  loadProfile: vi.fn<(profileName: string) => Promise<Profile>>(),
};

const originalRegisterProvider = providerManagerStub.registerProvider;

function wrapRegisterProviderToCaptureLB(): {
  getLBProvider: () => LoadBalancingProvider | null;
  getLBConfig: () => unknown;
} {
  let capturedLBProvider: LoadBalancingProvider | null = null;
  let capturedLBConfig: unknown = null;
  const original =
    providerManagerStub.registerProvider.bind(providerManagerStub);
  providerManagerStub.registerProvider = vi.fn((provider: unknown) => {
    const providerWithName = provider as { name: string };
    if (providerWithName.name === 'load-balancer') {
      capturedLBProvider = provider as LoadBalancingProvider;
      capturedLBConfig = (provider as { config?: unknown }).config;
    }
    return original(provider);
  });
  return {
    getLBProvider: () => capturedLBProvider,
    getLBConfig: () => capturedLBConfig,
  };
}

beforeEach(() => {
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
  getActiveProviderOrThrowMock.mockReturnValue({ name: 'gemini' });
  isCliStatelessProviderModeEnabledMock.mockReturnValue(true);
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

const { applyProfileWithGuards } = await import('../profileApplication.js');

describe('profileApplication - Failover Policy Mapping', () => {
  describe('Policy to strategy mapping', () => {
    it('should map policy "failover" to strategy "failover"', async () => {
      const lbProfile: LoadBalancerProfile = {
        version: 1,
        type: 'loadbalancer',
        policy: 'failover',
        profiles: ['sub1', 'sub2'],
        provider: '',
        model: '',
        modelParams: {},
        ephemeralSettings: {},
      };

      const mockLoadProfile = vi.fn(
        async (profileName: string): Promise<Profile> => ({
          version: 1,
          provider: 'gemini',
          model: `model-${profileName}`,
          modelParams: {},
          ephemeralSettings: {
            'auth-key': `key-${profileName}`,
          },
        }),
      );
      profileManagerStub.loadProfile = mockLoadProfile;

      const { getLBConfig } = wrapRegisterProviderToCaptureLB();

      await applyProfileWithGuards(lbProfile, {
        profileName: 'myFailoverLB',
      });

      const config = getLBConfig() as { strategy: string } | null;
      expect(config).not.toBeNull();
      expect(config?.strategy).toBe('failover');
    });

    it('should map policy "roundrobin" to strategy "round-robin"', async () => {
      const lbProfile: LoadBalancerProfile = {
        version: 1,
        type: 'loadbalancer',
        policy: 'roundrobin',
        profiles: ['sub1', 'sub2'],
        provider: '',
        model: '',
        modelParams: {},
        ephemeralSettings: {},
      };

      const mockLoadProfile = vi.fn(
        async (profileName: string): Promise<Profile> => ({
          version: 1,
          provider: 'gemini',
          model: `model-${profileName}`,
          modelParams: {},
          ephemeralSettings: {
            'auth-key': `key-${profileName}`,
          },
        }),
      );
      profileManagerStub.loadProfile = mockLoadProfile;

      const { getLBConfig } = wrapRegisterProviderToCaptureLB();

      await applyProfileWithGuards(lbProfile, {
        profileName: 'myRoundRobinLB',
      });

      const config = getLBConfig() as { strategy: string } | null;
      expect(config).not.toBeNull();
      expect(config?.strategy).toBe('round-robin');
    });
  });

  describe('LoadBalancingProvider creation with correct strategy', () => {
    it('should create LoadBalancingProvider with failover strategy from policy', async () => {
      const lbProfile: LoadBalancerProfile = {
        version: 1,
        type: 'loadbalancer',
        policy: 'failover',
        profiles: ['sub1', 'sub2'],
        provider: '',
        model: '',
        modelParams: {},
        ephemeralSettings: {},
      };

      const mockLoadProfile = vi.fn(
        async (): Promise<Profile> => ({
          version: 1,
          provider: 'gemini',
          model: 'test-model',
          modelParams: {},
          ephemeralSettings: {},
        }),
      );
      profileManagerStub.loadProfile = mockLoadProfile;

      const { getLBProvider } = wrapRegisterProviderToCaptureLB();

      await applyProfileWithGuards(lbProfile, {
        profileName: 'myFailoverLB',
      });

      expect(getLBProvider()).not.toBeNull();
      expect(getLBProvider()?.name).toBe('load-balancer');
    });

    it('should register LoadBalancingProvider with providerManager', async () => {
      const lbProfile: LoadBalancerProfile = {
        version: 1,
        type: 'loadbalancer',
        policy: 'failover',
        profiles: ['sub1', 'sub2'],
        provider: '',
        model: '',
        modelParams: {},
        ephemeralSettings: {},
      };

      const mockLoadProfile = vi.fn(
        async (): Promise<Profile> => ({
          version: 1,
          provider: 'gemini',
          model: 'test-model',
          modelParams: {},
          ephemeralSettings: {},
        }),
      );
      profileManagerStub.loadProfile = mockLoadProfile;

      await applyProfileWithGuards(lbProfile, {
        profileName: 'myFailoverLB',
      });

      const registeredProvider =
        providerManagerStub.getProviderByName('load-balancer');
      expect(registeredProvider).not.toBeNull();
    });
  });

  describe('Ephemeral settings passing', () => {
    it('should pass ephemeral settings to LoadBalancingProviderConfig', async () => {
      const lbProfile: LoadBalancerProfile = {
        version: 1,
        type: 'loadbalancer',
        policy: 'failover',
        profiles: ['sub1', 'sub2'],
        provider: '',
        model: '',
        modelParams: {},
        ephemeralSettings: {
          failover_retry_count: 3,
          failover_retry_delay_ms: 1000,
          'context-limit': 100000,
        } as unknown as typeof lbProfile.ephemeralSettings,
      };

      const mockLoadProfile = vi.fn(
        async (): Promise<Profile> => ({
          version: 1,
          provider: 'gemini',
          model: 'test-model',
          modelParams: {},
          ephemeralSettings: {},
        }),
      );
      profileManagerStub.loadProfile = mockLoadProfile;

      const { getLBConfig } = wrapRegisterProviderToCaptureLB();

      await applyProfileWithGuards(lbProfile, {
        profileName: 'myFailoverLB',
      });

      const config = getLBConfig() as {
        lbProfileEphemeralSettings?: Record<string, unknown>;
      } | null;
      expect(config).not.toBeNull();
      expect(config?.lbProfileEphemeralSettings).toBeDefined();
      expect(config?.lbProfileEphemeralSettings?.failover_retry_count).toBe(3);
      expect(config?.lbProfileEphemeralSettings?.failover_retry_delay_ms).toBe(
        1000,
      );
      expect(config?.lbProfileEphemeralSettings?.['context-limit']).toBe(
        100000,
      );
    });

    it('should pass empty ephemeral settings when none provided', async () => {
      const lbProfile: LoadBalancerProfile = {
        version: 1,
        type: 'loadbalancer',
        policy: 'failover',
        profiles: ['sub1', 'sub2'],
        provider: '',
        model: '',
        modelParams: {},
        ephemeralSettings: {},
      };

      const mockLoadProfile = vi.fn(
        async (): Promise<Profile> => ({
          version: 1,
          provider: 'gemini',
          model: 'test-model',
          modelParams: {},
          ephemeralSettings: {},
        }),
      );
      profileManagerStub.loadProfile = mockLoadProfile;

      const { getLBConfig } = wrapRegisterProviderToCaptureLB();

      await applyProfileWithGuards(lbProfile, {
        profileName: 'myFailoverLB',
      });

      const config = getLBConfig() as {
        lbProfileEphemeralSettings?: Record<string, unknown>;
      } | null;
      expect(config).not.toBeNull();
      expect(config?.lbProfileEphemeralSettings).toBeDefined();
      expect(
        Object.keys(config?.lbProfileEphemeralSettings ?? {}),
      ).toHaveLength(0);
    });
  });

  describe('Strategy in config matches policy', () => {
    it('should have failover strategy when policy is failover', async () => {
      const lbProfile: LoadBalancerProfile = {
        version: 1,
        type: 'loadbalancer',
        policy: 'failover',
        profiles: ['sub1', 'sub2'],
        provider: '',
        model: '',
        modelParams: {},
        ephemeralSettings: {},
      };

      const mockLoadProfile = vi.fn(
        async (): Promise<Profile> => ({
          version: 1,
          provider: 'gemini',
          model: 'test-model',
          modelParams: {},
          ephemeralSettings: {},
        }),
      );
      profileManagerStub.loadProfile = mockLoadProfile;

      const { getLBConfig } = wrapRegisterProviderToCaptureLB();

      await applyProfileWithGuards(lbProfile, {
        profileName: 'myFailoverLB',
      });

      const config = getLBConfig() as { strategy: string } | null;
      expect(config).not.toBeNull();
      expect(config?.strategy).toBe('failover');
    });

    it('should have round-robin strategy when policy is roundrobin', async () => {
      const lbProfile: LoadBalancerProfile = {
        version: 1,
        type: 'loadbalancer',
        policy: 'roundrobin',
        profiles: ['sub1', 'sub2'],
        provider: '',
        model: '',
        modelParams: {},
        ephemeralSettings: {},
      };

      const mockLoadProfile = vi.fn(
        async (): Promise<Profile> => ({
          version: 1,
          provider: 'gemini',
          model: 'test-model',
          modelParams: {},
          ephemeralSettings: {},
        }),
      );
      profileManagerStub.loadProfile = mockLoadProfile;

      const { getLBConfig } = wrapRegisterProviderToCaptureLB();

      await applyProfileWithGuards(lbProfile, {
        profileName: 'myRoundRobinLB',
      });

      const config = getLBConfig() as { strategy: string } | null;
      expect(config).not.toBeNull();
      expect(config?.strategy).toBe('round-robin');
    });
  });

  describe('Profile name in config', () => {
    it('should include profile name in LoadBalancingProviderConfig', async () => {
      const lbProfile: LoadBalancerProfile = {
        version: 1,
        type: 'loadbalancer',
        policy: 'failover',
        profiles: ['sub1', 'sub2'],
        provider: '',
        model: '',
        modelParams: {},
        ephemeralSettings: {},
      };

      const mockLoadProfile = vi.fn(
        async (): Promise<Profile> => ({
          version: 1,
          provider: 'gemini',
          model: 'test-model',
          modelParams: {},
          ephemeralSettings: {},
        }),
      );
      profileManagerStub.loadProfile = mockLoadProfile;

      const { getLBConfig } = wrapRegisterProviderToCaptureLB();

      await applyProfileWithGuards(lbProfile, {
        profileName: 'myCustomFailoverLB',
      });

      const config = getLBConfig() as { profileName: string } | null;
      expect(config).not.toBeNull();
      expect(config?.profileName).toBe('myCustomFailoverLB');
    });
  });
});
