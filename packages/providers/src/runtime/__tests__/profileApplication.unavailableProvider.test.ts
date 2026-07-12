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
  providerManagerStub,
  resetProfileApplicationStubs,
  restoreGcpEnvVars,
} from './profileApplicationTestSetup.js';

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

const { applyProfileWithGuards, selectAvailableProvider } = await import(
  '../profileApplication.js'
);

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

  it('keeps the silent fallback for empty-string provider', () => {
    const result = selectAvailableProvider('   ', ['openai']);
    expect(result.providerName).toBe('openai');
    expect(result.requestedProvider).toBeNull();
  });

  it('still throws when no providers are registered at all', () => {
    expect(() => selectAvailableProvider('anthropic', [])).toThrow(
      /No registered providers are available/,
    );
  });
});

describe('applyProfileWithGuards with unavailable provider (issue #2479)', () => {
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
    const corruptProfile: Profile = {
      version: 1,
      provider: 'load-balancer',
      model: 'gemini-2.5-pro',
      modelParams: {},
      ephemeralSettings: {
        'context-limit': 200000,
        maxOutputTokens: 60000,
      },
    };

    providerManagerStub.available = ['gemini', 'openai', 'anthropic'];
    providerManagerStub.providerLookup = new Map([
      ['gemini', { name: 'gemini' }],
      ['openai', { name: 'openai' }],
      ['anthropic', { name: 'anthropic' }],
    ]);

    await expect(
      applyProfileWithGuards(corruptProfile, { profileName: 'zai' }),
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
      applyProfileWithGuards(profile, { profileName: 'broken' }),
    ).rejects.toThrow(/Provider 'not-a-real-provider' is not available/);

    expect(setEphemeralSettingMock).not.toHaveBeenCalled();
  });
});
