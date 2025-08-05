/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { profileCommand } from './profileCommand.js';
import { createMockCommandContext } from '../../test-utils/mockCommandContext.js';
import { CommandContext } from './types.js';
import { ProfileManager } from '@vybestack/llxprt-code-core';
import * as fs from 'fs';

// Mock the ProfileManager
vi.mock('@vybestack/llxprt-code-core', async () => {
  const actual = await vi.importActual('@vybestack/llxprt-code-core');
  return {
    ...actual,
    ProfileManager: vi.fn(),
  };
});

// Mock fs module
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    default: actual,
    promises: {
      readFile: vi.fn(),
    },
  };
});

// Mock os module
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    homedir: vi.fn(() => '/home/user'),
  };
});

describe('profileCommand', () => {
  let context: CommandContext;
  let mockProfileManager: {
    listProfiles: ReturnType<typeof vi.fn>;
    saveProfile: ReturnType<typeof vi.fn>;
    loadProfile: ReturnType<typeof vi.fn>;
    deleteProfile: ReturnType<typeof vi.fn>;
  };
  let mockProvider: {
    name: string;
    setModel: ReturnType<typeof vi.fn>;
    setApiKey: ReturnType<typeof vi.fn>;
    setBaseUrl: ReturnType<typeof vi.fn>;
    setModelParams: ReturnType<typeof vi.fn>;
    getModelParams: ReturnType<typeof vi.fn>;
  };
  let mockProviderManager: {
    getActiveProvider: ReturnType<typeof vi.fn>;
    setActiveProvider: ReturnType<typeof vi.fn>;
  };
  let mockGeminiClient: {
    setCompressionSettings: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();

    // Create mock profile manager
    mockProfileManager = {
      listProfiles: vi.fn().mockResolvedValue(['test-profile', 'prod-profile']),
      saveProfile: vi.fn().mockResolvedValue(undefined),
      loadProfile: vi.fn().mockResolvedValue({
        version: 1,
        provider: 'openai',
        model: 'gpt-4',
        modelParams: { temperature: 0.7 },
        ephemeralSettings: {
          'context-limit': 100000,
          'compression-threshold': 0.8,
          'base-url': 'https://api.openai.com/v1',
        },
      }),
      deleteProfile: vi.fn().mockResolvedValue(undefined),
    };

    // Mock the ProfileManager constructor
    (ProfileManager as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      () => mockProfileManager,
    );

    // Create mock provider
    mockProvider = {
      name: 'openai',
      setModel: vi.fn(),
      setApiKey: vi.fn(),
      setBaseUrl: vi.fn(),
      setModelParams: vi.fn(),
      getModelParams: vi.fn().mockReturnValue({}),
    };

    // Create mock provider manager
    mockProviderManager = {
      getActiveProvider: vi.fn().mockReturnValue(mockProvider),
      setActiveProvider: vi.fn(),
    };

    // Create mock GeminiClient
    mockGeminiClient = {
      setCompressionSettings: vi.fn(),
    };

    // Create context with mocks
    context = createMockCommandContext({
      services: {
        config: {
          getProvider: vi.fn().mockReturnValue('openai'),
          getModel: vi.fn().mockReturnValue('gpt-4'),
          setProvider: vi.fn(),
          setModel: vi.fn(),
          getProviderManager: vi.fn().mockReturnValue(mockProviderManager),
          setProviderManager: vi.fn(),
          getEphemeralSettings: vi.fn().mockReturnValue({}),
          setEphemeralSetting: vi.fn(),
          getEphemeralSetting: vi.fn(),
          getGeminiClient: vi.fn().mockReturnValue(mockGeminiClient),
          getContentGeneratorConfig: vi.fn().mockReturnValue({}),
          refreshAuth: vi.fn().mockResolvedValue(undefined),
        } as unknown as CommandContext['services']['config'],
        settings: {
          merged: {},
          setValue: vi.fn(),
        } as unknown as CommandContext['services']['settings'],
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('profile load command', () => {
    const loadCommand = profileCommand.subCommands![1]; // load is the second subcommand

    it('should load profile and apply compression settings', async () => {
      const result = await loadCommand.action!(context, 'test-profile');

      // Verify profile was loaded
      expect(mockProfileManager.loadProfile).toHaveBeenCalledWith(
        'test-profile',
      );

      // Verify compression settings were applied
      expect(mockGeminiClient.setCompressionSettings).toHaveBeenCalledWith(
        0.8, // compression-threshold
        100000, // context-limit
      );

      // Verify success message
      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: "Profile 'test-profile' loaded",
      });
    });

    it('should apply only context-limit when compression-threshold is not set', async () => {
      mockProfileManager.loadProfile.mockResolvedValue({
        version: 1,
        provider: 'openai',
        model: 'gpt-4',
        modelParams: {},
        ephemeralSettings: {
          'context-limit': 50000,
          // No compression-threshold
        },
      });

      await loadCommand.action!(context, 'test-profile');

      expect(mockGeminiClient.setCompressionSettings).toHaveBeenCalledWith(
        undefined, // compression-threshold not set
        50000, // context-limit
      );
    });

    it('should apply only compression-threshold when context-limit is not set', async () => {
      mockProfileManager.loadProfile.mockResolvedValue({
        version: 1,
        provider: 'openai',
        model: 'gpt-4',
        modelParams: {},
        ephemeralSettings: {
          'compression-threshold': 0.6,
          // No context-limit
        },
      });

      await loadCommand.action!(context, 'test-profile');

      expect(mockGeminiClient.setCompressionSettings).toHaveBeenCalledWith(
        0.6, // compression-threshold
        undefined, // context-limit not set
      );
    });

    it('should clear existing ephemeral settings before loading', async () => {
      await loadCommand.action!(context, 'test-profile');

      // Verify ephemeral settings were cleared
      const expectedClears = [
        'auth-key',
        'auth-keyfile',
        'context-limit',
        'compression-threshold',
        'base-url',
        'tool-format',
        'api-version',
        'custom-headers',
      ];

      expectedClears.forEach((key) => {
        expect(
          context.services.config.setEphemeralSetting,
        ).toHaveBeenCalledWith(key, undefined);
      });
    });

    it('should reset compression settings when cleared', async () => {
      await loadCommand.action!(context, 'test-profile');

      // Verify compression settings were reset with undefined values first
      expect(mockGeminiClient.setCompressionSettings).toHaveBeenCalledWith(
        undefined,
        undefined,
      );
    });

    it('should handle base-url value of "none" correctly', async () => {
      mockProfileManager.loadProfile.mockResolvedValue({
        version: 1,
        provider: 'openai',
        model: 'gpt-4',
        modelParams: {},
        ephemeralSettings: {
          'base-url': 'none',
        },
      });

      await loadCommand.action!(context, 'test-profile');

      // Verify base URL was cleared (set to undefined)
      expect(mockProvider.setBaseUrl).toHaveBeenCalledWith(undefined);
    });

    it('should apply model parameters after clearing existing ones', async () => {
      mockProfileManager.loadProfile.mockResolvedValue({
        version: 1,
        provider: 'openai',
        model: 'gpt-4',
        modelParams: {
          temperature: 0.9,
          max_tokens: 2048,
        },
        ephemeralSettings: {},
      });

      await loadCommand.action!(context, 'test-profile');

      // Verify model params were cleared first
      expect(mockProvider.setModelParams).toHaveBeenNthCalledWith(1, undefined);

      // Then set with new values
      expect(mockProvider.setModelParams).toHaveBeenNthCalledWith(2, {
        temperature: 0.9,
        max_tokens: 2048,
      });
    });

    it('should load API key from keyfile when specified', async () => {
      mockProfileManager.loadProfile.mockResolvedValue({
        version: 1,
        provider: 'openai',
        model: 'gpt-4',
        modelParams: {},
        ephemeralSettings: {
          'auth-keyfile': '~/.keys/api-key',
        },
      });

      (fs.promises.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(
        'sk-test-key-123\n',
      );

      await loadCommand.action!(context, 'test-profile');

      // Verify file was read with expanded path
      expect(fs.promises.readFile).toHaveBeenCalledWith(
        '/home/user/.keys/api-key',
        'utf-8',
      );

      // Verify API key was set
      expect(mockProvider.setApiKey).toHaveBeenCalledWith('sk-test-key-123');
    });

    it('should handle keyfile read errors gracefully', async () => {
      mockProfileManager.loadProfile.mockResolvedValue({
        version: 1,
        provider: 'openai',
        model: 'gpt-4',
        modelParams: {},
        ephemeralSettings: {
          'auth-keyfile': '~/.keys/missing-file',
        },
      });

      (fs.promises.readFile as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('ENOENT'),
      );

      // Should not throw, just log error
      const result = await loadCommand.action!(context, 'test-profile');

      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: "Profile 'test-profile' loaded",
      });
    });
  });

  describe('profile save command', () => {
    const saveCommand = profileCommand.subCommands![0]; // save is the first subcommand

    it('should save compression settings from ephemeral settings', async () => {
      context.services.config.getEphemeralSettings = vi.fn().mockReturnValue({
        'context-limit': 75000,
        'compression-threshold': 0.65,
        'base-url': 'https://custom.api.com',
      });

      await saveCommand.action!(context, 'new-profile');

      expect(mockProfileManager.saveProfile).toHaveBeenCalledWith(
        'new-profile',
        {
          version: 1,
          provider: 'openai',
          model: 'gpt-4',
          modelParams: {},
          ephemeralSettings: {
            'context-limit': 75000,
            'compression-threshold': 0.65,
            'base-url': 'https://custom.api.com',
          },
        },
      );
    });

    it('should include model params when saving', async () => {
      mockProvider.getModelParams.mockReturnValue({
        temperature: 0.5,
        enable_thinking: true,
      });

      await saveCommand.action!(context, 'model-test');

      expect(mockProfileManager.saveProfile).toHaveBeenCalledWith(
        'model-test',
        {
          version: 1,
          provider: 'openai',
          model: 'gpt-4',
          modelParams: {
            temperature: 0.5,
            enable_thinking: true,
          },
          ephemeralSettings: expect.any(Object),
        },
      );
    });

    it('should save tool-output settings from ephemeral settings', async () => {
      context.services.config.getEphemeralSettings = vi.fn().mockReturnValue({
        'tool-output-max-items': 100,
        'tool-output-max-tokens': 75000,
        'tool-output-truncate-mode': 'truncate',
        'tool-output-item-size-limit': 1048576,
        'max-prompt-tokens': 150000,
      });

      await saveCommand.action!(context, 'tool-settings-profile');

      expect(mockProfileManager.saveProfile).toHaveBeenCalledWith(
        'tool-settings-profile',
        {
          version: 1,
          provider: 'openai',
          model: 'gpt-4',
          modelParams: {},
          ephemeralSettings: {
            'tool-output-max-items': 100,
            'tool-output-max-tokens': 75000,
            'tool-output-truncate-mode': 'truncate',
            'tool-output-item-size-limit': 1048576,
            'max-prompt-tokens': 150000,
          },
        },
      );
    });
  });

  describe('profile load command with tool-output settings', () => {
    const loadCommand = profileCommand.subCommands![1];

    it('should load profile with tool-output settings', async () => {
      mockProfileManager.loadProfile.mockResolvedValue({
        version: 1,
        provider: 'openai',
        model: 'gpt-4',
        modelParams: {},
        ephemeralSettings: {
          'tool-output-max-items': 100,
          'tool-output-max-tokens': 75000,
          'tool-output-truncate-mode': 'truncate',
          'tool-output-item-size-limit': 1048576,
          'max-prompt-tokens': 150000,
        },
      });

      const result = await loadCommand.action!(
        context,
        'tool-settings-profile',
      );

      // Verify ephemeral settings were applied
      expect(context.services.config.setEphemeralSetting).toHaveBeenCalledWith(
        'tool-output-max-items',
        100,
      );
      expect(context.services.config.setEphemeralSetting).toHaveBeenCalledWith(
        'tool-output-max-tokens',
        75000,
      );
      expect(context.services.config.setEphemeralSetting).toHaveBeenCalledWith(
        'tool-output-truncate-mode',
        'truncate',
      );
      expect(context.services.config.setEphemeralSetting).toHaveBeenCalledWith(
        'tool-output-item-size-limit',
        1048576,
      );
      expect(context.services.config.setEphemeralSetting).toHaveBeenCalledWith(
        'max-prompt-tokens',
        150000,
      );

      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: "Profile 'tool-settings-profile' loaded",
      });
    });
  });
});
