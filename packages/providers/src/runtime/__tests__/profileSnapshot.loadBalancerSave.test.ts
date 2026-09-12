/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Regression tests for issue #2479 (save side): saving a profile while a
 * load balancer is the active provider must produce a genuine
 * type:'loadbalancer' profile (or fail loudly) — never a standard profile
 * with provider:'load-balancer'. That corrupt shape can never be re-applied
 * because 'load-balancer' is not a registered provider at load time, and it
 * previously produced dead sessions via the silent gemini fallback.
 */

import { describe, it, expect, vi, beforeEach } from 'bun:test';
import { createImageProfileRuntimeState } from '@vybestack/llxprt-code-core';
import { isLoadBalancerProfile } from '@vybestack/llxprt-code-settings';
import type { LoadBalancerProfile } from '@vybestack/llxprt-code-settings';

const realLlxprtCodeSettingsModule = {
  ...(await import('@vybestack/llxprt-code-settings')),
};

const saveProfileMock = vi.fn();
const injectedManager = {
  saveLoadBalancerProfile: vi.fn(),
  deleteProfile: vi.fn(),
  loadProfile: vi.fn(),
  saveProfile: saveProfileMock,
};
const oauthManager = {
  configureProactiveRenewalsForProfile: vi.fn(async () => undefined),
  clearSessionBucket: vi.fn(),
  getOAuthToken: vi.fn(async () => null),
};

const runtimeServicesState = {
  activeProviderName: 'load-balancer' as string,
  lbConfig: null as unknown,
  ephemerals: {} as Record<string, unknown>,
  imageProfileState: createImageProfileRuntimeState(),
};

void vi.mock('../runtimeAccessors.js', () => ({
  getCliRuntimeServices: vi.fn(() => ({
    profileManager: injectedManager,
    config: {
      getEphemeralSettings: () => runtimeServicesState.ephemerals,
      getProvider: () => runtimeServicesState.activeProviderName,
      getModel: () => 'whatever-model',
    },
    settingsService: {
      setCurrentProfileName: vi.fn(),
      set: vi.fn(),
      get: vi.fn(),
    },
    providerManager: {
      getActiveProviderName: () => runtimeServicesState.activeProviderName,
      getProviderByName: (name: string) =>
        name === 'load-balancer' && runtimeServicesState.lbConfig !== null
          ? {
              getLoadBalancerConfig: () => runtimeServicesState.lbConfig,
            }
          : null,
    },
    imageProfileState: runtimeServicesState.imageProfileState,
  })),
  maybeGetCliOAuthManager: vi.fn(() => oauthManager),
  getActiveModelName: vi.fn(() => 'test-model'),
  getActiveModelParams: vi.fn(() => ({})),
  _internal: {
    resolveActiveProviderName: vi.fn(
      () => runtimeServicesState.activeProviderName,
    ),
    getProviderSettingsSnapshot: vi.fn(() => ({})),
    // Not exercised by these save-path tests; throw if accidentally called so
    // an empty mock cannot hide a future dependency (issue #2482).
    getActiveProviderOrThrow: vi.fn(() => {
      throw new Error(
        'getActiveProviderOrThrow should not be called during profile save snapshot tests',
      );
    }),
    extractModelParams: vi.fn(() => ({})),
  },
}));

void vi.mock('../profileApplication.js', () => ({
  applyProfileWithGuards: vi.fn(async () => ({
    providerName: 'load-balancer',
    modelName: 'balanced',
    infoMessages: [],
    warnings: [],
    providerChanged: false,
    didFallback: false,
    requestedProvider: null,
  })),
}));

void vi.mock('@vybestack/llxprt-code-settings', () => {
  const actual = realLlxprtCodeSettingsModule;
  return {
    ...actual,
    ProfileManager: vi.fn(() => ({
      saveProfile: saveProfileMock,
      loadProfile: vi.fn(),
      listProfiles: vi.fn(),
    })),
  };
});

const {
  buildRuntimeProfileSnapshot,
  saveProfileSnapshot,
  setActiveImageProfile,
  saveLoadBalancerProfile,
  getProfileByName,
  deleteProfileByName,
  applyProfileSnapshot,
} = await import('../profileSnapshot.js');

describe('profile save while load balancer is active (issue #2479)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setActiveImageProfile(undefined);
    runtimeServicesState.activeProviderName = 'load-balancer';
    runtimeServicesState.ephemerals = {};
    runtimeServicesState.lbConfig = {
      profileName: 'glm',
      strategy: 'round-robin',
      subProfiles: [
        { name: 'glm-a', providerName: 'anthropic', model: 'glm-5.2' },
        { name: 'glm-b', providerName: 'anthropic', model: 'glm-5.2' },
      ],
      contextLimit: 200000,
      lbProfileEphemeralSettings: { 'context-limit': 200000 },
      lbProfileModelParams: {},
    };
  });

  it('validates direct image selection before replacing runtime state', () => {
    const profile = {
      version: 1,
      type: 'image',
      backend: 'codex',
      model: 'gpt-image-2',
      baseUrl: 'https://chatgpt.com/backend-api/codex',
      auth: { type: 'oauth', provider: 'codex' },
    } as const;
    setActiveImageProfile({ name: 'valid', profile });
    expect(() =>
      setActiveImageProfile({
        name: 'invalid',
        profile: { ...profile, auth: { type: 'none' } },
      }),
    ).toThrow(
      expect.objectContaining({
        name: 'ImageBackendAuthModeError',
        profileName: 'invalid',
      }),
    );
    expect(runtimeServicesState.imageProfileState.getActive()?.name).toBe(
      'valid',
    );
    setActiveImageProfile(undefined);
    expect(runtimeServicesState.imageProfileState.getActive()).toBeUndefined();
  });

  it('uses the injected manager for save, get and delete', async () => {
    const profile = buildRuntimeProfileSnapshot();
    if (!isLoadBalancerProfile(profile))
      throw new Error('Expected load balancer');
    await saveLoadBalancerProfile('balanced', profile);
    expect(injectedManager.saveLoadBalancerProfile).toHaveBeenCalledWith(
      'balanced',
      profile,
    );
    injectedManager.loadProfile.mockResolvedValue({
      version: 1,
      provider: 'openai',
      model: 'chat',
      modelParams: {},
      ephemeralSettings: {},
    });
    await getProfileByName('chat');
    expect(injectedManager.loadProfile).toHaveBeenCalledWith('chat');
    await deleteProfileByName('chat');
    expect(injectedManager.deleteProfile).toHaveBeenCalledWith('chat');
  });

  it('loads failover members through the injected manager', async () => {
    injectedManager.loadProfile.mockResolvedValue({
      version: 1,
      provider: 'anthropic',
      model: 'chat',
      modelParams: {},
      ephemeralSettings: {},
      auth: { type: 'oauth', buckets: ['one', 'two'] },
    });
    await applyProfileSnapshot(buildRuntimeProfileSnapshot());
    expect(injectedManager.loadProfile).toHaveBeenCalledWith('glm-a');
    expect(injectedManager.loadProfile).toHaveBeenCalledWith('glm-b');
    expect(oauthManager.getOAuthToken).toHaveBeenCalledWith('anthropic');
  });

  it('serializes the active load balancer as a genuine loadbalancer profile', () => {
    const snapshot = buildRuntimeProfileSnapshot() as LoadBalancerProfile;

    expect(isLoadBalancerProfile(snapshot)).toBe(true);
    expect(snapshot.type).toBe('loadbalancer');
    expect(snapshot.policy).toBe('roundrobin');
    expect(snapshot.profiles).toStrictEqual(['glm-a', 'glm-b']);
    expect(snapshot.contextLimit).toBe(200000);
    // The corrupt field-shape from the field must never be produced:
    expect(snapshot.provider).not.toBe('load-balancer');
  });

  it('maps failover strategy to failover policy', () => {
    runtimeServicesState.lbConfig = {
      ...(runtimeServicesState.lbConfig as Record<string, unknown>),
      strategy: 'failover',
    };

    const snapshot = buildRuntimeProfileSnapshot() as LoadBalancerProfile;
    expect(isLoadBalancerProfile(snapshot)).toBe(true);
    expect(snapshot.policy).toBe('failover');
  });

  it('the saved loadbalancer snapshot passes isLoadBalancerProfile validation', async () => {
    const saved = await saveProfileSnapshot('glm');

    expect(saveProfileMock).toHaveBeenCalledTimes(1);
    const [, persisted] = saveProfileMock.mock.calls[0];
    expect(isLoadBalancerProfile(persisted)).toBe(true);
    expect(isLoadBalancerProfile(saved)).toBe(true);
  });

  it('throws instead of writing a corrupt file when the LB config is unreadable', () => {
    runtimeServicesState.lbConfig = null;

    expect(() => buildRuntimeProfileSnapshot()).toThrow(
      /load balancer is active but its configuration could not be read/,
    );
  });

  it('saveProfileSnapshot refuses to persist provider load-balancer as a standard profile', async () => {
    runtimeServicesState.lbConfig = null;

    await expect(saveProfileSnapshot('zai')).rejects.toThrow(
      /could not be read|corrupt profile/,
    );
    expect(saveProfileMock).not.toHaveBeenCalled();
  });

  it('additionalConfig cannot strip the loadbalancer type into a corrupt standard profile', async () => {
    await expect(
      saveProfileSnapshot('zai', {
        type: undefined,
        provider: 'load-balancer',
      } as never),
    ).rejects.toThrow(/corrupt profile/);
    expect(saveProfileMock).not.toHaveBeenCalled();
  });

  it('captures the active image profile reference in a model profile', async () => {
    runtimeServicesState.activeProviderName = 'anthropic';
    setActiveImageProfile({
      name: 'artwork',
      profile: {
        version: 1,
        type: 'image',
        backend: 'codex',
        model: 'gpt-image-2.5-flare',
        baseUrl: 'https://chatgpt.com/backend-api/codex',
        auth: { type: 'oauth', provider: 'codex' },
        defaults: { quality: 'high', size: 'auto', background: 'auto' },
      },
    });

    const saved = await saveProfileSnapshot('chat');

    expect(saved).toMatchObject({ type: 'model', imageProfile: 'artwork' });
  });

  it('standard-provider saves are unaffected', async () => {
    runtimeServicesState.activeProviderName = 'anthropic';

    const saved = await saveProfileSnapshot('zai');
    expect(saveProfileMock).toHaveBeenCalledTimes(1);
    expect(saved.provider).toBe('anthropic');
    expect(isLoadBalancerProfile(saved)).toBe(false);
  });
});
