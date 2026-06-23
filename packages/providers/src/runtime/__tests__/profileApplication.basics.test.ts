/**
 * @plan PLAN-20251020-STATELESSPROVIDER3.P08
 * @requirement REQ-SP3-002
 *
 * Profile application basics and LoadBalancer profile integration.
 * Split from profileApplication.test.ts during #2092 lint hardening.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  Profile,
  LoadBalancerProfile,
} from '@vybestack/llxprt-code-settings';
import path from 'node:path';
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
  configStub,
  providerManagerStub,
  mockProfileManager,
  resetProfileApplicationStubs,
  restoreGcpEnvVars,
} from './profileApplicationTestSetup.js';
import type { ProfileApplicationResult } from './profileApplicationTestSetup.js';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    readFile: vi.fn(),
  };
});

const mockFs = await import('node:fs/promises');

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

describe('Profile application basics', () => {
  let savedGcpProject: string | undefined;
  let savedGcpLocation: string | undefined;

  beforeEach(() => {
    const saved = resetProfileApplicationStubs();
    savedGcpProject = saved.savedGcpProject;
    savedGcpLocation = saved.savedGcpLocation;
  });

  afterEach(() => {
    restoreGcpEnvVars(savedGcpProject, savedGcpLocation);
    vi.clearAllMocks();
  });

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
    const readFileSpy = vi.mocked(mockFs.readFile);
    readFileSpy.mockResolvedValue('test-api-key-from-file');

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

    expect(readFileIndex).toBeLessThan(switchProviderIndex);
    expect(updateApiKeyIndex).toBeGreaterThan(switchProviderIndex);
  });

  it('should apply auth ephemerals using stash→switch→apply pattern', async () => {
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

    expect(apiKeyIndex).toBeGreaterThan(switchIndex);
    expect(baseUrlIndex).toBeGreaterThan(switchIndex);
  });

  it('should not trigger OAuth when loading profile with keyfile', async () => {
    vi.mocked(mockFs.readFile).mockResolvedValue('test-api-key-from-keyfile');

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

    const expectedPath = path.resolve('/home/user/.anthropic_key');
    expect(vi.mocked(mockFs.readFile)).toHaveBeenCalledWith(
      expectedPath,
      'utf-8',
    );

    expect(updateActiveProviderApiKeyMock).toHaveBeenCalledWith(
      'test-api-key-from-keyfile',
    );

    expect(switchWasCalledWithAutoOAuth).toBe(false);
    expect(authenticateSpy).not.toHaveBeenCalled();

    expect(configStub.getEphemeralSetting('auth-keyfile')).toBe(expectedPath);
    expect(configStub.getEphemeralSetting('auth-key')).toBeUndefined();
  });
});

describe('LoadBalancer profile integration', () => {
  let savedGcpProject: string | undefined;
  let savedGcpLocation: string | undefined;

  beforeEach(() => {
    const saved = resetProfileApplicationStubs();
    savedGcpProject = saved.savedGcpProject;
    savedGcpLocation = saved.savedGcpLocation;
    mockProfileManager.loadProfile.mockClear();
  });

  afterEach(() => {
    restoreGcpEnvVars(savedGcpProject, savedGcpLocation);
    vi.clearAllMocks();
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

    expect(result.modelName).toBe('load-balancer');
    expect(setActiveModelMock).toHaveBeenCalledWith('load-balancer');

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
