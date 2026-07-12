/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'bun:test';
import {
  isLoadBalancerProfile,
  type LoadBalancerProfile,
  type Profile,
} from '@vybestack/llxprt-code-settings';
import {
  buildRuntimeProfileSnapshot,
  saveProfileSnapshot,
  type ProfileSnapshotDependencies,
} from '../profileSnapshot.js';

const saveProfile = vi.fn<(name: string, profile: Profile) => Promise<void>>();
const state = {
  activeProviderName: 'load-balancer',
  lbConfig: null as unknown,
  ephemerals: {} as Record<string, unknown>,
};

const dependencies: ProfileSnapshotDependencies = {
  getRuntimeServices: () => ({
    config: {
      getEphemeralSettings: () => state.ephemerals,
      getProvider: () => state.activeProviderName,
      getModel: () => 'whatever-model',
    },
    settingsService: {
      get: () => undefined,
      getProviderSettings: () => ({}),
    },
    providerManager: {
      getActiveProviderName: () => state.activeProviderName,
      getProviderByName: (name: string) =>
        name === 'load-balancer' && state.lbConfig !== null
          ? { getLoadBalancerConfig: () => state.lbConfig }
          : null,
    },
  }),
  saveProfile,
};

describe('profile save while load balancer is active (issue #2479)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.activeProviderName = 'load-balancer';
    state.ephemerals = {};
    state.lbConfig = {
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
    saveProfile.mockResolvedValue(undefined);
  });

  it('serializes the active load balancer as a genuine loadbalancer profile', () => {
    const snapshot = buildRuntimeProfileSnapshot(
      dependencies,
    ) as LoadBalancerProfile;

    expect(isLoadBalancerProfile(snapshot)).toBe(true);
    expect(snapshot.type).toBe('loadbalancer');
    expect(snapshot.policy).toBe('roundrobin');
    expect(snapshot.profiles).toStrictEqual(['glm-a', 'glm-b']);
    expect(snapshot.contextLimit).toBe(200000);
    expect(snapshot.provider).not.toBe('load-balancer');
  });

  it('maps failover strategy to failover policy', () => {
    state.lbConfig = {
      ...(state.lbConfig as Record<string, unknown>),
      strategy: 'failover',
    };

    const snapshot = buildRuntimeProfileSnapshot(
      dependencies,
    ) as LoadBalancerProfile;
    expect(isLoadBalancerProfile(snapshot)).toBe(true);
    expect(snapshot.policy).toBe('failover');
  });

  it('saves a snapshot that passes load-balancer validation', async () => {
    const saved = await saveProfileSnapshot('glm', undefined, dependencies);

    expect(saveProfile).toHaveBeenCalledTimes(1);
    const [, persisted] = saveProfile.mock.calls[0];
    expect(isLoadBalancerProfile(persisted)).toBe(true);
    expect(isLoadBalancerProfile(saved)).toBe(true);
  });

  it('throws instead of writing a corrupt file when the LB config is unreadable', () => {
    state.lbConfig = null;

    expect(() => buildRuntimeProfileSnapshot(dependencies)).toThrow(
      /load balancer is active but its configuration could not be read/,
    );
  });

  it('refuses to persist provider load-balancer as a standard profile', () => {
    state.lbConfig = null;

    expect(saveProfileSnapshot('zai', undefined, dependencies)).rejects.toThrow(
      /could not be read|corrupt profile/,
    );
    expect(saveProfile).not.toHaveBeenCalled();
  });

  it('additional config cannot strip the load-balancer profile type', () => {
    expect(
      saveProfileSnapshot(
        'zai',
        { type: undefined, provider: 'load-balancer' } as never,
        dependencies,
      ),
    ).rejects.toThrow(/corrupt profile/);
    expect(saveProfile).not.toHaveBeenCalled();
  });

  it('leaves standard-provider saves unaffected', async () => {
    state.activeProviderName = 'anthropic';

    const saved = await saveProfileSnapshot('zai', undefined, dependencies);
    expect(saveProfile).toHaveBeenCalledTimes(1);
    expect(saved.provider).toBe('anthropic');
    expect(isLoadBalancerProfile(saved)).toBe(false);
  });
});
