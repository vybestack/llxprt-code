/**
 * Phase 2: Load Balancing Profile Detection Tests (type: loadbalancer format)
 * @plan PLAN-20251211issue486c
 * Phase 2: Profile Detection for `type: "loadbalancer"` format
 *
 * These tests verify that the profile loading system correctly detects
 * the {type: "loadbalancer", profiles: [...]} format and loads referenced
 * sub-profiles using ProfileManager.
 */

/**
 * @plan:PLAN-20260603-ISSUE1584.P12
 * @requirement:REQ-API-001
 * @pseudocode consumer-migration.md lines 10-15
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  Profile,
  LoadBalancerProfile,
} from '@vybestack/llxprt-code-settings';
import {
  switchActiveProviderMock,
  setActiveModelMock,
  updateActiveProviderBaseUrlMock,
  updateActiveProviderApiKeyMock,
  setActiveModelParamMock,
  clearActiveModelParamMock,
  getActiveModelParamsMock,
  setEphemeralSettingMock,
  getCliRuntimeServicesMock,
  getActiveProviderOrThrowMock,
  isCliStatelessProviderModeEnabledMock,
  isCliRuntimeStatelessReadyMock,
  createProviderKeyStorageMock,
  providerManagerStub,
  profileManagerStub,
  wrapRegisterProviderToCaptureLB,
  resetLbProfileApplicationStubs,
  makeLbProfile,
} from './lbProfileApplicationTestSetup.js';
import type { ProfileApplicationResult } from './lbProfileApplicationTestSetup.js';

vi.mock('../runtimeSettings.js', () => ({
  switchActiveProvider: switchActiveProviderMock,
  setActiveModel: setActiveModelMock,
  updateActiveProviderBaseUrl: updateActiveProviderBaseUrlMock,
  updateActiveProviderApiKey: updateActiveProviderApiKeyMock,
  setActiveModelParam: setActiveModelParamMock,
  clearActiveModelParam: clearActiveModelParamMock,
  getActiveModelParams: getActiveModelParamsMock,
  setEphemeralSetting: setEphemeralSettingMock,
  createProviderKeyStorage: createProviderKeyStorageMock,
  getCliRuntimeServices: getCliRuntimeServicesMock,
  getActiveProviderOrThrow: getActiveProviderOrThrowMock,
  isCliStatelessProviderModeEnabled: isCliStatelessProviderModeEnabledMock,
  isCliRuntimeStatelessReady: isCliRuntimeStatelessReadyMock,
}));

const { applyProfileWithGuards } = await import('../profileApplication.js');

describe('Phase 2: Load Balancing Profile Detection (type: loadbalancer format)', () => {
  beforeEach(() => {
    resetLbProfileApplicationStubs();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Profile format detection', () => {
    it('should detect {type: "loadbalancer", profiles: [...]} format @plan:PLAN-20251211issue486c @phase:2', async () => {
      const lbProfile: LoadBalancerProfile = makeLbProfile(
        ['syntheticglm46', 'syntheticm2maxstreaming'],
        {
          'context-limit': 190000,
        },
      );

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

      const { getLBProvider } = wrapRegisterProviderToCaptureLB();

      await applyProfileWithGuards(lbProfile, {
        profileName: 'myLB',
      });

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

      const { getLBProvider } = wrapRegisterProviderToCaptureLB();

      await applyProfileWithGuards(standardProfile, {
        profileName: 'standard-profile',
      });

      expect(getLBProvider()).toBeNull();
    });
  });

  describe('Sub-profile loading via ProfileManager', () => {
    it('should load each sub-profile using ProfileManager @plan:PLAN-20251211issue486c @phase:2', async () => {
      const lbProfile = makeLbProfile(['profile1', 'profile2', 'profile3']);

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

      expect(mockLoadProfile).toHaveBeenCalledWith('profile1');
      expect(mockLoadProfile).toHaveBeenCalledWith('profile2');
      expect(mockLoadProfile).toHaveBeenCalledWith('profile3');
      expect(mockLoadProfile).toHaveBeenCalledTimes(3);
    });

    it('should extract full config from loaded sub-profiles @plan:PLAN-20251211issue486c @phase:2', async () => {
      const lbProfile = makeLbProfile(['subProfile1']);

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

      expect(getLBProvider()).not.toBeNull();
      expect(mockLoadProfile).toHaveBeenCalledWith('subProfile1');
    });
  });

  describe('Error handling - missing sub-profiles', () => {
    it('should fail-fast when referenced profile does not exist @plan:PLAN-20251211issue486c @phase:2', async () => {
      const lbProfile = makeLbProfile(['existingProfile', 'nonexistent']);

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
      const lbProfile = makeLbProfile(['missingSubProfile']);

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
      expect(caughtError?.message).toMatch(/myLB/);
      expect(caughtError?.message).toMatch(/missingSubProfile/);
    });
  });

  describe('Error handling - circular references', () => {
    it('should detect circular reference when sub-profile is also a loadbalancer @plan:PLAN-20251211issue486c @phase:2', async () => {
      const lbProfile = makeLbProfile(['circularLB']);

      const mockLoadProfile = vi.fn(
        async (): Promise<LoadBalancerProfile> => ({
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
      const lbProfile = makeLbProfile(['sub1', 'sub2']);

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
      const lbProfile = makeLbProfile(['sub1']);

      profileManagerStub.loadProfile = vi.fn(
        async (): Promise<Profile> => ({
          version: 1,
          provider: 'gemini',
          model: 'gemini-flash',
          modelParams: {},
          ephemeralSettings: {},
        }),
      );

      await applyProfileWithGuards(lbProfile, {
        profileName: 'myLB',
      });

      const registeredProvider =
        providerManagerStub.getProviderByName('load-balancer');
      expect(registeredProvider).not.toBeNull();
      expect(registeredProvider).toHaveProperty('name', 'load-balancer');
    });

    it('should set load-balancer as active provider @plan:PLAN-20251211issue486c @phase:2', async () => {
      const lbProfile = makeLbProfile(['sub1']);

      profileManagerStub.loadProfile = vi.fn(
        async (): Promise<Profile> => ({
          version: 1,
          provider: 'gemini',
          model: 'gemini-flash',
          modelParams: {},
          ephemeralSettings: {},
        }),
      );

      await applyProfileWithGuards(lbProfile, {
        profileName: 'myLB',
      });

      const activeProviderName = providerManagerStub.getActiveProviderName();
      expect(activeProviderName).toBe('load-balancer');
    });

    it('should return load-balancer as providerName in result @plan:PLAN-20251211issue486c @phase:2', async () => {
      const lbProfile = makeLbProfile(['sub1']);

      profileManagerStub.loadProfile = vi.fn(
        async (): Promise<Profile> => ({
          version: 1,
          provider: 'gemini',
          model: 'gemini-flash',
          modelParams: {},
          ephemeralSettings: {},
        }),
      );

      const result = (await applyProfileWithGuards(lbProfile, {
        profileName: 'myLB',
      })) as unknown as ProfileApplicationResult;

      expect(result.providerName).toBe('load-balancer');
    });
  });

  describe('Integration with ephemeralSettings', () => {
    it('should apply top-level ephemeralSettings from LB profile @plan:PLAN-20251211issue486c @phase:2', async () => {
      const lbProfile = makeLbProfile(['sub1'], {
        'context-limit': 190000,
        streaming: 'enabled',
      });

      profileManagerStub.loadProfile = vi.fn(
        async (): Promise<Profile> => ({
          version: 1,
          provider: 'gemini',
          model: 'gemini-flash',
          modelParams: {},
          ephemeralSettings: {},
        }),
      );

      await applyProfileWithGuards(lbProfile, {
        profileName: 'myLB',
      });

      expect(setEphemeralSettingMock).toHaveBeenCalledWith(
        'context-limit',
        190000,
      );
      expect(setEphemeralSettingMock).toHaveBeenCalledWith(
        'streaming',
        'enabled',
      );
    });

    it('should apply top-level contextLimit from LB profile as runtime context-limit', async () => {
      const lbProfile: LoadBalancerProfile = {
        version: 1,
        type: 'loadbalancer',
        policy: 'roundrobin',
        profiles: ['sub1'],
        contextLimit: 200000,
        provider: '',
        model: '',
        modelParams: {},
        ephemeralSettings: {
          streaming: 'enabled',
        },
      };

      profileManagerStub.loadProfile = vi.fn(
        async (): Promise<Profile> => ({
          version: 1,
          provider: 'gemini',
          model: 'gemini-flash',
          modelParams: {},
          ephemeralSettings: {},
        }),
      );
      const { getLBProvider } = wrapRegisterProviderToCaptureLB();

      await applyProfileWithGuards(lbProfile, {
        profileName: 'myLB',
      });

      const models = await getLBProvider()?.getModels();
      expect(models?.[0]?.contextWindow).toBe(200000);
      expect(setEphemeralSettingMock).toHaveBeenCalledWith(
        'context-limit',
        200000,
      );
      expect(setEphemeralSettingMock).toHaveBeenCalledWith(
        'streaming',
        'enabled',
      );
    });
  });

  describe('Detection priority', () => {
    it('should check for type: loadbalancer BEFORE loadBalancer.subProfiles format @plan:PLAN-20251211issue486c @phase:2', async () => {
      const lbProfile = makeLbProfile(['sub1']);

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

      expect(mockLoadProfile).toHaveBeenCalledWith('sub1');

      const registeredProvider =
        providerManagerStub.getProviderByName('load-balancer');
      expect(registeredProvider).not.toBeNull();
    });
  });

  describe('Phase 5: Old 486b inline format is no longer supported', () => {
    it('should ignore old inline loadBalancer.subProfiles format and NOT create LB provider @plan:PLAN-20251211issue486c @phase:5', async () => {
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

      const { getLBProvider } = wrapRegisterProviderToCaptureLB();

      const result = (await applyProfileWithGuards(oldInlineFormatProfile, {
        profileName: 'oldFormat',
      })) as unknown as ProfileApplicationResult;

      expect(getLBProvider()).toBeNull();
      expect(result.providerName).toBe('gemini');
      expect(result.modelName).toBe('test-model');
    });
  });
});
