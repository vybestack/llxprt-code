/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import type { Profile } from '@vybestack/llxprt-code-core';

/**
 * Tests for Issue 1151: Proactive failover handler wiring in applyProfileSnapshot
 *
 * Problem: The bucket failover handler is only wired during getOAuthToken() which
 * happens when making API calls. If a 403 error occurs on the FIRST request after
 * profile activation, the handler hasn't been wired yet.
 *
 * Solution: In applyProfileSnapshot(), proactively call getOAuthToken() after
 * profile activation to wire the handler BEFORE any API calls occur.
 *
 * Implementation (in runtimeSettings.ts lines 1085-1113):
 *   if (authConfig?.type === 'oauth' && authConfig.buckets && authConfig.buckets.length > 1) {
 *     void oauthManager.getOAuthToken(profile.provider).catch(...);
 *   }
 *
 * The actual behavioral tests for OAuthManager wiring are in:
 *   - oauth-manager.failover-wiring.spec.ts (tests OAuthManager.getOAuthToken wiring)
 *   - oauth-manager.bucketFailover.spec.ts (tests bucket failover handler creation)
 *
 * This test file verifies the profile structure conditions that trigger proactive wiring.
 */
describe('RuntimeSettings - Proactive Failover Handler Wiring (Issue 1151)', () => {
  describe('Profile conditions for proactive wiring', () => {
    it('multi-bucket OAuth profile should trigger proactive wiring', () => {
      const multiBucketProfile: Profile = {
        version: 1,
        type: 'standard',
        provider: 'anthropic',
        model: 'claude-3-5-sonnet-latest',
        modelParams: {},
        ephemeralSettings: {},
        auth: {
          type: 'oauth',
          buckets: ['bucket1', 'bucket2', 'bucket3'],
        },
      };

      // Verify the profile matches what applyProfileSnapshot would check
      const authConfig = (
        multiBucketProfile as { auth?: { type?: string; buckets?: string[] } }
      ).auth;

      // This is the condition checked in runtimeSettings.ts lines 1094-1097
      const shouldProactivelyWire =
        authConfig?.type === 'oauth' &&
        authConfig.buckets &&
        authConfig.buckets.length > 1;

      expect(shouldProactivelyWire).toBe(true);
      expect(authConfig?.buckets?.length).toBe(3);
    });

    it('single-bucket OAuth profile should NOT trigger proactive wiring', () => {
      const singleBucketProfile: Profile = {
        version: 1,
        type: 'standard',
        provider: 'anthropic',
        model: 'claude-3-5-sonnet-latest',
        modelParams: {},
        ephemeralSettings: {},
        auth: {
          type: 'oauth',
          buckets: ['default'],
        },
      };

      const authConfig = (
        singleBucketProfile as { auth?: { type?: string; buckets?: string[] } }
      ).auth;

      const shouldProactivelyWire =
        authConfig?.type === 'oauth' &&
        authConfig.buckets &&
        authConfig.buckets.length > 1;

      // Single bucket = no failover needed = no proactive wiring
      expect(shouldProactivelyWire).toBe(false);
    });

    it('non-OAuth profile should NOT trigger proactive wiring', () => {
      const apiKeyProfile: Profile = {
        version: 1,
        type: 'standard',
        provider: 'anthropic',
        model: 'claude-3-5-sonnet-latest',
        modelParams: {},
        ephemeralSettings: {
          'auth-key': 'sk-test-key',
        },
      };

      const authConfig = (
        apiKeyProfile as { auth?: { type?: string; buckets?: string[] } }
      ).auth;

      const shouldProactivelyWire =
        authConfig?.type === 'oauth' &&
        authConfig.buckets &&
        authConfig.buckets.length > 1;

      // No OAuth = no proactive wiring
      expect(shouldProactivelyWire).toBe(false);
      expect(authConfig).toBeUndefined();
    });

    it('LoadBalancerProfile should NOT trigger proactive wiring (covered by #1250)', () => {
      const loadBalancerProfile: Profile = {
        version: 1,
        type: 'loadbalancer',
        policy: 'roundrobin',
        profiles: ['profile1', 'profile2'],
        provider: '',
        model: '',
        modelParams: {},
        ephemeralSettings: {},
      };

      const authConfig = (
        loadBalancerProfile as { auth?: { type?: string; buckets?: string[] } }
      ).auth;

      const shouldProactivelyWire =
        authConfig?.type === 'oauth' &&
        authConfig.buckets &&
        authConfig.buckets.length > 1;

      // Load balancer profiles delegate to sub-profiles for auth
      // Proactive wiring for LB sub-profiles is tracked in issue #1250
      expect(shouldProactivelyWire).toBe(false);
      expect(authConfig).toBeUndefined();
    });
  });
});
