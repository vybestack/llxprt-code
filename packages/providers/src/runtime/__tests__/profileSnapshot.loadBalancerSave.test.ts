/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ProfileManager,
  isLoadBalancerProfile,
} from '@vybestack/llxprt-code-settings';
import {
  buildRuntimeProfileSnapshot,
  saveProfileSnapshot,
  type ProfileSnapshotData,
} from '../profileSnapshot.js';

const data: ProfileSnapshotData = {
  providerName: 'load-balancer',
  modelName: 'load-balancer',
  providerSettings: {},
  ephemeralSettings: {},
  loadBalancerConfig: {
    profileName: 'glm',
    strategy: 'round-robin',
    subProfiles: [
      { name: 'glm-a', providerName: 'anthropic', model: 'glm-5.2' },
      { name: 'glm-b', providerName: 'anthropic', model: 'glm-5.2' },
    ],
    contextLimit: 200000,
    lbProfileEphemeralSettings: { 'context-limit': 200000 },
    lbProfileModelParams: {},
  },
};

describe('profile save while load balancer is active (issue #2479)', () => {
  let directory: string;
  let previousHome: string | undefined;
  beforeEach(async () => {
    previousHome = process.env.LLXPRT_CONFIG_HOME;
    directory = await mkdtemp(join(tmpdir(), 'lb-profile-save-'));
    process.env.LLXPRT_CONFIG_HOME = directory;
  });
  afterEach(async () => {
    if (previousHome === undefined) delete process.env.LLXPRT_CONFIG_HOME;
    else process.env.LLXPRT_CONFIG_HOME = previousHome;
    await rm(directory, { recursive: true, force: true });
  });

  it('serializes the active load balancer as a genuine loadbalancer profile', () => {
    const snapshot = buildRuntimeProfileSnapshot(data);
    expect(isLoadBalancerProfile(snapshot)).toBe(true);
    expect(snapshot).toMatchObject({
      type: 'loadbalancer',
      policy: 'roundrobin',
      profiles: ['glm-a', 'glm-b'],
      contextLimit: 200000,
    });
    expect(snapshot.provider).not.toBe('load-balancer');
  });

  it('maps failover strategy to failover policy', () => {
    if (!data.loadBalancerConfig)
      throw new Error('Fixture requires load balancer data');
    expect(
      buildRuntimeProfileSnapshot({
        ...data,
        loadBalancerConfig: {
          ...data.loadBalancerConfig,
          strategy: 'failover',
        },
      }),
    ).toMatchObject({ policy: 'failover' });
  });

  it('persists a valid loadbalancer snapshot', async () => {
    const manager = new ProfileManager();
    for (const name of ['glm-a', 'glm-b']) {
      await manager.saveProfile(name, {
        version: 1,
        provider: 'anthropic',
        model: 'glm-5.2',
        modelParams: {},
        ephemeralSettings: {},
      });
    }
    const snapshot = buildRuntimeProfileSnapshot(data);
    await saveProfileSnapshot(
      'glm',
      snapshot,
      undefined,
      new ProfileManager(join(directory, 'profiles')),
    );
    expect(await new ProfileManager().loadProfile('glm')).toMatchObject({
      type: 'loadbalancer',
      profiles: ['glm-a', 'glm-b'],
      policy: 'roundrobin',
    });
  });

  it('throws instead of capturing a corrupt file when the LB config is unreadable', () => {
    expect(() =>
      buildRuntimeProfileSnapshot({ ...data, loadBalancerConfig: undefined }),
    ).toThrow(
      /load balancer is active but its configuration could not be read/,
    );
  });

  it('refuses to persist the virtual provider as a standard profile', async () => {
    await expect(
      saveProfileSnapshot(
        'zai',
        {
          version: 1,
          provider: 'load-balancer',
          model: 'virtual',
          modelParams: {},
          ephemeralSettings: {},
        },
        undefined,
        new ProfileManager(join(directory, 'profiles')),
      ),
    ).rejects.toThrow(/corrupt profile/);
    expect(await new ProfileManager().listProfiles()).toStrictEqual([]);
  });

  it('additionalConfig cannot strip the loadbalancer type into a corrupt standard profile', async () => {
    await expect(
      saveProfileSnapshot(
        'zai',
        buildRuntimeProfileSnapshot(data),
        {
          type: undefined,
          provider: 'load-balancer',
        },
        new ProfileManager(join(directory, 'profiles')),
      ),
    ).rejects.toThrow(/corrupt profile/);
    expect(await new ProfileManager().listProfiles()).toStrictEqual([]);
  });

  it('standard-provider saves are unaffected', async () => {
    await saveProfileSnapshot(
      'zai',
      buildRuntimeProfileSnapshot({
        ...data,
        providerName: 'anthropic',
        modelName: 'claude',
      }),
      undefined,
      new ProfileManager(join(directory, 'profiles')),
    );
    expect(await new ProfileManager().loadProfile('zai')).toMatchObject({
      provider: 'anthropic',
      model: 'claude',
    });
  });
});
