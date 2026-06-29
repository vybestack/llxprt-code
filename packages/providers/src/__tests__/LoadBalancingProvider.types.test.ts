/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ProviderManager } from '../ProviderManager.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { createRuntimeConfigStub } from '@vybestack/llxprt-code-core/test-utils/runtime.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import {
  type ResolvedSubProfile,
  isLoadBalancerProfileFormat,
} from '../LoadBalancingProvider.js';

describe('LoadBalancingProvider', () => {
  let settingsService: SettingsService;
  let config: Config;
  let _providerManager: ProviderManager;

  beforeEach(() => {
    settingsService = new SettingsService();
    config = createRuntimeConfigStub(settingsService);
    _providerManager = new ProviderManager({ settingsService, config });
  });

  afterEach(() => {
    // Clean up any registered providers
  });

  describe('Load Balancer Profile Type Definitions - Phase 1', () => {
    describe('isLoadBalancerProfileFormat type guard', () => {
      it('should return true for valid load balancer profile', () => {
        const validProfile = {
          version: 1 as const,
          type: 'loadbalancer' as const,
          policy: 'roundrobin' as const,
          profiles: ['profile1', 'profile2'],
          provider: '',
          model: '',
          modelParams: {},
          ephemeralSettings: {},
        };

        expect(isLoadBalancerProfileFormat(validProfile)).toBe(true);
      });

      it('should reject standard profile without type field', () => {
        const standardProfile = {
          version: 1 as const,
          provider: 'openai',
          model: 'gpt-4',
          modelParams: {},
          ephemeralSettings: {},
        };

        expect(isLoadBalancerProfileFormat(standardProfile)).toBe(false);
      });

      it('should reject profile with wrong type', () => {
        const wrongTypeProfile = {
          version: 1 as const,
          type: 'standard' as const,
          provider: 'openai',
          model: 'gpt-4',
          modelParams: {},
          ephemeralSettings: {},
        };

        expect(isLoadBalancerProfileFormat(wrongTypeProfile)).toBe(false);
      });

      it('should reject old 486b inline format with loadBalancer property', () => {
        const oldInlineFormat = {
          version: 1 as const,
          provider: 'openai',
          model: 'gpt-4',
          modelParams: {},
          ephemeralSettings: {},
          loadBalancer: {
            strategy: 'round-robin' as const,
            subProfiles: [
              {
                name: 'sub1',
                provider: 'openai',
                model: 'gpt-4',
              },
            ],
          },
        };

        expect(isLoadBalancerProfileFormat(oldInlineFormat)).toBe(false);
      });

      it('should reject profile with profiles as objects instead of strings', () => {
        const profilesAsObjects = {
          version: 1 as const,
          type: 'loadbalancer' as const,
          policy: 'roundrobin' as const,
          profiles: [
            { name: 'profile1', provider: 'openai' },
            { name: 'profile2', provider: 'anthropic' },
          ],
          provider: '',
          model: '',
          modelParams: {},
          ephemeralSettings: {},
        };

        expect(isLoadBalancerProfileFormat(profilesAsObjects)).toBe(false);
      });

      it('should accept profile with empty profiles array (validation is separate)', () => {
        const emptyProfilesArray = {
          version: 1 as const,
          type: 'loadbalancer' as const,
          policy: 'roundrobin' as const,
          profiles: [] as string[],
          provider: '',
          model: '',
          modelParams: {},
          ephemeralSettings: {},
        };

        // Type guard should pass - runtime validation happens elsewhere
        expect(isLoadBalancerProfileFormat(emptyProfilesArray)).toBe(true);
      });

      it('should reject profile missing profiles array', () => {
        const missingProfiles = {
          version: 1 as const,
          type: 'loadbalancer' as const,
          policy: 'roundrobin' as const,
          provider: '',
          model: '',
          modelParams: {},
          ephemeralSettings: {},
        };

        expect(isLoadBalancerProfileFormat(missingProfiles)).toBe(false);
      });

      it('should reject profile with profiles as non-array', () => {
        const profilesNotArray = {
          version: 1 as const,
          type: 'loadbalancer' as const,
          policy: 'roundrobin' as const,
          profiles: 'profile1,profile2',
          provider: '',
          model: '',
          modelParams: {},
          ephemeralSettings: {},
        };

        expect(isLoadBalancerProfileFormat(profilesNotArray)).toBe(false);
      });

      it('should reject profile with mixed types in profiles array', () => {
        const mixedTypesArray = {
          version: 1 as const,
          type: 'loadbalancer' as const,
          policy: 'roundrobin' as const,
          profiles: ['profile1', 123, 'profile2'],
          provider: '',
          model: '',
          modelParams: {},
          ephemeralSettings: {},
        };

        expect(isLoadBalancerProfileFormat(mixedTypesArray)).toBe(false);
      });

      it('should reject sparse profiles arrays', () => {
        const sparseProfilesArray = {
          version: 1 as const,
          type: 'loadbalancer' as const,
          policy: 'roundrobin' as const,
          profiles: new Array(2),
          provider: '',
          model: '',
          modelParams: {},
          ephemeralSettings: {},
        };

        expect(isLoadBalancerProfileFormat(sparseProfilesArray)).toBe(false);
      });

      it.each([
        [
          'modelParams Date',
          { modelParams: new Date(), ephemeralSettings: {} },
        ],
        ['modelParams Map', { modelParams: new Map(), ephemeralSettings: {} }],
        [
          'ephemeralSettings Set',
          { modelParams: {}, ephemeralSettings: new Set() },
        ],
      ])('should reject non-plain %s', (_label, overrides) => {
        const profile = {
          version: 1 as const,
          type: 'loadbalancer' as const,
          policy: 'roundrobin' as const,
          profiles: ['profile1'],
          provider: '',
          model: '',
          ...overrides,
        };

        expect(isLoadBalancerProfileFormat(profile)).toBe(false);
      });

      it.each([
        ['null', null],
        ['undefined', undefined],
        ['string', 'profile'],
        ['number', 42],
        ['boolean', true],
        ['array without type field', [{ name: 'x' }]],
      ])('should reject %s as profile input', (_label, input) => {
        expect(isLoadBalancerProfileFormat(input)).toBe(false);
      });
    });

    describe('ResolvedSubProfile interface', () => {
      it('should support all required fields', () => {
        // This test verifies that a ResolvedSubProfile object can hold all necessary settings
        const resolvedSubProfile: ResolvedSubProfile = {
          name: 'test-profile',
          providerName: 'openai',
          model: 'gpt-4',
          ephemeralSettings: {},
          modelParams: {},
        };

        // Verify all fields are accessible
        expect(resolvedSubProfile.name).toBe('test-profile');
        expect(resolvedSubProfile.providerName).toBe('openai');
        expect(resolvedSubProfile.model).toBe('gpt-4');
        expect(resolvedSubProfile.ephemeralSettings).toBeDefined();
        expect(resolvedSubProfile.modelParams).toBeDefined();
      });

      it('should support optional baseURL field', () => {
        const resolvedSubProfile: ResolvedSubProfile = {
          name: 'test-profile',
          providerName: 'openai',
          model: 'gpt-4',
          baseURL: 'https://custom.api.endpoint',
          ephemeralSettings: {},
          modelParams: {},
        };

        expect(resolvedSubProfile.baseURL).toBe('https://custom.api.endpoint');
      });

      it('should support optional authToken field', () => {
        const resolvedSubProfile: ResolvedSubProfile = {
          name: 'test-profile',
          providerName: 'anthropic',
          model: 'claude-3-opus',
          authToken: 'sk-ant-test-token',
          ephemeralSettings: {},
          modelParams: {},
        };

        expect(resolvedSubProfile.authToken).toBe('sk-ant-test-token');
      });

      it('should support optional authKeyfile field', () => {
        const resolvedSubProfile: ResolvedSubProfile = {
          name: 'test-profile',
          providerName: 'google',
          model: 'gemini-pro',
          authKeyfile: '/path/to/keyfile.json',
          ephemeralSettings: {},
          modelParams: {},
        };

        expect(resolvedSubProfile.authKeyfile).toBe('/path/to/keyfile.json');
      });

      it('should support complex ephemeralSettings and modelParams', () => {
        const resolvedSubProfile: ResolvedSubProfile = {
          name: 'test-profile',
          providerName: 'openai',
          model: 'gpt-4',
          ephemeralSettings: {
            streaming: 'enabled',
            'socket-timeout': 30000,
            retries: 3,
          },
          modelParams: {
            temperature: 0.7,
            maxTokens: 2000,
            topP: 0.9,
          },
        };

        expect(resolvedSubProfile.ephemeralSettings.streaming).toBe('enabled');
        expect(resolvedSubProfile.ephemeralSettings['socket-timeout']).toBe(
          30000,
        );
        expect(resolvedSubProfile.modelParams.temperature).toBe(0.7);
        expect(resolvedSubProfile.modelParams.maxTokens).toBe(2000);
      });

      it('should allow empty ephemeralSettings and modelParams', () => {
        const resolvedSubProfile: ResolvedSubProfile = {
          name: 'minimal-profile',
          providerName: 'openai',
          model: 'gpt-3.5-turbo',
          ephemeralSettings: {},
          modelParams: {},
        };

        expect(Object.keys(resolvedSubProfile.ephemeralSettings).length).toBe(
          0,
        );
        expect(Object.keys(resolvedSubProfile.modelParams).length).toBe(0);
      });

      it('should support all optional fields combined', () => {
        const fullyPopulatedProfile: ResolvedSubProfile = {
          name: 'full-profile',
          providerName: 'openai',
          model: 'gpt-4',
          baseURL: 'https://api.openai.com/v1',
          authToken: 'sk-test-token',
          authKeyfile: '/path/to/keyfile.json',
          ephemeralSettings: {
            streaming: 'enabled',
            retries: 5,
          },
          modelParams: {
            temperature: 0.8,
            maxTokens: 4000,
          },
        };

        // Verify all fields are present and accessible
        expect(fullyPopulatedProfile.name).toBe('full-profile');
        expect(fullyPopulatedProfile.providerName).toBe('openai');
        expect(fullyPopulatedProfile.model).toBe('gpt-4');
        expect(fullyPopulatedProfile.baseURL).toBe('https://api.openai.com/v1');
        expect(fullyPopulatedProfile.authToken).toBe('sk-test-token');
        expect(fullyPopulatedProfile.authKeyfile).toBe('/path/to/keyfile.json');
        expect(
          Object.keys(fullyPopulatedProfile.ephemeralSettings).length,
        ).toBeGreaterThan(0);
        expect(
          Object.keys(fullyPopulatedProfile.modelParams).length,
        ).toBeGreaterThan(0);
      });
    });
  });
});
