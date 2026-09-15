/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Atomicity behavior tests for applyProfileWithGuards (#2534 C5).
 *
 * A mid-cascade failure must leave the persisted settings surface exactly as
 * it was before the application started, and the ORIGINAL error must surface
 * to the caller.
 */

import {
  beforeEach,
  describe,
  expect,
  it,
  mock,
} from 'bun:test';
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
  settingsServiceStub,
  resetProfileApplicationStubs,
  restoreGcpEnvVars,
} from './profileApplicationTestSetup.js';

await mock.module('../runtimeSettings.js', () => ({
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

const baseProfile: Profile = {
  name: 'work',
  provider: 'anthropic',
  model: 'claude-3',
  ephemeralSettings: {
    'base-url': 'https://injected.example',
  },
} as unknown as Profile;

describe('applyProfileWithGuards atomicity (#2534 C5)', () => {
  let savedGcpProject: string | undefined;
  let savedGcpLocation: string | undefined;

  beforeEach(() => {
    const saved = resetProfileApplicationStubs();
    savedGcpProject = saved.savedGcpProject;
    savedGcpLocation = saved.savedGcpLocation;
    restoreGcpEnvVars(savedGcpProject, savedGcpLocation);
  });

  it('restores pre-application settings state when a mid-cascade step fails and rethrows the original error', async () => {
    // Seed persisted state that must survive a failed application.
    settingsServiceStub.setProviderSetting('openai', 'auth-key', 'keep-me');
    settingsServiceStub.setProviderSetting('openai', 'model', 'gpt-4');
    settingsServiceStub.setCurrentProfileName('previous-profile');
    const snapshotBefore = settingsServiceStub.exportForStateSnapshot();

    // Inject a mid-cascade failure AFTER early writes have landed
    // (clearProfileEphemerals → wireAuthBeforeSwitch writes the profile
    // base-url into the target provider scope → switch).
    updateActiveProviderBaseUrlMock.mockRejectedValueOnce(
      new Error('injected cascade failure'),
    );

    const error = await applyProfileWithGuards(baseProfile).then(
      () => undefined,
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('injected cascade failure');

    // The settings store is byte-identical to the pre-application snapshot.
    expect(settingsServiceStub.exportForStateSnapshot()).toStrictEqual(
      snapshotBefore,
    );
    expect(settingsServiceStub.getProviderSettings('openai')).toStrictEqual({
      'auth-key': 'keep-me',
      model: 'gpt-4',
    });
    // The partially-applied target provider scope was rolled back away.
    expect(settingsServiceStub.providerSettings.has('anthropic')).toBe(false);
    expect(settingsServiceStub.getCurrentProfileName()).toBe(
      'previous-profile',
    );
  });

  it('keeps applied state on the success path (no spurious rollback)', async () => {
    settingsServiceStub.setProviderSetting('openai', 'auth-key', 'old-key');
    updateActiveProviderBaseUrlMock.mockResolvedValue({});
    updateActiveProviderApiKeyMock.mockResolvedValue({});

    await applyProfileWithGuards(baseProfile);

    // The pre-switch write targets the profile provider scope, which must
    // still be present after a successful application.
    expect(
      settingsServiceStub.getProviderSettings('anthropic')['base-url'],
    ).toBe('https://injected.example');
    expect(settingsServiceStub.getProviderSettings('openai')).toStrictEqual({
      'auth-key': 'old-key',
    });
  });
});
