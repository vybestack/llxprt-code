/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { LoadBalancerResolver } from './loadBalancerResolver.js';
import type { LoadBalancerProfile } from '../types/modelParams.js';

describe('LoadBalancerResolver', () => {
  let resolver: LoadBalancerResolver;

  beforeEach(() => {
    resolver = new LoadBalancerResolver();
  });

  describe('resolveProfile', () => {
    it('returns first profile on first call', () => {
      const lbProfile: LoadBalancerProfile = {
        version: 1,
        type: 'loadbalancer',
        policy: 'roundrobin',
        profiles: ['profile-a', 'profile-b', 'profile-c'],
        provider: '',
        model: '',
        modelParams: {},
        ephemeralSettings: {},
      };

      const result = resolver.resolveProfile(lbProfile, 'test-lb');
      expect(result).toBe('profile-a');
    });

    it('cycles through profiles in order (a, b, c, a, b, c...)', () => {
      const lbProfile: LoadBalancerProfile = {
        version: 1,
        type: 'loadbalancer',
        policy: 'roundrobin',
        profiles: ['profile-a', 'profile-b', 'profile-c'],
        provider: '',
        model: '',
        modelParams: {},
        ephemeralSettings: {},
      };

      expect(resolver.resolveProfile(lbProfile, 'test-lb')).toBe('profile-a');
      expect(resolver.resolveProfile(lbProfile, 'test-lb')).toBe('profile-b');
      expect(resolver.resolveProfile(lbProfile, 'test-lb')).toBe('profile-c');
      expect(resolver.resolveProfile(lbProfile, 'test-lb')).toBe('profile-a');
      expect(resolver.resolveProfile(lbProfile, 'test-lb')).toBe('profile-b');
      expect(resolver.resolveProfile(lbProfile, 'test-lb')).toBe('profile-c');
    });

    it('maintains separate counters per LB profile name', () => {
      const lbProfile1: LoadBalancerProfile = {
        version: 1,
        type: 'loadbalancer',
        policy: 'roundrobin',
        profiles: ['profile-a', 'profile-b'],
        provider: '',
        model: '',
        modelParams: {},
        ephemeralSettings: {},
      };

      const lbProfile2: LoadBalancerProfile = {
        version: 1,
        type: 'loadbalancer',
        policy: 'roundrobin',
        profiles: ['profile-x', 'profile-y', 'profile-z'],
        provider: '',
        model: '',
        modelParams: {},
        ephemeralSettings: {},
      };

      // First LB profile
      expect(resolver.resolveProfile(lbProfile1, 'lb1')).toBe('profile-a');
      expect(resolver.resolveProfile(lbProfile1, 'lb1')).toBe('profile-b');

      // Second LB profile (should start from beginning)
      expect(resolver.resolveProfile(lbProfile2, 'lb2')).toBe('profile-x');
      expect(resolver.resolveProfile(lbProfile2, 'lb2')).toBe('profile-y');

      // Back to first LB profile (should continue from where it left off)
      expect(resolver.resolveProfile(lbProfile1, 'lb1')).toBe('profile-a');

      // Back to second LB profile (should continue)
      expect(resolver.resolveProfile(lbProfile2, 'lb2')).toBe('profile-z');
      expect(resolver.resolveProfile(lbProfile2, 'lb2')).toBe('profile-x');
    });

    it('handles single-profile LB (always returns same profile)', () => {
      const lbProfile: LoadBalancerProfile = {
        version: 1,
        type: 'loadbalancer',
        policy: 'roundrobin',
        profiles: ['only-profile'],
        provider: '',
        model: '',
        modelParams: {},
        ephemeralSettings: {},
      };

      expect(resolver.resolveProfile(lbProfile, 'single-lb')).toBe(
        'only-profile',
      );
      expect(resolver.resolveProfile(lbProfile, 'single-lb')).toBe(
        'only-profile',
      );
      expect(resolver.resolveProfile(lbProfile, 'single-lb')).toBe(
        'only-profile',
      );
    });
  });

  describe('resetCounter', () => {
    it('resets counter for specific profile name', () => {
      const lbProfile: LoadBalancerProfile = {
        version: 1,
        type: 'loadbalancer',
        policy: 'roundrobin',
        profiles: ['profile-a', 'profile-b', 'profile-c'],
        provider: '',
        model: '',
        modelParams: {},
        ephemeralSettings: {},
      };

      // Advance counter
      expect(resolver.resolveProfile(lbProfile, 'test-lb')).toBe('profile-a');
      expect(resolver.resolveProfile(lbProfile, 'test-lb')).toBe('profile-b');
      expect(resolver.resolveProfile(lbProfile, 'test-lb')).toBe('profile-c');

      // Reset counter
      resolver.resetCounter('test-lb');

      // Should start from beginning again
      expect(resolver.resolveProfile(lbProfile, 'test-lb')).toBe('profile-a');
      expect(resolver.resolveProfile(lbProfile, 'test-lb')).toBe('profile-b');
    });

    it('does not affect other profile counters when resetting', () => {
      const lbProfile1: LoadBalancerProfile = {
        version: 1,
        type: 'loadbalancer',
        policy: 'roundrobin',
        profiles: ['profile-a', 'profile-b'],
        provider: '',
        model: '',
        modelParams: {},
        ephemeralSettings: {},
      };

      const lbProfile2: LoadBalancerProfile = {
        version: 1,
        type: 'loadbalancer',
        policy: 'roundrobin',
        profiles: ['profile-x', 'profile-y'],
        provider: '',
        model: '',
        modelParams: {},
        ephemeralSettings: {},
      };

      // Advance both counters
      resolver.resolveProfile(lbProfile1, 'lb1');
      resolver.resolveProfile(lbProfile1, 'lb1');
      resolver.resolveProfile(lbProfile2, 'lb2');

      // Reset only lb1
      resolver.resetCounter('lb1');

      // lb1 should reset
      expect(resolver.resolveProfile(lbProfile1, 'lb1')).toBe('profile-a');

      // lb2 should continue
      expect(resolver.resolveProfile(lbProfile2, 'lb2')).toBe('profile-y');
    });
  });

  describe('getStats', () => {
    it('returns undefined for unknown load balancer', () => {
      expect(resolver.getStats('unknown-lb')).toBeUndefined();
    });

    it('returns stats after resolving profiles', () => {
      const lbProfile: LoadBalancerProfile = {
        version: 1,
        type: 'loadbalancer',
        policy: 'roundrobin',
        profiles: ['profile-a', 'profile-b'],
        provider: '',
        model: '',
        modelParams: {},
        ephemeralSettings: {},
      };

      resolver.resolveProfile(lbProfile, 'test-lb');
      resolver.resolveProfile(lbProfile, 'test-lb');
      resolver.resolveProfile(lbProfile, 'test-lb');

      const stats = resolver.getStats('test-lb');
      expect(stats).toBeDefined();
      expect(stats?.totalRequests).toBe(3);
      expect(stats?.profileCounts['profile-a']).toBe(2);
      expect(stats?.profileCounts['profile-b']).toBe(1);
      expect(stats?.lastSelected).toBe('profile-a');
    });
  });

  describe('getLastSelected', () => {
    it('returns null for unknown load balancer', () => {
      expect(resolver.getLastSelected('unknown-lb')).toBeNull();
    });

    it('returns the last selected profile', () => {
      const lbProfile: LoadBalancerProfile = {
        version: 1,
        type: 'loadbalancer',
        policy: 'roundrobin',
        profiles: ['profile-a', 'profile-b', 'profile-c'],
        provider: '',
        model: '',
        modelParams: {},
        ephemeralSettings: {},
      };

      resolver.resolveProfile(lbProfile, 'test-lb');
      expect(resolver.getLastSelected('test-lb')).toBe('profile-a');

      resolver.resolveProfile(lbProfile, 'test-lb');
      expect(resolver.getLastSelected('test-lb')).toBe('profile-b');

      resolver.resolveProfile(lbProfile, 'test-lb');
      expect(resolver.getLastSelected('test-lb')).toBe('profile-c');
    });
  });

  describe('getAllStats', () => {
    it('returns empty map when no profiles resolved', () => {
      const allStats = resolver.getAllStats();
      expect(allStats.size).toBe(0);
    });

    it('returns stats for all load balancers', () => {
      const lbProfile1: LoadBalancerProfile = {
        version: 1,
        type: 'loadbalancer',
        policy: 'roundrobin',
        profiles: ['profile-a', 'profile-b'],
        provider: '',
        model: '',
        modelParams: {},
        ephemeralSettings: {},
      };

      const lbProfile2: LoadBalancerProfile = {
        version: 1,
        type: 'loadbalancer',
        policy: 'roundrobin',
        profiles: ['profile-x', 'profile-y'],
        provider: '',
        model: '',
        modelParams: {},
        ephemeralSettings: {},
      };

      resolver.resolveProfile(lbProfile1, 'lb1');
      resolver.resolveProfile(lbProfile1, 'lb1');
      resolver.resolveProfile(lbProfile2, 'lb2');

      const allStats = resolver.getAllStats();
      expect(allStats.size).toBe(2);
      expect(allStats.get('lb1')?.totalRequests).toBe(2);
      expect(allStats.get('lb2')?.totalRequests).toBe(1);
    });
  });
});
