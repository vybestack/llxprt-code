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

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isLoadBalancerProfile } from '@vybestack/llxprt-code-settings';
import type { LoadBalancerProfile } from '@vybestack/llxprt-code-settings';

const saveProfileMock = vi.hoisted(() => vi.fn());

const runtimeServicesState = vi.hoisted(() => ({
  activeProviderName: 'load-balancer' as string,
  lbConfig: null as unknown,
  ephemerals: {} as Record<string, unknown>,
}));

vi.mock('../runtimeAccessors.js', () => ({
  getCliRuntimeServices: vi.fn(() => ({
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
  })),
  maybeGetCliOAuthManager: vi.fn(() => null),
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

vi.mock('../profileApplication.js', () => ({
  applyProfileWithGuards: vi.fn(),
}));

vi.mock('@vybestack/llxprt-code-settings', async () => {
  const actual = await vi.importActual<
    typeof import('@vybestack/llxprt-code-settings')
  >('@vybestack/llxprt-code-settings');
  return {
    ...actual,
    ProfileManager: vi.fn(() => ({
      saveProfile: saveProfileMock,
      loadProfile: vi.fn(),
      listProfiles: vi.fn(),
    })),
  };
});

const { buildRuntimeProfileSnapshot, saveProfileSnapshot } = await import(
  '../profileSnapshot.js'
);

describe('profile save while load balancer is active (issue #2479)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it('standard-provider saves are unaffected', async () => {
    runtimeServicesState.activeProviderName = 'anthropic';

    const saved = await saveProfileSnapshot('zai');
    expect(saveProfileMock).toHaveBeenCalledTimes(1);
    expect(saved.provider).toBe('anthropic');
    expect(isLoadBalancerProfile(saved)).toBe(false);
  });
});
