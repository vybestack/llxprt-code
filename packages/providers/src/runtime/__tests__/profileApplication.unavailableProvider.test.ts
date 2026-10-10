import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { assembleModelSelection } from '../providerMutations.js';
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Regression tests for issue #2479: a profile naming a provider that is not
 * registered must FAIL LOUDLY instead of silently falling back to the first
 * registered provider (gemini). The silent fallback produced dead sessions:
 * the profile "loaded", the session landed on gemini without credentials,
 * and every subsequent prompt was swallowed with no error.
 */

import type { ProviderSwitcher } from '../index.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
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
  getActiveProviderOrThrowMock,
  isCliStatelessProviderModeEnabledMock,
  createProviderKeyStorageMock,
  providerManagerStub,
  configStub,
  mockProfileManager,
  resetProfileApplicationStubs,
  restoreGcpEnvVars,
} from './profileApplicationTestSetup.js';

void vi.mock('../index.js', () => ({
  switchActiveProvider: switchActiveProviderMock,
  setActiveModel: setActiveModelMock,
  updateActiveProviderBaseUrl: updateActiveProviderBaseUrlMock,
  updateActiveProviderApiKey: updateActiveProviderApiKeyMock,
  setActiveModelParam: setActiveModelParamMock,
  clearActiveModelParam: clearActiveModelParamMock,
  getActiveModelParams: getActiveModelParamsMock,
  setEphemeralSetting: setEphemeralSettingMock,
  createProviderKeyStorage: createProviderKeyStorageMock,

  getActiveProviderOrThrow: getActiveProviderOrThrowMock,
  isCliStatelessProviderModeEnabled: isCliStatelessProviderModeEnabledMock,
}));

const { applyProfileCascade, selectAvailableProvider } = await import(
  '../profileApplication.js'
);

async function applyProfileForTest(
  profile: Profile,
  options: Parameters<typeof applyProfileCascade>[1],
  switchProvider: ProviderSwitcher,
): ReturnType<typeof applyProfileCascade> {
  const settings = new SettingsService();
  const owner = new SessionSettingsOwner(settings);
  try {
    return await applyProfileCascade(
      profile,
      options,
      configStub as never,
      settings,
      providerManagerStub as never,
      mockProfileManager as never,
      switchProvider,
      assembleModelSelection(owner),
      {
        readEndpoint: () => owner.readSelectedEndpoint(),
        applyParameter: (key, value) => owner.writeUserParameter(key, value),
      },
    );
  } finally {
    await owner.dispose();
  }
}

const unreachableSwitch: ProviderSwitcher = async () => {
  throw new Error('Provider switch must not run in this test');
};

describe('selectAvailableProvider (issue #2479)', () => {
  it('throws when the requested provider is not registered', () => {
    expect(() =>
      selectAvailableProvider('load-balancer', ['gemini', 'openai']),
    ).toThrow(
      /Provider 'load-balancer' is not available \(registered providers: gemini, openai\)\. Profile not applied\./,
    );
  });

  it('does NOT silently fall back to the first registered provider', () => {
    expect(() => selectAvailableProvider('anthropic', ['gemini'])).toThrow(
      /Provider 'anthropic' is not available/,
    );
  });

  it('still selects the requested provider when it is registered', () => {
    const result = selectAvailableProvider('anthropic', [
      'gemini',
      'anthropic',
    ]);
    expect(result.providerName).toBe('anthropic');
    expect(result.didFallback).toBe(false);
    expect(result.warnings).toStrictEqual([]);
  });

  it('keeps the silent fallback for profiles with no provider at all', () => {
    const result = selectAvailableProvider(undefined, ['gemini', 'openai']);
    expect(result.providerName).toBe('gemini');
    expect(result.didFallback).toBe(false);
    expect(result.requestedProvider).toBeNull();
  });

  it('keeps the silent fallback for whitespace-only provider', () => {
    const result = selectAvailableProvider('   ', ['openai']);
    expect(result.providerName).toBe('openai');
    expect(result.didFallback).toBe(false);
    expect(result.requestedProvider).toBeNull();
  });

  it('keeps the silent fallback for empty-string provider', () => {
    const result = selectAvailableProvider('', ['openai']);
    expect(result.providerName).toBe('openai');
    expect(result.didFallback).toBe(false);
    expect(result.requestedProvider).toBeNull();
  });

  it('still throws when no providers are registered at all', () => {
    expect(() => selectAvailableProvider('anthropic', [])).toThrow(
      /No registered providers are available/,
    );
  });
});

describe('applyProfileCascade with unavailable provider (issue #2479)', () => {
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

  it('rejects the corrupt-profile shape that caused the dead session', async () => {
    // Exact corruption from the field: a runtime snapshot of an active
    // load-balancer session saved as a standard profile. 'load-balancer'
    // is a virtual provider name that is never registered at startup.
    const corruptEphemeralSettings = {
      'context-limit': 200000,
      maxOutputTokens: 60000,
    };
    const corruptProfile: Profile = {
      version: 1,
      provider: 'load-balancer',
      model: 'gemini-2.5-pro',
      modelParams: {},
      ephemeralSettings: corruptEphemeralSettings,
    };

    providerManagerStub.available = ['gemini', 'openai', 'anthropic'];
    providerManagerStub.providerLookup = new Map([
      ['gemini', { name: 'gemini' }],
      ['openai', { name: 'openai' }],
      ['anthropic', { name: 'anthropic' }],
    ]);

    await expect(
      applyProfileForTest(
        corruptProfile,
        { profileName: 'zai' },
        unreachableSwitch,
      ),
    ).rejects.toThrow(/Provider 'load-balancer' is not available/);

    // The session must not have been mutated: no provider switch happened.
    expect(switchActiveProviderMock).not.toHaveBeenCalled();
    expect(setActiveModelMock).not.toHaveBeenCalled();
  });

  it('rejects before mutating ephemeral settings', async () => {
    const profile: Profile = {
      version: 1,
      provider: 'not-a-real-provider',
      model: 'some-model',
      modelParams: {},
      ephemeralSettings: { 'base-url': 'https://example.invalid' },
    };

    providerManagerStub.available = ['gemini'];
    providerManagerStub.providerLookup = new Map([
      ['gemini', { name: 'gemini' }],
    ]);

    await expect(
      applyProfileForTest(
        profile,
        { profileName: 'broken' },
        unreachableSwitch,
      ),
    ).rejects.toThrow(/Provider 'not-a-real-provider' is not available/);

    expect(setEphemeralSettingMock).not.toHaveBeenCalled();
  });
});
