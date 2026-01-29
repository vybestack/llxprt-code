/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tests for load balancer profile save/load with advanced failover ephemeral settings
 * Issue #489 Phase 7
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { profileCommand } from '../profileCommand.js';
import { createMockCommandContext } from '../../../test-utils/mockCommandContext.js';
import type { CommandContext } from '../types.js';
import type { LoadBalancerProfile } from '@vybestack/llxprt-code-core';

const runtimeMocks = vi.hoisted(() => ({
  saveLoadBalancerProfile: vi.fn(),
  listSavedProfiles: vi.fn(),
  getEphemeralSettings: vi.fn(),
}));

vi.mock('../../contexts/RuntimeContext.js', () => ({
  getRuntimeApi: () => runtimeMocks,
}));

describe('profileCommand - load balancer save with protected settings', () => {
  let context: CommandContext;

  beforeEach(() => {
    vi.clearAllMocks();
    context = createMockCommandContext();
    runtimeMocks.listSavedProfiles.mockResolvedValue([
      'profile1',
      'profile2',
      'profile3',
    ]);
  });

  const save = profileCommand.subCommands!.find((cmd) => cmd?.name === 'save')!;

  describe('protected settings stripping', () => {
    it('strips protected settings when saving loadbalancer profile', async () => {
      // Setup: Mock ephemeral settings with both protected and non-protected settings
      runtimeMocks.getEphemeralSettings.mockReturnValue({
        // Protected settings (should be stripped)
        'auth-key': 'secret-key-12345',
        'auth-keyfile': '/path/to/keyfile',
        'base-url': 'https://custom.api.example.com',
        apiKey: 'api-key-67890',
        apiKeyfile: '/path/to/api-keyfile',
        model: 'gpt-4',
        'tool-format': 'openai',
        GOOGLE_CLOUD_PROJECT: 'my-project',
        GOOGLE_CLOUD_LOCATION: 'us-central1',
        // Non-protected settings (should be preserved)
        'context-limit': 190000,
        streaming: true,
        'compression-threshold': 1000,
        retries: 3,
      });

      runtimeMocks.saveLoadBalancerProfile.mockResolvedValue(undefined);

      await save.action!(
        context,
        'loadbalancer myLB roundrobin profile1 profile2',
      );

      expect(runtimeMocks.saveLoadBalancerProfile).toHaveBeenCalledTimes(1);
      const savedProfile = runtimeMocks.saveLoadBalancerProfile.mock
        .calls[0][1] as LoadBalancerProfile;

      // Verify protected settings are NOT in ephemeralSettings
      expect(savedProfile.ephemeralSettings).not.toHaveProperty('auth-key');
      expect(savedProfile.ephemeralSettings).not.toHaveProperty('auth-keyfile');
      expect(savedProfile.ephemeralSettings).not.toHaveProperty('base-url');
      expect(savedProfile.ephemeralSettings).not.toHaveProperty('apiKey');
      expect(savedProfile.ephemeralSettings).not.toHaveProperty('apiKeyfile');
      expect(savedProfile.ephemeralSettings).not.toHaveProperty('model');
      expect(savedProfile.ephemeralSettings).not.toHaveProperty('tool-format');
      expect(savedProfile.ephemeralSettings).not.toHaveProperty(
        'GOOGLE_CLOUD_PROJECT',
      );
      expect(savedProfile.ephemeralSettings).not.toHaveProperty(
        'GOOGLE_CLOUD_LOCATION',
      );

      // Verify non-protected settings ARE preserved
      expect(savedProfile.ephemeralSettings).toHaveProperty(
        'context-limit',
        190000,
      );
      expect(savedProfile.ephemeralSettings).toHaveProperty('streaming', true);
      expect(savedProfile.ephemeralSettings).toHaveProperty(
        'compression-threshold',
        1000,
      );
      expect(savedProfile.ephemeralSettings).toHaveProperty('retries', 3);
    });

    it('saves loadbalancer profile with correct structure', async () => {
      runtimeMocks.getEphemeralSettings.mockReturnValue({
        'context-limit': 190000,
        streaming: true,
      });

      runtimeMocks.saveLoadBalancerProfile.mockResolvedValue(undefined);

      const result = await save.action!(
        context,
        'loadbalancer myLB roundrobin profile1 profile2',
      );

      expect(runtimeMocks.saveLoadBalancerProfile).toHaveBeenCalledWith(
        'myLB',
        {
          version: 1,
          type: 'loadbalancer',
          policy: 'roundrobin',
          profiles: ['profile1', 'profile2'],
          provider: '',
          model: '',
          modelParams: {},
          ephemeralSettings: {
            'context-limit': 190000,
            streaming: true,
          },
        },
      );

      expect(result).toBeDefined();
      expect(result).toHaveProperty('type', 'message');
      expect(result).toHaveProperty('messageType', 'info');
      expect(result).toHaveProperty(
        'content',
        "Load balancer profile 'myLB' saved with 2 profiles (policy: roundrobin)",
      );
    });

    it('handles empty ephemeral settings gracefully', async () => {
      runtimeMocks.getEphemeralSettings.mockReturnValue({});
      runtimeMocks.saveLoadBalancerProfile.mockResolvedValue(undefined);

      await save.action!(
        context,
        'loadbalancer myLB roundrobin profile1 profile2',
      );

      const savedProfile = runtimeMocks.saveLoadBalancerProfile.mock
        .calls[0][1] as LoadBalancerProfile;
      expect(savedProfile.ephemeralSettings).toEqual({});
    });

    it('handles ephemeral settings with only protected values', async () => {
      runtimeMocks.getEphemeralSettings.mockReturnValue({
        'auth-key': 'secret',
        apiKey: 'key',
        model: 'gpt-4',
      });
      runtimeMocks.saveLoadBalancerProfile.mockResolvedValue(undefined);

      await save.action!(
        context,
        'loadbalancer myLB roundrobin profile1 profile2',
      );

      const savedProfile = runtimeMocks.saveLoadBalancerProfile.mock
        .calls[0][1] as LoadBalancerProfile;
      // All settings were protected, so ephemeralSettings should be empty
      expect(savedProfile.ephemeralSettings).toEqual({});
    });

    it('preserves multiple profile names correctly', async () => {
      runtimeMocks.getEphemeralSettings.mockReturnValue({
        'context-limit': 100000,
      });
      runtimeMocks.saveLoadBalancerProfile.mockResolvedValue(undefined);

      await save.action!(
        context,
        'loadbalancer myLB roundrobin profile1 profile2 profile3',
      );

      const savedProfile = runtimeMocks.saveLoadBalancerProfile.mock
        .calls[0][1] as LoadBalancerProfile;
      expect(savedProfile.profiles).toEqual([
        'profile1',
        'profile2',
        'profile3',
      ]);
    });

    it('strips all variations of protected setting names', async () => {
      runtimeMocks.getEphemeralSettings.mockReturnValue({
        // All variations of protected settings
        'auth-key': 'key1',
        'auth-keyfile': 'file1',
        'base-url': 'url1',
        apiKey: 'key2',
        apiKeyfile: 'file2',
        model: 'model1',
        provider: 'openai', // LB profiles use load-balancer, not current provider
        GOOGLE_CLOUD_PROJECT: 'proj',
        GOOGLE_CLOUD_LOCATION: 'loc',
        // Should be preserved
        streaming: false,
      });
      runtimeMocks.saveLoadBalancerProfile.mockResolvedValue(undefined);

      await save.action!(
        context,
        'loadbalancer myLB roundrobin profile1 profile2',
      );

      const savedProfile = runtimeMocks.saveLoadBalancerProfile.mock
        .calls[0][1] as LoadBalancerProfile;

      // Only streaming should remain (provider should be stripped)
      expect(savedProfile.ephemeralSettings).toEqual({
        streaming: false,
      });
    });
  });

  describe('validation and error handling', () => {
    it('requires at least 2 profiles', async () => {
      runtimeMocks.getEphemeralSettings.mockReturnValue({});

      const result = await save.action!(
        context,
        'loadbalancer myLB roundrobin profile1',
      );

      expect(result).toBeDefined();
      expect(result).toHaveProperty('type', 'message');
      expect(result).toHaveProperty('messageType', 'error');
      const content = (result as { content: string }).content;
      // Gets usage error since parts.length < 5
      expect(content).toMatch(/Usage.*roundrobin.*failover/i);
    });

    it('validates that referenced profiles exist', async () => {
      runtimeMocks.getEphemeralSettings.mockReturnValue({});
      runtimeMocks.listSavedProfiles.mockResolvedValue(['profile1']);

      const result = await save.action!(
        context,
        'loadbalancer myLB roundrobin profile1 nonexistent',
      );

      expect(result).toBeDefined();
      expect(result).toHaveProperty('type', 'message');
      expect(result).toHaveProperty('messageType', 'error');
      const content = (result as { content: string }).content;
      expect(content).toContain('Profile nonexistent does not exist');
    });

    it('handles save errors gracefully', async () => {
      runtimeMocks.getEphemeralSettings.mockReturnValue({});
      runtimeMocks.saveLoadBalancerProfile.mockRejectedValue(
        new Error('disk full'),
      );

      const result = await save.action!(
        context,
        'loadbalancer myLB roundrobin profile1 profile2',
      );

      expect(result).toBeDefined();
      expect(result).toHaveProperty('type', 'message');
      expect(result).toHaveProperty('messageType', 'error');
      const content = (result as { content: string }).content;
      expect(content).toContain('disk full');
    });
  });

  describe('advanced failover ephemeral settings (Issue #489)', () => {
    it('includes tpm_threshold in saved profile when set', async () => {
      runtimeMocks.getEphemeralSettings.mockReturnValue({
        'context-limit': 190000,
        tpm_threshold: 1000,
      });
      runtimeMocks.saveLoadBalancerProfile.mockResolvedValue(undefined);

      await save.action!(
        context,
        'loadbalancer lb-tpm failover profile1 profile2',
      );

      const savedProfile = runtimeMocks.saveLoadBalancerProfile.mock
        .calls[0][1] as LoadBalancerProfile;
      const settings = savedProfile.ephemeralSettings as Record<
        string,
        unknown
      >;
      expect(settings.tpm_threshold).toBe(1000);
    });

    it('includes timeout_ms in saved profile when set', async () => {
      runtimeMocks.getEphemeralSettings.mockReturnValue({
        timeout_ms: 30000,
      });
      runtimeMocks.saveLoadBalancerProfile.mockResolvedValue(undefined);

      await save.action!(
        context,
        'loadbalancer lb-timeout failover profile1 profile2',
      );

      const savedProfile = runtimeMocks.saveLoadBalancerProfile.mock
        .calls[0][1] as LoadBalancerProfile;
      const settings = savedProfile.ephemeralSettings as Record<
        string,
        unknown
      >;
      expect(settings.timeout_ms).toBe(30000);
    });

    it('includes circuit_breaker_enabled in saved profile when set', async () => {
      runtimeMocks.getEphemeralSettings.mockReturnValue({
        circuit_breaker_enabled: true,
      });
      runtimeMocks.saveLoadBalancerProfile.mockResolvedValue(undefined);

      await save.action!(
        context,
        'loadbalancer lb-cb failover profile1 profile2',
      );

      const savedProfile = runtimeMocks.saveLoadBalancerProfile.mock
        .calls[0][1] as LoadBalancerProfile;
      const settings = savedProfile.ephemeralSettings as Record<
        string,
        unknown
      >;
      expect(settings.circuit_breaker_enabled).toBe(true);
    });

    it('includes circuit_breaker_failure_threshold in saved profile when set', async () => {
      runtimeMocks.getEphemeralSettings.mockReturnValue({
        circuit_breaker_failure_threshold: 3,
      });
      runtimeMocks.saveLoadBalancerProfile.mockResolvedValue(undefined);

      await save.action!(
        context,
        'loadbalancer lb-cb-threshold failover profile1 profile2',
      );

      const savedProfile = runtimeMocks.saveLoadBalancerProfile.mock
        .calls[0][1] as LoadBalancerProfile;
      const settings = savedProfile.ephemeralSettings as Record<
        string,
        unknown
      >;
      expect(settings.circuit_breaker_failure_threshold).toBe(3);
    });

    it('includes circuit_breaker_failure_window_ms in saved profile when set', async () => {
      runtimeMocks.getEphemeralSettings.mockReturnValue({
        circuit_breaker_failure_window_ms: 60000,
      });
      runtimeMocks.saveLoadBalancerProfile.mockResolvedValue(undefined);

      await save.action!(
        context,
        'loadbalancer lb-cb-window failover profile1 profile2',
      );

      const savedProfile = runtimeMocks.saveLoadBalancerProfile.mock
        .calls[0][1] as LoadBalancerProfile;
      const settings = savedProfile.ephemeralSettings as Record<
        string,
        unknown
      >;
      expect(settings.circuit_breaker_failure_window_ms).toBe(60000);
    });

    it('includes circuit_breaker_recovery_timeout_ms in saved profile when set', async () => {
      runtimeMocks.getEphemeralSettings.mockReturnValue({
        circuit_breaker_recovery_timeout_ms: 30000,
      });
      runtimeMocks.saveLoadBalancerProfile.mockResolvedValue(undefined);

      await save.action!(
        context,
        'loadbalancer lb-cb-recovery failover profile1 profile2',
      );

      const savedProfile = runtimeMocks.saveLoadBalancerProfile.mock
        .calls[0][1] as LoadBalancerProfile;
      const settings = savedProfile.ephemeralSettings as Record<
        string,
        unknown
      >;
      expect(settings.circuit_breaker_recovery_timeout_ms).toBe(30000);
    });

    it('includes all load balancer advanced failover settings when set', async () => {
      runtimeMocks.getEphemeralSettings.mockReturnValue({
        tpm_threshold: 500,
        timeout_ms: 30000,
        circuit_breaker_enabled: true,
        circuit_breaker_failure_threshold: 3,
        circuit_breaker_failure_window_ms: 60000,
        circuit_breaker_recovery_timeout_ms: 30000,
      });
      runtimeMocks.saveLoadBalancerProfile.mockResolvedValue(undefined);

      await save.action!(
        context,
        'loadbalancer lb-all failover profile1 profile2',
      );

      const savedProfile = runtimeMocks.saveLoadBalancerProfile.mock
        .calls[0][1] as LoadBalancerProfile;
      const settings = savedProfile.ephemeralSettings as Record<
        string,
        unknown
      >;

      expect(settings.tpm_threshold).toBe(500);
      expect(settings.timeout_ms).toBe(30000);
      expect(settings.circuit_breaker_enabled).toBe(true);
      expect(settings.circuit_breaker_failure_threshold).toBe(3);
      expect(settings.circuit_breaker_failure_window_ms).toBe(60000);
      expect(settings.circuit_breaker_recovery_timeout_ms).toBe(30000);
    });

    it('excludes undefined/null load balancer settings from saved profile', async () => {
      runtimeMocks.getEphemeralSettings.mockReturnValue({
        tpm_threshold: 1000,
        timeout_ms: undefined,
        circuit_breaker_enabled: null,
      });
      runtimeMocks.saveLoadBalancerProfile.mockResolvedValue(undefined);

      await save.action!(
        context,
        'loadbalancer lb-nulls failover profile1 profile2',
      );

      const savedProfile = runtimeMocks.saveLoadBalancerProfile.mock
        .calls[0][1] as LoadBalancerProfile;
      const settings = savedProfile.ephemeralSettings as Record<
        string,
        unknown
      >;

      expect(settings.tpm_threshold).toBe(1000);
      expect(settings.timeout_ms).toBeUndefined();
      expect(settings.circuit_breaker_enabled).toBeUndefined();
    });
  });
});
