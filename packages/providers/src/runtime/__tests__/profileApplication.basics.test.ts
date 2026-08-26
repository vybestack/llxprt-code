/**
 * @plan PLAN-20251020-STATELESSPROVIDER3.P08
 * @requirement REQ-SP3-002
 *
 * Profile application basics and LoadBalancer profile integration.
 * Split from profileApplication.test.ts during #2092 lint hardening.
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from 'bun:test';
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

const realPromisesModule = { ...(await import('node:fs/promises')) };

void vi.mock('node:fs/promises', () => {
  const actual = realPromisesModule;
  return {
    ...actual,
    readFile: vi.fn(),
  };
});

const mockFs = await import('node:fs/promises');

void vi.mock('../runtimeSettings.js', () => ({
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

interface ProviderSwitchOptions {
  preserveEphemerals?: string[];
  autoOAuth?: boolean;
}

function preservedEphemerals(
  options: ProviderSwitchOptions | undefined,
): string[] {
  return options?.preserveEphemerals ?? [];
}

function configuredState(value: string | null | undefined): 'set' | 'null' {
  return value !== null && value !== undefined && value !== '' ? 'set' : 'null';
}

function undefinedWhenNull(
  value: string | null | undefined,
): string | undefined {
  return value ?? undefined;
}

function recordNonAuthEphemeral(callOrder: string[], key: string): void {
  if (key !== 'auth-key' && key !== 'auth-keyfile' && key !== 'base-url') {
    callOrder.push(`setEphemeralSetting:${key}`);
  }
}

function autoOAuthEnabled(options: ProviderSwitchOptions | undefined): boolean {
  return (
    options !== undefined &&
    'autoOAuth' in options &&
    options.autoOAuth === true
  );
}

async function loadNamedProfile(
  profiles: ReadonlyMap<string, Profile>,
  name: string,
): Promise<Profile> {
  const profile = profiles.get(name);
  if (profile === undefined) {
    throw new Error(`Profile ${name} not found`);
  }
  return profile;
}

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
        capturedPreserveEphemerals = preservedEphemerals(options);
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
    const readFileSpy = mockFs.readFile as Mock<typeof mockFs.readFile>;
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
      callOrder.push(`updateActiveProviderApiKey:${configuredState(apiKey)}`);
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
      callOrder.push(`updateActiveProviderApiKey:${configuredState(apiKey)}`);
      return { message: 'API key set' };
    });

    updateActiveProviderBaseUrlMock.mockImplementation(async (baseUrl) => {
      callOrder.push(`updateActiveProviderBaseUrl:${configuredState(baseUrl)}`);
      return { message: 'Base URL set', baseUrl: undefinedWhenNull(baseUrl) };
    });

    setEphemeralSettingMock.mockImplementation((key, value) => {
      recordNonAuthEphemeral(callOrder, key);
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
    (mockFs.readFile as Mock<typeof mockFs.readFile>).mockResolvedValue(
      'test-api-key-from-keyfile',
    );

    const authenticateSpy = vi.fn();
    let switchWasCalledWithAutoOAuth = false;

    switchActiveProviderMock.mockImplementation(
      async (
        providerName: string,
        options?: { preserveEphemerals?: string[]; autoOAuth?: boolean },
      ) => {
        switchWasCalledWithAutoOAuth = autoOAuthEnabled(options);
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
    expect(
      mockFs.readFile as Mock<typeof mockFs.readFile>,
    ).toHaveBeenCalledWith(expectedPath, 'utf-8');

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

    const profiles = new Map([
      ['profile1', standardProfile1],
      ['profile2', standardProfile2],
    ]);
    mockProfileManager.loadProfile.mockImplementation((name: string) =>
      loadNamedProfile(profiles, name),
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
