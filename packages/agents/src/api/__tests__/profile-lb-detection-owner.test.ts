/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { beforeEach, describe, expect, it } from 'bun:test';
import type { LoadBalancerProfile } from '@vybestack/llxprt-code-settings';
import {
  loadBalancer,
  standardProfile,
  useProfileOwner,
} from './helpers/profile-owner-fixture.js';

function profile(profiles = ['first', 'second']): LoadBalancerProfile {
  return {
    version: 1,
    type: 'loadbalancer',
    provider: '',
    model: '',
    modelParams: {},
    ephemeralSettings: {},
    policy: 'roundrobin',
    profiles,
  };
}

describe('Load balancer profile detection at the owner', () => {
  const owner = useProfileOwner();
  beforeEach(async () => {
    await owner().store.saveProfile('first', standardProfile());
    await owner().store.saveProfile('second', {
      ...standardProfile(),
      provider: 'openai',
      model: 'second-model',
    });
    await owner().store.saveProfile('third', {
      ...standardProfile(),
      provider: 'gemini',
      model: 'third-model',
    });
  });

  it('detects the type loadbalancer profiles format', async () => {
    await owner().application.applySnapshot(profile());
    expect(
      loadBalancer(owner())
        .getLoadBalancerConfig()
        .subProfiles.map((member) => member.name),
    ).toStrictEqual(['first', 'second']);
  });

  it('does not detect standard profiles as load balancers', async () => {
    await owner().application.applySnapshot(standardProfile());
    expect(owner().manager.getProviderByName('load-balancer')).toBeUndefined();
  });

  it('loads each sub-profile from the durable ProfileManager', async () => {
    await owner().application.applySnapshot(
      profile(['first', 'second', 'third']),
    );
    expect(
      loadBalancer(owner()).getLoadBalancerConfig().subProfiles,
    ).toMatchObject([
      { name: 'first', providerName: 'anthropic', model: 'selected-model' },
      { name: 'second', providerName: 'openai', model: 'second-model' },
      { name: 'third', providerName: 'gemini', model: 'third-model' },
    ]);
  });

  it('extracts the full configuration from loaded sub-profiles', async () => {
    await owner().store.saveProfile('first', {
      ...standardProfile({
        'auth-key': 'member-key',
        'base-url': 'https://member.invalid',
        'context-limit': 4096,
      }),
      modelParams: { temperature: 0.3 },
    });
    await owner().application.applySnapshot(profile(['first']));
    expect(
      loadBalancer(owner()).getLoadBalancerConfig().subProfiles[0],
    ).toMatchObject({
      name: 'first',
      providerName: 'anthropic',
      model: 'selected-model',
      authToken: 'member-key',
      baseURL: 'https://member.invalid',
      modelParams: { temperature: 0.3 },
      ephemeralSettings: { 'context-limit': 4096 },
    });
  });

  it('fails fast when a referenced profile does not exist', async () => {
    await expect(
      owner().application.applySnapshot(profile(['missing'])),
    ).rejects.toThrow('does not exist');
    expect(owner().manager.getProviderByName('load-balancer')).toBeUndefined();
  });

  it('includes both the load balancer and missing member in the error', async () => {
    await expect(
      owner().application.applySnapshot(profile(['missingSubProfile']), {
        profileName: 'myLB',
      }),
    ).rejects.toThrow(
      'Load balancer profile "myLB" references profile "missingSubProfile"',
    );
  });

  it('rejects circular references to another load balancer', async () => {
    await owner().store.saveProfile('nested', profile(['first']));
    await expect(
      owner().application.applySnapshot(profile(['nested'])),
    ).rejects.toThrow('cannot reference another loadbalancer');
    expect(owner().manager.getProviderByName('load-balancer')).toBeUndefined();
  });

  it('creates LoadBalancingProvider with resolved member configurations', async () => {
    await owner().application.applySnapshot(profile());
    expect(loadBalancer(owner()).name).toBe('load-balancer');
    expect(
      loadBalancer(owner()).getLoadBalancerConfig().subProfiles,
    ).toHaveLength(2);
  });

  it('registers LoadBalancingProvider as load-balancer', async () => {
    await owner().application.applySnapshot(profile());
    expect(owner().manager.getProviderByName('load-balancer')?.name).toBe(
      'load-balancer',
    );
  });

  it('sets load-balancer as the active provider', async () => {
    await owner().application.applySnapshot(profile());
    expect(owner().manager.getActiveProviderName()).toBe('load-balancer');
  });

  it('returns load-balancer as providerName', async () => {
    const result = await owner().application.applySnapshot(profile());
    expect(result.providerName).toBe('load-balancer');
  });

  it('applies top-level ephemeral settings', async () => {
    await owner().application.applySnapshot({
      ...profile(),
      ephemeralSettings: { 'context-limit': 100000, streaming: 'enabled' },
    });
    expect(owner().settingsOwner.readNamedParameter('context-limit')).toBe(
      100000,
    );
    expect(owner().settingsOwner.readNamedParameter('streaming')).toBe(
      'enabled',
    );
  });

  it('applies top-level contextLimit to both metadata and runtime context-limit', async () => {
    await owner().application.applySnapshot({
      ...profile(),
      contextLimit: 200000,
      ephemeralSettings: { 'context-limit': 100000 },
    });
    expect((await loadBalancer(owner()).getModels())[0]?.contextWindow).toBe(
      200000,
    );
    expect(owner().settingsOwner.readNamedParameter('context-limit')).toBe(
      200000,
    );
  });

  it('checks type loadbalancer before the old inline format', async () => {
    const input = { ...profile(['first']), loadBalancer: { subProfiles: [] } };
    await owner().application.applySnapshot(input);
    expect(
      loadBalancer(owner()).getLoadBalancerConfig().subProfiles,
    ).toMatchObject([{ name: 'first' }]);
  });

  it('ignores the old inline subProfiles format', async () => {
    const input = {
      ...standardProfile(),
      provider: 'gemini',
      model: 'test-model',
      loadBalancer: { subProfiles: [{ provider: 'openai', model: 'unused' }] },
    };
    const result = await owner().application.applySnapshot(input);
    expect(owner().manager.getProviderByName('load-balancer')).toBeUndefined();
    expect(result.providerName).toBe('gemini');
    expect(result.modelName).toBe('test-model');
  });
});
