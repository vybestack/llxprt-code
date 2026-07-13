/**
 * STEP 2/5/6 workflow tests for profile application.
 * Split from profileApplication.test.ts during #2092 lint hardening.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Profile } from '@vybestack/llxprt-code-settings';
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
  configStub,
  settingsServiceStub,
  providerManagerStub,
  resetProfileApplicationStubs,
  restoreGcpEnvVars,
} from './profileApplicationTestSetup.js';

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
describe('STEP 2 workflow: pre-switch auth wiring', () => {
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

    expect(
      settingsServiceStub.getProviderSettings('anthropic')['auth-key'],
    ).toBe('keyfile-api-key');
    expect(
      settingsServiceStub.getProviderSettings('anthropic')['auth-keyfile'],
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
    expect(provSettings['base-url']).toBe('https://custom.api.com/v1');
  });

  it('resolves auth-key-name from secure storage and preserves auth-key-name ephemeral', async () => {
    keyStorageStub.getKey.mockResolvedValueOnce('resolved-named-key');

    providerManagerStub.available = ['Chutes.ai'];
    providerManagerStub.providerLookup = new Map([
      ['Chutes.ai', { name: 'Chutes.ai' }],
    ]);

    const profile: Profile = {
      version: 1,
      provider: 'Chutes.ai',
      model: 'MiniMaxAI/MiniMax-M2.1-TEE',
      modelParams: {},
      ephemeralSettings: {
        'auth-key-name': 'chutes',
        'base-url': 'https://llm.chutes.ai/v1',
      },
    };

    await applyProfileWithGuards(profile);

    expect(createProviderKeyStorageMock).toHaveBeenCalledTimes(1);
    expect(keyStorageStub.getKey).toHaveBeenCalledWith('chutes');
    expect(updateActiveProviderApiKeyMock).toHaveBeenCalledWith(
      'resolved-named-key',
    );
    expect(configStub.getEphemeralSetting('auth-key-name')).toBe('chutes');
    expect(configStub.getEphemeralSetting('auth-key')).toBeUndefined();
  });

  it('adds warning when auth-key-name is missing from secure storage', async () => {
    keyStorageStub.getKey.mockResolvedValueOnce(null);

    providerManagerStub.available = ['Chutes.ai'];
    providerManagerStub.providerLookup = new Map([
      ['Chutes.ai', { name: 'Chutes.ai' }],
    ]);

    const profile: Profile = {
      version: 1,
      provider: 'Chutes.ai',
      model: 'MiniMaxAI/MiniMax-M2.1-TEE',
      modelParams: {},
      ephemeralSettings: {
        'auth-key-name': 'missing-key',
      },
    };

    const result = await applyProfileWithGuards(profile);

    expect(result.warnings).toStrictEqual(
      expect.arrayContaining([
        expect.stringContaining(
          "Key 'missing-key' not found in secure storage",
        ),
      ]),
    );
    expect(updateActiveProviderApiKeyMock).not.toHaveBeenCalled();
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

  it('keeps explicit profile context-limit after model default recomputation', async () => {
    providerManagerStub.available = ['anthropic'];
    providerManagerStub.providerLookup = new Map([
      ['anthropic', { name: 'anthropic' }],
    ]);
    configStub.setEphemeralSetting('context-limit', 200000);

    setActiveModelMock.mockImplementationOnce(async (model: string) => {
      configStub.setEphemeralSetting('context-limit', undefined);
      return { nextModel: model };
    });

    const profile: Profile = {
      version: 1,
      provider: 'anthropic',
      model: 'claude-opus-4-8',
      modelParams: {},
      ephemeralSettings: {
        'context-limit': 200000,
      },
    };

    await applyProfileWithGuards(profile);

    expect(configStub.getEphemeralSetting('context-limit')).toBe(200000);
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
