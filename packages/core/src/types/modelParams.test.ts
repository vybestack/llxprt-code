/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  Profile,
  isLoadBalancerProfile,
  isStandardProfile,
} from './modelParams.js';

describe('Profile Type Guards', () => {
  describe('isLoadBalancerProfile', () => {
    it('returns false for profile without type field (backward compat)', () => {
      const profile: Profile = {
        version: 1,
        provider: 'openai',
        model: 'gpt-4',
        modelParams: {},
        ephemeralSettings: {},
      };

      expect(isLoadBalancerProfile(profile)).toBe(false);
    });

    it('returns false for profile with type: "standard"', () => {
      const profile: Profile = {
        version: 1,
        type: 'standard',
        provider: 'openai',
        model: 'gpt-4',
        modelParams: {},
        ephemeralSettings: {},
      };

      expect(isLoadBalancerProfile(profile)).toBe(false);
    });

    it('returns true for profile with type: "loadbalancer"', () => {
      const profile: Profile = {
        version: 1,
        type: 'loadbalancer',
        policy: 'roundrobin',
        profiles: ['profile1', 'profile2'],
        provider: '',
        model: '',
        modelParams: {},
        ephemeralSettings: {},
      };

      expect(isLoadBalancerProfile(profile)).toBe(true);
    });
  });

  describe('isStandardProfile', () => {
    it('returns true for profile without type field', () => {
      const profile: Profile = {
        version: 1,
        provider: 'openai',
        model: 'gpt-4',
        modelParams: {},
        ephemeralSettings: {},
      };

      expect(isStandardProfile(profile)).toBe(true);
    });

    it('returns true for profile with type: "standard"', () => {
      const profile: Profile = {
        version: 1,
        type: 'standard',
        provider: 'openai',
        model: 'gpt-4',
        modelParams: {},
        ephemeralSettings: {},
      };

      expect(isStandardProfile(profile)).toBe(true);
    });

    it('returns false for profile with type: "loadbalancer"', () => {
      const profile: Profile = {
        version: 1,
        type: 'loadbalancer',
        policy: 'roundrobin',
        profiles: ['profile1', 'profile2'],
        provider: '',
        model: '',
        modelParams: {},
        ephemeralSettings: {},
      };

      expect(isStandardProfile(profile)).toBe(false);
    });
  });
});
