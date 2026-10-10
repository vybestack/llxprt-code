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

function profile(
  policy: 'failover' | 'roundrobin' = 'failover',
): LoadBalancerProfile {
  return {
    version: 1,
    type: 'loadbalancer',
    provider: '',
    model: '',
    modelParams: {},
    ephemeralSettings: {},
    policy,
    profiles: ['first', 'second'],
  };
}

describe('Load balancer policy at the profile owner', () => {
  const owner = useProfileOwner();
  beforeEach(async () => {
    await owner().store.saveProfile('first', standardProfile());
    await owner().store.saveProfile('second', {
      ...standardProfile(),
      provider: 'openai',
    });
  });

  for (const [title, policy, strategy] of [
    [
      'should map policy "failover" to strategy "failover"',
      'failover',
      'failover',
    ],
    [
      'should map policy "roundrobin" to strategy "round-robin"',
      'roundrobin',
      'round-robin',
    ],
    [
      'should have failover strategy when policy is failover',
      'failover',
      'failover',
    ],
    [
      'should have round-robin strategy when policy is roundrobin',
      'roundrobin',
      'round-robin',
    ],
  ] satisfies Array<
    [string, 'failover' | 'roundrobin', 'failover' | 'round-robin']
  >) {
    it(`${title}`, async () => {
      await owner().application.applySnapshot(profile(policy));
      expect(loadBalancer(owner()).getLoadBalancerConfig().strategy).toBe(
        strategy,
      );
    });
  }

  it('should create LoadBalancingProvider with failover strategy from policy', async () => {
    await owner().application.applySnapshot(profile());
    expect(loadBalancer(owner()).name).toBe('load-balancer');
    expect(loadBalancer(owner()).getLoadBalancerConfig().strategy).toBe(
      'failover',
    );
  });

  it('should register LoadBalancingProvider with providerManager', async () => {
    await owner().application.applySnapshot(profile());
    expect(owner().manager.getProviderByName('load-balancer')?.name).toBe(
      'load-balancer',
    );
    expect(
      loadBalancer(owner()).getLoadBalancerConfig().subProfiles,
    ).toHaveLength(2);
  });

  it('should pass ephemeral settings to LoadBalancingProviderConfig', async () => {
    await owner().application.applySnapshot({
      ...profile(),
      ephemeralSettings: standardProfile({
        failover_retry_count: 3,
        failover_retry_delay_ms: 1000,
        'context-limit': 100000,
      }).ephemeralSettings,
    });
    expect(
      loadBalancer(owner()).getLoadBalancerConfig().lbProfileEphemeralSettings,
    ).toStrictEqual({
      failover_retry_count: 3,
      failover_retry_delay_ms: 1000,
      'context-limit': 100000,
    });
  });

  it('should pass empty ephemeral settings when none provided', async () => {
    await owner().application.applySnapshot(profile());
    expect(
      loadBalancer(owner()).getLoadBalancerConfig().lbProfileEphemeralSettings,
    ).toStrictEqual({});
  });

  it('should include profile name in LoadBalancingProviderConfig', async () => {
    await owner().application.applySnapshot(profile(), {
      profileName: 'myCustomFailoverLB',
    });
    expect(loadBalancer(owner()).getLoadBalancerConfig().profileName).toBe(
      'myCustomFailoverLB',
    );
  });
});
