/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { profileCommand } from './profileCommand.js';
import { createMockCommandContext } from '../../test-utils/mockCommandContext.js';
import type { CommandContext } from './types.js';

const runtimeMocks = vi.hoisted(() => ({
  saveProfileSnapshot: vi.fn(),
  loadProfileByName: vi.fn(),
  deleteProfileByName: vi.fn(),
  listSavedProfiles: vi.fn(),
  setDefaultProfileName: vi.fn(),
  getActiveProfileName: vi.fn(),
  switchActiveProvider: vi.fn(),
  getActiveProviderStatus: vi.fn(),
  saveLoadBalancerProfile: vi.fn(),
  getEphemeralSettings: vi.fn(),
}));

vi.mock('../contexts/RuntimeContext.js', () => ({
  getRuntimeApi: () => runtimeMocks,
}));

describe('profileCommand', () => {
  let context: CommandContext;

  beforeEach(() => {
    vi.clearAllMocks();
    context = createMockCommandContext();
    runtimeMocks.listSavedProfiles.mockResolvedValue(['alpha', 'beta']);
    runtimeMocks.switchActiveProvider.mockResolvedValue(undefined);
    runtimeMocks.getActiveProviderStatus.mockReturnValue({
      providerName: 'gemini',
      modelName: 'gemini-1.5-pro',
    });
  });

  describe('save subcommand', () => {
    const save = profileCommand.subCommands!.find(
      (cmd) => cmd?.name === 'save',
    )!;

    it('saves model profile with provided name', async () => {
      await save.action!(context, 'model demo');
      expect(runtimeMocks.saveProfileSnapshot).toHaveBeenCalledWith(
        'demo',
        undefined,
      );
    });

    it('shows usage when no args provided', async () => {
      const result = await save.action!(context, '');
      expect(result).toBeDefined();
      expect(result).toHaveProperty('type', 'message');
      expect(result).toHaveProperty('messageType', 'error');
      const content = (result as { content: string }).content;
      expect(content).toContain('Usage');
    });

    it('shows error for unknown profile type', async () => {
      const result = await save.action!(context, 'unknown myprofile');
      expect(result).toBeDefined();
      expect(result).toHaveProperty('type', 'message');
      expect(result).toHaveProperty('messageType', 'error');
    });
  });

  describe('load subcommand', () => {
    const load = profileCommand.subCommands!.find(
      (cmd) => cmd?.name === 'load',
    )!;

    it('loads profile and surfaces info messages', async () => {
      runtimeMocks.loadProfileByName.mockResolvedValue({
        providerName: 'openai',
        modelName: 'gpt-4',
        infoMessages: ['message one'],
        warnings: ['fallback provider used'],
        providerChanged: true,
      });

      const result = await load.action!(context, 'demo');
      expect(runtimeMocks.loadProfileByName).toHaveBeenCalledWith('demo');
      expect(runtimeMocks.switchActiveProvider).toHaveBeenCalledWith('openai');
      expect(result?.type).toBe('message');
      expect(result).toBeDefined();
      expect((result as { content: string }).content).toContain('message one');
      expect((result as { content: string }).content).toContain(
        'fallback provider used',
      );
    });

    it('refreshes Gemini tools after profile load', async () => {
      const setToolsSpy = vi.fn();
      const providerManagerMock = {
        setActiveProvider: vi.fn(),
        getActiveProvider: vi.fn().mockReturnValue({ name: 'openai' }),
      };

      const contextWithConfig = createMockCommandContext({
        services: {
          config: {
            getGeminiClient: () => ({ setTools: setToolsSpy }),
            getProviderManager: () => providerManagerMock,
            setProvider: vi.fn(),
          },
        },
      });

      runtimeMocks.loadProfileByName.mockResolvedValue({
        providerName: 'openai',
        modelName: 'gpt-4',
        infoMessages: [],
      });

      await load.action!(contextWithConfig, 'demo');
      expect(setToolsSpy).toHaveBeenCalled();
    });
  });

  describe('delete subcommand', () => {
    const del = profileCommand.subCommands!.find(
      (cmd) => cmd?.name === 'delete',
    )!;

    it('deletes named profile', async () => {
      await del.action!(context, 'demo');
      expect(runtimeMocks.deleteProfileByName).toHaveBeenCalledWith('demo');
    });
  });

  describe('set-default subcommand', () => {
    const setDefault = profileCommand.subCommands!.find(
      (cmd) => cmd?.name === 'set-default',
    )!;

    it('persists default profile name', async () => {
      await setDefault.action!(context, 'alpha');
      expect(runtimeMocks.setDefaultProfileName).toHaveBeenCalledWith('alpha');
    });

    it('clears default when none specified', async () => {
      await setDefault.action!(context, 'none');
      expect(runtimeMocks.setDefaultProfileName).toHaveBeenCalledWith(null);
    });
  });

  describe('list subcommand', () => {
    const list = profileCommand.subCommands!.find(
      (cmd) => cmd?.name === 'list',
    )!;

    it('opens the profile list dialog', async () => {
      const result = await list.action!(context, '');
      expect(result?.type).toBe('dialog');
      expect((result as { dialog: string }).dialog).toBe('profileList');
    });
  });

  describe('save subcommand - load balancer', () => {
    const save = profileCommand.subCommands!.find(
      (cmd) => cmd?.name === 'save',
    )!;

    beforeEach(() => {
      runtimeMocks.listSavedProfiles.mockResolvedValue([
        'profile1',
        'profile2',
        'profile3',
      ]);
      runtimeMocks.getEphemeralSettings.mockReturnValue({});
    });

    it('saves load balancer profile with selected profiles', async () => {
      runtimeMocks.saveLoadBalancerProfile.mockResolvedValue(undefined);

      const result = await save.action!(
        context,
        'loadbalancer lb-profile roundrobin profile1 profile2',
      );

      expect(runtimeMocks.saveLoadBalancerProfile).toHaveBeenCalledWith(
        'lb-profile',
        {
          version: 1,
          type: 'loadbalancer',
          policy: 'roundrobin',
          profiles: ['profile1', 'profile2'],
          provider: '',
          model: '',
          modelParams: {},
          ephemeralSettings: {},
        },
      );
      expect(result).toBeDefined();
      expect(result).toHaveProperty('type', 'message');
      expect(result).toHaveProperty(
        'content',
        "Load balancer profile 'lb-profile' saved with 2 profiles (policy: roundrobin)",
      );
    });

    it('requires at least 2 profiles for load balancer', async () => {
      const result = await save.action!(
        context,
        'loadbalancer lb-profile roundrobin profile1',
      );

      expect(result).toBeDefined();
      expect(result).toHaveProperty('type', 'message');
      expect(result).toHaveProperty('messageType', 'error');
      const content = (result as { content: string }).content;
      // Gets usage error since parts.length < 5
      expect(content).toMatch(/Usage.*roundrobin.*failover/i);
    });

    it('validates profile names exist', async () => {
      runtimeMocks.listSavedProfiles.mockResolvedValue(['profile1']);

      const result = await save.action!(
        context,
        'loadbalancer lb-profile roundrobin profile1 nonexistent',
      );

      expect(result).toBeDefined();
      expect(result).toHaveProperty('type', 'message');
      expect(result).toHaveProperty('messageType', 'error');
      const content = (result as { content: string }).content;
      expect(content).toContain('Profile nonexistent does not exist');
    });

    it('prevents circular references in load balancer profiles', async () => {
      runtimeMocks.listSavedProfiles.mockResolvedValue([
        'profile1',
        'lb-existing',
      ]);
      runtimeMocks.saveLoadBalancerProfile.mockRejectedValue(
        new Error(
          "LoadBalancer profile 'lb-new' cannot reference another LoadBalancer profile 'lb-existing'",
        ),
      );

      const result = await save.action!(
        context,
        'loadbalancer lb-new roundrobin profile1 lb-existing',
      );

      expect(result).toBeDefined();
      expect(result).toHaveProperty('type', 'message');
      expect(result).toHaveProperty('messageType', 'error');
      const content = (result as { content: string }).content;
      expect(content).toContain('cannot reference another LoadBalancer');
    });

    it('handles save errors gracefully', async () => {
      runtimeMocks.saveLoadBalancerProfile.mockRejectedValue(
        new Error('disk full'),
      );

      const result = await save.action!(
        context,
        'loadbalancer lb-profile roundrobin profile1 profile2',
      );

      expect(result).toBeDefined();
      expect(result).toHaveProperty('type', 'message');
      expect(result).toHaveProperty('messageType', 'error');
      const content = (result as { content: string }).content;
      expect(content).toContain('disk full');
    });
  });
});
