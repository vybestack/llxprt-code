import { configureProviderRuntimeFactories } from '@vybestack/llxprt-code-providers/composition.js';
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260603-ISSUE1584.P12
 * @requirement:REQ-API-001
 * @pseudocode consumer-migration.md lines 10-15
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as path from 'node:path';
import type { Profile } from '@vybestack/llxprt-code-settings';
import { ProviderManager } from '@vybestack/llxprt-code-providers';
import { Config } from '@vybestack/llxprt-code-core';
import { ProfileManager } from '@vybestack/llxprt-code-settings';
import {
  createTempDirectory,
  cleanupTempDirectory,
  initializeTestSessionRoot,
  type CliTestSessionRoot,
} from './test-utils.js';

describe('Ephemeral Settings Integration Tests', () => {
  let tempDir: string;
  let config: Config;
  let sessionRoot: CliTestSessionRoot;
  let profileManager: ProfileManager;
  let originalHome: string | undefined;

  beforeEach(async () => {
    // Store original HOME environment variable
    originalHome = process.env.HOME;

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

    // Clean up temp directory
    await cleanupTempDirectory(tempDir);
  });

  describe('Ephemeral Settings Persistence', () => {
    it('should store ephemeral settings in current Config instance', async () => {
      // Set various ephemeral settings
      sessionRoot.agent.setEphemeralSetting('context-limit', 150000);
      sessionRoot.agent.setEphemeralSetting('compression-threshold', 0.75);
      sessionRoot.agent.setEphemeralSetting(
        'base-url',
        'https://api.example.com',
      );
      sessionRoot.agent.setEphemeralSetting('auth-key', 'test-key-123');
      sessionRoot.agent.setEphemeralSetting('custom-headers', {
        'X-Custom-Header': 'test-value',
        Authorization: 'Bearer token123',
      });
      sessionRoot.agent.setEphemeralSetting('api-version', '2024-02-01');

      // Verify settings are stored in the current instance
      expect(sessionRoot.agent.getEphemeralSetting('context-limit')).toBe(
        150000,
      );
      expect(
        sessionRoot.agent.getEphemeralSetting('compression-threshold'),
      ).toBe(0.75);
      expect(sessionRoot.agent.getEphemeralSetting('base-url')).toBe(
        'https://api.example.com',
      );
      expect(sessionRoot.agent.getEphemeralSetting('auth-key')).toBe(
        'test-key-123',
      );
      expect(
        sessionRoot.agent.getEphemeralSetting('custom-headers'),
      ).toStrictEqual({
        'X-Custom-Header': 'test-value',
        Authorization: 'Bearer token123',
      });
      expect(sessionRoot.agent.getEphemeralSetting('api-version')).toBe(
        '2024-02-01',
      );
    });
  });

  describe('Compression Settings Application', () => {
    it('should apply compression settings to AgentClient', async () => {
      // Set compression-related ephemeral settings
      sessionRoot.agent.setEphemeralSetting('context-limit', 100000);
      sessionRoot.agent.setEphemeralSetting('compression-threshold', 0.6);

      // Get the AgentClient from config
      // Verify compression settings are stored in ephemeral settings
      // (actual compression happens internally in chatSession when needed)
      expect(
        sessionRoot.agent.getEphemeralSetting('compression-threshold'),
      ).toBe(0.6);
      expect(sessionRoot.agent.getEphemeralSetting('context-limit')).toBe(
        100000,
      );

      // Compression validation now happens in chatSession when it reads the settings
    });
  });

  describe('Custom Headers Application', () => {
    it('should make custom headers available for API requests', async () => {
      // Create a ProviderManager bound to this config's runtime
      const providerManager = new ProviderManager({
        settingsService: sessionRoot.settingsService,
        config,
      });
      configureProviderRuntimeFactories(config, providerManager);

      // Set custom headers via ephemeral settings
      const customHeaders = {
        'X-Custom-Header': 'test-value',
        'X-API-Version': '2024-01-01',
        Authorization: 'Bearer custom-token',
      };
      sessionRoot.agent.setEphemeralSetting('custom-headers', customHeaders);

      // Verify custom headers are stored
      expect(
        sessionRoot.agent.getEphemeralSetting('custom-headers'),
      ).toStrictEqual(customHeaders);

      // When providers are initialized, they should be able to access these headers
      // through config.getEphemeralSetting('custom-headers')
      const headers = sessionRoot.agent.getEphemeralSetting(
        'custom-headers',
      ) as Record<string, string>;
      expect(headers['X-Custom-Header']).toBe('test-value');
      expect(headers['X-API-Version']).toBe('2024-01-01');
      expect(headers['Authorization']).toBe('Bearer custom-token');
    });
  });

  describe('Streaming Settings Application', () => {
    it('should default to streaming enabled when not set', async () => {
      // Create a ProviderManager bound to this config's runtime
      const providerManager = new ProviderManager({
        settingsService: sessionRoot.settingsService,
        config,
      });
      configureProviderRuntimeFactories(config, providerManager);

      // Get ephemeral settings - streaming should not be set initially
      const ephemeralSettings = sessionRoot.agent.getEphemeralSettings();
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
      sessionRoot.agent.setEphemeralSetting('streaming', 'enabled');
      expect(sessionRoot.agent.getEphemeralSetting('streaming')).toBe(
        'enabled',
      );

      let streamingSetting = sessionRoot.agent.getEphemeralSetting('streaming');
      let streamingEnabled = streamingSetting !== 'disabled';
      expect(streamingEnabled).toBe(true);

      // Test streaming disabled
      sessionRoot.agent.setEphemeralSetting('streaming', 'disabled');
      expect(sessionRoot.agent.getEphemeralSetting('streaming')).toBe(
        'disabled',
      );

      streamingSetting = sessionRoot.agent.getEphemeralSetting('streaming');
      streamingEnabled = streamingSetting !== 'disabled';
      expect(streamingEnabled).toBe(false);

      // Case is normalised by Config itself now, rather than being left to
      // the UI layer.
      sessionRoot.agent.setEphemeralSetting('streaming', 'ENABLED');
      expect(sessionRoot.agent.getEphemeralSetting('streaming')).toBe(
        'enabled',
      );

      sessionRoot.agent.setEphemeralSetting('streaming', 'DISABLED');
      expect(sessionRoot.agent.getEphemeralSetting('streaming')).toBe(
        'disabled',
      );
    });

    it('should validate streaming mode values', () => {
      // Valid values should be accepted
      expect(() => {
        sessionRoot.agent.setEphemeralSetting('streaming', 'enabled');
      }).not.toThrow();

      expect(() => {
        sessionRoot.agent.setEphemeralSetting('streaming', 'disabled');
      }).not.toThrow();

      // Note: The validation happens in setCommand.ts, not in Config.setEphemeralSetting
      // Config itself accepts any value, validation is at the UI layer
    });
  });

  describe('Ephemeral Settings in Profiles', () => {
    it('should save ephemeral settings to a profile and restore them', async () => {
      // Set ephemeral settings
      sessionRoot.agent.setEphemeralSetting('context-limit', 200000);
      sessionRoot.agent.setEphemeralSetting('compression-threshold', 0.85);
      sessionRoot.agent.setEphemeralSetting('auth-key', 'profile-test-key');
      sessionRoot.agent.setEphemeralSetting(
        'base-url',
        'https://api.profile.com',
      );
      sessionRoot.agent.setEphemeralSetting('custom-headers', {
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
          'context-limit': sessionRoot.agent.getEphemeralSetting(
            'context-limit',
          ) as number,
          'compression-threshold': sessionRoot.agent.getEphemeralSetting(
            'compression-threshold',
          ) as number,
          'auth-key': sessionRoot.agent.getEphemeralSetting(
            'auth-key',
          ) as string,
          'base-url': sessionRoot.agent.getEphemeralSetting(
            'base-url',
          ) as string,
          'custom-headers': sessionRoot.agent.getEphemeralSetting(
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
        initialSettings: {},
        debugMode: false,
        model: 'gemini-2.0-flash-exp',
        cwd: tempDir,
      });
      const newSessionRoot = await initializeTestSessionRoot(newConfig);

      // Verify ephemeral settings are not there initially
      expect(
        newSessionRoot.agent.getEphemeralSetting('context-limit'),
      ).toBeUndefined();
      expect(
        newSessionRoot.agent.getEphemeralSetting('compression-threshold'),
      ).toBeUndefined();
      expect(
        newSessionRoot.agent.getEphemeralSetting('auth-key'),
      ).toBeUndefined();
      expect(
        newSessionRoot.agent.getEphemeralSetting('base-url'),
      ).toBeUndefined();
      expect(
        newSessionRoot.agent.getEphemeralSetting('custom-headers'),
      ).toBeUndefined();

      // Load the profile
      const loadedProfile = await profileManager.loadProfile(
        'test-ephemeral-profile',
      );

      // Apply ephemeral settings from profile to config
      for (const [key, value] of Object.entries(
        loadedProfile.ephemeralSettings,
      )) {
        newSessionRoot.agent.setEphemeralSetting(key, value);
      }

      // Verify ephemeral settings are restored from profile
      expect(newSessionRoot.agent.getEphemeralSetting('context-limit')).toBe(
        200000,
      );
      expect(
        newSessionRoot.agent.getEphemeralSetting('compression-threshold'),
      ).toBe(0.85);
      expect(newSessionRoot.agent.getEphemeralSetting('auth-key')).toBe(
        'profile-test-key',
      );
      expect(newSessionRoot.agent.getEphemeralSetting('base-url')).toBe(
        'https://api.profile.com',
      );
      expect(
        newSessionRoot.agent.getEphemeralSetting('custom-headers'),
      ).toStrictEqual({
        'X-Profile-Header': 'profile-value',
      });

      // Create yet another Config without loading the profile
      const anotherConfig = new Config({
        sessionId: 'another-session',
        targetDir: tempDir,
        initialSettings: {},
        debugMode: false,
        model: 'gemini-2.0-flash-exp',
        cwd: tempDir,
      });
      const anotherSessionRoot = await initializeTestSessionRoot(anotherConfig);

      // Verify ephemeral settings are not there (not automatically loaded)
      expect(
        anotherSessionRoot.agent.getEphemeralSetting('context-limit'),
      ).toBeUndefined();
      expect(
        anotherSessionRoot.agent.getEphemeralSetting('compression-threshold'),
      ).toBeUndefined();
      expect(
        anotherSessionRoot.agent.getEphemeralSetting('auth-key'),
      ).toBeUndefined();
      expect(
        anotherSessionRoot.agent.getEphemeralSetting('base-url'),
      ).toBeUndefined();
      expect(
        anotherSessionRoot.agent.getEphemeralSetting('custom-headers'),
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
        sessionRoot.agent.setEphemeralSetting(key, value);
      }

      // Verify only the specified settings are loaded
      expect(sessionRoot.agent.getEphemeralSetting('auth-key')).toBe(
        'partial-key',
      );
      expect(sessionRoot.agent.getEphemeralSetting('context-limit')).toBe(
        50000,
      );
      expect(
        sessionRoot.agent.getEphemeralSetting('compression-threshold'),
      ).toBeUndefined();
      expect(sessionRoot.agent.getEphemeralSetting('base-url')).toBeUndefined();
      expect(
        sessionRoot.agent.getEphemeralSetting('custom-headers'),
      ).toBeUndefined();
    });
  });

  describe('Ephemeral Settings Edge Cases', () => {
    it('should handle setting and unsetting ephemeral values', () => {
      // Set a value
      sessionRoot.agent.setEphemeralSetting('test-key', 'test-value');
      expect(sessionRoot.agent.getEphemeralSetting('test-key')).toBe(
        'test-value',
      );

      // Overwrite with new value
      sessionRoot.agent.setEphemeralSetting('test-key', 'new-value');
      expect(sessionRoot.agent.getEphemeralSetting('test-key')).toBe(
        'new-value',
      );

      // Set to undefined (effectively remove)
      sessionRoot.agent.setEphemeralSetting('test-key', undefined);
      expect(sessionRoot.agent.getEphemeralSetting('test-key')).toBeUndefined();
    });

    it('should handle complex ephemeral setting values', () => {
      // Arrays
      sessionRoot.agent.setEphemeralSetting('array-setting', ['a', 'b', 'c']);
      expect(
        sessionRoot.agent.getEphemeralSetting('array-setting'),
      ).toStrictEqual(['a', 'b', 'c']);

      // Nested objects
      const nestedObj = {
        level1: {
          level2: {
            value: 'deep',
          },
        },
      };
      sessionRoot.agent.setEphemeralSetting('nested-object', nestedObj);
      expect(
        sessionRoot.agent.getEphemeralSetting('nested-object'),
      ).toStrictEqual(nestedObj);

      // Numbers, booleans, null
      sessionRoot.agent.setEphemeralSetting('number', 42);
      sessionRoot.agent.setEphemeralSetting('boolean', true);
      sessionRoot.agent.setEphemeralSetting('null-value', null);

      expect(sessionRoot.agent.getEphemeralSetting('number')).toBe(42);
      expect(sessionRoot.agent.getEphemeralSetting('boolean')).toBe(true);
      expect(sessionRoot.agent.getEphemeralSetting('null-value')).toBeNull();
    });

    it('should return a copy of ephemeral settings to prevent external modification', () => {
      sessionRoot.agent.setEphemeralSetting('key1', 'value1');
      sessionRoot.agent.setEphemeralSetting('key2', 'value2');

      const settings1 = sessionRoot.agent.getEphemeralSettings();
      const settings2 = sessionRoot.agent.getEphemeralSettings();

      // Should return new objects each time
      expect(settings1).not.toBe(settings2);
      expect(settings1).toStrictEqual(settings2);

      // Modifying returned object should not affect internal state
      Reflect.set(settings1, 'key1', 'modified');
      expect(sessionRoot.agent.getEphemeralSetting('key1')).toBe('value1');
    });
  });
});
