/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ProfileManager } from '../config/profileManager.js';
import { SettingsService } from '../settings/SettingsService.js';
import { Profile } from '../types/modelParams.js';
import { getSettingsService } from '../settings/settingsServiceInstance.js';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

// Mock file system and settings service instance
vi.mock('fs/promises');
vi.mock('os');
vi.mock('path');
vi.mock('../settings/settingsServiceInstance.js');

const mockFs = fs as vi.Mocked<typeof fs>;
const mockOs = os as vi.Mocked<typeof os>;
const mockPath = path as vi.Mocked<typeof path>;
const mockGetSettingsService = getSettingsService as vi.MockedFunction<
  typeof getSettingsService
>;

class MockSettingsRepository {
  private settings: Record<string, unknown> = {
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

  async load(): Promise<Record<string, unknown>> {
    return this.settings;
  }

  async save(settings: Record<string, unknown>): Promise<void> {
    this.settings = { ...settings };
  }

  watch(_callback: (settings: Record<string, unknown>) => void): () => void {
    return () => {};
  }
}

class MockSettingsService {
  private settings: Record<string, unknown>;
  private currentProfileName: string | null = null;
  private eventListeners: Record<string, Array<(event: unknown) => void>> = {};

  constructor(repository: MockSettingsRepository) {
    this.settings = {};
    repository.load().then((settings) => {
      this.settings = settings;
      this.emit('initialized', {});
    });
  }

  async getSettings(): Promise<Record<string, unknown>> {
    return this.settings;
  }

  async updateSettings(updates: Record<string, unknown>): Promise<void> {
    this.settings = { ...this.settings, ...updates };
  }

  set(key: string, value: unknown): void {
    if (key.includes('.')) {
      const segments = key.split('.');
      let current = this.settings;
      for (let i = 0; i < segments.length - 1; i++) {
        const segment = segments[i];
        if (typeof current[segment] !== 'object' || current[segment] === null) {
          current[segment] = {};
        }
        current = current[segment] as Record<string, unknown>;
      }
      current[segments[segments.length - 1]] = value;
    } else {
      this.settings[key] = value;
    }
  }

  setCurrentProfileName(profileName: string | null): void {
    this.currentProfileName = profileName;
  }

  getCurrentProfileName(): string | null {
    return this.currentProfileName;
  }

  async exportForProfile(): Promise<Record<string, unknown>> {
    return this.settings;
  }

  async importFromProfile(profileData: Record<string, unknown>): Promise<void> {
    this.settings = { ...profileData };
    this.emit('profile-loaded', {
      type: 'profile-loaded',
      profileName: this.currentProfileName,
    });
  }

  on(event: string, listener: (event: unknown) => void): () => void {
    if (!this.eventListeners[event]) {
      this.eventListeners[event] = [];
    }
    this.eventListeners[event].push(listener);
    return () => {
      const index = this.eventListeners[event].indexOf(listener);
      if (index > -1) {
        this.eventListeners[event].splice(index, 1);
      }
    };
  }

  emit(event: string, data: unknown): void {
    if (this.eventListeners[event]) {
      this.eventListeners[event].forEach((listener) => listener(data));
    }
  }
}

describe('Profile Integration Tests', () => {
  let profileManager: ProfileManager;
  let settingsService: MockSettingsService;
  let mockRepository: MockSettingsRepository;

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

  beforeEach(async () => {
    vi.clearAllMocks();

    // Setup path mocks
    mockOs.homedir.mockReturnValue('/home/test');
    mockPath.join.mockImplementation((...args: string[]) => args.join('/'));

    // Mock file operations
    mockFs.mkdir.mockResolvedValue(undefined);
    mockFs.writeFile.mockResolvedValue();
    mockFs.readFile.mockResolvedValue(JSON.stringify(testProfile));
    mockFs.readdir.mockResolvedValue(['test-profile.json'] as never);

    // SettingsService is always enabled in the new architecture

    // Create SettingsService with mock repository
    mockRepository = new MockSettingsRepository();
    settingsService = new MockSettingsService(
      mockRepository,
    ) as unknown as MockSettingsService;

    // Mock the getSettingsService to return our mock
    mockGetSettingsService.mockReturnValue(
      settingsService as unknown as SettingsService,
    );

    // Wait for initialization
    await new Promise((resolve) => {
      settingsService.on('initialized' as never, resolve);
    });

    profileManager = new ProfileManager();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('should save and load profile through SettingsService', async () => {
    // First set some settings in SettingsService
    await settingsService.updateSettings({
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

    // Save profile through new integrated method
    await profileManager.save('test-profile', settingsService);

    // Verify the profile was saved to file
    expect(mockFs.writeFile).toHaveBeenCalled();
    expect(settingsService.getCurrentProfileName()).toBe('test-profile');

    // Reset settings to different state
    await settingsService.updateSettings({
      defaultProvider: 'gemini',
      providers: {
        gemini: {
          enabled: true,
          model: 'gemini-pro',
          temperature: 1.0,
        },
      },
    });

    // Load the profile
    await profileManager.load('test-profile', settingsService);

    // Verify settings were restored
    const currentSettings = await settingsService.getSettings();
    expect(currentSettings.defaultProvider).toBe('openai');
    expect(currentSettings.providers.openai.model).toBe('test-model');
    expect(currentSettings.providers.openai.temperature).toBe(0.7);
    expect(settingsService.getCurrentProfileName()).toBe('test-profile');
  });

  it('should track profile changes in SettingsService', async () => {
    const profileLoadedEvents: unknown[] = [];

    // Listen for profile loaded events
    settingsService.on('profile-loaded' as never, (event: unknown) => {
      profileLoadedEvents.push(event);
    });

    // Load a profile
    await profileManager.load('test-profile', settingsService);

    // Verify event was emitted
    expect(profileLoadedEvents).toHaveLength(1);
    expect(profileLoadedEvents[0]).toMatchObject({
      type: 'profile-loaded',
      profileName: 'test-profile',
    });
  });

  it('should work with SettingsService always enabled', async () => {
    // SettingsService is always available in the new architecture
    const manager = new ProfileManager();

    // Set up mock repository with current settings
    await settingsService.updateSettings({
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

    // Both integrated and direct operations should work
    await expect(
      manager.save('test-profile', settingsService),
    ).resolves.not.toThrow();

    await expect(
      manager.saveProfile('test-profile', testProfile),
    ).resolves.not.toThrow();
    await expect(manager.loadProfile('test-profile')).resolves.toEqual(
      testProfile,
    );
  });

  it('should maintain backward compatibility with existing profile format', async () => {
    // Create profile manager - SettingsService is always available
    const legacyManager = new ProfileManager();

    // Save using direct method
    await legacyManager.saveProfile('legacy-profile', testProfile);

    // Load using integrated method should still work
    const loadedProfile = await profileManager.loadProfile('legacy-profile');
    expect(loadedProfile).toEqual(testProfile);
  });
});
