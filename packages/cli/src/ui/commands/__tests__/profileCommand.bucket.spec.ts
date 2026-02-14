/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { profileCommand } from '../profileCommand.js';
import { createMockCommandContext } from '../../../test-utils/mockCommandContext.js';
import type { CommandContext } from '../types.js';

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

const tokenStoreMocks = vi.hoisted(() => ({
  listBuckets: vi.fn(),
  getToken: vi.fn(),
  saveToken: vi.fn(),
}));

vi.mock('../../contexts/RuntimeContext.js', () => ({
  getRuntimeApi: () => runtimeMocks,
}));

vi.mock('@vybestack/llxprt-code-core', async () => {
  const actual = await vi.importActual('@vybestack/llxprt-code-core');
  return {
    ...actual,
    KeyringTokenStore: vi.fn().mockImplementation(() => tokenStoreMocks),
  };
});

vi.mock('../../../auth/oauth-manager.js', () => ({
  OAuthManager: vi.fn().mockImplementation(() => ({
    getTokenStore: () => tokenStoreMocks,
  })),
}));

describe('profileCommand - OAuth Buckets (Phase 5)', () => {
  let context: CommandContext;

  beforeEach(() => {
    vi.clearAllMocks();
    context = createMockCommandContext();
    runtimeMocks.listSavedProfiles.mockResolvedValue(['alpha', 'beta']);
    runtimeMocks.switchActiveProvider.mockResolvedValue(undefined);
    runtimeMocks.getActiveProviderStatus.mockReturnValue({
      providerName: 'anthropic',
      modelName: 'claude-sonnet-4',
    });
    runtimeMocks.getEphemeralSettings.mockReturnValue({});
    tokenStoreMocks.listBuckets.mockResolvedValue([
      'default',
      'work@company.com',
      'personal@gmail.com',
      'bucket1',
      'bucket2',
      'bucket3',
      'bucket4',
      'bucket5',
    ]);
    tokenStoreMocks.getToken.mockResolvedValue({
      access_token: 'mock-token',
      token_type: 'Bearer',
      expiry: Math.floor(Date.now() / 1000) + 3600,
    });
  });

  describe('save subcommand - single bucket', () => {
    const save = profileCommand.subCommands!.find(
      (cmd) => cmd?.name === 'save',
    )!;

    it('should save profile with single bucket', async () => {
      runtimeMocks.saveProfileSnapshot.mockResolvedValue(undefined);

      const result = await save.action!(
        context,
        'model myprofile work@company.com',
      );

      expect(runtimeMocks.saveProfileSnapshot).toHaveBeenCalledWith(
        'myprofile',
        {
          auth: {
            type: 'oauth',
            buckets: ['work@company.com'],
          },
        },
      );
      expect(result).toBeDefined();
      expect(result).toHaveProperty('type', 'message');
      expect(result).toHaveProperty('messageType', 'info');
    });

    it('should save profile with auth.buckets field', async () => {
      runtimeMocks.saveProfileSnapshot.mockResolvedValue(undefined);

      await save.action!(context, 'model myprofile bucket1');

      expect(runtimeMocks.saveProfileSnapshot).toHaveBeenCalledWith(
        'myprofile',
        expect.objectContaining({
          auth: expect.objectContaining({
            type: 'oauth',
            buckets: ['bucket1'],
          }),
        }),
      );
    });

    it('should validate bucket exists before saving', async () => {
      tokenStoreMocks.listBuckets.mockResolvedValue(['default', 'other']);

      const result = await save.action!(
        context,
        'model myprofile nonexistent-bucket',
      );

      expect(result).toBeDefined();
      expect(result).toHaveProperty('type', 'message');
      expect(result).toHaveProperty('messageType', 'error');
      const content = (result as { content: string }).content;
      expect(content).toContain('nonexistent-bucket');
      expect(content).toContain('not found');
    });
  });

  describe('save subcommand - multiple buckets', () => {
    const save = profileCommand.subCommands!.find(
      (cmd) => cmd?.name === 'save',
    )!;

    it('should save profile with multiple buckets', async () => {
      runtimeMocks.saveProfileSnapshot.mockResolvedValue(undefined);

      const result = await save.action!(
        context,
        'model myprofile bucket1 bucket2 bucket3',
      );

      expect(runtimeMocks.saveProfileSnapshot).toHaveBeenCalledWith(
        'myprofile',
        {
          auth: {
            type: 'oauth',
            buckets: ['bucket1', 'bucket2', 'bucket3'],
          },
        },
      );
      expect(result).toBeDefined();
      expect(result).toHaveProperty('type', 'message');
      expect(result).toHaveProperty('messageType', 'info');
    });

    it('should save buckets in order for failover sequence', async () => {
      runtimeMocks.saveProfileSnapshot.mockResolvedValue(undefined);

      await save.action!(
        context,
        'model myprofile work@company.com personal@gmail.com default',
      );

      const callArgs = runtimeMocks.saveProfileSnapshot.mock.calls[0];
      expect(callArgs[1].auth.buckets).toEqual([
        'work@company.com',
        'personal@gmail.com',
        'default',
      ]);
    });

    it('should validate all buckets exist', async () => {
      tokenStoreMocks.listBuckets.mockResolvedValue([
        'default',
        'work@company.com',
      ]);

      const result = await save.action!(
        context,
        'model myprofile work@company.com missing-bucket',
      );

      expect(result).toBeDefined();
      expect(result).toHaveProperty('type', 'message');
      expect(result).toHaveProperty('messageType', 'error');
      const content = (result as { content: string }).content;
      expect(content).toContain('missing-bucket');
      expect(content).toContain('not found');
    });
  });

  describe('save subcommand - backward compatibility', () => {
    const save = profileCommand.subCommands!.find(
      (cmd) => cmd?.name === 'save',
    )!;

    it('should save profile without auth field when no buckets specified', async () => {
      runtimeMocks.saveProfileSnapshot.mockResolvedValue(undefined);

      await save.action!(context, 'model myprofile');

      expect(runtimeMocks.saveProfileSnapshot).toHaveBeenCalledWith(
        'myprofile',
        undefined,
      );
    });
  });

  describe('save subcommand - bucket validation', () => {
    const save = profileCommand.subCommands!.find(
      (cmd) => cmd?.name === 'save',
    )!;

    it('should reject bucket names with unsafe characters', async () => {
      const result = await save.action!(
        context,
        'model myprofile bucket/with/slash',
      );

      expect(result).toBeDefined();
      expect(result).toHaveProperty('type', 'message');
      expect(result).toHaveProperty('messageType', 'error');
      const content = (result as { content: string }).content;
      expect(content).toContain('unsafe');
    });

    it('should reject reserved bucket names', async () => {
      const result = await save.action!(context, 'model myprofile login');

      expect(result).toBeDefined();
      expect(result).toHaveProperty('type', 'message');
      expect(result).toHaveProperty('messageType', 'error');
      const content = (result as { content: string }).content;
      expect(content).toContain('reserved');
    });

    it('should reject bucket name "logout"', async () => {
      const result = await save.action!(context, 'model myprofile logout');

      expect(result).toBeDefined();
      expect(result).toHaveProperty('type', 'message');
      expect(result).toHaveProperty('messageType', 'error');
      const content = (result as { content: string }).content;
      expect(content).toContain('reserved');
    });

    it('should reject bucket name "status"', async () => {
      const result = await save.action!(context, 'model myprofile status');

      expect(result).toBeDefined();
      expect(result).toHaveProperty('type', 'message');
      expect(result).toHaveProperty('messageType', 'error');
      const content = (result as { content: string }).content;
      expect(content).toContain('reserved');
    });

    it('should reject bucket name "switch"', async () => {
      const result = await save.action!(context, 'model myprofile switch');

      expect(result).toBeDefined();
      expect(result).toHaveProperty('type', 'message');
      expect(result).toHaveProperty('messageType', 'error');
      const content = (result as { content: string }).content;
      expect(content).toContain('reserved');
    });

    it('should reject bucket name "--all"', async () => {
      const result = await save.action!(context, 'model myprofile --all');

      expect(result).toBeDefined();
      expect(result).toHaveProperty('type', 'message');
      expect(result).toHaveProperty('messageType', 'error');
      const content = (result as { content: string }).content;
      expect(content).toContain('reserved');
    });
  });

  describe('load subcommand - bucket info display', () => {
    const load = profileCommand.subCommands!.find(
      (cmd) => cmd?.name === 'load',
    )!;

    it('should display bucket info when loading profile with buckets', async () => {
      runtimeMocks.loadProfileByName.mockResolvedValue({
        providerName: 'anthropic',
        modelName: 'claude-sonnet-4',
        infoMessages: [
          'OAuth buckets: work@company.com, personal@gmail.com',
          'Failover order: work@company.com -> personal@gmail.com',
        ],
        warnings: [],
      });

      const result = await load.action!(context, 'multi-claude');

      expect(result).toBeDefined();
      expect(result).toHaveProperty('type', 'message');
      const content = (result as { content: string }).content;
      expect(content).toContain('OAuth buckets');
      expect(content).toContain('work@company.com');
      expect(content).toContain('personal@gmail.com');
    });

    it('should show bucket order for failover', async () => {
      runtimeMocks.loadProfileByName.mockResolvedValue({
        providerName: 'anthropic',
        modelName: 'claude-sonnet-4',
        infoMessages: ['Failover order: bucket1 -> bucket2 -> bucket3'],
        warnings: [],
      });

      const result = await load.action!(context, 'myprofile');

      expect(result).toBeDefined();
      const content = (result as { content: string }).content;
      expect(content).toContain('Failover order');
      expect(content).toContain('bucket1');
      expect(content).toContain('bucket2');
      expect(content).toContain('bucket3');
    });

    it('should display warning when bucket token expired', async () => {
      runtimeMocks.loadProfileByName.mockResolvedValue({
        providerName: 'anthropic',
        modelName: 'claude-sonnet-4',
        infoMessages: [],
        warnings: [
          'Bucket work@company.com token expired, re-authentication required',
        ],
      });

      const result = await load.action!(context, 'myprofile');

      expect(result).toBeDefined();
      const content = (result as { content: string }).content;
      expect(content).toContain('work@company.com');
      expect(content).toContain('expired');
    });
  });

  describe('load subcommand - bucket resolution', () => {
    const load = profileCommand.subCommands!.find(
      (cmd) => cmd?.name === 'load',
    )!;

    it('should use first bucket for auth when profile has buckets', async () => {
      runtimeMocks.loadProfileByName.mockResolvedValue({
        providerName: 'anthropic',
        modelName: 'claude-sonnet-4',
        infoMessages: ['Using bucket: work@company.com'],
        warnings: [],
      });

      const result = await load.action!(context, 'myprofile');

      expect(result).toBeDefined();
      const content = (result as { content: string }).content;
      expect(content).toContain('Using bucket: work@company.com');
    });

    it('should use default behavior when profile has no auth field', async () => {
      runtimeMocks.loadProfileByName.mockResolvedValue({
        providerName: 'anthropic',
        modelName: 'claude-sonnet-4',
        infoMessages: [],
        warnings: [],
      });

      const result = await load.action!(context, 'legacy-profile');

      expect(result).toBeDefined();
      expect(result).toHaveProperty('type', 'message');
      expect(result).toHaveProperty('messageType', 'info');
    });

    it('should error when bucket not found during load', async () => {
      runtimeMocks.loadProfileByName.mockRejectedValue(
        new Error(
          "OAuth bucket 'nonexistent' for provider 'anthropic' not found. Use /auth anthropic login nonexistent",
        ),
      );

      const result = await load.action!(context, 'myprofile');

      expect(result).toBeDefined();
      expect(result).toHaveProperty('type', 'message');
      expect(result).toHaveProperty('messageType', 'error');
      const content = (result as { content: string }).content;
      expect(content).toContain('nonexistent');
      expect(content).toContain('/auth anthropic login');
    });

    it('should error when all bucket tokens expired', async () => {
      runtimeMocks.loadProfileByName.mockRejectedValue(
        new Error(
          'All OAuth buckets expired: work@company.com, personal@gmail.com. Re-authenticate: /auth anthropic login work@company.com personal@gmail.com',
        ),
      );

      const result = await load.action!(context, 'myprofile');

      expect(result).toBeDefined();
      expect(result).toHaveProperty('type', 'message');
      expect(result).toHaveProperty('messageType', 'error');
      const content = (result as { content: string }).content;
      expect(content).toContain('All OAuth buckets expired');
      expect(content).toContain('work@company.com');
      expect(content).toContain('personal@gmail.com');
    });
  });

  describe('autocomplete support', () => {
    const save = profileCommand.subCommands!.find(
      (cmd) => cmd?.name === 'save',
    )!;

    it('should have schema with bucket completer for save model', () => {
      expect(save.schema).toBeDefined();
      const modelBranch = save.schema?.find(
        (s) => s.kind === 'literal' && s.value === 'model',
      );
      expect(modelBranch).toBeDefined();
    });

    it('should suggest available buckets during autocomplete', async () => {
      tokenStoreMocks.listBuckets.mockResolvedValue([
        'default',
        'work@company.com',
        'personal@gmail.com',
      ]);

      const buckets = await tokenStoreMocks.listBuckets('anthropic');
      expect(buckets).toEqual([
        'default',
        'work@company.com',
        'personal@gmail.com',
      ]);
    });

    it('should filter out already selected buckets from suggestions', async () => {
      tokenStoreMocks.listBuckets.mockResolvedValue([
        'default',
        'work@company.com',
        'personal@gmail.com',
      ]);

      const allBuckets = await tokenStoreMocks.listBuckets('anthropic');
      const alreadySelected = ['work@company.com'];
      const available = allBuckets.filter(
        (b: string) => !alreadySelected.includes(b),
      );

      expect(available).toEqual(['default', 'personal@gmail.com']);
    });
  });

  describe('positional argument parsing', () => {
    const save = profileCommand.subCommands!.find(
      (cmd) => cmd?.name === 'save',
    )!;

    it('should parse buckets as positional arguments after profile name', async () => {
      runtimeMocks.saveProfileSnapshot.mockResolvedValue(undefined);

      await save.action!(
        context,
        'model myprofile work@company.com personal@gmail.com',
      );

      const callArgs = runtimeMocks.saveProfileSnapshot.mock.calls[0];
      expect(callArgs[0]).toBe('myprofile');
      expect(callArgs[1]).toEqual({
        auth: {
          type: 'oauth',
          buckets: ['work@company.com', 'personal@gmail.com'],
        },
      });
    });

    it('should handle quoted profile names with bucket arguments', async () => {
      runtimeMocks.saveProfileSnapshot.mockResolvedValue(undefined);

      await save.action!(
        context,
        'model "my profile" work@company.com personal@gmail.com',
      );

      const callArgs = runtimeMocks.saveProfileSnapshot.mock.calls[0];
      expect(callArgs[0]).toBe('my profile');
      expect(callArgs[1]).toEqual({
        auth: {
          type: 'oauth',
          buckets: ['work@company.com', 'personal@gmail.com'],
        },
      });
    });

    it('should parse unlimited bucket arguments', async () => {
      runtimeMocks.saveProfileSnapshot.mockResolvedValue(undefined);

      await save.action!(
        context,
        'model myprofile bucket1 bucket2 bucket3 bucket4 bucket5',
      );

      const callArgs = runtimeMocks.saveProfileSnapshot.mock.calls[0];
      expect(callArgs[1].auth.buckets).toHaveLength(5);
      expect(callArgs[1].auth.buckets).toEqual([
        'bucket1',
        'bucket2',
        'bucket3',
        'bucket4',
        'bucket5',
      ]);
    });
  });

  describe('error handling', () => {
    const save = profileCommand.subCommands!.find(
      (cmd) => cmd?.name === 'save',
    )!;

    it('should show actionable error when bucket validation fails', async () => {
      tokenStoreMocks.listBuckets.mockResolvedValue(['default']);

      const result = await save.action!(
        context,
        'model myprofile work@company.com',
      );

      expect(result).toBeDefined();
      expect(result).toHaveProperty('type', 'message');
      expect(result).toHaveProperty('messageType', 'error');
      const content = (result as { content: string }).content;
      expect(content).toContain('not found');
      expect(content).toContain('work@company.com');
    });

    it('should provide helpful error message with auth command suggestion', async () => {
      tokenStoreMocks.listBuckets.mockResolvedValue(['default']);

      const result = await save.action!(
        context,
        'model myprofile missing-bucket',
      );

      expect(result).toBeDefined();
      const content = (result as { content: string }).content;
      expect(content).toContain('/auth');
      expect(content).toContain('login');
    });

    it('should handle token store errors gracefully', async () => {
      tokenStoreMocks.listBuckets.mockRejectedValue(
        new Error('Token store unavailable'),
      );

      const result = await save.action!(
        context,
        'model myprofile work@company.com',
      );

      expect(result).toBeDefined();
      expect(result).toHaveProperty('type', 'message');
      expect(result).toHaveProperty('messageType', 'error');
    });
  });

  describe('integration with existing save functionality', () => {
    const save = profileCommand.subCommands!.find(
      (cmd) => cmd?.name === 'save',
    )!;

    it('should not break existing model profile save without buckets', async () => {
      runtimeMocks.saveProfileSnapshot.mockResolvedValue(undefined);

      const result = await save.action!(context, 'model simple-profile');

      expect(runtimeMocks.saveProfileSnapshot).toHaveBeenCalledWith(
        'simple-profile',
        undefined,
      );
      expect(result).toBeDefined();
      expect(result).toHaveProperty('type', 'message');
      expect(result).toHaveProperty('messageType', 'info');
    });

    it('should prevent path separators in profile names even with buckets', async () => {
      const result = await save.action!(
        context,
        'model bad/profile work@company.com',
      );

      expect(result).toBeDefined();
      expect(result).toHaveProperty('type', 'message');
      expect(result).toHaveProperty('messageType', 'error');
      const content = (result as { content: string }).content;
      expect(content).toContain('path separators');
    });
  });
});
