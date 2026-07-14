/**
 * Phase 3 tests: OAuth lazy loading timing
 * @plan PLAN-20251105-profilefixes/plan2.md Phase 3
 *
 * These tests verify that profile loading does NOT trigger OAuth when auth
 * credentials are provided via keyfile or auth-key.
 *
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

describe('Phase 3: Profile loading auth timing (OAuth lazy loading)', () => {
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

  it('should apply auth-key to SettingsService BEFORE switching provider', async () => {
    const operationOrder: string[] = [];

    const originalSetProviderSetting =
      settingsServiceStub.setProviderSetting.bind(settingsServiceStub);
    settingsServiceStub.setProviderSetting = vi.fn(
      (providerName: string, key: string, value: unknown) => {
        if (key === 'auth-key' || key === 'apiKey') {
          operationOrder.push(`settingsService.setProviderSetting:${key}`);
        }
        originalSetProviderSetting(providerName, key, value);
      },
    );

    setEphemeralSettingMock.mockImplementation((key, value) => {
      if (key === 'auth-key') {
        operationOrder.push(`setEphemeralSetting:auth-key`);
      }
      configStub.setEphemeralSetting(key, value);
    });

    switchActiveProviderMock.mockImplementation(
      async (providerName: string) => {
        operationOrder.push(`switchActiveProvider:${providerName}`);
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
        'auth-key': 'test-direct-api-key',
      },
    };

    await applyProfileWithGuards(profile, {
      profileName: 'test-profile',
    });

    const authKeyIndex = operationOrder.indexOf('setEphemeralSetting:auth-key');
    const switchIndex = operationOrder.indexOf(
      'switchActiveProvider:anthropic',
    );

    expect(authKeyIndex).toBeGreaterThan(-1);
    expect(switchIndex).toBeGreaterThan(-1);
    expect(authKeyIndex).toBeLessThan(switchIndex);
  });

  it('should apply keyfile auth to SettingsService BEFORE switching provider', async () => {
    vi.mocked(mockFs.readFile).mockResolvedValue('test-api-key-from-file');

    const operationOrder: string[] = [];

    vi.mocked(mockFs.readFile).mockImplementation(async (filePath) => {
      operationOrder.push(`readFile:${filePath}`);
      return 'test-api-key-from-file';
    });

    setEphemeralSettingMock.mockImplementation((key, value) => {
      if (key === 'auth-key') {
        operationOrder.push(`setEphemeralSetting:auth-key`);
      }
      configStub.setEphemeralSetting(key, value);
    });

    switchActiveProviderMock.mockImplementation(
      async (providerName: string) => {
        operationOrder.push(`switchActiveProvider:${providerName}`);
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

    const readFileIndex = operationOrder.findIndex((op) =>
      op.startsWith('readFile:'),
    );
    const authKeyIndex = operationOrder.indexOf('setEphemeralSetting:auth-key');
    const switchIndex = operationOrder.indexOf(
      'switchActiveProvider:anthropic',
    );

    expect(readFileIndex).toBeGreaterThan(-1);
    expect(authKeyIndex).toBeGreaterThan(-1);
    expect(switchIndex).toBeGreaterThan(-1);

    expect(readFileIndex).toBeLessThan(switchIndex);
    expect(authKeyIndex).toBeLessThan(switchIndex);
  });

  it('should apply base-url to SettingsService BEFORE switching provider', async () => {
    const operationOrder: string[] = [];

    setEphemeralSettingMock.mockImplementation((key, value) => {
      if (key === 'base-url') {
        operationOrder.push(`setEphemeralSetting:base-url`);
      }
      configStub.setEphemeralSetting(key, value);
    });

    switchActiveProviderMock.mockImplementation(
      async (providerName: string) => {
        operationOrder.push(`switchActiveProvider:${providerName}`);
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
        'base-url': 'https://custom-api.example.com/v1',
        'auth-key': 'test-api-key',
      },
    };

    await applyProfileWithGuards(profile, {
      profileName: 'test-profile',
    });

    const baseUrlIndex = operationOrder.indexOf('setEphemeralSetting:base-url');
    const switchIndex = operationOrder.indexOf(
      'switchActiveProvider:anthropic',
    );

    expect(baseUrlIndex).toBeGreaterThan(-1);
    expect(switchIndex).toBeGreaterThan(-1);
    expect(baseUrlIndex).toBeLessThan(switchIndex);
  });

  it('should verify SettingsService has auth available when switchActiveProvider is called', async () => {
    let authAvailableAtSwitchTime = false;

    switchActiveProviderMock.mockImplementation(
      async (providerName: string) => {
        authAvailableAtSwitchTime = Boolean(
          configStub.getEphemeralSetting('auth-key'),
        );

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
        'auth-key': 'test-api-key',
      },
    };

    await applyProfileWithGuards(profile, {
      profileName: 'test-profile',
    });

    expect(authAvailableAtSwitchTime).toBe(true);
  });

  it('hydrates legacy modelParams auth entries into ephemerals', async () => {
    providerManagerStub.available = ['anthropic'];
    providerManagerStub.providerLookup = new Map([
      ['anthropic', { name: 'anthropic' }],
    ]);

    const profile: Profile = {
      version: 1,
      provider: 'anthropic',
      model: 'claude-sonnet-4',
      modelParams: {
        'auth-key': 'legacy-auth-key',
        'base-url': 'https://legacy.example.com/v1',
        temperature: 0.25,
      },
      ephemeralSettings: {},
    };

    await applyProfileWithGuards(profile, {
      profileName: 'legacy-profile',
    });

    expect(configStub.getEphemeralSetting('auth-key')).toBe('legacy-auth-key');
    expect(configStub.getEphemeralSetting('base-url')).toBe(
      'https://legacy.example.com/v1',
    );
    expect(updateActiveProviderApiKeyMock).toHaveBeenCalledWith(
      'legacy-auth-key',
    );
  });

  it('clears provider auth/base-url when profile omits those directives', async () => {
    providerManagerStub.available = ['openai'];
    providerManagerStub.providerLookup = new Map([
      ['openai', { name: 'openai' }],
    ]);

    configStub.setEphemeralSetting('auth-key', 'stale-auth-key');
    configStub.setEphemeralSetting('auth-key-name', 'named-stale-key');
    configStub.setEphemeralSetting('base-url', 'https://stale.example.com/v1');

    const profile: Profile = {
      version: 1,
      provider: 'openai',
      model: 'gpt-4o',
      modelParams: {},
      ephemeralSettings: {
        'context-limit': 2048,
      },
    };

    await applyProfileWithGuards(profile, {
      profileName: 'openai-clean-profile',
    });

    expect(updateActiveProviderApiKeyMock).toHaveBeenCalledWith(null);
    expect(updateActiveProviderBaseUrlMock).toHaveBeenCalledWith(null);
  });

  it('treats explicit null auth/base-url values as clear directives', async () => {
    providerManagerStub.available = ['openai'];
    providerManagerStub.providerLookup = new Map([
      ['openai', { name: 'openai' }],
    ]);

    const profile = {
      version: 1,
      provider: 'openai',
      model: 'gpt-4o-mini',
      modelParams: {},
      ephemeralSettings: {
        'auth-key': null,
        'auth-keyfile': null,
        'auth-key-name': null,
        'base-url': null,
      },
    } as unknown as Profile;

    await applyProfileWithGuards(profile, {
      profileName: 'openai-explicit-clear',
    });

    expect(updateActiveProviderApiKeyMock).toHaveBeenCalledWith(null);
    expect(updateActiveProviderBaseUrlMock).toHaveBeenCalledWith(null);
  });

  it('should NOT trigger OAuth when profile has keyfile and provider switch calls getModels', async () => {
    vi.mocked(mockFs.readFile).mockResolvedValue('test-api-key-from-keyfile');

    const oauthCalls: string[] = [];

    switchActiveProviderMock.mockImplementation(
      async (providerName: string) => {
        const authKey = configStub.getEphemeralSetting('auth-key');

        if (authKey === undefined) {
          oauthCalls.push('OAuth triggered during switch');
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

    expect(oauthCalls).toHaveLength(0);
  });

  it('should apply auth ephemerals in correct order: clear → apply-auth → switch → apply-other', async () => {
    configStub.setEphemeralSetting('old-setting', 'old-value');
    configStub.setEphemeralSetting('auth-key', 'old-auth-key');

    const operationOrder: string[] = [];

    setEphemeralSettingMock.mockImplementation((key, value) => {
      if (value === undefined) {
        operationOrder.push(`clear:${key}`);
      } else {
        operationOrder.push(`set:${key}`);
      }
      configStub.setEphemeralSetting(key, value);
    });

    switchActiveProviderMock.mockImplementation(
      async (providerName: string) => {
        operationOrder.push(`switchActiveProvider:${providerName}`);
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
        'auth-key': 'new-auth-key',
        'base-url': 'https://custom.example.com',
        'context-limit': 200000,
      },
    };

    await applyProfileWithGuards(profile, {
      profileName: 'test-profile',
    });

    const oldSettingClearIndex = operationOrder.indexOf('clear:old-setting');
    const oldAuthClearIndex = operationOrder.indexOf('clear:auth-key');
    const newAuthSetIndex = operationOrder.indexOf('set:auth-key');
    const switchIndex = operationOrder.indexOf(
      'switchActiveProvider:anthropic',
    );
    const contextLimitSetIndex = operationOrder.indexOf('set:context-limit');

    expect(oldSettingClearIndex).toBeGreaterThan(-1);
    expect(oldAuthClearIndex).toBeGreaterThan(-1);

    expect(newAuthSetIndex).toBeGreaterThan(-1);
    expect(switchIndex).toBeGreaterThan(-1);
    expect(newAuthSetIndex).toBeLessThan(switchIndex);

    expect(contextLimitSetIndex).toBeGreaterThan(-1);
  });

  it('should handle keyfile loading failure gracefully without blocking provider switch', async () => {
    vi.mocked(mockFs.readFile).mockRejectedValue(
      new Error('ENOENT: file not found'),
    );

    const operationOrder: string[] = [];

    switchActiveProviderMock.mockImplementation(
      async (providerName: string) => {
        operationOrder.push(`switchActiveProvider:${providerName}`);
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
        'auth-keyfile': '/nonexistent/path/.anthropic_key',
      },
    };

    const result = await applyProfileWithGuards(profile, {
      profileName: 'test-profile',
    });

    const switchIndex = operationOrder.indexOf(
      'switchActiveProvider:anthropic',
    );
    expect(switchIndex).toBeGreaterThan(-1);

    expect(result.warnings).toStrictEqual(
      expect.arrayContaining([
        expect.stringMatching(/Failed to load keyfile/i),
      ]),
    );
  });
});
