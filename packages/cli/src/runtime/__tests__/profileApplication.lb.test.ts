/**
 * Phase 2: Load Balancing Profile Detection Tests (type: loadbalancer format)
 * @plan PLAN-20251211issue486c
 * Phase 2: Profile Detection for `type: "loadbalancer"` format
 *
 * These tests verify that the profile loading system correctly detects
 * the {type: "loadbalancer", profiles: [...]} format and loads referenced
 * sub-profiles using ProfileManager.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  LoadBalancingProvider,
  Profile,
  LoadBalancerProfile,
} from '@vybestack/llxprt-code-core';

type ProfileApplicationResult = {
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

// Mock runtime settings module
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

// Stub objects
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

// Capture original registerProvider to prevent nested wrappers
const originalRegisterProvider = providerManagerStub.registerProvider;

// Helper function to wrap registerProvider and capture LoadBalancingProvider
function wrapRegisterProviderToCaptureLB(): {
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

beforeEach(() => {
  configStub.model = undefined;
  configStub.ephemerals.clear();
  settingsServiceStub.currentProfile = null;
  settingsServiceStub.providerSettings.clear();
  providerManagerStub.providers.clear();
  providerManagerStub.activeProviderName = null;
  // Restore original registerProvider to prevent nested wrappers
  providerManagerStub.registerProvider = originalRegisterProvider;

  // Register standard providers
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

describe('Phase 2: Load Balancing Profile Detection (type: loadbalancer format)', () => {
  describe('Profile format detection', () => {
    it('should detect {type: "loadbalancer", profiles: [...]} format @plan:PLAN-20251211issue486c @phase:2', async () => {
      const lbProfile: LoadBalancerProfile = {
        version: 1,
        type: 'loadbalancer',
        policy: 'roundrobin',
        profiles: ['syntheticglm46', 'syntheticm2maxstreaming'],
        provider: '',
        model: '',
        modelParams: {},
        ephemeralSettings: {
          'context-limit': 190000,
        },
      };

      // Mock ProfileManager to return standard profiles for the referenced profiles
      const mockLoadProfile = vi.fn(
        async (profileName: string): Promise<Profile> => {
          if (profileName === 'syntheticglm46') {
            return {
              version: 1,
              provider: 'gemini',
              model: 'glm-4-flash',
              modelParams: {},
              ephemeralSettings: {
                'auth-key': 'test-key-glm46',
                'base-url': 'https://api.glm46.example.com',
              },
            };
          }
          if (profileName === 'syntheticm2maxstreaming') {
            return {
              version: 1,
              provider: 'openai',
              model: 'm2-max',
              modelParams: {},
              ephemeralSettings: {
                'auth-key': 'test-key-m2max',
                'base-url': 'https://api.m2max.example.com',
              },
            };
          }
          throw new Error(`Profile '${profileName}' not found`);
        },
      );
      profileManagerStub.loadProfile = mockLoadProfile;

      // Track if LoadBalancingProvider was created
      const { getLBProvider } = wrapRegisterProviderToCaptureLB();

      await applyProfileWithGuards(lbProfile, {
        profileName: 'myLB',
      });

      // Verify that LoadBalancingProvider was detected and created
      expect(getLBProvider()).not.toBeNull();
      expect(mockLoadProfile).toHaveBeenCalledWith('syntheticglm46');
      expect(mockLoadProfile).toHaveBeenCalledWith('syntheticm2maxstreaming');
    });

    it('should NOT detect standard profile as loadbalancer @plan:PLAN-20251211issue486c @phase:2', async () => {
      const standardProfile: Profile = {
        version: 1,
        provider: 'gemini',
        model: 'gemini-2.0-flash-exp',
        modelParams: {},
        ephemeralSettings: {},
      };

      // Track if LoadBalancingProvider was created
      const { getLBProvider } = wrapRegisterProviderToCaptureLB();

      await applyProfileWithGuards(standardProfile, {
        profileName: 'standard-profile',
      });

      // Verify that LoadBalancingProvider was NOT created
      expect(getLBProvider()).toBeNull();
    });
  });

  describe('Sub-profile loading via ProfileManager', () => {
    it('should load each sub-profile using ProfileManager @plan:PLAN-20251211issue486c @phase:2', async () => {
      const lbProfile: LoadBalancerProfile = {
        version: 1,
        type: 'loadbalancer',
        policy: 'roundrobin',
        profiles: ['profile1', 'profile2', 'profile3'],
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

      await applyProfileWithGuards(lbProfile, {
        profileName: 'myLB',
      });

      // Verify each sub-profile was loaded
      expect(mockLoadProfile).toHaveBeenCalledWith('profile1');
      expect(mockLoadProfile).toHaveBeenCalledWith('profile2');
      expect(mockLoadProfile).toHaveBeenCalledWith('profile3');
      expect(mockLoadProfile).toHaveBeenCalledTimes(3);
    });

    it('should extract full config from loaded sub-profiles @plan:PLAN-20251211issue486c @phase:2', async () => {
      const lbProfile: LoadBalancerProfile = {
        version: 1,
        type: 'loadbalancer',
        policy: 'roundrobin',
        profiles: ['subProfile1'],
        provider: '',
        model: '',
        modelParams: {},
        ephemeralSettings: {},
      };

      const mockLoadProfile = vi.fn(
        async (): Promise<Profile> => ({
          version: 1,
          provider: 'gemini',
          model: 'gemini-2.0-flash-exp',
          modelParams: {
            temperature: 0.7,
            max_tokens: 4096,
          },
          ephemeralSettings: {
            'auth-key': 'test-api-key',
            'base-url': 'https://custom.api.example.com',
            'context-limit': 100000,
          },
        }),
      );
      profileManagerStub.loadProfile = mockLoadProfile;

      const { getLBProvider } = wrapRegisterProviderToCaptureLB();

      await applyProfileWithGuards(lbProfile, {
        profileName: 'myLB',
      });

      // Verify provider was created (config extraction happens internally)
      expect(getLBProvider()).not.toBeNull();
      expect(mockLoadProfile).toHaveBeenCalledWith('subProfile1');
    });
  });

  describe('Error handling - missing sub-profiles', () => {
    it('should fail-fast when referenced profile does not exist @plan:PLAN-20251211issue486c @phase:2', async () => {
      const lbProfile: LoadBalancerProfile = {
        version: 1,
        type: 'loadbalancer',
        policy: 'roundrobin',
        profiles: ['existingProfile', 'nonexistent'],
        provider: '',
        model: '',
        modelParams: {},
        ephemeralSettings: {},
      };

      const mockLoadProfile = vi.fn(
        async (profileName: string): Promise<Profile> => {
          if (profileName === 'existingProfile') {
            return {
              version: 1,
              provider: 'gemini',
              model: 'test-model',
              modelParams: {},
              ephemeralSettings: {},
            };
          }
          throw new Error(`Profile '${profileName}' not found`);
        },
      );
      profileManagerStub.loadProfile = mockLoadProfile;

      await expect(
        applyProfileWithGuards(lbProfile, {
          profileName: 'myLB',
        }),
      ).rejects.toThrow(/nonexistent.*does not exist/i);
    });

    it('should provide clear error message with LB profile name and missing sub-profile name @plan:PLAN-20251211issue486c @phase:2', async () => {
      const lbProfile: LoadBalancerProfile = {
        version: 1,
        type: 'loadbalancer',
        policy: 'roundrobin',
        profiles: ['missingSubProfile'],
        provider: '',
        model: '',
        modelParams: {},
        ephemeralSettings: {},
      };

      const mockLoadProfile = vi.fn(async (profileName: string) => {
        throw new Error(`Profile '${profileName}' not found`);
      });
      profileManagerStub.loadProfile = mockLoadProfile;

      let caughtError: Error | null = null;
      try {
        await applyProfileWithGuards(lbProfile, {
          profileName: 'myLB',
        });
      } catch (error) {
        caughtError = error as Error;
      }

      expect(caughtError).not.toBeNull();
      // Error message should mention both LB profile name and missing sub-profile
      expect(caughtError?.message).toMatch(/myLB/);
      expect(caughtError?.message).toMatch(/missingSubProfile/);
    });
  });

  describe('Error handling - circular references', () => {
    it('should detect circular reference when sub-profile is also a loadbalancer @plan:PLAN-20251211issue486c @phase:2', async () => {
      const lbProfile: LoadBalancerProfile = {
        version: 1,
        type: 'loadbalancer',
        policy: 'roundrobin',
        profiles: ['circularLB'],
        provider: '',
        model: '',
        modelParams: {},
        ephemeralSettings: {},
      };

      const mockLoadProfile = vi.fn(
        async (): Promise<LoadBalancerProfile> =>
          // Return another loadbalancer profile (circular)
          ({
            version: 1,
            type: 'loadbalancer',
            policy: 'roundrobin',
            profiles: ['anotherProfile'],
            provider: '',
            model: '',
            modelParams: {},
            ephemeralSettings: {},
          }),
      );
      profileManagerStub.loadProfile = mockLoadProfile;

      await expect(
        applyProfileWithGuards(lbProfile, {
          profileName: 'myLB',
        }),
      ).rejects.toThrow(/circular|loadbalancer.*loadbalancer/i);
    });
  });

  describe('LoadBalancingProvider creation from loaded sub-profiles', () => {
    it('should create LoadBalancingProvider with resolved sub-profile configs @plan:PLAN-20251211issue486c @phase:2', async () => {
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
        async (profileName: string): Promise<Profile> => {
          if (profileName === 'sub1') {
            return {
              version: 1,
              provider: 'gemini',
              model: 'gemini-flash',
              modelParams: {},
              ephemeralSettings: {
                'auth-key': 'key-sub1',
                'base-url': 'https://sub1.example.com',
              },
            };
          }
          return {
            version: 1,
            provider: 'openai',
            model: 'gpt-4o-mini',
            modelParams: {},
            ephemeralSettings: {
              'auth-key': 'key-sub2',
              'base-url': 'https://sub2.example.com',
            },
          };
        },
      );
      profileManagerStub.loadProfile = mockLoadProfile;

      const { getLBProvider } = wrapRegisterProviderToCaptureLB();

      await applyProfileWithGuards(lbProfile, {
        profileName: 'myLB',
      });

      expect(getLBProvider()).not.toBeNull();
      expect(getLBProvider()).toHaveProperty('name', 'load-balancer');
    });

    it('should register LoadBalancingProvider as "load-balancer" @plan:PLAN-20251211issue486c @phase:2', async () => {
      const lbProfile: LoadBalancerProfile = {
        version: 1,
        type: 'loadbalancer',
        policy: 'roundrobin',
        profiles: ['sub1'],
        provider: '',
        model: '',
        modelParams: {},
        ephemeralSettings: {},
      };

      const mockLoadProfile = vi.fn(
        async (): Promise<Profile> => ({
          version: 1,
          provider: 'gemini',
          model: 'gemini-flash',
          modelParams: {},
          ephemeralSettings: {},
        }),
      );
      profileManagerStub.loadProfile = mockLoadProfile;

      await applyProfileWithGuards(lbProfile, {
        profileName: 'myLB',
      });

      const registeredProvider =
        providerManagerStub.getProviderByName('load-balancer');
      expect(registeredProvider).not.toBeNull();
      expect(registeredProvider).toHaveProperty('name', 'load-balancer');
    });

    it('should set load-balancer as active provider @plan:PLAN-20251211issue486c @phase:2', async () => {
      const lbProfile: LoadBalancerProfile = {
        version: 1,
        type: 'loadbalancer',
        policy: 'roundrobin',
        profiles: ['sub1'],
        provider: '',
        model: '',
        modelParams: {},
        ephemeralSettings: {},
      };

      const mockLoadProfile = vi.fn(
        async (): Promise<Profile> => ({
          version: 1,
          provider: 'gemini',
          model: 'gemini-flash',
          modelParams: {},
          ephemeralSettings: {},
        }),
      );
      profileManagerStub.loadProfile = mockLoadProfile;

      await applyProfileWithGuards(lbProfile, {
        profileName: 'myLB',
      });

      const activeProviderName = providerManagerStub.getActiveProviderName();
      expect(activeProviderName).toBe('load-balancer');
    });

    it('should return load-balancer as providerName in result @plan:PLAN-20251211issue486c @phase:2', async () => {
      const lbProfile: LoadBalancerProfile = {
        version: 1,
        type: 'loadbalancer',
        policy: 'roundrobin',
        profiles: ['sub1'],
        provider: '',
        model: '',
        modelParams: {},
        ephemeralSettings: {},
      };

      const mockLoadProfile = vi.fn(
        async (): Promise<Profile> => ({
          version: 1,
          provider: 'gemini',
          model: 'gemini-flash',
          modelParams: {},
          ephemeralSettings: {},
        }),
      );
      profileManagerStub.loadProfile = mockLoadProfile;

      const result = (await applyProfileWithGuards(lbProfile, {
        profileName: 'myLB',
      })) as unknown as ProfileApplicationResult;

      expect(result.providerName).toBe('load-balancer');
    });
  });

  describe('Integration with ephemeralSettings', () => {
    it('should apply top-level ephemeralSettings from LB profile @plan:PLAN-20251211issue486c @phase:2', async () => {
      const lbProfile: LoadBalancerProfile = {
        version: 1,
        type: 'loadbalancer',
        policy: 'roundrobin',
        profiles: ['sub1'],
        provider: '',
        model: '',
        modelParams: {},
        ephemeralSettings: {
          'context-limit': 190000,
          streaming: 'enabled',
        },
      };

      const mockLoadProfile = vi.fn(
        async (): Promise<Profile> => ({
          version: 1,
          provider: 'gemini',
          model: 'gemini-flash',
          modelParams: {},
          ephemeralSettings: {},
        }),
      );
      profileManagerStub.loadProfile = mockLoadProfile;

      await applyProfileWithGuards(lbProfile, {
        profileName: 'myLB',
      });

      // Verify ephemeralSettings were applied
      expect(setEphemeralSettingMock).toHaveBeenCalledWith(
        'context-limit',
        190000,
      );
      expect(setEphemeralSettingMock).toHaveBeenCalledWith(
        'streaming',
        'enabled',
      );
    });
  });

  describe('Detection priority', () => {
    it('should check for type: loadbalancer BEFORE loadBalancer.subProfiles format @plan:PLAN-20251211issue486c @phase:2', async () => {
      // This test ensures the new format is checked first (as per plan requirement)
      // We verify by ensuring that when we pass a type: loadbalancer profile,
      // it uses ProfileManager to load sub-profiles (new behavior)
      // rather than using inline subProfiles (old behavior from 486b)

      const lbProfile: LoadBalancerProfile = {
        version: 1,
        type: 'loadbalancer',
        policy: 'roundrobin',
        profiles: ['sub1'],
        provider: '',
        model: '',
        modelParams: {},
        ephemeralSettings: {},
      };

      const mockLoadProfile = vi.fn(
        async (): Promise<Profile> => ({
          version: 1,
          provider: 'gemini',
          model: 'gemini-flash',
          modelParams: {},
          ephemeralSettings: {},
        }),
      );
      profileManagerStub.loadProfile = mockLoadProfile;

      await applyProfileWithGuards(lbProfile, {
        profileName: 'myLB',
      });

      // Verify that ProfileManager.loadProfile was called (new format behavior)
      expect(mockLoadProfile).toHaveBeenCalledWith('sub1');

      // Verify LoadBalancingProvider was created
      const registeredProvider =
        providerManagerStub.getProviderByName('load-balancer');
      expect(registeredProvider).not.toBeNull();
    });
  });

  describe('Phase 5: Old 486b inline format is no longer supported', () => {
    it('should ignore old inline loadBalancer.subProfiles format and NOT create LB provider @plan:PLAN-20251211issue486c @phase:5', async () => {
      // Phase 5: The old 486b format {loadBalancer: {subProfiles: [...]}} is no longer supported
      // It should be ignored (treated as a standard profile) and NOT create a LoadBalancingProvider

      // Create a profile with the old 486b loadBalancer format
      // Cast as Profile to bypass type checking since this format is no longer supported
      const oldInlineFormatProfile = {
        version: 1 as const,
        provider: 'gemini',
        model: 'gemini-2.0-flash-exp',
        modelParams: {},
        ephemeralSettings: {},
        loadBalancer: {
          strategy: 'round-robin' as const,
          subProfiles: [
            {
              name: 'sub1',
              provider: 'gemini',
              model: 'gemini-flash',
              apiKey: 'test-key',
            },
            {
              name: 'sub2',
              provider: 'openai',
              model: 'gpt-4o-mini',
              apiKey: 'test-key-2',
            },
          ],
        },
      } as unknown as Profile;

      // Track if LoadBalancingProvider was created
      const { getLBProvider } = wrapRegisterProviderToCaptureLB();

      // This should treat the profile as a standard profile (use provider: gemini)
      const result = (await applyProfileWithGuards(oldInlineFormatProfile, {
        profileName: 'oldFormat',
      })) as unknown as ProfileApplicationResult;

      // Verify that LoadBalancingProvider was NOT created
      expect(getLBProvider()).toBeNull();

      // Verify the provider was set to 'gemini' (from profile.provider), not 'load-balancer'
      expect(result.providerName).toBe('gemini');

      // Verify the model was set correctly
      expect(result.modelName).toBe('test-model');
    });
  });
});
