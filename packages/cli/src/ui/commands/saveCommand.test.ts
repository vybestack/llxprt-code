/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { saveCommand } from './saveCommand.js';
import { CommandContext } from './types.js';
import { createMockCommandContext } from '../../test-utils/mockCommandContext.js';
import { IProvider, Profile } from '@vybestack/llxprt-code-core';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

// Mock fs/promises
vi.mock('fs/promises');

// Mock os
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return {
    ...actual,
    default: {
      ...actual.default,
      homedir: vi.fn(),
    },
    homedir: vi.fn(),
  };
});

// Mock ProfileManager
vi.mock('@vybestack/llxprt-code-core', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@vybestack/llxprt-code-core')>();
  return {
    ...actual,
    ProfileManager: vi.fn().mockImplementation(() => ({
      saveProfile: vi
        .fn()
        .mockImplementation(async (name: string, profile: Profile) => {
          // Simulate the ProfileManager's behavior
          await fs.mkdir(path.join(os.homedir(), '.llxprt', 'profiles'), {
            recursive: true,
          });
          await fs.writeFile(
            path.join(os.homedir(), '.llxprt', 'profiles', `${name}.json`),
            JSON.stringify(profile, null, 2),
            'utf8',
          );
        }),
    })),
  };
});

describe('saveCommand', () => {
  let context: CommandContext;
  let mockProvider: IProvider;
  let mockProviderManager: {
    getActiveProvider: ReturnType<typeof vi.fn>;
  };
  let mockConfig: {
    getProviderManager: ReturnType<typeof vi.fn>;
    getProvider: ReturnType<typeof vi.fn>;
    getModel: ReturnType<typeof vi.fn>;
  };
  const mockHomedir = '/home/testuser';
  const profilesDir = path.join(mockHomedir, '.llxprt', 'profiles');

  beforeEach(() => {
    // Setup mocks
    vi.mocked(os.homedir).mockReturnValue(mockHomedir);
    vi.mocked(fs.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);

    // Create a mock provider with setModelParams and getModelParams methods
    mockProvider = {
      name: 'openai',
      getModels: vi.fn().mockResolvedValue([]),
      generateChatCompletion: vi.fn(),
      getServerTools: vi.fn().mockReturnValue([]),
      invokeServerTool: vi.fn().mockResolvedValue(undefined),
      setModelParams: vi.fn(),
      getModelParams: vi.fn().mockReturnValue({
        temperature: 0.7,
        max_tokens: 4096,
      }),
    };

    // Create a mock provider manager
    mockProviderManager = {
      getActiveProvider: vi.fn().mockReturnValue(mockProvider),
    };

    // Create a mock config with ephemeral settings
    mockConfig = {
      getProviderManager: vi.fn().mockReturnValue(mockProviderManager),
      getProvider: vi.fn().mockReturnValue('openai'),
      getModel: vi.fn().mockReturnValue('gpt-4'),
    };

    // Create context with the mock config and settings
    context = createMockCommandContext({
      services: {
        config: mockConfig as unknown as CommandContext['services']['config'],
        settings: {
          merged: {
            'context-limit': 32000,
            'compression-threshold': 0.8,
            'auth-keyfile': '~/.keys/api-key',
            'base-url': 'http://localhost:8080/v1',
            'tool-format': 'openai',
          },
        } as unknown as CommandContext['services']['settings'],
      },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should have correct metadata', () => {
    expect(saveCommand.name).toBe('save');
    expect(saveCommand.description).toBe(
      'save current configuration to a profile',
    );
  });

  describe('behavioral tests', () => {
    it('should save current provider, model, modelParams, and ephemeralSettings', async () => {
      const result = await saveCommand.action!(context, '"TestProfile"');

      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: "Profile 'TestProfile' saved",
      });

      // Verify profile data
      expect(vi.mocked(fs.writeFile)).toHaveBeenCalledWith(
        path.join(profilesDir, 'TestProfile.json'),
        JSON.stringify(
          {
            version: 1,
            provider: 'openai',
            model: 'gpt-4',
            modelParams: {
              temperature: 0.7,
              max_tokens: 4096,
            },
            ephemeralSettings: {
              'context-limit': 32000,
              'compression-threshold': 0.8,
              'auth-keyfile': '~/.keys/api-key',
              'base-url': 'http://localhost:8080/v1',
              'tool-format': 'openai',
            },
          },
          null,
          2,
        ),
        'utf8',
      );
    });

    it('should create profile file at correct location (~/.llxprt/profiles/<name>.json)', async () => {
      const result = await saveCommand.action!(context, '"MyProfile"');

      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: "Profile 'MyProfile' saved",
      });

      // Verify directory creation
      expect(vi.mocked(fs.mkdir)).toHaveBeenCalledWith(profilesDir, {
        recursive: true,
      });

      // Verify file path
      expect(vi.mocked(fs.writeFile)).toHaveBeenCalledWith(
        path.join(profilesDir, 'MyProfile.json'),
        expect.any(String),
        'utf8',
      );
    });

    it('should handle profile names with spaces when quoted', async () => {
      const result = await saveCommand.action!(
        context,
        '"My Profile With Spaces"',
      );

      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: "Profile 'My Profile With Spaces' saved",
      });

      expect(vi.mocked(fs.writeFile)).toHaveBeenCalledWith(
        path.join(profilesDir, 'My Profile With Spaces.json'),
        expect.any(String),
        'utf8',
      );
    });

    it('should show error if profile name missing', async () => {
      const result = await saveCommand.action!(context, '');
      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content: 'Usage: /save "<profile-name>"',
      });
    });

    it('should overwrite existing profiles', async () => {
      // Mock that file already exists
      vi.mocked(fs.access).mockResolvedValue(undefined);

      const result = await saveCommand.action!(context, '"ExistingProfile"');

      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: "Profile 'ExistingProfile' saved",
      });

      // Should not check if file exists
      expect(vi.mocked(fs.access)).not.toHaveBeenCalled();

      // Should directly overwrite
      expect(vi.mocked(fs.writeFile)).toHaveBeenCalled();
    });

    it("should create directory if doesn't exist", async () => {
      // Mock that directory doesn't exist
      vi.mocked(fs.access).mockRejectedValue(new Error('ENOENT'));

      const result = await saveCommand.action!(context, '"NewProfile"');

      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: "Profile 'NewProfile' saved",
      });

      // Should create directory
      expect(vi.mocked(fs.mkdir)).toHaveBeenCalledWith(profilesDir, {
        recursive: true,
      });

      // Should write profile file
      expect(vi.mocked(fs.writeFile)).toHaveBeenCalled();
    });

    it('should return success message', async () => {
      const result = await saveCommand.action!(context, '"SuccessProfile"');

      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: "Profile 'SuccessProfile' saved",
      });
    });

    it('should handle file system errors gracefully', async () => {
      vi.mocked(fs.writeFile).mockRejectedValue(new Error('Permission denied'));

      const result = await saveCommand.action!(context, '"ErrorProfile"');

      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content: 'Failed to save profile: Permission denied',
      });
    });
  });

  describe('profile name validation', () => {
    it('should reject profile names with path separators', async () => {
      const result = await saveCommand.action!(context, '"profiles/test"');
      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content: 'Profile name cannot contain path separators',
      });

      const result2 = await saveCommand.action!(context, '"profiles\\test"');
      expect(result2).toEqual({
        type: 'message',
        messageType: 'error',
        content: 'Profile name cannot contain path separators',
      });
    });

    it('should handle unquoted profile names', async () => {
      const result = await saveCommand.action!(context, 'SimpleProfile');

      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: "Profile 'SimpleProfile' saved",
      });

      expect(vi.mocked(fs.writeFile)).toHaveBeenCalledWith(
        path.join(profilesDir, 'SimpleProfile.json'),
        expect.any(String),
        'utf8',
      );
    });

    it('should trim whitespace from profile names', async () => {
      const result = await saveCommand.action!(context, '  "ProfileName"  ');

      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: "Profile 'ProfileName' saved",
      });

      expect(vi.mocked(fs.writeFile)).toHaveBeenCalledWith(
        path.join(profilesDir, 'ProfileName.json'),
        expect.any(String),
        'utf8',
      );
    });
  });

  describe('data gathering', () => {
    it('should handle missing model params gracefully', async () => {
      mockProvider.getModelParams = vi.fn().mockReturnValue(undefined);

      const result = await saveCommand.action!(context, '"NoParamsProfile"');

      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: "Profile 'NoParamsProfile' saved",
      });

      // Verify empty object for modelParams
      expect(vi.mocked(fs.writeFile)).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('"modelParams": {}'),
        'utf8',
      );
    });

    it('should handle provider without getModelParams method', async () => {
      const providerWithoutModelParams = {
        name: 'basic-provider',
        getModels: vi.fn().mockResolvedValue([]),
        generateChatCompletion: vi.fn(),
        getServerTools: vi.fn().mockReturnValue([]),
        invokeServerTool: vi.fn().mockResolvedValue(undefined),
        // No getModelParams method
      };
      mockProviderManager.getActiveProvider.mockReturnValue(
        providerWithoutModelParams,
      );

      const result = await saveCommand.action!(context, '"BasicProfile"');

      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: "Profile 'BasicProfile' saved",
      });

      // Verify empty object for modelParams
      expect(vi.mocked(fs.writeFile)).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('"modelParams": {}'),
        'utf8',
      );
    });

    it('should filter only relevant ephemeral settings', async () => {
      // Add some non-ephemeral settings to context
      context.services.settings.merged = {
        ...context.services.settings.merged,
        someOtherSetting: 'value',
        theme: 'dark',
      };

      const result = await saveCommand.action!(context, '"FilteredProfile"');

      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: "Profile 'FilteredProfile' saved",
      });

      // Verify only ephemeral settings are included
      const writeCall = vi.mocked(fs.writeFile).mock.calls[0];
      const savedProfile = JSON.parse(writeCall[1] as string);

      expect(savedProfile.ephemeralSettings).not.toHaveProperty(
        'someOtherSetting',
      );
      expect(savedProfile.ephemeralSettings).not.toHaveProperty('theme');
      expect(savedProfile.ephemeralSettings).toHaveProperty('context-limit');
      expect(savedProfile.ephemeralSettings).toHaveProperty(
        'compression-threshold',
      );
    });

    it('should handle missing config gracefully', async () => {
      context.services.config = null;

      const result = await saveCommand.action!(context, '"NoConfigProfile"');

      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content: 'No configuration available',
      });
    });

    it('should save all model params returned by provider', async () => {
      mockProvider.getModelParams = vi.fn().mockReturnValue({
        temperature: 0.9,
        max_tokens: 8192,
        top_p: 0.95,
        presence_penalty: 0.5,
        frequency_penalty: 0.3,
        seed: 12345,
        response_format: { type: 'json_object' },
      });

      const result = await saveCommand.action!(context, '"AllParamsProfile"');

      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: "Profile 'AllParamsProfile' saved",
      });

      // Verify all model params are saved
      const writeCall = vi.mocked(fs.writeFile).mock.calls[0];
      const savedProfile = JSON.parse(writeCall[1] as string);

      expect(savedProfile.modelParams).toEqual({
        temperature: 0.9,
        max_tokens: 8192,
        top_p: 0.95,
        presence_penalty: 0.5,
        frequency_penalty: 0.3,
        seed: 12345,
        response_format: { type: 'json_object' },
      });
    });

    it('should save custom headers as JSON in ephemeral settings', async () => {
      context.services.settings.merged['custom-headers'] = {
        Authorization: 'Bearer token',
        'X-Custom': 'value',
      };

      const result = await saveCommand.action!(context, '"HeadersProfile"');

      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: "Profile 'HeadersProfile' saved",
      });

      // Verify custom headers are preserved as object
      const writeCall = vi.mocked(fs.writeFile).mock.calls[0];
      const savedProfile = JSON.parse(writeCall[1] as string);

      expect(savedProfile.ephemeralSettings['custom-headers']).toEqual({
        Authorization: 'Bearer token',
        'X-Custom': 'value',
      });
    });
  });

  describe('file system operations', () => {
    it('should create profile with correct JSON formatting', async () => {
      const result = await saveCommand.action!(context, '"FormattedProfile"');

      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: "Profile 'FormattedProfile' saved",
      });

      // Verify formatting
      expect(vi.mocked(fs.writeFile)).toHaveBeenCalledWith(
        path.join(profilesDir, 'FormattedProfile.json'),
        expect.stringMatching(/^{\n {2}/), // Verify JSON is formatted with 2-space indentation
        'utf8',
      );
    });

    it('should use home directory from os.homedir()', async () => {
      vi.mocked(os.homedir).mockReturnValue('/custom/home');

      const result = await saveCommand.action!(context, '"CustomHomeProfile"');

      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: "Profile 'CustomHomeProfile' saved",
      });

      expect(vi.mocked(fs.writeFile)).toHaveBeenCalledWith(
        '/custom/home/.llxprt/profiles/CustomHomeProfile.json',
        expect.any(String),
        'utf8',
      );
    });

    it('should handle directory creation errors', async () => {
      vi.mocked(fs.mkdir).mockRejectedValue(
        new Error('EACCES: permission denied'),
      );

      const result = await saveCommand.action!(context, '"DirErrorProfile"');

      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content: 'Failed to save profile: EACCES: permission denied',
      });
    });
  });
});
