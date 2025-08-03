/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { ProfileManager, Profile } from '@vybestack/llxprt-code-core';
import {
  createTempDirectory,
  cleanupTempDirectory,
  createTempKeyfile,
} from './test-utils.js';

describe('Profile Save/Load Cycle Integration Tests', () => {
  let tempDir: string;
  let profileManager: ProfileManager;
  let originalHome: string | undefined;

  beforeEach(async () => {
    // Store original HOME environment variable
    originalHome = process.env.HOME;

    // Create a temporary directory for our test
    tempDir = await createTempDirectory();

    // Set HOME to our temp directory so ProfileManager uses it
    process.env.HOME = tempDir;

    // Create a new ProfileManager instance (will use our temp HOME)
    profileManager = new ProfileManager();
  });

  afterEach(async () => {
    // Restore original HOME
    if (originalHome !== undefined) {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }

    // Clean up temp directory
    await cleanupTempDirectory(tempDir);
  });

  describe('Basic Save/Load Operations', () => {
    it('should save a profile to disk and load it back', async () => {
      // Create a test profile
      const testProfile: Profile = {
        version: 1,
        provider: 'anthropic',
        model: 'claude-3-5-sonnet-20240620',
        modelParams: {
          temperature: 0.7,
          max_tokens: 4096,
          top_p: 0.95,
        },
        ephemeralSettings: {
          'context-limit': 200000,
          'compression-threshold': 0.8,
          'auth-key': 'test-api-key-123',
          'base-url': 'https://api.anthropic.com',
        },
      };

      // Save the profile
      await profileManager.saveProfile('test-profile', testProfile);

      // Verify the file was created
      const profilePath = path.join(
        tempDir,
        '.llxprt',
        'profiles',
        'test-profile.json',
      );
      const fileExists = await fs
        .access(profilePath)
        .then(() => true)
        .catch(() => false);
      expect(fileExists).toBe(true);

      // Load the profile back
      const loadedProfile = await profileManager.loadProfile('test-profile');

      // Verify all fields match
      expect(loadedProfile).toEqual(testProfile);
      expect(loadedProfile.version).toBe(1);
      expect(loadedProfile.provider).toBe('anthropic');
      expect(loadedProfile.model).toBe('claude-3-5-sonnet-20240620');
      expect(loadedProfile.modelParams.temperature).toBe(0.7);
      expect(loadedProfile.ephemeralSettings['auth-key']).toBe(
        'test-api-key-123',
      );
    });

    it('should save multiple profiles and list them all', async () => {
      const profiles: Record<string, Profile> = {
        'openai-gpt4': {
          version: 1,
          provider: 'openai',
          model: 'gpt-4o',
          modelParams: { temperature: 0.5, max_tokens: 8192 },
          ephemeralSettings: { 'auth-key': 'sk-test-123' },
        },
        'google-gemini': {
          version: 1,
          provider: 'google',
          model: 'gemini-pro',
          modelParams: { temperature: 0.8, top_k: 40 },
          ephemeralSettings: { 'auth-key': 'google-key-456' },
        },
        'azure-deployment': {
          version: 1,
          provider: 'azureopenai',
          model: 'gpt-4o',
          modelParams: { temperature: 0.6 },
          ephemeralSettings: {
            'auth-key': 'azure-key-789',
            'base-url': 'https://myazure.openai.azure.com',
            'api-version': '2024-02-01',
          },
        },
      };

      // Save all profiles
      for (const [name, profile] of Object.entries(profiles)) {
        await profileManager.saveProfile(name, profile);
      }

      // List all profiles
      const profileList = await profileManager.listProfiles();
      expect(profileList).toHaveLength(3);
      expect(profileList).toContain('openai-gpt4');
      expect(profileList).toContain('google-gemini');
      expect(profileList).toContain('azure-deployment');

      // Load and verify each profile
      for (const [name, expectedProfile] of Object.entries(profiles)) {
        const loadedProfile = await profileManager.loadProfile(name);
        expect(loadedProfile).toEqual(expectedProfile);
      }
    });
  });

  describe('JSON File Structure', () => {
    it('should save profiles with proper JSON formatting', async () => {
      const profile: Profile = {
        version: 1,
        provider: 'anthropic',
        model: 'claude-3-opus-20240229',
        modelParams: {
          temperature: 0.3,
          max_tokens: 2048,
          presence_penalty: 0.1,
          frequency_penalty: 0.2,
        },
        ephemeralSettings: {
          'context-limit': 100000,
          'compression-threshold': 0.7,
          'auth-keyfile': '/path/to/keyfile',
          'custom-headers': {
            'X-Custom-Header': 'test-value',
            'X-Another-Header': 'another-value',
          },
        },
      };

      await profileManager.saveProfile('json-test', profile);

      // Read the raw JSON file
      const profilePath = path.join(
        tempDir,
        '.llxprt',
        'profiles',
        'json-test.json',
      );
      const rawContent = await fs.readFile(profilePath, 'utf8');
      const parsedContent = JSON.parse(rawContent);

      // Verify JSON structure
      expect(parsedContent).toEqual(profile);

      // Verify formatting (should be pretty-printed with 2-space indentation)
      expect(rawContent).toContain('  "version": 1');
      expect(rawContent).toContain('  "provider": "anthropic"');
      expect(rawContent).toContain('    "temperature": 0.3');
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should throw error when loading non-existent profile', async () => {
      await expect(
        profileManager.loadProfile('does-not-exist'),
      ).rejects.toThrow("Profile 'does-not-exist' not found");
    });

    it('should throw error when loading profile with invalid JSON', async () => {
      // Create a profile with invalid JSON
      const profilesDir = path.join(tempDir, '.llxprt', 'profiles');
      await fs.mkdir(profilesDir, { recursive: true });
      const invalidPath = path.join(profilesDir, 'invalid.json');
      await fs.writeFile(invalidPath, '{ invalid json content', 'utf8');

      await expect(profileManager.loadProfile('invalid')).rejects.toThrow(
        "Profile 'invalid' is corrupted",
      );
    });

    it('should throw error when loading profile with missing required fields', async () => {
      // Create a profile missing required fields
      const profilesDir = path.join(tempDir, '.llxprt', 'profiles');
      await fs.mkdir(profilesDir, { recursive: true });
      const incompletePath = path.join(profilesDir, 'incomplete.json');

      // Missing modelParams and ephemeralSettings
      await fs.writeFile(
        incompletePath,
        JSON.stringify({
          version: 1,
          provider: 'openai',
          model: 'gpt-4',
        }),
        'utf8',
      );

      await expect(profileManager.loadProfile('incomplete')).rejects.toThrow(
        "Profile 'incomplete' is invalid: missing required fields",
      );
    });

    it('should throw error when loading profile with unsupported version', async () => {
      const profilesDir = path.join(tempDir, '.llxprt', 'profiles');
      await fs.mkdir(profilesDir, { recursive: true });
      const futurePath = path.join(profilesDir, 'future-version.json');

      await fs.writeFile(
        futurePath,
        JSON.stringify({
          version: 2, // Unsupported version
          provider: 'openai',
          model: 'gpt-4',
          modelParams: {},
          ephemeralSettings: {},
        }),
        'utf8',
      );

      await expect(
        profileManager.loadProfile('future-version'),
      ).rejects.toThrow('unsupported profile version');
    });

    it('should handle empty profile list gracefully', async () => {
      // Don't create any profiles
      const profileList = await profileManager.listProfiles();
      expect(profileList).toEqual([]);
    });

    it('should create profiles directory if it does not exist', async () => {
      // Verify directory doesn't exist initially
      const profilesDir = path.join(tempDir, '.llxprt', 'profiles');
      let dirExists = await fs
        .access(profilesDir)
        .then(() => true)
        .catch(() => false);
      expect(dirExists).toBe(false);

      // Save a profile
      const profile: Profile = {
        version: 1,
        provider: 'openai',
        model: 'gpt-4o-mini',
        modelParams: {},
        ephemeralSettings: {},
      };
      await profileManager.saveProfile('test', profile);

      // Verify directory was created
      dirExists = await fs
        .access(profilesDir)
        .then(() => true)
        .catch(() => false);
      expect(dirExists).toBe(true);
    });

    it('should overwrite existing profile when saving with same name', async () => {
      const originalProfile: Profile = {
        version: 1,
        provider: 'openai',
        model: 'gpt-4o-mini',
        modelParams: { temperature: 0.5 },
        ephemeralSettings: { 'auth-key': 'original-key' },
      };

      const updatedProfile: Profile = {
        version: 1,
        provider: 'anthropic',
        model: 'claude-3-5-haiku-20241022',
        modelParams: { temperature: 0.8 },
        ephemeralSettings: { 'auth-key': 'updated-key' },
      };

      // Save original profile
      await profileManager.saveProfile('overwrite-test', originalProfile);

      // Load and verify original
      let loaded = await profileManager.loadProfile('overwrite-test');
      expect(loaded.provider).toBe('openai');
      expect(loaded.ephemeralSettings['auth-key']).toBe('original-key');

      // Save updated profile with same name
      await profileManager.saveProfile('overwrite-test', updatedProfile);

      // Load and verify update
      loaded = await profileManager.loadProfile('overwrite-test');
      expect(loaded.provider).toBe('anthropic');
      expect(loaded.ephemeralSettings['auth-key']).toBe('updated-key');
    });
  });

  describe('Complex Profile Configurations', () => {
    it('should handle profiles with auth-keyfile references', async () => {
      // Create a temporary keyfile
      const keyfilePath = await createTempKeyfile(
        tempDir,
        'secret-api-key-content',
      );

      const profile: Profile = {
        version: 1,
        provider: 'openai',
        model: 'gpt-4',
        modelParams: {
          temperature: 0.7,
          max_tokens: 4096,
          seed: 12345,
        },
        ephemeralSettings: {
          'auth-keyfile': keyfilePath,
          'context-limit': 128000,
          'compression-threshold': 0.85,
        },
      };

      await profileManager.saveProfile('keyfile-profile', profile);
      const loaded = await profileManager.loadProfile('keyfile-profile');

      expect(loaded.ephemeralSettings['auth-keyfile']).toBe(keyfilePath);
      expect(loaded.modelParams.seed).toBe(12345);
    });

    it('should handle profiles with all possible settings', async () => {
      const comprehensiveProfile: Profile = {
        version: 1,
        provider: 'azureopenai',
        model: 'gpt-4o-deployment',
        modelParams: {
          temperature: 0.6,
          max_tokens: 8192,
          top_p: 0.9,
          top_k: 50,
          presence_penalty: 0.1,
          frequency_penalty: 0.2,
          seed: 42,
          // Provider-specific params
          logprobs: true,
          top_logprobs: 3,
        },
        ephemeralSettings: {
          'context-limit': 128000,
          'compression-threshold': 0.75,
          'auth-key': 'azure-key-comprehensive',
          'base-url': 'https://my-deployment.openai.azure.com',
          'api-version': '2024-06-01',
          'tool-format': 'azure',
          'custom-headers': {
            'X-Organization-ID': 'org-123',
            'X-Project-ID': 'proj-456',
            'X-Custom-Tracking': 'enabled',
          },
        },
      };

      await profileManager.saveProfile('comprehensive', comprehensiveProfile);
      const loaded = await profileManager.loadProfile('comprehensive');

      // Verify all fields are preserved
      expect(loaded).toEqual(comprehensiveProfile);
      expect(loaded.modelParams.logprobs).toBe(true);
      expect(loaded.modelParams.top_logprobs).toBe(3);
      expect(loaded.ephemeralSettings['custom-headers']).toEqual({
        'X-Organization-ID': 'org-123',
        'X-Project-ID': 'proj-456',
        'X-Custom-Tracking': 'enabled',
      });
    });

    it('should handle profiles with minimal settings', async () => {
      const minimalProfile: Profile = {
        version: 1,
        provider: 'openai',
        model: 'gpt-4o-mini',
        modelParams: {},
        ephemeralSettings: {},
      };

      await profileManager.saveProfile('minimal', minimalProfile);
      const loaded = await profileManager.loadProfile('minimal');

      expect(loaded).toEqual(minimalProfile);
      expect(loaded.modelParams).toEqual({});
      expect(loaded.ephemeralSettings).toEqual({});
    });
  });

  describe('Profile Names and Special Characters', () => {
    it('should handle profile names with special characters', async () => {
      const specialNames = [
        'profile-with-dashes',
        'profile_with_underscores',
        'profile.with.dots',
        'UPPERCASE_PROFILE',
        'profile123',
        'profile-2025-01-15',
      ];

      const baseProfile: Profile = {
        version: 1,
        provider: 'openai',
        model: 'gpt-4',
        modelParams: {},
        ephemeralSettings: {},
      };

      // Save profiles with special names
      for (const name of specialNames) {
        await profileManager.saveProfile(name, baseProfile);
      }

      // List and verify all profiles
      const profileList = await profileManager.listProfiles();
      expect(profileList).toHaveLength(specialNames.length);

      for (const name of specialNames) {
        expect(profileList).toContain(name);
        const loaded = await profileManager.loadProfile(name);
        expect(loaded).toEqual(baseProfile);
      }
    });
  });
});
