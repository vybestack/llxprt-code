/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ProfileManager } from './profileManager.js';
import { ISettingsService } from '../settings/types.js';
import { Profile, LoadBalancerProfile } from '../types/modelParams.js';
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
    it('should export from SettingsService and save profile', async () => {
      const settingsData = {
        defaultProvider: 'openai',
        providers: {
          openai: {
            enabled: true,
            model: 'test-model',
            temperature: 0.7,
            maxTokens: 2000,
            'base-url': 'https://api.openai.com/v1',
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
      mockSettingsService.exportForProfile.mockResolvedValue({
        defaultProvider: 'openai',
        providers: {
          openai: {
            enabled: true,
            model: 'test-model',
            temperature: 0.7,
            maxTokens: 2000,
            'base-url': 'https://api.openai.com/v1',
            apiKey: 'test-key',
          },
        },
      });
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue();

      await expect(
        profileManager.save(
          'test-profile',
          mockSettingsService as unknown as SettingsService,
        ),
      ).resolves.not.toThrow();
    });

    it('should persist tool enablement lists from settings service', async () => {
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

      await profileManager.save(
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

      await profileManager.save(
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
    it('should load profile and invoke importFromProfile', async () => {
      const profileJson = JSON.stringify(testProfile);
      mockFs.readFile.mockResolvedValue(profileJson);
      mockSettingsService.importFromProfile.mockResolvedValue();

      await profileManager.load(
        'test-profile',
        mockSettingsService as unknown as SettingsService,
      );

      expect(mockFs.readFile).toHaveBeenCalled();
      expect(mockSettingsService.importFromProfile).toHaveBeenCalled();
      expect(mockSettingsService.setCurrentProfileName).toHaveBeenCalledWith(
        'test-profile',
      );
    });

    it('should pass provider and model from profile to SettingsService', async () => {
      const capturedData: { value?: unknown } = {};

      mockFs.readFile.mockResolvedValue(JSON.stringify(testProfile));
      mockSettingsService.importFromProfile.mockImplementation((data) => {
        capturedData.value = data;
        return Promise.resolve();
      });

      await profileManager.load(
        'test-profile',
        mockSettingsService as unknown as SettingsService,
      );

      expect(capturedData.value).toBeDefined();
      const imported = capturedData.value as {
        defaultProvider?: string;
        providers?: Record<string, { model?: string }>;
      };
      expect(imported.defaultProvider).toBe('openai');
      expect(imported.providers?.openai?.model).toBe('test-model');
    });

    it('should pass base-url from profile ephemeralSettings', async () => {
      const capturedData: { value?: unknown } = {};

      mockFs.readFile.mockResolvedValue(JSON.stringify(testProfile));
      mockSettingsService.importFromProfile.mockImplementation((data) => {
        capturedData.value = data;
        return Promise.resolve();
      });

      await profileManager.load(
        'test-profile',
        mockSettingsService as unknown as SettingsService,
      );

      expect(capturedData.value).toBeDefined();
      const imported = capturedData.value as {
        providers?: Record<string, Record<string, unknown>>;
      };
      expect(imported.providers?.openai?.['base-url']).toBe(
        'https://api.openai.com/v1',
      );
    });

    it('should pass toolFormat from profile to SettingsService', async () => {
      const capturedData: { value?: unknown } = {};
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
      mockSettingsService.importFromProfile.mockImplementation((data) => {
        capturedData.value = data;
        return Promise.resolve();
      });

      await profileManager.load(
        'kimi-profile',
        mockSettingsService as unknown as SettingsService,
      );

      expect(capturedData.value).toBeDefined();
      const imported = capturedData.value as {
        providers?: Record<string, { toolFormat?: string }>;
      };
      expect(imported.providers?.openai?.toolFormat).toBe('kimi');
    });

    it('should pass tool enablement lists from profile', async () => {
      const capturedData: { value?: unknown } = {};
      const profileWithTools: Profile = {
        version: 1,
        provider: 'openai',
        model: 'test-model',
        modelParams: {},
        ephemeralSettings: {
          'tools.allowed': ['tool-a', 'tool-b'],
          'tools.disabled': ['tool-c'],
        },
      };

      mockFs.readFile.mockResolvedValue(JSON.stringify(profileWithTools));
      mockSettingsService.importFromProfile.mockImplementation((data) => {
        capturedData.value = data;
        return Promise.resolve();
      });

      await profileManager.load(
        'tools-profile',
        mockSettingsService as unknown as SettingsService,
      );

      expect(capturedData.value).toBeDefined();
      const imported = capturedData.value as {
        tools?: { allowed?: string[]; disabled?: string[] };
      };
      expect(imported.tools?.allowed).toEqual(['tool-a', 'tool-b']);
      expect(imported.tools?.disabled).toEqual(['tool-c']);
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

  describe('loadProfile with LoadBalancer profiles', () => {
    it('should return LB profile when file has type loadbalancer', async () => {
      const standardProfile1 = {
        version: 1,
        provider: 'openai',
        model: 'gpt-4',
        modelParams: {},
        ephemeralSettings: {},
      };
      const standardProfile2 = {
        version: 1,
        provider: 'anthropic',
        model: 'claude-3',
        modelParams: {},
        ephemeralSettings: {},
      };
      const lbProfile = {
        version: 1,
        type: 'loadbalancer',
        policy: 'roundrobin',
        profiles: ['profile1', 'profile2'],
        provider: '',
        model: '',
        modelParams: {},
        ephemeralSettings: {},
      };
      mockFs.readFile.mockImplementation(async (filePath: string) => {
        if (filePath.includes('lb-profile.json')) {
          return JSON.stringify(lbProfile);
        } else if (filePath.includes('profile1.json')) {
          return JSON.stringify(standardProfile1);
        } else if (filePath.includes('profile2.json')) {
          return JSON.stringify(standardProfile2);
        }
        throw new Error('ENOENT');
      });
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.readdir.mockResolvedValue([
        'profile1.json',
        'profile2.json',
        'lb-profile.json',
      ] as never);

      const result = await profileManager.loadProfile('lb-profile');

      expect(result).toEqual(lbProfile);
      expect(result.type).toBe('loadbalancer');
    });

    it('should reject LB profile with empty profiles array', async () => {
      const lbProfile = {
        version: 1,
        type: 'loadbalancer',
        policy: 'roundrobin',
        profiles: [],
        provider: '',
        model: '',
        modelParams: {},
        ephemeralSettings: {},
      };
      mockFs.readFile.mockResolvedValue(JSON.stringify(lbProfile));

      await expect(
        profileManager.loadProfile('empty-lb-profile'),
      ).rejects.toThrow(
        "LoadBalancer profile 'empty-lb-profile' must reference at least one profile",
      );
    });

    it('should reject LB profile referencing non-existent profile', async () => {
      const standardProfile1 = {
        version: 1,
        provider: 'openai',
        model: 'gpt-4',
        modelParams: {},
        ephemeralSettings: {},
      };
      const lbProfile = {
        version: 1,
        type: 'loadbalancer',
        policy: 'roundrobin',
        profiles: ['profile1', 'missing-profile'],
        provider: '',
        model: '',
        modelParams: {},
        ephemeralSettings: {},
      };
      mockFs.readFile.mockImplementation(async (filePath: string) => {
        if (filePath.includes('invalid-lb-profile.json')) {
          return JSON.stringify(lbProfile);
        } else if (filePath.includes('profile1.json')) {
          return JSON.stringify(standardProfile1);
        }
        throw new Error('ENOENT');
      });
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.readdir.mockResolvedValue(['profile1.json'] as never);

      await expect(
        profileManager.loadProfile('invalid-lb-profile'),
      ).rejects.toThrow(
        "LoadBalancer profile 'invalid-lb-profile' references non-existent profile 'missing-profile'",
      );
    });

    it('should reject LB profile referencing another LB profile', async () => {
      const nestedLbProfile = {
        version: 1,
        type: 'loadbalancer',
        policy: 'roundrobin',
        profiles: ['profile1'],
        provider: '',
        model: '',
        modelParams: {},
        ephemeralSettings: {},
      };
      const lbProfile = {
        version: 1,
        type: 'loadbalancer',
        policy: 'roundrobin',
        profiles: ['nested-lb'],
        provider: '',
        model: '',
        modelParams: {},
        ephemeralSettings: {},
      };
      mockFs.readFile
        .mockResolvedValueOnce(JSON.stringify(lbProfile))
        .mockResolvedValueOnce(JSON.stringify(nestedLbProfile));
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.readdir.mockResolvedValue(['nested-lb.json'] as never);

      await expect(
        profileManager.loadProfile('nested-lb-profile'),
      ).rejects.toThrow(
        "LoadBalancer profile 'nested-lb-profile' cannot reference another LoadBalancer profile 'nested-lb'",
      );
    });

    it('should reject LB profile with unsupported version', async () => {
      const lbProfile = {
        version: 2,
        type: 'loadbalancer',
        policy: 'roundrobin',
        profiles: ['profile1'],
      };
      mockFs.readFile.mockResolvedValue(JSON.stringify(lbProfile));

      await expect(
        profileManager.loadProfile('unsupported-version-lb'),
      ).rejects.toThrow('unsupported profile version');
    });

    it('should still work for standard profiles backward compatibility', async () => {
      const standardProfile = {
        version: 1,
        provider: 'openai',
        model: 'gpt-4',
        modelParams: {
          temperature: 0.7,
        },
        ephemeralSettings: {},
      };
      mockFs.readFile.mockResolvedValue(JSON.stringify(standardProfile));

      const result = await profileManager.loadProfile('standard-profile');

      expect(result).toEqual(standardProfile);
      expect(result.provider).toBe('openai');
      expect(result.model).toBe('gpt-4');
    });
  });

  describe('saveLoadBalancerProfile', () => {
    it('should save valid LB profile to file', async () => {
      const profile1: Profile = {
        version: 1,
        provider: 'openai',
        model: 'gpt-4',
        modelParams: {},
        ephemeralSettings: {},
      };
      const profile2: Profile = {
        version: 1,
        provider: 'anthropic',
        model: 'claude-3',
        modelParams: {},
        ephemeralSettings: {},
      };
      const lbProfile: LoadBalancerProfile = {
        version: 1,
        type: 'loadbalancer',
        policy: 'roundrobin',
        profiles: ['profile1', 'profile2'],
        provider: '',
        model: '',
        modelParams: {},
        ephemeralSettings: {},
      };

      mockFs.readFile.mockImplementation(async (filePath: string) => {
        if (filePath.includes('profile1.json')) {
          return JSON.stringify(profile1);
        } else if (filePath.includes('profile2.json')) {
          return JSON.stringify(profile2);
        }
        throw new Error('ENOENT');
      });
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.readdir.mockResolvedValue([
        'profile1.json',
        'profile2.json',
      ] as never);
      mockFs.writeFile.mockResolvedValue();

      await profileManager.saveLoadBalancerProfile('lb-profile', lbProfile);

      expect(mockFs.writeFile).toHaveBeenCalledWith(
        '/home/test/.llxprt/profiles/lb-profile.json',
        JSON.stringify(lbProfile, null, 2),
        'utf8',
      );
    });

    it('should reject if member profile does not exist', async () => {
      const lbProfile: LoadBalancerProfile = {
        version: 1,
        type: 'loadbalancer',
        policy: 'roundrobin',
        profiles: ['profile1', 'missing-profile'],
        provider: '',
        model: '',
        modelParams: {},
        ephemeralSettings: {},
      };

      const profile1: Profile = {
        version: 1,
        provider: 'openai',
        model: 'gpt-4',
        modelParams: {},
        ephemeralSettings: {},
      };

      mockFs.readFile.mockImplementation(async (filePath: string) => {
        if (filePath.includes('profile1.json')) {
          return JSON.stringify(profile1);
        }
        throw new Error('ENOENT');
      });
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.readdir.mockResolvedValue(['profile1.json'] as never);

      await expect(
        profileManager.saveLoadBalancerProfile('lb-profile', lbProfile),
      ).rejects.toThrow(
        "LoadBalancer profile 'lb-profile' references non-existent profile 'missing-profile'",
      );
    });

    it('should reject if member profile is an LB profile', async () => {
      const nestedLbProfile: LoadBalancerProfile = {
        version: 1,
        type: 'loadbalancer',
        policy: 'roundrobin',
        profiles: ['profile1'],
        provider: '',
        model: '',
        modelParams: {},
        ephemeralSettings: {},
      };
      const lbProfile: LoadBalancerProfile = {
        version: 1,
        type: 'loadbalancer',
        policy: 'roundrobin',
        profiles: ['nested-lb'],
        provider: '',
        model: '',
        modelParams: {},
        ephemeralSettings: {},
      };

      mockFs.readFile.mockResolvedValue(JSON.stringify(nestedLbProfile));
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.readdir.mockResolvedValue(['nested-lb.json'] as never);

      await expect(
        profileManager.saveLoadBalancerProfile('lb-profile', lbProfile),
      ).rejects.toThrow(
        "LoadBalancer profile 'lb-profile' cannot reference another LoadBalancer profile 'nested-lb'",
      );
    });

    it('should reject empty profiles array', async () => {
      const lbProfile: LoadBalancerProfile = {
        version: 1,
        type: 'loadbalancer',
        policy: 'roundrobin',
        profiles: [],
        provider: '',
        model: '',
        modelParams: {},
        ephemeralSettings: {},
      };

      await expect(
        profileManager.saveLoadBalancerProfile('empty-lb', lbProfile),
      ).rejects.toThrow(
        "LoadBalancer profile 'empty-lb' must reference at least one profile",
      );
    });

    it('should reject unsupported version', async () => {
      const lbProfile = {
        version: 2,
        type: 'loadbalancer',
        policy: 'roundrobin',
        profiles: ['profile1'],
        provider: '',
        model: '',
        modelParams: {},
        ephemeralSettings: {},
      } as LoadBalancerProfile;

      await expect(
        profileManager.saveLoadBalancerProfile('invalid-version', lbProfile),
      ).rejects.toThrow('unsupported profile version');
    });

    it('should allow saved LB profile to be loaded back correctly', async () => {
      const profile1: Profile = {
        version: 1,
        provider: 'openai',
        model: 'gpt-4',
        modelParams: {},
        ephemeralSettings: {},
      };
      const profile2: Profile = {
        version: 1,
        provider: 'anthropic',
        model: 'claude-3',
        modelParams: {},
        ephemeralSettings: {},
      };
      const lbProfile: LoadBalancerProfile = {
        version: 1,
        type: 'loadbalancer',
        policy: 'roundrobin',
        profiles: ['profile1', 'profile2'],
        provider: '',
        model: '',
        modelParams: {},
        ephemeralSettings: {},
      };

      let savedContent = '';
      mockFs.readFile.mockImplementation(async (filePath: string) => {
        if (filePath.includes('lb-profile.json')) {
          return savedContent;
        } else if (filePath.includes('profile1.json')) {
          return JSON.stringify(profile1);
        } else if (filePath.includes('profile2.json')) {
          return JSON.stringify(profile2);
        }
        throw new Error('ENOENT');
      });
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.readdir.mockResolvedValue([
        'profile1.json',
        'profile2.json',
        'lb-profile.json',
      ] as never);
      mockFs.writeFile.mockImplementation(
        async (_path: string, content: string) => {
          savedContent = content;
        },
      );

      await profileManager.saveLoadBalancerProfile('lb-profile', lbProfile);
      const loadedProfile = await profileManager.loadProfile('lb-profile');

      expect(loadedProfile).toEqual(lbProfile);
    });
  });
});
