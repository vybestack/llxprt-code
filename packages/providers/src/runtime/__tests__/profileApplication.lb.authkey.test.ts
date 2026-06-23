/**
 * auth-key-name resolution in LoadBalancing sub-profiles (issue #1970).
 * Split from profileApplication.lb.test.ts during #2092 lint hardening.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Profile } from '@vybestack/llxprt-code-settings';
import * as fs from 'node:fs/promises';
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
  keyStorageStub,
  profileManagerStub,
  wrapRegisterProviderToCaptureLB,
  resetLbProfileApplicationStubs,
  makeLbProfile,
  createTempKeyfile,
  getLbSubProfiles,
} from './lbProfileApplicationTestSetup.js';

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

describe('auth-key-name resolution in sub-profiles (issue #1970)', () => {
  beforeEach(() => {
    resetLbProfileApplicationStubs();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('resolves auth-key-name from secure storage into sub-profile authToken', async () => {
    keyStorageStub.getKey.mockImplementation(async (name: string) => {
      if (name === 'chutes') return 'resolved-chutes-api-key';
      if (name === 'openrouter') return 'resolved-openrouter-api-key';
      return null;
    });

    const lbProfile = makeLbProfile(['zai', 'ollamaglm51']);

    const mockLoadProfile = vi.fn(
      async (profileName: string): Promise<Profile> => {
        if (profileName === 'zai') {
          return {
            version: 1,
            provider: 'Chutes.ai',
            model: 'model-zai',
            modelParams: {},
            ephemeralSettings: {
              'auth-key-name': 'chutes',
              'base-url': 'https://chutes.ai/v1',
            },
          };
        }
        return {
          version: 1,
          provider: 'OpenRouter',
          model: 'model-glm51',
          modelParams: {},
          ephemeralSettings: {
            'auth-key-name': 'openrouter',
            'base-url': 'https://openrouter.ai/v1',
          },
        };
      },
    );
    profileManagerStub.loadProfile = mockLoadProfile;

    const { getLBProvider } = wrapRegisterProviderToCaptureLB();

    await applyProfileWithGuards(lbProfile, {
      profileName: 'glm',
    });

    const lbProvider = getLBProvider();
    expect(lbProvider).not.toBeNull();
    expect(createProviderKeyStorageMock).toHaveBeenCalled();
    expect(keyStorageStub.getKey).toHaveBeenCalledWith('chutes');
    expect(keyStorageStub.getKey).toHaveBeenCalledWith('openrouter');

    const subProfiles = getLbSubProfiles(lbProvider);
    const zaiSub = subProfiles.find((sp) => sp.name === 'zai');
    const ollamaSub = subProfiles.find((sp) => sp.name === 'ollamaglm51');
    expect(zaiSub?.authToken).toBe('resolved-chutes-api-key');
    expect(ollamaSub?.authToken).toBe('resolved-openrouter-api-key');
  });

  it('prefers explicit auth-key over auth-key-name', async () => {
    keyStorageStub.getKey.mockResolvedValue('resolved-from-storage');

    const lbProfile = makeLbProfile(['explicitKey']);

    const mockLoadProfile = vi.fn(
      async (): Promise<Profile> => ({
        version: 1,
        provider: 'gemini',
        model: 'gemini-flash',
        modelParams: {},
        ephemeralSettings: {
          'auth-key': 'explicit-direct-key',
          'auth-key-name': 'chutes',
        },
      }),
    );
    profileManagerStub.loadProfile = mockLoadProfile;

    const { getLBProvider } = wrapRegisterProviderToCaptureLB();

    await applyProfileWithGuards(lbProfile, {
      profileName: 'myLB',
    });

    const lbProvider = getLBProvider();
    expect(lbProvider).not.toBeNull();
    const subProfiles = getLbSubProfiles(lbProvider);
    expect(keyStorageStub.getKey).not.toHaveBeenCalled();
    expect(subProfiles[0]?.authToken).toBe('explicit-direct-key');
  });

  it('warns and continues when auth-key-name references a missing key', async () => {
    keyStorageStub.getKey.mockResolvedValue(null);

    const lbProfile = makeLbProfile(['missingKeyProfile']);

    const mockLoadProfile = vi.fn(
      async (): Promise<Profile> => ({
        version: 1,
        provider: 'gemini',
        model: 'gemini-flash',
        modelParams: {},
        ephemeralSettings: {
          'auth-key-name': 'nonexistent-key',
        },
      }),
    );
    profileManagerStub.loadProfile = mockLoadProfile;

    const { getLBProvider } = wrapRegisterProviderToCaptureLB();

    await applyProfileWithGuards(lbProfile, {
      profileName: 'myLB',
    });

    const lbProvider = getLBProvider();
    expect(lbProvider).not.toBeNull();
    const subProfiles = getLbSubProfiles(lbProvider);
    expect(subProfiles[0]?.authToken).toBeUndefined();
  });

  it('resolves auth-key-name and falls back to auth-keyfile when named key missing', async () => {
    keyStorageStub.getKey.mockResolvedValue(null);
    const { tempDir, keyfilePath } = await createTempKeyfile(
      'resolved-from-keyfile\n',
    );

    try {
      const lbProfile = makeLbProfile(['fallbackProfile']);

      const mockLoadProfile = vi.fn(
        async (): Promise<Profile> => ({
          version: 1,
          provider: 'gemini',
          model: 'gemini-flash',
          modelParams: {},
          ephemeralSettings: {
            'auth-key-name': 'missing-key',
            'auth-keyfile': keyfilePath,
          },
        }),
      );
      profileManagerStub.loadProfile = mockLoadProfile;

      const { getLBProvider } = wrapRegisterProviderToCaptureLB();

      await applyProfileWithGuards(lbProfile, {
        profileName: 'myLB',
      });

      const lbProvider = getLBProvider();
      expect(lbProvider).not.toBeNull();
      const subProfiles = getLbSubProfiles(lbProvider);
      expect(subProfiles[0]?.authToken).toBe('resolved-from-keyfile');
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});
