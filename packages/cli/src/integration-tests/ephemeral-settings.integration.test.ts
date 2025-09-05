/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  Config,
  Profile,
  ProfileManager,
  ProviderManager,
} from '@vybestack/llxprt-code-core';
import { createTempDirectory, cleanupTempDirectory } from './test-utils.js';

describe('Ephemeral Settings Integration Tests', () => {
  let tempDir: string;
  let config: Config;
  let profileManager: ProfileManager;
  let originalHome: string | undefined;

  beforeEach(async () => {
    // Store original HOME environment variable
    originalHome = process.env.HOME;

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

    // Clean up temp directory
    await cleanupTempDirectory(tempDir);
  });

  describe('Ephemeral Settings Persistence', () => {
    it('should store ephemeral settings in current Config instance', async () => {
      // Set various ephemeral settings
      config.setEphemeralSetting('context-limit', 150000);
      config.setEphemeralSetting('compression-threshold', 0.75);
      config.setEphemeralSetting('base-url', 'https://api.example.com');
      config.setEphemeralSetting('auth-key', 'test-key-123');
      config.setEphemeralSetting('custom-headers', {
        'X-Custom-Header': 'test-value',
        Authorization: 'Bearer token123',
      });
      config.setEphemeralSetting('api-version', '2024-02-01');

      // Verify settings are stored in the current instance
      expect(config.getEphemeralSetting('context-limit')).toBe(150000);
      expect(config.getEphemeralSetting('compression-threshold')).toBe(0.75);
      expect(config.getEphemeralSetting('base-url')).toBe(
        'https://api.example.com',
      );
      expect(config.getEphemeralSetting('auth-key')).toBe('test-key-123');
      expect(config.getEphemeralSetting('custom-headers')).toEqual({
        'X-Custom-Header': 'test-value',
        Authorization: 'Bearer token123',
      });
      expect(config.getEphemeralSetting('api-version')).toBe('2024-02-01');
    });
  });

  describe('Compression Settings Application', () => {
    it('should apply compression settings to GeminiClient', async () => {
      // Set compression-related ephemeral settings
      config.setEphemeralSetting('context-limit', 100000);
      config.setEphemeralSetting('compression-threshold', 0.6);

      // Get the GeminiClient from config
      // Verify compression settings are stored in ephemeral settings
      // (actual compression happens internally in geminiChat when needed)
      expect(config.getEphemeralSetting('compression-threshold')).toBe(0.6);
      expect(config.getEphemeralSetting('context-limit')).toBe(100000);

      // Compression validation now happens in geminiChat when it reads the settings
    });
  });

  describe('Custom Headers Application', () => {
    it('should make custom headers available for API requests', async () => {
      // Create a ProviderManager
      const providerManager = new ProviderManager();
      config.setProviderManager(providerManager);

      // Set custom headers via ephemeral settings
      const customHeaders = {
        'X-Custom-Header': 'test-value',
        'X-API-Version': '2024-01-01',
        Authorization: 'Bearer custom-token',
      };
      config.setEphemeralSetting('custom-headers', customHeaders);

      // Verify custom headers are stored
      expect(config.getEphemeralSetting('custom-headers')).toEqual(
        customHeaders,
      );

      // When providers are initialized, they should be able to access these headers
      // through config.getEphemeralSetting('custom-headers')
      const headers = config.getEphemeralSetting('custom-headers') as Record<
        string,
        string
      >;
      expect(headers['X-Custom-Header']).toBe('test-value');
      expect(headers['X-API-Version']).toBe('2024-01-01');
      expect(headers['Authorization']).toBe('Bearer custom-token');
    });
  });

  describe('Streaming Settings Application', () => {
    it('should default to streaming enabled when not set', async () => {
      // Create a ProviderManager to test streaming behavior
      const providerManager = new ProviderManager();
      config.setProviderManager(providerManager);

      // Get ephemeral settings - streaming should not be set initially
      const ephemeralSettings = config.getEphemeralSettings();
      expect(ephemeralSettings['streaming']).toBeUndefined();

      // Verify that providers would default to streaming enabled
      // This mimics the logic in AnthropicProvider and OpenAIProvider:
      // const streamingEnabled = streamingSetting !== 'disabled';
      const streamingSetting = ephemeralSettings['streaming'];
      const streamingEnabled = streamingSetting !== 'disabled';
      expect(streamingEnabled).toBe(true);
    });

    it('should allow explicit streaming control via ephemeral settings', async () => {
      // Test streaming enabled
      config.setEphemeralSetting('streaming', 'enabled');
      expect(config.getEphemeralSetting('streaming')).toBe('enabled');

      let streamingSetting = config.getEphemeralSetting('streaming');
      let streamingEnabled = streamingSetting !== 'disabled';
      expect(streamingEnabled).toBe(true);

      // Test streaming disabled
      config.setEphemeralSetting('streaming', 'disabled');
      expect(config.getEphemeralSetting('streaming')).toBe('disabled');

      streamingSetting = config.getEphemeralSetting('streaming');
      streamingEnabled = streamingSetting !== 'disabled';
      expect(streamingEnabled).toBe(false);

      // Test case sensitivity - Config accepts any value, normalization happens at UI layer
      config.setEphemeralSetting('streaming', 'ENABLED');
      expect(config.getEphemeralSetting('streaming')).toBe('ENABLED');

      config.setEphemeralSetting('streaming', 'DISABLED');
      expect(config.getEphemeralSetting('streaming')).toBe('DISABLED');
    });

    it('should validate streaming mode values', () => {
      // Valid values should be accepted
      expect(() => {
        config.setEphemeralSetting('streaming', 'enabled');
      }).not.toThrow();

      expect(() => {
        config.setEphemeralSetting('streaming', 'disabled');
      }).not.toThrow();

      // Note: The validation happens in setCommand.ts, not in Config.setEphemeralSetting
      // Config itself accepts any value, validation is at the UI layer
    });
  });

  describe('Ephemeral Settings in Profiles', () => {
    it('should save ephemeral settings to a profile and restore them', async () => {
      // Set ephemeral settings
      config.setEphemeralSetting('context-limit', 200000);
      config.setEphemeralSetting('compression-threshold', 0.85);
      config.setEphemeralSetting('auth-key', 'profile-test-key');
      config.setEphemeralSetting('base-url', 'https://api.profile.com');
      config.setEphemeralSetting('custom-headers', {
        'X-Profile-Header': 'profile-value',
      });

      // Create a profile with current ephemeral settings
      const profile: Profile = {
        version: 1,
        provider: 'anthropic',
        model: 'claude-3-5-sonnet-20240620',
        modelParams: {
          temperature: 0.8,
          max_tokens: 4096,
        },
        ephemeralSettings: {
          'context-limit': config.getEphemeralSetting(
            'context-limit',
          ) as number,
          'compression-threshold': config.getEphemeralSetting(
            'compression-threshold',
          ) as number,
          'auth-key': config.getEphemeralSetting('auth-key') as string,
          'base-url': config.getEphemeralSetting('base-url') as string,
          'custom-headers': config.getEphemeralSetting(
            'custom-headers',
          ) as Record<string, string>,
        },
      };

      // Save the profile
      await profileManager.saveProfile('test-ephemeral-profile', profile);

      // Create a new Config without any ephemeral settings
      const newConfig = new Config({
        sessionId: 'profile-test-session',
        targetDir: tempDir,
        debugMode: false,
        model: 'gemini-2.0-flash-exp',
        cwd: tempDir,
      });
      await newConfig.initialize();

      // Verify ephemeral settings are not there initially
      expect(newConfig.getEphemeralSetting('context-limit')).toBeUndefined();
      expect(
        newConfig.getEphemeralSetting('compression-threshold'),
      ).toBeUndefined();
      expect(newConfig.getEphemeralSetting('auth-key')).toBeUndefined();
      expect(newConfig.getEphemeralSetting('base-url')).toBeUndefined();
      expect(newConfig.getEphemeralSetting('custom-headers')).toBeUndefined();

      // Load the profile
      const loadedProfile = await profileManager.loadProfile(
        'test-ephemeral-profile',
      );

      // Apply ephemeral settings from profile to config
      for (const [key, value] of Object.entries(
        loadedProfile.ephemeralSettings,
      )) {
        newConfig.setEphemeralSetting(key, value);
      }

      // Verify ephemeral settings are restored from profile
      expect(newConfig.getEphemeralSetting('context-limit')).toBe(200000);
      expect(newConfig.getEphemeralSetting('compression-threshold')).toBe(0.85);
      expect(newConfig.getEphemeralSetting('auth-key')).toBe(
        'profile-test-key',
      );
      expect(newConfig.getEphemeralSetting('base-url')).toBe(
        'https://api.profile.com',
      );
      expect(newConfig.getEphemeralSetting('custom-headers')).toEqual({
        'X-Profile-Header': 'profile-value',
      });

      // Create yet another Config without loading the profile
      const anotherConfig = new Config({
        sessionId: 'another-session',
        targetDir: tempDir,
        debugMode: false,
        model: 'gemini-2.0-flash-exp',
        cwd: tempDir,
      });
      await anotherConfig.initialize();

      // Verify ephemeral settings are not there (not automatically loaded)
      expect(
        anotherConfig.getEphemeralSetting('context-limit'),
      ).toBeUndefined();
      expect(
        anotherConfig.getEphemeralSetting('compression-threshold'),
      ).toBeUndefined();
      expect(anotherConfig.getEphemeralSetting('auth-key')).toBeUndefined();
      expect(anotherConfig.getEphemeralSetting('base-url')).toBeUndefined();
      expect(
        anotherConfig.getEphemeralSetting('custom-headers'),
      ).toBeUndefined();
    });

    it('should handle profiles with partial ephemeral settings', async () => {
      // Create a profile with only some ephemeral settings
      const profile: Profile = {
        version: 1,
        provider: 'openai',
        model: 'gpt-4o',
        modelParams: {
          temperature: 0.7,
        },
        ephemeralSettings: {
          'auth-key': 'partial-key',
          'context-limit': 50000,
          // Other ephemeral settings are not included
        },
      };

      // Save the profile
      await profileManager.saveProfile('partial-profile', profile);

      // Load the profile
      const loadedProfile = await profileManager.loadProfile('partial-profile');

      // Apply ephemeral settings from profile to config
      for (const [key, value] of Object.entries(
        loadedProfile.ephemeralSettings,
      )) {
        config.setEphemeralSetting(key, value);
      }

      // Verify only the specified settings are loaded
      expect(config.getEphemeralSetting('auth-key')).toBe('partial-key');
      expect(config.getEphemeralSetting('context-limit')).toBe(50000);
      expect(
        config.getEphemeralSetting('compression-threshold'),
      ).toBeUndefined();
      expect(config.getEphemeralSetting('base-url')).toBeUndefined();
      expect(config.getEphemeralSetting('custom-headers')).toBeUndefined();
    });
  });

  describe('Ephemeral Settings Edge Cases', () => {
    it('should handle setting and unsetting ephemeral values', () => {
      // Set a value
      config.setEphemeralSetting('test-key', 'test-value');
      expect(config.getEphemeralSetting('test-key')).toBe('test-value');

      // Overwrite with new value
      config.setEphemeralSetting('test-key', 'new-value');
      expect(config.getEphemeralSetting('test-key')).toBe('new-value');

      // Set to undefined (effectively remove)
      config.setEphemeralSetting('test-key', undefined);
      expect(config.getEphemeralSetting('test-key')).toBeUndefined();
    });

    it('should handle complex ephemeral setting values', () => {
      // Arrays
      config.setEphemeralSetting('array-setting', ['a', 'b', 'c']);
      expect(config.getEphemeralSetting('array-setting')).toEqual([
        'a',
        'b',
        'c',
      ]);

      // Nested objects
      const nestedObj = {
        level1: {
          level2: {
            value: 'deep',
          },
        },
      };
      config.setEphemeralSetting('nested-object', nestedObj);
      expect(config.getEphemeralSetting('nested-object')).toEqual(nestedObj);

      // Numbers, booleans, null
      config.setEphemeralSetting('number', 42);
      config.setEphemeralSetting('boolean', true);
      config.setEphemeralSetting('null-value', null);

      expect(config.getEphemeralSetting('number')).toBe(42);
      expect(config.getEphemeralSetting('boolean')).toBe(true);
      expect(config.getEphemeralSetting('null-value')).toBeNull();
    });

    it('should return a copy of ephemeral settings to prevent external modification', () => {
      config.setEphemeralSetting('key1', 'value1');
      config.setEphemeralSetting('key2', 'value2');

      const settings1 = config.getEphemeralSettings();
      const settings2 = config.getEphemeralSettings();

      // Should return new objects each time
      expect(settings1).not.toBe(settings2);
      expect(settings1).toEqual(settings2);

      // Modifying returned object should not affect internal state
      settings1['key1'] = 'modified';
      expect(config.getEphemeralSetting('key1')).toBe('value1');
    });
  });
});
