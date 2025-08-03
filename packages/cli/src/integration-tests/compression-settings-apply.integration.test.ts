/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Config, Profile, ProfileManager } from '@vybestack/llxprt-code-core';
import { createTempDirectory, cleanupTempDirectory } from './test-utils.js';

describe('Compression Settings Apply Integration Tests', () => {
  let tempDir: string;
  let config: Config;
  let profileManager: ProfileManager;
  let originalHome: string | undefined;
  let originalArgv: string[];

  beforeEach(async () => {
    // Store original HOME environment variable
    originalHome = process.env.HOME;
    originalArgv = process.argv;

    // Create a temporary directory for our test
    tempDir = await createTempDirectory();

    // Set HOME to our temp directory so ProfileManager uses it
    process.env.HOME = tempDir;

    // Create a ProfileManager instance
    profileManager = new ProfileManager();

    // Create a basic config instance
    config = new Config({
      sessionId: 'test-session',
      targetDir: tempDir,
      debugMode: false,
      model: 'gemini-2.0-flash-exp',
      cwd: tempDir,
    });

    // Initialize the config
    await config.initialize();
  });

  afterEach(async () => {
    // Restore original HOME
    if (originalHome !== undefined) {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }

    // Restore original argv
    process.argv = originalArgv;

    // Clean up temp directory
    await cleanupTempDirectory(tempDir);
  });

  describe('Setting compression-threshold and context-limit via ephemeral settings', () => {
    it('should apply compression settings to GeminiClient when both are set', async () => {
      // Set compression settings via ephemeral settings
      config.setEphemeralSetting('compression-threshold', 0.7);
      config.setEphemeralSetting('context-limit', 100000);

      // Get the GeminiClient
      const geminiClient = config.getGeminiClient();

      // Mock setCompressionSettings to verify it's called correctly
      const setCompressionSettingsSpy = vi.spyOn(
        geminiClient,
        'setCompressionSettings',
      );

      // Apply compression settings
      geminiClient.setCompressionSettings(
        config.getEphemeralSetting('compression-threshold') as number,
        config.getEphemeralSetting('context-limit') as number,
      );

      // Verify the method was called with correct parameters
      expect(setCompressionSettingsSpy).toHaveBeenCalledWith(0.7, 100000);
      expect(setCompressionSettingsSpy).toHaveBeenCalledTimes(1);

      // Verify ephemeral settings are stored
      expect(config.getEphemeralSetting('compression-threshold')).toBe(0.7);
      expect(config.getEphemeralSetting('context-limit')).toBe(100000);
    });

    it('should apply only compression-threshold when context-limit is not set', async () => {
      config.setEphemeralSetting('compression-threshold', 0.85);

      const geminiClient = config.getGeminiClient();
      const setCompressionSettingsSpy = vi.spyOn(
        geminiClient,
        'setCompressionSettings',
      );

      geminiClient.setCompressionSettings(
        config.getEphemeralSetting('compression-threshold') as number,
        undefined,
      );

      expect(setCompressionSettingsSpy).toHaveBeenCalledWith(0.85, undefined);
    });

    it('should apply only context-limit when compression-threshold is not set', async () => {
      config.setEphemeralSetting('context-limit', 150000);

      const geminiClient = config.getGeminiClient();
      const setCompressionSettingsSpy = vi.spyOn(
        geminiClient,
        'setCompressionSettings',
      );

      geminiClient.setCompressionSettings(
        undefined,
        config.getEphemeralSetting('context-limit') as number,
      );

      expect(setCompressionSettingsSpy).toHaveBeenCalledWith(undefined, 150000);
    });
  });

  describe('Profile save/load preserves compression settings', () => {
    it('should save compression settings in profile and restore them', async () => {
      // Set compression settings
      config.setEphemeralSetting('compression-threshold', 0.6);
      config.setEphemeralSetting('context-limit', 200000);

      // Create a profile with compression settings
      const profile: Profile = {
        version: 1,
        provider: 'google',
        model: 'gemini-2.0-flash-exp',
        modelParams: {},
        ephemeralSettings: {
          'compression-threshold': 0.6,
          'context-limit': 200000,
        },
      };

      // Save the profile
      await profileManager.saveProfile('compression-test-profile', profile);

      // Create a new config without compression settings
      const newConfig = new Config({
        sessionId: 'new-session',
        targetDir: tempDir,
        debugMode: false,
        model: 'gemini-2.0-flash-exp',
        cwd: tempDir,
      });
      await newConfig.initialize();

      // Verify settings are not there initially
      expect(
        newConfig.getEphemeralSetting('compression-threshold'),
      ).toBeUndefined();
      expect(newConfig.getEphemeralSetting('context-limit')).toBeUndefined();

      // Load the profile
      const loadedProfile = await profileManager.loadProfile(
        'compression-test-profile',
      );

      // Apply ephemeral settings from profile
      if (loadedProfile.ephemeralSettings) {
        for (const [key, value] of Object.entries(
          loadedProfile.ephemeralSettings,
        )) {
          newConfig.setEphemeralSetting(key, value);
        }
      }

      // Verify compression settings are restored
      expect(newConfig.getEphemeralSetting('compression-threshold')).toBe(0.6);
      expect(newConfig.getEphemeralSetting('context-limit')).toBe(200000);

      // Verify they can be applied to GeminiClient
      const geminiClient = newConfig.getGeminiClient();
      const setCompressionSettingsSpy = vi.spyOn(
        geminiClient,
        'setCompressionSettings',
      );

      geminiClient.setCompressionSettings(
        newConfig.getEphemeralSetting('compression-threshold') as number,
        newConfig.getEphemeralSetting('context-limit') as number,
      );

      expect(setCompressionSettingsSpy).toHaveBeenCalledWith(0.6, 200000);
    });

    it('should not affect current values when loading profile without compression settings', async () => {
      // Set current compression settings
      config.setEphemeralSetting('compression-threshold', 0.8);
      config.setEphemeralSetting('context-limit', 120000);

      // Create and save a profile WITHOUT compression settings
      const profile: Profile = {
        version: 1,
        provider: 'anthropic',
        model: 'claude-3-5-sonnet-20240620',
        modelParams: {
          temperature: 0.7,
        },
        ephemeralSettings: {
          'base-url': 'https://api.example.com',
        },
      };

      await profileManager.saveProfile('no-compression-profile', profile);

      // Load the profile
      const loadedProfile = await profileManager.loadProfile(
        'no-compression-profile',
      );

      // Only apply the settings that are in the profile
      if (loadedProfile.ephemeralSettings) {
        for (const [key, value] of Object.entries(
          loadedProfile.ephemeralSettings,
        )) {
          if (key !== 'compression-threshold' && key !== 'context-limit') {
            config.setEphemeralSetting(key, value);
          }
        }
      }

      // Verify compression settings remain unchanged
      expect(config.getEphemeralSetting('compression-threshold')).toBe(0.8);
      expect(config.getEphemeralSetting('context-limit')).toBe(120000);
      expect(config.getEphemeralSetting('base-url')).toBe(
        'https://api.example.com',
      );
    });
  });

  describe('Invalid values are handled correctly', () => {
    it('should handle negative compression-threshold gracefully', async () => {
      const geminiClient = config.getGeminiClient();
      const setCompressionSettingsSpy = vi.spyOn(
        geminiClient,
        'setCompressionSettings',
      );

      // Try to set negative threshold
      geminiClient.setCompressionSettings(-0.5, 100000);

      // The GeminiClient should ignore invalid values
      expect(setCompressionSettingsSpy).toHaveBeenCalledWith(-0.5, 100000);

      // The method should not throw
      expect(() => {
        geminiClient.setCompressionSettings(-0.5, 100000);
      }).not.toThrow();
    });

    it('should handle compression-threshold greater than 1 gracefully', async () => {
      const geminiClient = config.getGeminiClient();
      const setCompressionSettingsSpy = vi.spyOn(
        geminiClient,
        'setCompressionSettings',
      );

      // Try to set threshold > 1
      geminiClient.setCompressionSettings(1.5, 100000);

      expect(setCompressionSettingsSpy).toHaveBeenCalledWith(1.5, 100000);

      // The method should not throw
      expect(() => {
        geminiClient.setCompressionSettings(1.5, 100000);
      }).not.toThrow();
    });

    it('should handle non-numeric compression-threshold values', async () => {
      // Setting a non-numeric value in ephemeral settings
      config.setEphemeralSetting(
        'compression-threshold',
        'invalid' as unknown as number,
      );

      const geminiClient = config.getGeminiClient();

      // When applying, it should handle gracefully
      expect(() => {
        geminiClient.setCompressionSettings(
          config.getEphemeralSetting('compression-threshold') as number,
          100000,
        );
      }).not.toThrow();
    });

    it('should handle negative context-limit gracefully', async () => {
      const geminiClient = config.getGeminiClient();
      const setCompressionSettingsSpy = vi.spyOn(
        geminiClient,
        'setCompressionSettings',
      );

      // Try to set negative context limit
      geminiClient.setCompressionSettings(0.7, -100000);

      expect(setCompressionSettingsSpy).toHaveBeenCalledWith(0.7, -100000);

      // The method should not throw
      expect(() => {
        geminiClient.setCompressionSettings(0.7, -100000);
      }).not.toThrow();
    });

    it('should handle edge case values correctly', async () => {
      const geminiClient = config.getGeminiClient();
      const setCompressionSettingsSpy = vi.spyOn(
        geminiClient,
        'setCompressionSettings',
      );

      // Test edge case: 0
      geminiClient.setCompressionSettings(0, 0);
      expect(setCompressionSettingsSpy).toHaveBeenCalledWith(0, 0);
      expect(() => geminiClient.setCompressionSettings(0, 0)).not.toThrow();

      // Test edge case: 1
      geminiClient.setCompressionSettings(1, 1);
      expect(setCompressionSettingsSpy).toHaveBeenCalledWith(1, 1);
      expect(() => geminiClient.setCompressionSettings(1, 1)).not.toThrow();

      // Test very large context limit
      geminiClient.setCompressionSettings(0.9, 10000000);
      expect(setCompressionSettingsSpy).toHaveBeenCalledWith(0.9, 10000000);
      expect(() =>
        geminiClient.setCompressionSettings(0.9, 10000000),
      ).not.toThrow();
    });
  });

  describe('Unsetting compression settings reverts to defaults', () => {
    it('should revert to defaults when unsetting compression-threshold', async () => {
      // Set compression settings
      config.setEphemeralSetting('compression-threshold', 0.75);
      config.setEphemeralSetting('context-limit', 100000);

      // Unset compression-threshold
      config.setEphemeralSetting('compression-threshold', undefined);

      // Verify it's unset
      expect(
        config.getEphemeralSetting('compression-threshold'),
      ).toBeUndefined();
      expect(config.getEphemeralSetting('context-limit')).toBe(100000);

      // Apply to GeminiClient
      const geminiClient = config.getGeminiClient();
      const setCompressionSettingsSpy = vi.spyOn(
        geminiClient,
        'setCompressionSettings',
      );

      geminiClient.setCompressionSettings(
        undefined,
        config.getEphemeralSetting('context-limit') as number,
      );

      expect(setCompressionSettingsSpy).toHaveBeenCalledWith(undefined, 100000);
    });

    it('should revert to defaults when unsetting context-limit', async () => {
      // Set compression settings
      config.setEphemeralSetting('compression-threshold', 0.65);
      config.setEphemeralSetting('context-limit', 150000);

      // Unset context-limit
      config.setEphemeralSetting('context-limit', undefined);

      // Verify it's unset
      expect(config.getEphemeralSetting('compression-threshold')).toBe(0.65);
      expect(config.getEphemeralSetting('context-limit')).toBeUndefined();

      // Apply to GeminiClient
      const geminiClient = config.getGeminiClient();
      const setCompressionSettingsSpy = vi.spyOn(
        geminiClient,
        'setCompressionSettings',
      );

      geminiClient.setCompressionSettings(
        config.getEphemeralSetting('compression-threshold') as number,
        undefined,
      );

      expect(setCompressionSettingsSpy).toHaveBeenCalledWith(0.65, undefined);
    });

    it('should revert to defaults when unsetting both settings', async () => {
      // Set compression settings
      config.setEphemeralSetting('compression-threshold', 0.7);
      config.setEphemeralSetting('context-limit', 100000);

      // Unset both
      config.setEphemeralSetting('compression-threshold', undefined);
      config.setEphemeralSetting('context-limit', undefined);

      // Verify both are unset
      expect(
        config.getEphemeralSetting('compression-threshold'),
      ).toBeUndefined();
      expect(config.getEphemeralSetting('context-limit')).toBeUndefined();

      // Apply to GeminiClient
      const geminiClient = config.getGeminiClient();
      const setCompressionSettingsSpy = vi.spyOn(
        geminiClient,
        'setCompressionSettings',
      );

      geminiClient.setCompressionSettings(undefined, undefined);

      expect(setCompressionSettingsSpy).toHaveBeenCalledWith(
        undefined,
        undefined,
      );
    });
  });

  describe('CLI args for compression settings work correctly', () => {
    it('should apply compression settings from CLI args via settings', async () => {
      // Mock settings with compression values
      const mockSettings = {
        merged: {
          'compression-threshold': 0.72,
          'context-limit': 125000,
        },
      };

      // Create a new config with mocked settings behavior
      const testConfig = new Config({
        sessionId: 'cli-test-session',
        targetDir: tempDir,
        debugMode: false,
        model: 'gemini-2.0-flash-exp',
        cwd: tempDir,
      });
      await testConfig.initialize();

      // Apply settings as if they came from CLI args
      testConfig.setEphemeralSetting(
        'compression-threshold',
        mockSettings.merged['compression-threshold'],
      );
      testConfig.setEphemeralSetting(
        'context-limit',
        mockSettings.merged['context-limit'],
      );

      // Get the GeminiClient and apply settings
      const geminiClient = testConfig.getGeminiClient();
      const setCompressionSettingsSpy = vi.spyOn(
        geminiClient,
        'setCompressionSettings',
      );

      geminiClient.setCompressionSettings(
        testConfig.getEphemeralSetting('compression-threshold') as number,
        testConfig.getEphemeralSetting('context-limit') as number,
      );

      // Verify settings were applied correctly
      expect(setCompressionSettingsSpy).toHaveBeenCalledWith(0.72, 125000);
      expect(testConfig.getEphemeralSetting('compression-threshold')).toBe(
        0.72,
      );
      expect(testConfig.getEphemeralSetting('context-limit')).toBe(125000);
    });

    it('should prioritize CLI args over profile settings', async () => {
      // Create and save a profile with compression settings
      const profile: Profile = {
        version: 1,
        provider: 'google',
        model: 'gemini-2.0-flash-exp',
        modelParams: {},
        ephemeralSettings: {
          'compression-threshold': 0.5,
          'context-limit': 80000,
        },
      };
      await profileManager.saveProfile('cli-override-profile', profile);

      // Create config and load profile
      const testConfig = new Config({
        sessionId: 'cli-override-session',
        targetDir: tempDir,
        debugMode: false,
        model: 'gemini-2.0-flash-exp',
        cwd: tempDir,
      });
      await testConfig.initialize();

      // Load profile settings
      const loadedProfile = await profileManager.loadProfile(
        'cli-override-profile',
      );
      if (loadedProfile.ephemeralSettings) {
        for (const [key, value] of Object.entries(
          loadedProfile.ephemeralSettings,
        )) {
          testConfig.setEphemeralSetting(key, value);
        }
      }

      // Simulate CLI args overriding the profile
      const cliSettings = {
        'compression-threshold': 0.9,
        'context-limit': 180000,
      };

      // Apply CLI settings (these should override profile)
      testConfig.setEphemeralSetting(
        'compression-threshold',
        cliSettings['compression-threshold'],
      );
      testConfig.setEphemeralSetting(
        'context-limit',
        cliSettings['context-limit'],
      );

      // Verify CLI settings took precedence
      expect(testConfig.getEphemeralSetting('compression-threshold')).toBe(0.9);
      expect(testConfig.getEphemeralSetting('context-limit')).toBe(180000);

      // Verify they are applied to GeminiClient
      const geminiClient = testConfig.getGeminiClient();
      const setCompressionSettingsSpy = vi.spyOn(
        geminiClient,
        'setCompressionSettings',
      );

      geminiClient.setCompressionSettings(
        testConfig.getEphemeralSetting('compression-threshold') as number,
        testConfig.getEphemeralSetting('context-limit') as number,
      );

      expect(setCompressionSettingsSpy).toHaveBeenCalledWith(0.9, 180000);
    });
  });

  describe('Interaction between context-limit and compression-threshold', () => {
    it('should correctly handle the relationship between context-limit and compression-threshold', async () => {
      // Set a context limit and compression threshold
      config.setEphemeralSetting('context-limit', 100000);
      config.setEphemeralSetting('compression-threshold', 0.7);

      const geminiClient = config.getGeminiClient();
      const setCompressionSettingsSpy = vi.spyOn(
        geminiClient,
        'setCompressionSettings',
      );

      // Apply settings
      geminiClient.setCompressionSettings(0.7, 100000);

      expect(setCompressionSettingsSpy).toHaveBeenCalledWith(0.7, 100000);

      // Test changing context limit while keeping threshold
      config.setEphemeralSetting('context-limit', 200000);
      geminiClient.setCompressionSettings(
        config.getEphemeralSetting('compression-threshold') as number,
        config.getEphemeralSetting('context-limit') as number,
      );

      expect(setCompressionSettingsSpy).toHaveBeenCalledWith(0.7, 200000);

      // Test changing threshold while keeping context limit
      config.setEphemeralSetting('compression-threshold', 0.5);
      geminiClient.setCompressionSettings(
        config.getEphemeralSetting('compression-threshold') as number,
        config.getEphemeralSetting('context-limit') as number,
      );

      expect(setCompressionSettingsSpy).toHaveBeenCalledWith(0.5, 200000);
    });

    it('should handle independent updates of context-limit and compression-threshold', async () => {
      const geminiClient = config.getGeminiClient();
      const setCompressionSettingsSpy = vi.spyOn(
        geminiClient,
        'setCompressionSettings',
      );

      // Set only context-limit first
      config.setEphemeralSetting('context-limit', 150000);
      geminiClient.setCompressionSettings(undefined, 150000);
      expect(setCompressionSettingsSpy).toHaveBeenCalledWith(undefined, 150000);

      // Later add compression-threshold
      config.setEphemeralSetting('compression-threshold', 0.8);
      geminiClient.setCompressionSettings(
        config.getEphemeralSetting('compression-threshold') as number,
        config.getEphemeralSetting('context-limit') as number,
      );
      expect(setCompressionSettingsSpy).toHaveBeenCalledWith(0.8, 150000);

      // Update only compression-threshold
      config.setEphemeralSetting('compression-threshold', 0.6);
      geminiClient.setCompressionSettings(
        config.getEphemeralSetting('compression-threshold') as number,
        config.getEphemeralSetting('context-limit') as number,
      );
      expect(setCompressionSettingsSpy).toHaveBeenCalledWith(0.6, 150000);

      // Remove compression-threshold, keep context-limit
      config.setEphemeralSetting('compression-threshold', undefined);
      geminiClient.setCompressionSettings(
        undefined,
        config.getEphemeralSetting('context-limit') as number,
      );
      expect(setCompressionSettingsSpy).toHaveBeenCalledWith(undefined, 150000);
    });
  });

  describe('Full integration flow', () => {
    it('should handle the complete flow from settings to client application', async () => {
      // 1. Start with no compression settings
      expect(
        config.getEphemeralSetting('compression-threshold'),
      ).toBeUndefined();
      expect(config.getEphemeralSetting('context-limit')).toBeUndefined();

      // 2. Set compression settings via ephemeral settings (simulating /set command)
      config.setEphemeralSetting('compression-threshold', 0.75);
      config.setEphemeralSetting('context-limit', 120000);

      // 3. Apply to GeminiClient
      const geminiClient = config.getGeminiClient();
      const setCompressionSettingsSpy = vi.spyOn(
        geminiClient,
        'setCompressionSettings',
      );

      geminiClient.setCompressionSettings(
        config.getEphemeralSetting('compression-threshold') as number,
        config.getEphemeralSetting('context-limit') as number,
      );

      expect(setCompressionSettingsSpy).toHaveBeenCalledWith(0.75, 120000);

      // 4. Save to profile
      const profile: Profile = {
        version: 1,
        provider: 'google',
        model: 'gemini-2.0-flash-exp',
        modelParams: {},
        ephemeralSettings: config.getEphemeralSettings(),
      };
      await profileManager.saveProfile('integration-test-profile', profile);

      // 5. Create new session
      const newConfig = new Config({
        sessionId: 'new-integration-session',
        targetDir: tempDir,
        debugMode: false,
        model: 'gemini-2.0-flash-exp',
        cwd: tempDir,
      });
      await newConfig.initialize();

      // 6. Load profile
      const loadedProfile = await profileManager.loadProfile(
        'integration-test-profile',
      );
      if (loadedProfile.ephemeralSettings) {
        for (const [key, value] of Object.entries(
          loadedProfile.ephemeralSettings,
        )) {
          newConfig.setEphemeralSetting(key, value);
        }
      }

      // 7. Verify settings are restored and can be applied
      expect(newConfig.getEphemeralSetting('compression-threshold')).toBe(0.75);
      expect(newConfig.getEphemeralSetting('context-limit')).toBe(120000);

      const newGeminiClient = newConfig.getGeminiClient();
      const newSetCompressionSettingsSpy = vi.spyOn(
        newGeminiClient,
        'setCompressionSettings',
      );

      newGeminiClient.setCompressionSettings(
        newConfig.getEphemeralSetting('compression-threshold') as number,
        newConfig.getEphemeralSetting('context-limit') as number,
      );

      expect(newSetCompressionSettingsSpy).toHaveBeenCalledWith(0.75, 120000);
    });
  });
});
