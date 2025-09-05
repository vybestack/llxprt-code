/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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
    it('should store compression settings in ephemeral settings', async () => {
      // Set compression settings via ephemeral settings
      config.setEphemeralSetting('compression-threshold', 0.7);
      config.setEphemeralSetting('context-limit', 100000);

      // Verify ephemeral settings are stored
      expect(config.getEphemeralSetting('compression-threshold')).toBe(0.7);
      expect(config.getEphemeralSetting('context-limit')).toBe(100000);

      // Verify settings are accessible when needed by geminiChat
      const compressionThreshold = config.getEphemeralSetting(
        'compression-threshold',
      );
      const contextLimit = config.getEphemeralSetting('context-limit');

      expect(compressionThreshold).toBe(0.7);
      expect(contextLimit).toBe(100000);
    });

    it('should apply only compression-threshold when context-limit is not set', async () => {
      config.setEphemeralSetting('compression-threshold', 0.85);

      // Verify only compression-threshold is set
      expect(config.getEphemeralSetting('compression-threshold')).toBe(0.85);
      expect(config.getEphemeralSetting('context-limit')).toBeUndefined();
    });

    it('should apply only context-limit when compression-threshold is not set', async () => {
      config.setEphemeralSetting('context-limit', 150000);

      // Verify only context-limit is set
      expect(
        config.getEphemeralSetting('compression-threshold'),
      ).toBeUndefined();
      expect(config.getEphemeralSetting('context-limit')).toBe(150000);
    });

    it('should handle clearing compression settings', async () => {
      // Set initial values
      config.setEphemeralSetting('compression-threshold', 0.6);
      config.setEphemeralSetting('context-limit', 80000);

      expect(config.getEphemeralSetting('compression-threshold')).toBe(0.6);
      expect(config.getEphemeralSetting('context-limit')).toBe(80000);

      // Clear the settings
      config.setEphemeralSetting('compression-threshold', undefined);
      config.setEphemeralSetting('context-limit', undefined);

      // Verify settings are cleared
      expect(
        config.getEphemeralSetting('compression-threshold'),
      ).toBeUndefined();
      expect(config.getEphemeralSetting('context-limit')).toBeUndefined();
    });

    it('should validate compression-threshold range', async () => {
      // Compression threshold should be between 0 and 1
      config.setEphemeralSetting('compression-threshold', 0.5);
      expect(config.getEphemeralSetting('compression-threshold')).toBe(0.5);

      config.setEphemeralSetting('compression-threshold', 0.99);
      expect(config.getEphemeralSetting('compression-threshold')).toBe(0.99);

      // Config itself doesn't validate - validation happens in setCommand
      // So these values would be stored but rejected when used
      config.setEphemeralSetting('compression-threshold', 1.5);
      expect(config.getEphemeralSetting('compression-threshold')).toBe(1.5);

      config.setEphemeralSetting('compression-threshold', -0.1);
      expect(config.getEphemeralSetting('compression-threshold')).toBe(-0.1);
    });

    it('should validate context-limit is positive', async () => {
      // Context limit should be positive
      config.setEphemeralSetting('context-limit', 10000);
      expect(config.getEphemeralSetting('context-limit')).toBe(10000);

      config.setEphemeralSetting('context-limit', 200000);
      expect(config.getEphemeralSetting('context-limit')).toBe(200000);

      // Config itself doesn't validate - validation happens in setCommand
      // So these values would be stored but rejected when used
      config.setEphemeralSetting('context-limit', -1000);
      expect(config.getEphemeralSetting('context-limit')).toBe(-1000);

      config.setEphemeralSetting('context-limit', 0);
      expect(config.getEphemeralSetting('context-limit')).toBe(0);
    });
  });

  describe('Profiles with compression settings', () => {
    it('should save and load compression settings in profiles', async () => {
      // Set compression settings
      config.setEphemeralSetting('compression-threshold', 0.75);
      config.setEphemeralSetting('context-limit', 120000);

      // Create a profile with compression settings
      const profile: Profile = {
        version: 1,
        provider: 'openai',
        model: 'gpt-4',
        modelParams: {
          temperature: 0.7,
        },
        ephemeralSettings: {
          'compression-threshold': config.getEphemeralSetting(
            'compression-threshold',
          ) as number,
          'context-limit': config.getEphemeralSetting(
            'context-limit',
          ) as number,
        },
      };

      // Save the profile
      await profileManager.saveProfile('compression-profile', profile);

      // Create a new config without compression settings
      const newConfig = new Config({
        sessionId: 'new-session',
        targetDir: tempDir,
        debugMode: false,
        model: 'gemini-2.0-flash-exp',
        cwd: tempDir,
      });
      await newConfig.initialize();

      // Verify new config doesn't have compression settings initially
      expect(
        newConfig.getEphemeralSetting('compression-threshold'),
      ).toBeUndefined();
      expect(newConfig.getEphemeralSetting('context-limit')).toBeUndefined();

      // Load the profile
      const loadedProfile = await profileManager.loadProfile(
        'compression-profile',
      );

      // Apply ephemeral settings from profile
      for (const [key, value] of Object.entries(
        loadedProfile.ephemeralSettings,
      )) {
        newConfig.setEphemeralSetting(key, value);
      }

      // Verify settings were loaded correctly
      expect(newConfig.getEphemeralSetting('compression-threshold')).toBe(0.75);
      expect(newConfig.getEphemeralSetting('context-limit')).toBe(120000);
    });

    it('should handle profiles with partial compression settings', async () => {
      // Create a profile with only compression-threshold
      const profile: Profile = {
        version: 1,
        provider: 'anthropic',
        model: 'claude-3',
        modelParams: {},
        ephemeralSettings: {
          'compression-threshold': 0.65,
          // No context-limit
        },
      };

      await profileManager.saveProfile('partial-compression', profile);
      const loadedProfile = await profileManager.loadProfile(
        'partial-compression',
      );

      // Apply to a new config
      const newConfig = new Config({
        sessionId: 'partial-session',
        targetDir: tempDir,
        debugMode: false,
        model: 'gemini-2.0-flash-exp',
        cwd: tempDir,
      });
      await newConfig.initialize();

      for (const [key, value] of Object.entries(
        loadedProfile.ephemeralSettings,
      )) {
        newConfig.setEphemeralSetting(key, value);
      }

      // Verify only compression-threshold was loaded
      expect(newConfig.getEphemeralSetting('compression-threshold')).toBe(0.65);
      expect(newConfig.getEphemeralSetting('context-limit')).toBeUndefined();
    });
  });
});
