/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Behavioral test for issue #3149: a member provider whose getModels() never
 * resolves must not hang load-balancer registration. The context-window lookup
 * is advisory (an unresolved window degrades gracefully to the load balancer's
 * configured context limit), so it is bounded by SUBPROFILE_CONTEXT_WINDOW_TIMEOUT_MS.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import type {
  Profile,
  LoadBalancerProfile,
} from '@vybestack/llxprt-code-settings';
import { isResolvedSubProfile } from '../../loadBalancing/loadBalancerTypes.js';
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

describe('Load balancer sub-profile context-window timeout (issue #3149)', () => {
  beforeEach(() => {
    resetLbProfileApplicationStubs();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('completes registration when a member provider getModels() never resolves', async () => {
    // A provider whose getModels() hangs forever — this is the CI failure mode:
    // a member endpoint that never responds (e.g. a slow or blocked network
    // egress). Before the fix this blocked registration indefinitely.
    providerManagerStub.registerProvider({
      name: 'hangprovider',
      getDefaultModel: () => 'hang-model',
      getModels: () => new Promise(() => {}),
    });

    profileManagerStub.loadProfile = vi.fn(
      async (): Promise<Profile> => ({
        version: 1,
        provider: 'hangprovider',
        model: 'hang-model',
        modelParams: {},
        ephemeralSettings: { 'auth-key': 'k' },
      }),
    );

    const lbProfile: LoadBalancerProfile = makeLbProfile(['hangmember']);
    const { getLBProvider } = wrapRegisterProviderToCaptureLB();

    const start = Date.now();
    await applyProfileWithGuards(lbProfile, { profileName: 'myLB' });
    const elapsed = Date.now() - start;

    // Registration completed (this line being reached at all proves it did not
    // hang) and the load balancer was registered despite the unreachable member.
    expect(getLBProvider()).not.toBeNull();
    // The advisory context-window lookup is bounded at 3s; registration
    // finishes near that bound plus overhead, never hanging.
    expect(elapsed).toBeLessThan(10_000);
  }, 20_000);

  it('resolves N hanging members concurrently, not sequentially', async () => {
    // Three providers whose getModels() all hang. Sequential resolution would
    // take 3 × timeout; concurrent (Promise.all) takes ~1 × timeout.
    for (const name of ['p1', 'p2', 'p3']) {
      providerManagerStub.registerProvider({
        name,
        getDefaultModel: () => `${name}-model`,
        getModels: () => new Promise(() => {}),
      });
    }

    let callCount = 0;
    profileManagerStub.loadProfile = vi.fn(async (name: string) => {
      callCount++;
      return {
        version: 1,
        provider: name,
        model: `${name}-model`,
        modelParams: {},
        ephemeralSettings: { 'auth-key': 'k' },
      } as Profile;
    });

    const lbProfile: LoadBalancerProfile = makeLbProfile(['p1', 'p2', 'p3']);
    const { getLBProvider } = wrapRegisterProviderToCaptureLB();

    const start = Date.now();
    await applyProfileWithGuards(lbProfile, { profileName: 'concurrentLB' });
    const elapsed = Date.now() - start;

    expect(getLBProvider()).not.toBeNull();
    expect(callCount).toBe(3);
    // If sequential, elapsed would be ~9s (3 × 3s). Concurrent is ~3s.
    expect(elapsed).toBeLessThan(7_000);
  }, 20_000);

  it('degrades a member to an undefined context window when getModels() rejects', async () => {
    providerManagerStub.registerProvider({
      name: 'errprovider',
      getDefaultModel: () => 'err-model',
      getModels: async () => {
        throw new Error('boom');
      },
    });

    profileManagerStub.loadProfile = vi.fn(
      async (): Promise<Profile> => ({
        version: 1,
        provider: 'errprovider',
        model: 'err-model',
        modelParams: {},
        ephemeralSettings: { 'auth-key': 'k' },
      }),
    );

    const lbProfile: LoadBalancerProfile = makeLbProfile(['errmember']);
    const { getLBProvider } = wrapRegisterProviderToCaptureLB();

    await applyProfileWithGuards(lbProfile, { profileName: 'myLB' });

    const lbProvider = getLBProvider();
    expect(lbProvider).not.toBeNull();
    // Verify the member degraded gracefully: contextWindow should be undefined
    // (not a numeric fallback), proving the rejection was handled, not hidden.
    const subProfile = lbProvider!.selectNextSubProfile();
    expect(isResolvedSubProfile(subProfile)).toBe(true);
    if (isResolvedSubProfile(subProfile)) {
      expect(subProfile.contextWindow).toBeUndefined();
    }
  });
});
