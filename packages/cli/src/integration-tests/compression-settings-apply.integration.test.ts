/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as path from 'node:path';
import type { Profile } from '@vybestack/llxprt-code-settings';
import { Config } from '@vybestack/llxprt-code-core';
import { ProfileManager } from '@vybestack/llxprt-code-settings';
import {
  createTempDirectory,
  cleanupTempDirectory,
  initializeTestSessionRoot,
  type CliTestSessionRoot,
} from './test-utils.js';

describe('Compression Settings Apply Integration Tests', () => {
  let tempDir: string;
  let config: Config;
  let sessionRoot: CliTestSessionRoot;
  let profileManager: ProfileManager;
  let originalHome: string | undefined;
  let originalArgv: string[];

  beforeEach(async () => {
    // Store original HOME environment variable
    originalHome = process.env.HOME;
    originalArgv = process.argv;

    // Create a temporary directory for our test
    tempDir = await createTempDirectory();

    // HOME still steers the home-relative roots (~/.llxprt, ~/.agents), which
    // have no environment override. It does NOT steer ProfileManager: the
    // platform paths come from env-paths, evaluated once at module load, so the
    // no-argument constructor resolves the ambient global config root. Hence
    // the explicit per-test directory below.
    process.env.HOME = tempDir;
    profileManager = new ProfileManager(path.join(tempDir, 'profiles'));

    // Create a basic config instance
    config = new Config({
      sessionId: 'test-session',
      targetDir: tempDir,
      initialSettings: {},
      debugMode: false,
      model: 'gemini-2.0-flash-exp',
      cwd: tempDir,
    });

    // Initialize the config
    sessionRoot = await initializeTestSessionRoot(config);
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
      sessionRoot.agent.setEphemeralSetting('compression-threshold', 0.7);
      sessionRoot.agent.setEphemeralSetting('context-limit', 100000);

      // Verify ephemeral settings are stored
      expect(
        sessionRoot.agent.getEphemeralSetting('compression-threshold'),
      ).toBe(0.7);
      expect(sessionRoot.agent.getEphemeralSetting('context-limit')).toBe(
        100000,
      );

      // Verify settings are accessible when needed by chatSession
      const compressionThreshold = sessionRoot.agent.getEphemeralSetting(
        'compression-threshold',
      );
      const contextLimit =
        sessionRoot.agent.getEphemeralSetting('context-limit');

      expect(compressionThreshold).toBe(0.7);
      expect(contextLimit).toBe(100000);
    });

    it('should apply only compression-threshold when context-limit is not set', async () => {
      sessionRoot.agent.setEphemeralSetting('compression-threshold', 0.85);

      // Verify only compression-threshold is set
      expect(
        sessionRoot.agent.getEphemeralSetting('compression-threshold'),
      ).toBe(0.85);
      expect(
        sessionRoot.agent.getEphemeralSetting('context-limit'),
      ).toBeUndefined();
    });

    it('should apply only context-limit when compression-threshold is not set', async () => {
      sessionRoot.agent.setEphemeralSetting('context-limit', 150000);

      // Verify only context-limit is set
      expect(
        sessionRoot.agent.getEphemeralSetting('compression-threshold'),
      ).toBeUndefined();
      expect(sessionRoot.agent.getEphemeralSetting('context-limit')).toBe(
        150000,
      );
    });

    it('should handle clearing compression settings', async () => {
      // Set initial values
      sessionRoot.agent.setEphemeralSetting('compression-threshold', 0.6);
      sessionRoot.agent.setEphemeralSetting('context-limit', 80000);

      expect(
        sessionRoot.agent.getEphemeralSetting('compression-threshold'),
      ).toBe(0.6);
      expect(sessionRoot.agent.getEphemeralSetting('context-limit')).toBe(
        80000,
      );

      // Clear the settings
      sessionRoot.agent.setEphemeralSetting('compression-threshold', undefined);
      sessionRoot.agent.setEphemeralSetting('context-limit', undefined);

      // Verify settings are cleared
      expect(
        sessionRoot.agent.getEphemeralSetting('compression-threshold'),
      ).toBeUndefined();
      expect(
        sessionRoot.agent.getEphemeralSetting('context-limit'),
      ).toBeUndefined();
    });

    it('should validate compression-threshold range', async () => {
      // Compression threshold should be between 0 and 1
      sessionRoot.agent.setEphemeralSetting('compression-threshold', 0.5);
      expect(
        sessionRoot.agent.getEphemeralSetting('compression-threshold'),
      ).toBe(0.5);

      sessionRoot.agent.setEphemeralSetting('compression-threshold', 0.99);
      expect(
        sessionRoot.agent.getEphemeralSetting('compression-threshold'),
      ).toBe(0.99);

      // Config itself doesn't validate - validation happens in setCommand
      // So these values would be stored but rejected when used
      sessionRoot.agent.setEphemeralSetting('compression-threshold', 1.5);
      expect(
        sessionRoot.agent.getEphemeralSetting('compression-threshold'),
      ).toBe(1.5);

      sessionRoot.agent.setEphemeralSetting('compression-threshold', -0.1);
      expect(
        sessionRoot.agent.getEphemeralSetting('compression-threshold'),
      ).toBe(-0.1);
    });

    it('should validate context-limit is positive', async () => {
      // Context limit should be positive
      sessionRoot.agent.setEphemeralSetting('context-limit', 10000);
      expect(sessionRoot.agent.getEphemeralSetting('context-limit')).toBe(
        10000,
      );

      sessionRoot.agent.setEphemeralSetting('context-limit', 200000);
      expect(sessionRoot.agent.getEphemeralSetting('context-limit')).toBe(
        200000,
      );

      // Config validates the value now rather than deferring to setCommand: a
      // non-positive context limit is rejected and leaves the setting unset.
      sessionRoot.agent.setEphemeralSetting('context-limit', -1000);
      expect(
        sessionRoot.agent.getEphemeralSetting('context-limit'),
      ).toBeUndefined();

      sessionRoot.agent.setEphemeralSetting('context-limit', 0);
      expect(
        sessionRoot.agent.getEphemeralSetting('context-limit'),
      ).toBeUndefined();
    });
  });

  describe('Profiles with compression settings', () => {
    it('should save and load compression settings in profiles', async () => {
      // Set compression settings
      sessionRoot.agent.setEphemeralSetting('compression-threshold', 0.75);
      sessionRoot.agent.setEphemeralSetting('context-limit', 120000);

      // Create a profile with compression settings
      const profile: Profile = {
        version: 1,
        provider: 'openai',
        model: 'gpt-4',
        modelParams: {
          temperature: 0.7,
        },
        ephemeralSettings: {
          'compression-threshold': sessionRoot.agent.getEphemeralSetting(
            'compression-threshold',
          ) as number,
          'context-limit': sessionRoot.agent.getEphemeralSetting(
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
        initialSettings: {},
        debugMode: false,
        model: 'gemini-2.0-flash-exp',
        cwd: tempDir,
      });
      const newSessionRoot = await initializeTestSessionRoot(newConfig);

      // Verify new config doesn't have compression settings initially
      expect(
        newSessionRoot.agent.getEphemeralSetting('compression-threshold'),
      ).toBeUndefined();
      expect(
        newSessionRoot.agent.getEphemeralSetting('context-limit'),
      ).toBeUndefined();

      // Load the profile
      const loadedProfile = await profileManager.loadProfile(
        'compression-profile',
      );

      // Apply ephemeral settings from profile
      for (const [key, value] of Object.entries(
        loadedProfile.ephemeralSettings,
      )) {
        newSessionRoot.agent.setEphemeralSetting(key, value);
      }

      // Verify settings were loaded correctly
      expect(
        newSessionRoot.agent.getEphemeralSetting('compression-threshold'),
      ).toBe(0.75);
      expect(newSessionRoot.agent.getEphemeralSetting('context-limit')).toBe(
        120000,
      );
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
        initialSettings: {},
        debugMode: false,
        model: 'gemini-2.0-flash-exp',
        cwd: tempDir,
      });
      const newSessionRoot = await initializeTestSessionRoot(newConfig);

      for (const [key, value] of Object.entries(
        loadedProfile.ephemeralSettings,
      )) {
        newSessionRoot.agent.setEphemeralSetting(key, value);
      }

      // Verify only compression-threshold was loaded
      expect(
        newSessionRoot.agent.getEphemeralSetting('compression-threshold'),
      ).toBe(0.65);
      expect(
        newSessionRoot.agent.getEphemeralSetting('context-limit'),
      ).toBeUndefined();
    });
  });
});
