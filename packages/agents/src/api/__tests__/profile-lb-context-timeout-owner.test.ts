/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { isResolvedSubProfile } from '@vybestack/llxprt-code-providers';
import {
  loadBalancer,
  standardProfile,
  useProfileOwner,
} from './helpers/profile-owner-fixture.js';

describe('Load balancer model-discovery timeout', () => {
  const owner = useProfileOwner();

  it('completes registration when member model discovery never resolves', async () => {
    const provider = owner().providers.get('anthropic');
    if (!provider) throw new Error('Missing provider fixture');
    provider.getModels = () => new Promise(() => {});
    await owner().store.saveProfile('hanging', standardProfile());
    const start = Date.now();
    await owner().application.applySnapshot({
      ...standardProfile(),
      type: 'loadbalancer',
      policy: 'roundrobin',
      profiles: ['hanging'],
    });
    expect(loadBalancer(owner()).name).toBe('load-balancer');
    expect(Date.now() - start).toBeLessThan(10000);
  });

  it('resolves three hanging members concurrently', async () => {
    for (const name of ['anthropic', 'openai', 'gemini']) {
      const provider = owner().providers.get(name);
      if (!provider) throw new Error('Missing provider fixture');
      provider.getModels = () => new Promise(() => {});
      await owner().store.saveProfile(name, {
        ...standardProfile(),
        provider: name,
      });
    }
    const start = Date.now();
    await owner().application.applySnapshot({
      ...standardProfile(),
      type: 'loadbalancer',
      policy: 'roundrobin',
      profiles: ['anthropic', 'openai', 'gemini'],
    });
    expect(
      loadBalancer(owner()).getLoadBalancerConfig().subProfiles,
    ).toHaveLength(3);
    expect(Date.now() - start).toBeLessThan(8000);
  });

  it('leaves member context window undefined when model discovery rejects', async () => {
    const provider = owner().providers.get('anthropic');
    if (!provider) throw new Error('Missing provider fixture');
    provider.getModels = async () => {
      throw new Error('endpoint unavailable');
    };
    await owner().store.saveProfile('failing', standardProfile());
    await owner().application.applySnapshot({
      ...standardProfile(),
      type: 'loadbalancer',
      policy: 'roundrobin',
      profiles: ['failing'],
    });
    const member = loadBalancer(owner()).getLoadBalancerConfig().subProfiles[0];
    if (!isResolvedSubProfile(member))
      throw new Error('Expected resolved member');
    expect(member.contextWindow).toBeUndefined();
  });
});
