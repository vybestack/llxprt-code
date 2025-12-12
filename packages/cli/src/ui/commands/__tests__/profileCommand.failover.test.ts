/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * @plan PLAN-20251212issue488
 * Phase 1: CLI Policy Parsing Tests (TDD - RED)
 *
 * Tests MUST be written FIRST, implementation SECOND.
 * These tests verify CLI parsing of the failover/roundrobin policy parameter.
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

describe('profileCommand - failover policy parsing', () => {
  let context: CommandContext;

  beforeEach(() => {
    vi.clearAllMocks();
    context = createMockCommandContext();
    runtimeMocks.listSavedProfiles.mockResolvedValue([
      'profile1',
      'profile2',
      'profile3',
    ]);
    runtimeMocks.getEphemeralSettings.mockReturnValue({
      'context-limit': 190000,
    });
  });

  const save = profileCommand.subCommands!.find((cmd) => cmd?.name === 'save')!;

  describe('Policy parameter parsing', () => {
    it('should parse policy "failover" from command', async () => {
      runtimeMocks.saveLoadBalancerProfile.mockResolvedValue(undefined);

      await save.action!(
        context,
        'loadbalancer lb-name failover profile1 profile2',
      );

      expect(runtimeMocks.saveLoadBalancerProfile).toHaveBeenCalledTimes(1);
      const savedProfile = runtimeMocks.saveLoadBalancerProfile.mock
        .calls[0][1] as LoadBalancerProfile;

      expect(savedProfile.policy).toBe('failover');
    });

    it('should parse policy "roundrobin" from command', async () => {
      runtimeMocks.saveLoadBalancerProfile.mockResolvedValue(undefined);

      await save.action!(
        context,
        'loadbalancer lb-name roundrobin profile1 profile2',
      );

      expect(runtimeMocks.saveLoadBalancerProfile).toHaveBeenCalledTimes(1);
      const savedProfile = runtimeMocks.saveLoadBalancerProfile.mock
        .calls[0][1] as LoadBalancerProfile;

      expect(savedProfile.policy).toBe('roundrobin');
    });

    it('should error when policy not specified', async () => {
      const result = await save.action!(
        context,
        'loadbalancer lb-name profile1 profile2',
      );

      expect(result).toBeDefined();
      expect(result).toHaveProperty('type', 'message');
      expect(result).toHaveProperty('messageType', 'error');
      const content = (result as { content: string }).content;
      // Gets usage error since parts.length < 5
      expect(content).toMatch(/Usage.*roundrobin.*failover/i);
    });

    it('should parse policy case-insensitively (FAILOVER)', async () => {
      runtimeMocks.saveLoadBalancerProfile.mockResolvedValue(undefined);

      await save.action!(
        context,
        'loadbalancer lb-name FAILOVER profile1 profile2',
      );

      expect(runtimeMocks.saveLoadBalancerProfile).toHaveBeenCalledTimes(1);
      const savedProfile = runtimeMocks.saveLoadBalancerProfile.mock
        .calls[0][1] as LoadBalancerProfile;

      expect(savedProfile.policy).toBe('failover');
    });

    it('should parse policy case-insensitively (Failover)', async () => {
      runtimeMocks.saveLoadBalancerProfile.mockResolvedValue(undefined);

      await save.action!(
        context,
        'loadbalancer lb-name Failover profile1 profile2',
      );

      expect(runtimeMocks.saveLoadBalancerProfile).toHaveBeenCalledTimes(1);
      const savedProfile = runtimeMocks.saveLoadBalancerProfile.mock
        .calls[0][1] as LoadBalancerProfile;

      expect(savedProfile.policy).toBe('failover');
    });

    it('should parse policy case-insensitively (RoundRobin)', async () => {
      runtimeMocks.saveLoadBalancerProfile.mockResolvedValue(undefined);

      await save.action!(
        context,
        'loadbalancer lb-name RoundRobin profile1 profile2',
      );

      expect(runtimeMocks.saveLoadBalancerProfile).toHaveBeenCalledTimes(1);
      const savedProfile = runtimeMocks.saveLoadBalancerProfile.mock
        .calls[0][1] as LoadBalancerProfile;

      expect(savedProfile.policy).toBe('roundrobin');
    });
  });

  describe('Profile validation with policy', () => {
    it('should error when only 1 profile provided after policy detection', async () => {
      const result = await save.action!(
        context,
        'loadbalancer lb-name failover profile1',
      );

      expect(result).toBeDefined();
      expect(result).toHaveProperty('type', 'message');
      expect(result).toHaveProperty('messageType', 'error');
      const content = (result as { content: string }).content;
      // Gets usage error since parts.length < 5
      expect(content).toMatch(/Usage.*roundrobin.*failover/i);
    });

    it('should succeed with 2 profiles and failover policy', async () => {
      runtimeMocks.saveLoadBalancerProfile.mockResolvedValue(undefined);

      const result = await save.action!(
        context,
        'loadbalancer lb-name failover profile1 profile2',
      );

      expect(result).toBeDefined();
      expect(result).toHaveProperty('type', 'message');
      expect(result).toHaveProperty('messageType', 'info');
    });

    it('should succeed with 3 profiles and failover policy', async () => {
      runtimeMocks.saveLoadBalancerProfile.mockResolvedValue(undefined);

      const result = await save.action!(
        context,
        'loadbalancer lb-name failover profile1 profile2 profile3',
      );

      expect(result).toBeDefined();
      expect(result).toHaveProperty('type', 'message');
      expect(result).toHaveProperty('messageType', 'info');
    });
  });

  describe('Saved profile structure', () => {
    it('should save profile with correct policy field (failover)', async () => {
      runtimeMocks.saveLoadBalancerProfile.mockResolvedValue(undefined);

      await save.action!(
        context,
        'loadbalancer lb-name failover profile1 profile2',
      );

      const savedProfile = runtimeMocks.saveLoadBalancerProfile.mock
        .calls[0][1] as LoadBalancerProfile;

      expect(savedProfile).toEqual({
        version: 1,
        type: 'loadbalancer',
        policy: 'failover',
        profiles: ['profile1', 'profile2'],
        provider: '',
        model: '',
        modelParams: {},
        ephemeralSettings: {
          'context-limit': 190000,
        },
      });
    });

    it('should save profile with correct policy field (roundrobin)', async () => {
      runtimeMocks.saveLoadBalancerProfile.mockResolvedValue(undefined);

      await save.action!(
        context,
        'loadbalancer lb-name roundrobin profile1 profile2',
      );

      const savedProfile = runtimeMocks.saveLoadBalancerProfile.mock
        .calls[0][1] as LoadBalancerProfile;

      expect(savedProfile).toEqual({
        version: 1,
        type: 'loadbalancer',
        policy: 'roundrobin',
        profiles: ['profile1', 'profile2'],
        provider: '',
        model: '',
        modelParams: {},
        ephemeralSettings: {
          'context-limit': 190000,
        },
      });
    });

    it('should preserve profile names correctly with policy', async () => {
      runtimeMocks.saveLoadBalancerProfile.mockResolvedValue(undefined);

      await save.action!(
        context,
        'loadbalancer lb-name failover profile1 profile2 profile3',
      );

      const savedProfile = runtimeMocks.saveLoadBalancerProfile.mock
        .calls[0][1] as LoadBalancerProfile;

      expect(savedProfile.profiles).toEqual([
        'profile1',
        'profile2',
        'profile3',
      ]);
      expect(savedProfile.policy).toBe('failover');
    });
  });

  describe('Success message includes policy', () => {
    it('should include policy in success message (failover)', async () => {
      runtimeMocks.saveLoadBalancerProfile.mockResolvedValue(undefined);

      const result = await save.action!(
        context,
        'loadbalancer myLB failover profile1 profile2',
      );

      expect(result).toBeDefined();
      expect(result).toHaveProperty('type', 'message');
      expect(result).toHaveProperty('messageType', 'info');
      const content = (result as { content: string }).content;
      expect(content).toMatch(/failover/i);
    });

    it('should include policy in success message (roundrobin)', async () => {
      runtimeMocks.saveLoadBalancerProfile.mockResolvedValue(undefined);

      const result = await save.action!(
        context,
        'loadbalancer myLB roundrobin profile1 profile2',
      );

      expect(result).toBeDefined();
      expect(result).toHaveProperty('type', 'message');
      expect(result).toHaveProperty('messageType', 'info');
      const content = (result as { content: string }).content;
      expect(content).toMatch(/roundrobin/i);
    });
  });

  describe('Edge cases', () => {
    it('should error when unknown word used instead of policy', async () => {
      runtimeMocks.listSavedProfiles.mockResolvedValue([
        'profile1',
        'profile2',
        'profile3',
        'notapolicy',
      ]);

      const result = await save.action!(
        context,
        'loadbalancer lb-name notapolicy profile1 profile2',
      );

      expect(result).toBeDefined();
      expect(result).toHaveProperty('type', 'message');
      expect(result).toHaveProperty('messageType', 'error');
      const content = (result as { content: string }).content;
      expect(content).toMatch(/Invalid policy.*notapolicy/i);
    });

    it('should error when not enough arguments provided', async () => {
      const result = await save.action!(
        context,
        'loadbalancer lb-name profile1',
      );

      expect(result).toBeDefined();
      expect(result).toHaveProperty('messageType', 'error');
    });

    it('should validate profile existence before saving with policy', async () => {
      runtimeMocks.listSavedProfiles.mockResolvedValue(['profile1']);

      const result = await save.action!(
        context,
        'loadbalancer lb-name failover profile1 nonexistent',
      );

      expect(result).toBeDefined();
      expect(result).toHaveProperty('messageType', 'error');
      const content = (result as { content: string }).content;
      expect(content).toContain('nonexistent');
    });
  });
});
