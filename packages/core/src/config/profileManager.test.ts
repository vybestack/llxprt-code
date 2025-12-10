/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ProfileManager } from './profileManager.js';
import { ISettingsService } from '../settings/types.js';
import { Profile } from '../types/modelParams.js';
import type { SettingsService } from '../settings/SettingsService.js';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

// Mock file system and settings service instance
vi.mock('fs/promises');
vi.mock('os');
vi.mock('path');

const mockFs = fs as vi.Mocked<typeof fs>;
const mockOs = os as vi.Mocked<typeof os>;
const mockPath = path as vi.Mocked<typeof path>;

// Mock SettingsService
const createMockSettingsService = (): vi.Mocked<ISettingsService> => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  set: vi.fn(),
  switchProvider: vi.fn(),
  onSettingsChanged: vi.fn(),
  on: vi.fn(),
  emit: vi.fn(),
  exportForProfile: vi.fn(),
  importFromProfile: vi.fn(),
  setCurrentProfileName: vi.fn(),
  getCurrentProfileName: vi.fn(),
});

describe('ProfileManager', () => {
  let profileManager: ProfileManager;
  let mockSettingsService: vi.Mocked<ISettingsService>;
  const testProfilesDir = '/home/test/.llxprt/profiles';

  const testProfile: Profile = {
    version: 1,
    provider: 'openai',
    model: 'test-model',
    modelParams: {
      temperature: 0.7,
      max_tokens: 2000,
    },
    ephemeralSettings: {
      'base-url': 'https://api.openai.com/v1',
      'auth-key': 'test-key',
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup path mocks
    mockOs.homedir.mockReturnValue('/home/test');
    mockPath.join.mockImplementation((...args: string[]) => args.join('/'));

    mockSettingsService = createMockSettingsService();

    profileManager = new ProfileManager();

    // No feature flags needed - SettingsService is always used
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with default profiles directory', () => {
      const manager = new ProfileManager();
      expect(manager).toBeInstanceOf(ProfileManager);
    });
  });

  describe('saveProfile', () => {
    it('should save profile to file with correct format', async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue();

      await profileManager.saveProfile('test-profile', testProfile);

      expect(mockFs.mkdir).toHaveBeenCalledWith(testProfilesDir, {
        recursive: true,
      });
      expect(mockFs.writeFile).toHaveBeenCalledWith(
        '/home/test/.llxprt/profiles/test-profile.json',
        JSON.stringify(testProfile, null, 2),
        'utf8',
      );
    });
  });

  describe('loadProfile', () => {
    it('should load and validate profile from file', async () => {
      const profileJson = JSON.stringify(testProfile);
      mockFs.readFile.mockResolvedValue(profileJson);

      const result = await profileManager.loadProfile('test-profile');

      expect(mockFs.readFile).toHaveBeenCalledWith(
        '/home/test/.llxprt/profiles/test-profile.json',
        'utf8',
      );
      expect(result).toEqual(testProfile);
    });

    it('should throw error for missing profile', async () => {
      const error = new Error('ENOENT: no such file or directory');
      mockFs.readFile.mockRejectedValue(error);

      await expect(
        profileManager.loadProfile('missing-profile'),
      ).rejects.toThrow("Profile 'missing-profile' not found");
    });

    it('should throw error for corrupted profile', async () => {
      mockFs.readFile.mockResolvedValue('invalid json');

      await expect(
        profileManager.loadProfile('corrupted-profile'),
      ).rejects.toThrow("Profile 'corrupted-profile' is corrupted");
    });

    it('should throw error for profile with missing fields', async () => {
      const invalidProfile = { version: 1, provider: 'openai' };
      mockFs.readFile.mockResolvedValue(JSON.stringify(invalidProfile));

      await expect(
        profileManager.loadProfile('invalid-profile'),
      ).rejects.toThrow(
        "Profile 'invalid-profile' is invalid: missing required fields",
      );
    });
  });

  describe('save method with SettingsService', () => {
    beforeEach(() => {
      // SettingsService is already mocked in the main beforeEach
      profileManager = new ProfileManager();
    });

    it('should export from SettingsService and save profile', async () => {
      const settingsData = {
        defaultProvider: 'openai',
        providers: {
          openai: {
            enabled: true,
            model: 'test-model',
            temperature: 0.7,
            maxTokens: 2000,
            baseUrl: 'https://api.openai.com/v1',
            apiKey: 'test-key',
          },
        },
      };

      mockSettingsService.exportForProfile.mockResolvedValue(settingsData);
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue();

      await profileManager.save(
        'test-profile',
        mockSettingsService as unknown as SettingsService,
      );

      expect(mockSettingsService.exportForProfile).toHaveBeenCalled();
      expect(mockSettingsService.setCurrentProfileName).toHaveBeenCalledWith(
        'test-profile',
      );
      expect(mockFs.writeFile).toHaveBeenCalled();
    });

    it('should work when SettingsService is always available', async () => {
      // In the new architecture, SettingsService is always available
      const manager = new ProfileManager();

      mockSettingsService.exportForProfile.mockResolvedValue({
        defaultProvider: 'openai',
        providers: {
          openai: {
            enabled: true,
            model: 'test-model',
            temperature: 0.7,
            maxTokens: 2000,
            baseUrl: 'https://api.openai.com/v1',
            apiKey: 'test-key',
          },
        },
      });
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue();

      await expect(
        manager.save(
          'test-profile',
          mockSettingsService as unknown as SettingsService,
        ),
      ).resolves.not.toThrow();
    });

    it('should persist tool enablement lists from settings service', async () => {
      const manager = new ProfileManager();
      const payloadCapture: { value?: unknown } = {};

      mockSettingsService.exportForProfile.mockResolvedValue({
        defaultProvider: 'openai',
        providers: {
          openai: {
            enabled: true,
            model: 'test-model',
          },
        },
        tools: {
          allowed: ['file-reader'],
          disabled: ['code-editor'],
        },
      });
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockImplementation(async (_path, data: string) => {
        payloadCapture.value = JSON.parse(data);
      });

      await manager.save(
        'tool-profile',
        mockSettingsService as unknown as SettingsService,
      );

      const serialized = payloadCapture.value as {
        ephemeralSettings?: Record<string, unknown>;
      };
      expect(serialized.ephemeralSettings?.['tools.allowed']).toEqual([
        'file-reader',
      ]);
      expect(serialized.ephemeralSettings?.['tools.disabled']).toEqual([
        'code-editor',
      ]);
    });

    it('should persist toolFormat from settings service to ephemeralSettings', async () => {
      const manager = new ProfileManager();
      const payloadCapture: { value?: unknown } = {};

      mockSettingsService.exportForProfile.mockResolvedValue({
        defaultProvider: 'openai',
        providers: {
          openai: {
            enabled: true,
            model: 'moonshotai/Kimi-K2-Thinking',
            toolFormat: 'kimi',
          },
        },
      });
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockImplementation(async (_path, data: string) => {
        payloadCapture.value = JSON.parse(data);
      });

      await manager.save(
        'kimi-profile',
        mockSettingsService as unknown as SettingsService,
      );

      const serialized = payloadCapture.value as {
        ephemeralSettings?: Record<string, unknown>;
      };
      expect(serialized.ephemeralSettings?.['tool-format']).toEqual('kimi');
    });
  });

  describe('load method with SettingsService', () => {
    beforeEach(() => {
      // SettingsService is already mocked in the main beforeEach
      profileManager = new ProfileManager();
    });

    it('should load profile and import to SettingsService', async () => {
      const profileJson = JSON.stringify(testProfile);
      mockFs.readFile.mockResolvedValue(profileJson);
      mockSettingsService.importFromProfile.mockResolvedValue();

      await profileManager.load(
        'test-profile',
        mockSettingsService as unknown as SettingsService,
      );

      expect(mockFs.readFile).toHaveBeenCalled();
      expect(mockSettingsService.importFromProfile).toHaveBeenCalledWith({
        defaultProvider: 'openai',
        providers: {
          openai: {
            enabled: true,
            model: 'test-model',
            temperature: 0.7,
            maxTokens: 2000,
            baseUrl: 'https://api.openai.com/v1',
            apiKey: 'test-key',
          },
        },
        tools: {
          allowed: [],
          disabled: [],
        },
      });
      expect(mockSettingsService.setCurrentProfileName).toHaveBeenCalledWith(
        'test-profile',
      );
    });

    it('should work when SettingsService is always available', async () => {
      // In the new architecture, SettingsService is always available
      const manager = new ProfileManager();

      const profileJson = JSON.stringify(testProfile);
      mockFs.readFile.mockResolvedValue(profileJson);
      mockSettingsService.importFromProfile.mockResolvedValue();

      await expect(
        manager.load(
          'test-profile',
          mockSettingsService as unknown as SettingsService,
        ),
      ).resolves.not.toThrow();
      expect(mockSettingsService.importFromProfile).toHaveBeenCalled();
    });

    it('should load toolFormat from profile and apply to SettingsService', async () => {
      const manager = new ProfileManager();
      const profileWithToolFormat: Profile = {
        version: 1,
        provider: 'openai',
        model: 'moonshotai/Kimi-K2-Thinking',
        modelParams: {
          temperature: 0.7,
        },
        ephemeralSettings: {
          'tool-format': 'kimi',
        },
      };

      mockFs.readFile.mockResolvedValue(JSON.stringify(profileWithToolFormat));
      mockSettingsService.importFromProfile.mockResolvedValue();

      await manager.load(
        'kimi-profile',
        mockSettingsService as unknown as SettingsService,
      );

      expect(mockSettingsService.importFromProfile).toHaveBeenCalledWith({
        defaultProvider: 'openai',
        providers: {
          openai: {
            enabled: true,
            model: 'moonshotai/Kimi-K2-Thinking',
            temperature: 0.7,
            maxTokens: undefined,
            baseUrl: undefined,
            apiKey: undefined,
            'prompt-caching': undefined,
            'include-folder-structure': undefined,
            toolFormat: 'kimi',
          },
        },
        tools: {
          allowed: [],
          disabled: [],
        },
      });
    });
  });

  describe('profileExists', () => {
    it('should return true when profile exists', async () => {
      mockFs.access.mockResolvedValue();

      const exists = await profileManager.profileExists('test-profile');

      expect(exists).toBe(true);
      expect(mockFs.access).toHaveBeenCalledWith(
        '/home/test/.llxprt/profiles/test-profile.json',
      );
    });

    it('should return false when profile does not exist', async () => {
      mockFs.access.mockRejectedValue(new Error('ENOENT'));

      const exists = await profileManager.profileExists('missing-profile');

      expect(exists).toBe(false);
    });
  });

  describe('deleteProfile', () => {
    it('should delete profile file', async () => {
      mockFs.unlink.mockResolvedValue();

      await profileManager.deleteProfile('test-profile');

      expect(mockFs.unlink).toHaveBeenCalledWith(
        '/home/test/.llxprt/profiles/test-profile.json',
      );
    });

    it('should throw error for non-existent profile', async () => {
      const error = new Error('ENOENT: no such file or directory');
      mockFs.unlink.mockRejectedValue(error);

      await expect(
        profileManager.deleteProfile('missing-profile'),
      ).rejects.toThrow("Profile 'missing-profile' not found");
    });
  });

  describe('listProfiles', () => {
    it('should return list of profile names without .json extension', async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.readdir.mockResolvedValue([
        'profile1.json',
        'profile2.json',
        'other.txt',
      ] as never);

      const profiles = await profileManager.listProfiles();

      expect(profiles).toEqual(['profile1', 'profile2']);
      expect(mockFs.mkdir).toHaveBeenCalledWith(testProfilesDir, {
        recursive: true,
      });
    });

    it('should return empty array when directory does not exist', async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.readdir.mockRejectedValue(new Error('ENOENT'));

      const profiles = await profileManager.listProfiles();

      expect(profiles).toEqual([]);
    });
  });
});
