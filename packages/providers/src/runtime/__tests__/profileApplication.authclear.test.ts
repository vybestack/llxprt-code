/**
 * Tests for profile application clearing stale auth state on profile switch.
 * Ensures that switching profiles (e.g. from opusthinking to glm) cannot
 * reuse the previous profile's auth-key, auth-keyfile, auth-key-name, or
 * base-url when the new profile omits those directives.
 *
 * @plan PLAN-20260623-ISSUE2132
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

describe('Profile application clears stale auth state (issue #2132)', () => {
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

  it('clears stale auth-key when switching to a profile without auth-key directive', async () => {
    providerManagerStub.available = ['openai'];
    providerManagerStub.providerLookup = new Map([
      ['openai', { name: 'openai' }],
    ]);

    // Simulate previous profile (e.g. opusthinking) having set an auth-key
    configStub.setEphemeralSetting('auth-key', 'stale-opus-token');

    const newProfile: Profile = {
      version: 1,
      provider: 'openai',
      model: 'glm-4.6',
      modelParams: {},
      ephemeralSettings: {},
    };

    await applyProfileWithGuards(newProfile, { profileName: 'glm' });

    expect(configStub.getEphemeralSetting('auth-key')).toBeUndefined();
    expect(updateActiveProviderApiKeyMock).toHaveBeenCalledWith(null);
  });

  it('clears stale auth-key-name when switching to a profile without auth-key-name', async () => {
    providerManagerStub.available = ['openai'];
    providerManagerStub.providerLookup = new Map([
      ['openai', { name: 'openai' }],
    ]);

    // Simulate previous profile having resolved a named key
    configStub.setEphemeralSetting('auth-key-name', 'anthropic-oauth-bucket');

    const newProfile: Profile = {
      version: 1,
      provider: 'openai',
      model: 'glm-4.6',
      modelParams: {},
      ephemeralSettings: {},
    };

    await applyProfileWithGuards(newProfile, { profileName: 'glm' });

    expect(configStub.getEphemeralSetting('auth-key-name')).toBeUndefined();
  });

  it('clears stale auth-keyfile when switching to a profile without auth-keyfile', async () => {
    providerManagerStub.available = ['openai'];
    providerManagerStub.providerLookup = new Map([
      ['openai', { name: 'openai' }],
    ]);

    configStub.setEphemeralSetting('auth-keyfile', '/home/user/.old_key');

    const newProfile: Profile = {
      version: 1,
      provider: 'openai',
      model: 'glm-4.6',
      modelParams: {},
      ephemeralSettings: {},
    };

    await applyProfileWithGuards(newProfile, { profileName: 'glm' });

    expect(configStub.getEphemeralSetting('auth-keyfile')).toBeUndefined();
  });

  it('clears stale base-url when switching to a profile without base-url', async () => {
    providerManagerStub.available = ['openai'];
    providerManagerStub.providerLookup = new Map([
      ['openai', { name: 'openai' }],
    ]);

    configStub.setEphemeralSetting(
      'base-url',
      'https://old-anthropic-proxy.com',
    );

    const newProfile: Profile = {
      version: 1,
      provider: 'openai',
      model: 'glm-4.6',
      modelParams: {},
      ephemeralSettings: {},
    };

    await applyProfileWithGuards(newProfile, { profileName: 'glm' });

    expect(configStub.getEphemeralSetting('base-url')).toBeUndefined();
    expect(updateActiveProviderBaseUrlMock).toHaveBeenCalledWith(null);
  });

  it('clears all stale auth state simultaneously when switching profiles', async () => {
    providerManagerStub.available = ['openai'];
    providerManagerStub.providerLookup = new Map([
      ['openai', { name: 'openai' }],
    ]);

    // Simulate all auth-related ephemerals being set by previous profile
    configStub.setEphemeralSetting('auth-key', 'stale-key');
    configStub.setEphemeralSetting('auth-key-name', 'stale-named-key');
    configStub.setEphemeralSetting('auth-keyfile', '/home/user/.stale_keyfile');
    configStub.setEphemeralSetting('base-url', 'https://stale-proxy.com');

    const newProfile: Profile = {
      version: 1,
      provider: 'openai',
      model: 'glm-4.6',
      modelParams: {},
      ephemeralSettings: {},
    };

    await applyProfileWithGuards(newProfile, { profileName: 'glm' });

    expect(configStub.getEphemeralSetting('auth-key')).toBeUndefined();
    expect(configStub.getEphemeralSetting('auth-key-name')).toBeUndefined();
    expect(configStub.getEphemeralSetting('auth-keyfile')).toBeUndefined();
    expect(configStub.getEphemeralSetting('base-url')).toBeUndefined();
    expect(updateActiveProviderApiKeyMock).toHaveBeenCalledWith(null);
    expect(updateActiveProviderBaseUrlMock).toHaveBeenCalledWith(null);
  });

  it('preserves explicit auth-key on the newly loaded profile', async () => {
    providerManagerStub.available = ['openai'];
    providerManagerStub.providerLookup = new Map([
      ['openai', { name: 'openai' }],
    ]);

    // Previous profile set a different auth-key
    configStub.setEphemeralSetting('auth-key', 'old-opus-key');

    const newProfile: Profile = {
      version: 1,
      provider: 'openai',
      model: 'glm-4.6',
      modelParams: {},
      ephemeralSettings: {
        'auth-key': 'new-glm-key',
      },
    };

    await applyProfileWithGuards(newProfile, { profileName: 'glm' });

    expect(configStub.getEphemeralSetting('auth-key')).toBe('new-glm-key');
    expect(updateActiveProviderApiKeyMock).toHaveBeenCalledWith('new-glm-key');
  });

  it('preserves explicit auth-keyfile on the newly loaded profile', async () => {
    const mockFs = await import('node:fs/promises');
    vi.mocked(mockFs.readFile).mockResolvedValue('keyfile-content');

    providerManagerStub.available = ['openai'];
    providerManagerStub.providerLookup = new Map([
      ['openai', { name: 'openai' }],
    ]);

    // Previous profile set auth-key-name (higher precedence)
    configStub.setEphemeralSetting('auth-key-name', 'old-named-key');

    const newProfile: Profile = {
      version: 1,
      provider: 'openai',
      model: 'glm-4.6',
      modelParams: {},
      ephemeralSettings: {
        'auth-keyfile': '/home/user/.glm_key',
      },
    };

    await applyProfileWithGuards(newProfile, { profileName: 'glm' });

    // The stale auth-key-name should be cleared and not interfere
    expect(configStub.getEphemeralSetting('auth-key-name')).toBeUndefined();
    // auth-keyfile should be set from the new profile
    expect(configStub.getEphemeralSetting('auth-keyfile')).toBe(
      '/home/user/.glm_key',
    );
  });

  it('preserves explicit auth-key-name on the newly loaded profile', async () => {
    providerManagerStub.available = ['openai'];
    providerManagerStub.providerLookup = new Map([
      ['openai', { name: 'openai' }],
    ]);

    // Previous profile set a direct auth-key
    configStub.setEphemeralSetting('auth-key', 'old-direct-key');

    const keyStorage = createProviderKeyStorageMock();
    keyStorage.getKey.mockResolvedValue('resolved-named-key-value');

    const newProfile: Profile = {
      version: 1,
      provider: 'openai',
      model: 'glm-4.6',
      modelParams: {},
      ephemeralSettings: {
        'auth-key-name': 'glm-named-key',
      },
    };

    await applyProfileWithGuards(newProfile, { profileName: 'glm' });

    expect(configStub.getEphemeralSetting('auth-key-name')).toBe(
      'glm-named-key',
    );
    // The resolved key from the named key should be applied
    expect(updateActiveProviderApiKeyMock).toHaveBeenCalledWith(
      'resolved-named-key-value',
    );
  });
});
