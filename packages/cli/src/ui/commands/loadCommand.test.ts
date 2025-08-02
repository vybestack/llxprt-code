/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

// Mock fs/promises
vi.mock('fs/promises');

// Mock os before any other imports
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return {
    ...actual,
    default: {
      ...actual.default,
      homedir: vi.fn().mockReturnValue('/home/testuser'),
    },
    homedir: vi.fn().mockReturnValue('/home/testuser'),
  };
});

// Import after mocks are set up
import { loadCommand } from './loadCommand.js';
import { CommandContext } from './types.js';
import { createMockCommandContext } from '../../test-utils/mockCommandContext.js';
import { IProvider, Profile, AuthType } from '@vybestack/llxprt-code-core';
import { SettingScope } from '../../config/settings.js';

// Mock ProfileManager
vi.mock('@vybestack/llxprt-code-core', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@vybestack/llxprt-code-core')>();
  return {
    ...actual,
    ProfileManager: vi.fn().mockImplementation(() => ({
      loadProfile: vi.fn().mockImplementation(async (name: string) => {
        // Simulate the ProfileManager's behavior
        const filePath = path.join(
          os.homedir(),
          '.llxprt',
          'profiles',
          `${name}.json`,
        );
        try {
          const content = await fs.readFile(filePath, 'utf8');
          const profile = JSON.parse(content);

          // Validate profile structure
          if (
            !profile.version ||
            !profile.provider ||
            !profile.model ||
            !profile.modelParams ||
            !profile.ephemeralSettings
          ) {
            throw new Error('Profile is invalid: missing required fields');
          }
          if (profile.version !== 1) {
            throw new Error('Unsupported profile version');
          }

          return profile;
        } catch (error) {
          if (error instanceof Error) {
            if (error.message.includes('ENOENT')) {
              throw new Error(`Profile not found: ${name}`);
            }
            if (error.message.includes('JSON')) {
              throw new Error(`Profile is corrupted: ${name}`);
            }
          }
          throw error;
        }
      }),
    })),
  };
});

describe('loadCommand', () => {
  let context: CommandContext;
  let mockProvider: IProvider;
  let mockProviderManager: {
    getActiveProvider: ReturnType<typeof vi.fn>;
    setActiveProvider: ReturnType<typeof vi.fn>;
  };
  let mockConfig: {
    getProviderManager: ReturnType<typeof vi.fn>;
    setModel: ReturnType<typeof vi.fn>;
  };
  let mockSettings: {
    setValue: ReturnType<typeof vi.fn>;
  };
  const mockHomedir = '/home/testuser';
  const profilesDir = path.join(mockHomedir, '.llxprt', 'profiles');

  // Sample profile data
  const sampleProfile: Profile = {
    version: 1,
    provider: 'openai',
    model: 'gpt-4',
    modelParams: {
      temperature: 0.7,
      max_tokens: 4096,
      top_p: 0.95,
    },
    ephemeralSettings: {
      'context-limit': 32000,
      'compression-threshold': 0.8,
      'auth-keyfile': '~/.keys/api-key',
      'base-url': 'http://localhost:8080/v1',
      'tool-format': 'openai',
    },
  };

  beforeEach(() => {
    // Setup mocks
    vi.mocked(os.homedir).mockReturnValue(mockHomedir);
    vi.mocked(fs.readFile).mockResolvedValue(
      JSON.stringify(sampleProfile, null, 2),
    );

    // Clear all mocks before each test
    vi.clearAllMocks();

    // Create a mock provider with setModelParams method
    mockProvider = {
      name: 'openai',
      getModels: vi.fn().mockResolvedValue([]),
      generateChatCompletion: vi.fn(),
      getServerTools: vi.fn().mockReturnValue([]),
      invokeServerTool: vi.fn().mockResolvedValue(undefined),
      setModelParams: vi.fn(),
      getModelParams: vi.fn(),
    };

    // Create a mock provider manager
    mockProviderManager = {
      getActiveProvider: vi.fn().mockReturnValue(mockProvider),
      setActiveProvider: vi.fn(),
    };

    // Create a mock config
    mockConfig = {
      getProviderManager: vi.fn().mockReturnValue(mockProviderManager),
      setModel: vi.fn(),
      setProviderManager: vi.fn(),
      refreshAuth: vi.fn().mockResolvedValue(undefined),
      getContentGeneratorConfig: vi.fn().mockReturnValue({
        authType: AuthType.LOGIN_WITH_GOOGLE,
      }),
    };

    // Create mock settings
    mockSettings = {
      setValue: vi.fn(),
    };

    // Create context with the mock config and settings
    context = createMockCommandContext({
      services: {
        config: mockConfig as unknown as CommandContext['services']['config'],
        settings:
          mockSettings as unknown as CommandContext['services']['settings'],
      },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should have correct metadata', () => {
    expect(loadCommand.name).toBe('load');
    expect(loadCommand.description).toBe(
      'load configuration from a saved profile',
    );
  });

  describe('behavioral tests', () => {
    it('should load profile and apply all settings', async () => {
      const result = await loadCommand.action!(context, '"TestProfile"');

      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: "Profile 'TestProfile' loaded",
      });

      // Verify calls in correct order
      expect(mockProviderManager.setActiveProvider).toHaveBeenCalledWith(
        'openai',
      );
      expect(mockConfig.setModel).toHaveBeenCalledWith('gpt-4');
      expect(mockSettings.setValue).toHaveBeenCalledWith(
        SettingScope.User,
        'context-limit',
        32000,
      );
      expect(mockSettings.setValue).toHaveBeenCalledWith(
        SettingScope.User,
        'compression-threshold',
        0.8,
      );
      expect(mockProvider.setModelParams).toHaveBeenCalledWith({
        temperature: 0.7,
        max_tokens: 4096,
        top_p: 0.95,
      });
    });

    it('should set provider, model, modelParams, and ephemeralSettings', async () => {
      const result = await loadCommand.action!(context, '"CompleteProfile"');

      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: "Profile 'CompleteProfile' loaded",
      });

      // Verify all operations
      expect(mockProviderManager.setActiveProvider).toHaveBeenCalledWith(
        'openai',
      );
      expect(mockConfig.setModel).toHaveBeenCalledWith('gpt-4');

      // Verify all ephemeral settings
      expect(mockSettings.setValue).toHaveBeenCalledWith(
        SettingScope.User,
        'context-limit',
        32000,
      );
      expect(mockSettings.setValue).toHaveBeenCalledWith(
        SettingScope.User,
        'compression-threshold',
        0.8,
      );
      expect(mockSettings.setValue).toHaveBeenCalledWith(
        SettingScope.User,
        'auth-keyfile',
        '~/.keys/api-key',
      );
      expect(mockSettings.setValue).toHaveBeenCalledWith(
        SettingScope.User,
        'base-url',
        'http://localhost:8080/v1',
      );
      expect(mockSettings.setValue).toHaveBeenCalledWith(
        SettingScope.User,
        'tool-format',
        'openai',
      );

      expect(mockProvider.setModelParams).toHaveBeenCalledWith(
        sampleProfile.modelParams,
      );
    });

    it("should show error if profile doesn't exist", async () => {
      vi.mocked(fs.readFile).mockRejectedValue(
        new Error('ENOENT: no such file or directory'),
      );

      const result = await loadCommand.action!(context, '"NonExistentProfile"');

      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content: "Profile 'NonExistentProfile' not found",
      });
    });

    it('should show error if profile corrupted/invalid JSON', async () => {
      vi.mocked(fs.readFile).mockResolvedValue('{ invalid json }');

      const result = await loadCommand.action!(context, '"CorruptedProfile"');

      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content: "Profile 'CorruptedProfile' is corrupted",
      });
    });

    it('should handle profile names with spaces', async () => {
      const result = await loadCommand.action!(
        context,
        '"My Profile With Spaces"',
      );

      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: "Profile 'My Profile With Spaces' loaded",
      });

      expect(vi.mocked(fs.readFile)).toHaveBeenCalledWith(
        path.join(profilesDir, 'My Profile With Spaces.json'),
        'utf8',
      );
    });

    it('should return success message', async () => {
      const result = await loadCommand.action!(context, '"SuccessProfile"');

      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: "Profile 'SuccessProfile' loaded",
      });
    });

    it('should override current state with profile settings', async () => {
      // Set some existing state
      context.services.settings.merged = {
        'context-limit': 16000,
        'compression-threshold': 0.5,
        'some-other-setting': 'value',
      };

      const result = await loadCommand.action!(context, '"OverrideProfile"');

      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: "Profile 'OverrideProfile' loaded",
      });

      // Verify settings were overridden
      expect(mockSettings.setValue).toHaveBeenCalledWith(
        SettingScope.User,
        'context-limit',
        32000,
      );
      expect(mockSettings.setValue).toHaveBeenCalledWith(
        SettingScope.User,
        'compression-threshold',
        0.8,
      );
    });
  });

  describe('profile name validation', () => {
    it('should reject profile names with path separators', async () => {
      const result = await loadCommand.action!(context, '"profiles/test"');
      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content: 'Profile name cannot contain path separators',
      });

      const result2 = await loadCommand.action!(context, '"profiles\\test"');
      expect(result2).toEqual({
        type: 'message',
        messageType: 'error',
        content: 'Profile name cannot contain path separators',
      });
    });

    it('should show error if profile name missing', async () => {
      const result = await loadCommand.action!(context, '');
      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content: 'Usage: /load "<profile-name>"',
      });
    });

    it('should handle unquoted profile names', async () => {
      const result = await loadCommand.action!(context, 'SimpleProfile');

      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: "Profile 'SimpleProfile' loaded",
      });

      expect(vi.mocked(fs.readFile)).toHaveBeenCalledWith(
        path.join(profilesDir, 'SimpleProfile.json'),
        'utf8',
      );
    });

    it('should trim whitespace from profile names', async () => {
      const result = await loadCommand.action!(context, '  "ProfileName"  ');

      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: "Profile 'ProfileName' loaded",
      });

      expect(vi.mocked(fs.readFile)).toHaveBeenCalledWith(
        path.join(profilesDir, 'ProfileName.json'),
        'utf8',
      );
    });
  });

  describe('profile validation', () => {
    it('should validate profile has required fields', async () => {
      const incompleteProfile = {
        version: 1,
        provider: 'openai',
        // Missing model, modelParams, ephemeralSettings
      };
      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify(incompleteProfile),
      );

      const result = await loadCommand.action!(context, '"IncompleteProfile"');

      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content:
          "Profile 'IncompleteProfile' is invalid: missing required fields",
      });
    });

    it('should handle profile with wrong version', async () => {
      const futureProfile = {
        version: 2,
        provider: 'openai',
        model: 'gpt-4',
        modelParams: {},
        ephemeralSettings: {},
      };
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(futureProfile));

      const result = await loadCommand.action!(context, '"FutureProfile"');

      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content: 'Failed to load profile: Unsupported profile version',
      });
    });

    it('should handle empty modelParams and ephemeralSettings', async () => {
      const minimalProfile: Profile = {
        version: 1,
        provider: 'openai',
        model: 'gpt-3.5-turbo',
        modelParams: {},
        ephemeralSettings: {},
      };
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(minimalProfile));

      const result = await loadCommand.action!(context, '"MinimalProfile"');

      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: "Profile 'MinimalProfile' loaded",
      });

      // Should not call setModelParams for empty object
      expect(mockProvider.setModelParams).not.toHaveBeenCalled();

      // Should not set any ephemeral settings
      expect(mockSettings.setValue).not.toHaveBeenCalled();
    });
  });

  describe('settings application', () => {
    it('should apply each ephemeral setting individually', async () => {
      const result = await loadCommand.action!(context, '"SettingsProfile"');

      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: "Profile 'SettingsProfile' loaded",
      });

      // Verify each setting was applied
      expect(mockSettings.setValue).toHaveBeenCalledWith(
        SettingScope.User,
        'context-limit',
        32000,
      );
      expect(mockSettings.setValue).toHaveBeenCalledWith(
        SettingScope.User,
        'compression-threshold',
        0.8,
      );
      expect(mockSettings.setValue).toHaveBeenCalledWith(
        SettingScope.User,
        'auth-keyfile',
        '~/.keys/api-key',
      );
      expect(mockSettings.setValue).toHaveBeenCalledWith(
        SettingScope.User,
        'base-url',
        'http://localhost:8080/v1',
      );
      expect(mockSettings.setValue).toHaveBeenCalledWith(
        SettingScope.User,
        'tool-format',
        'openai',
      );
    });

    it('should handle provider without setModelParams method', async () => {
      const basicProvider = {
        name: 'basic-provider',
        getModels: vi.fn().mockResolvedValue([]),
        generateChatCompletion: vi.fn(),
        getServerTools: vi.fn().mockReturnValue([]),
        invokeServerTool: vi.fn().mockResolvedValue(undefined),
        // No setModelParams method
      };
      mockProviderManager.getActiveProvider.mockReturnValue(basicProvider);

      const result = await loadCommand.action!(
        context,
        '"BasicProviderProfile"',
      );

      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: "Profile 'BasicProviderProfile' loaded",
      });

      // Should still apply other settings
      expect(mockProviderManager.setActiveProvider).toHaveBeenCalled();
      expect(mockConfig.setModel).toHaveBeenCalled();
      expect(mockSettings.setValue).toHaveBeenCalled();
    });

    it('should apply custom headers as object', async () => {
      const profileWithHeaders: Profile = {
        ...sampleProfile,
        ephemeralSettings: {
          ...sampleProfile.ephemeralSettings,
          'custom-headers': {
            Authorization: 'Bearer token',
            'X-Custom': 'value',
          },
        },
      };
      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify(profileWithHeaders),
      );

      const result = await loadCommand.action!(context, '"HeadersProfile"');

      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: "Profile 'HeadersProfile' loaded",
      });

      // Verify custom headers were set as object
      expect(mockSettings.setValue).toHaveBeenCalledWith(
        SettingScope.User,
        'custom-headers',
        {
          Authorization: 'Bearer token',
          'X-Custom': 'value',
        },
      );
    });

    it('should set all model params on provider', async () => {
      const profileWithManyParams: Profile = {
        ...sampleProfile,
        modelParams: {
          temperature: 0.9,
          max_tokens: 8192,
          top_p: 0.95,
          presence_penalty: 0.5,
          frequency_penalty: 0.3,
          seed: 12345,
          response_format: { type: 'json_object' },
        },
      };
      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify(profileWithManyParams),
      );

      const result = await loadCommand.action!(context, '"AllParamsProfile"');

      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: "Profile 'AllParamsProfile' loaded",
      });

      // Verify all params were set
      expect(mockProvider.setModelParams).toHaveBeenCalledWith({
        temperature: 0.9,
        max_tokens: 8192,
        top_p: 0.95,
        presence_penalty: 0.5,
        frequency_penalty: 0.3,
        seed: 12345,
        response_format: { type: 'json_object' },
      });
    });
  });

  describe('error handling', () => {
    it('should handle file read errors gracefully', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('Permission denied'));

      const result = await loadCommand.action!(context, '"ErrorProfile"');

      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content: 'Failed to load profile: Permission denied',
      });
    });

    it('should handle missing config gracefully', async () => {
      context.services.config = null;

      const result = await loadCommand.action!(context, '"NoConfigProfile"');

      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content: 'No configuration available',
      });
    });

    it('should handle provider switch errors', async () => {
      mockProviderManager.setActiveProvider.mockImplementation(() => {
        throw new Error('Provider not found');
      });

      const result = await loadCommand.action!(
        context,
        '"ProviderErrorProfile"',
      );

      // Note: The implementation catches "not found" in error messages and
      // converts them to profile not found errors
      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content: "Profile 'ProviderErrorProfile' not found",
      });
    });

    it('should handle settings.set errors', async () => {
      mockSettings.setValue.mockImplementation(() => {
        throw new Error('Invalid setting value');
      });

      const result = await loadCommand.action!(
        context,
        '"SettingsErrorProfile"',
      );

      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content: 'Failed to load profile: Invalid setting value',
      });
    });
  });

  describe('file system operations', () => {
    it('should use home directory from os.homedir()', async () => {
      vi.mocked(os.homedir).mockReturnValue('/custom/home');

      const result = await loadCommand.action!(context, '"CustomHomeProfile"');

      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: "Profile 'CustomHomeProfile' loaded",
      });

      expect(vi.mocked(fs.readFile)).toHaveBeenCalledWith(
        '/custom/home/.llxprt/profiles/CustomHomeProfile.json',
        'utf8',
      );
    });

    it('should read file with utf8 encoding', async () => {
      const result = await loadCommand.action!(context, '"EncodingProfile"');

      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: "Profile 'EncodingProfile' loaded",
      });

      expect(vi.mocked(fs.readFile)).toHaveBeenCalledWith(
        expect.stringContaining('EncodingProfile.json'),
        'utf8',
      );
    });

    it('should handle unicode in profile data', async () => {
      const unicodeProfile: Profile = {
        ...sampleProfile,
        model: 'gpt-4-🚀',
        ephemeralSettings: {
          ...sampleProfile.ephemeralSettings,
          'auth-key': 'sk-测试密钥',
        },
      };
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(unicodeProfile));

      const result = await loadCommand.action!(context, '"UnicodeProfile"');

      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: "Profile 'UnicodeProfile' loaded",
      });

      // Verify unicode values were preserved
      expect(mockConfig.setModel).toHaveBeenCalledWith('gpt-4-🚀');
      expect(mockSettings.setValue).toHaveBeenCalledWith(
        SettingScope.User,
        'auth-key',
        'sk-测试密钥',
      );
    });
  });

  describe('order of operations', () => {
    it('should apply settings in correct order', async () => {
      const result = await loadCommand.action!(context, '"OrderProfile"');

      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: "Profile 'OrderProfile' loaded",
      });

      // Verify order of operations
      const callOrder: string[] = [];

      mockProviderManager.setActiveProvider.mockImplementation(() => {
        callOrder.push('setActiveProvider');
      });
      mockConfig.setModel.mockImplementation(() => {
        callOrder.push('setModel');
      });
      mockSettings.setValue.mockImplementation(() => {
        callOrder.push('settings.setValue');
      });
      mockProvider.setModelParams?.mockImplementation(() => {
        callOrder.push('setModelParams');
      });

      // Execute again to capture order
      await loadCommand.action!(context, '"OrderProfile2"');

      expect(callOrder).toEqual([
        'setActiveProvider',
        'setModel',
        'settings.setValue',
        'settings.setValue',
        'settings.setValue',
        'settings.setValue',
        'settings.setValue',
        'setModelParams',
      ]);
    });

    it('should wait for async operations', async () => {
      let providerSetComplete = false;
      mockProviderManager.setActiveProvider.mockImplementation(() => {
        // Simulate synchronous operation since setActiveProvider is not async
        providerSetComplete = true;
      });

      mockConfig.setModel.mockImplementation(() => {
        // This should only be called after provider is set
        expect(providerSetComplete).toBe(true);
      });

      const result = await loadCommand.action!(context, '"AsyncProfile"');

      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: "Profile 'AsyncProfile' loaded",
      });

      expect(providerSetComplete).toBe(true);
    });
  });
});
