/**
 * ConfigurationManager Hierarchy Tests
 * Tests the configuration hierarchy: Session > Profile > Default
 * Uses REAL ConfigurationManager with mocked SettingsService to simulate different settings.json content
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  ConfigurationManager,
  type EmojiFilterMode,
} from './ConfigurationManager.js';
import { SettingsService } from '../settings/SettingsService.js';
import type { Config } from '../config/config.js';

// Mock the Config type for testing
const createMockConfig = (): Config => ({}) as Config;

describe('ConfigurationManager - Configuration Hierarchy', () => {
  let configManager: ConfigurationManager;
  let mockSettingsService: SettingsService;
  let mockConfig: Config;

  beforeEach(() => {
    // Reset singleton before each test to ensure clean state
    (
      ConfigurationManager as unknown as {
        instance: ConfigurationManager | null;
      }
    ).instance = null;

    // Create fresh instances
    configManager = ConfigurationManager.getInstance();
    mockSettingsService = new SettingsService();
    mockConfig = createMockConfig();

    // Initialize with mocks
    configManager.initialize(mockConfig, mockSettingsService);
  });

  afterEach(() => {
    // Clean up after each test
    configManager._resetForTesting();
  });

  describe('Default Configuration from Settings', () => {
    it('should use default from settings.json when no profile or session override', () => {
      // Simulate settings.json with specific default
      mockSettingsService.set('emojiFilter.mode', 'warn');
      configManager.loadDefaultConfiguration();

      const config = configManager.getConfiguration();
      expect(config.mode).toBe('warn');
      expect(config.source).toBe('profile');
      expect(config.profileConfig).toBe('warn');
      expect(config.sessionOverride).toBeUndefined();
    });

    it('should fallback to built-in default when settings.json has no emoji filter config', () => {
      // No emojiFilter.mode in settings - should use built-in default
      configManager.loadDefaultConfiguration();

      const config = configManager.getConfiguration();
      expect(config.mode).toBe('auto');
      expect(config.source).toBe('default');
      expect(config.defaultConfig).toBe('auto');
      expect(config.profileConfig).toBeUndefined();
    });

    it('should use built-in default when settings.json has invalid emoji filter mode', () => {
      // Simulate invalid mode in settings.json
      mockSettingsService.set('emojiFilter.mode', 'invalid-mode');
      configManager.loadDefaultConfiguration();

      const config = configManager.getConfiguration();
      expect(config.mode).toBe('auto');
      expect(config.source).toBe('default');
      expect(config.profileConfig).toBeUndefined();
    });
  });

  describe('Profile Override of Default', () => {
    it('should override built-in default with profile configuration', () => {
      // Start with built-in default
      expect(configManager.getCurrentMode()).toBe('auto');

      // Load profile that overrides default
      mockSettingsService.set('emojiFilter.mode', 'error');
      configManager.loadDefaultConfiguration();

      const config = configManager.getConfiguration();
      expect(config.mode).toBe('error');
      expect(config.source).toBe('profile');
      expect(config.profileConfig).toBe('error');
      expect(config.defaultConfig).toBe('auto');
    });

    it('should allow different profile modes to override default', () => {
      const profileModes: EmojiFilterMode[] = ['allowed', 'warn', 'error'];

      profileModes.forEach((mode) => {
        // Reset for clean test
        configManager._resetForTesting();
        configManager.initialize(mockConfig, mockSettingsService);

        // Set profile mode
        mockSettingsService.set('emojiFilter.mode', mode);
        configManager.loadDefaultConfiguration();

        const config = configManager.getConfiguration();
        expect(config.mode).toBe(mode);
        expect(config.source).toBe('profile');
        expect(config.profileConfig).toBe(mode);
      });
    });

    it('should maintain profile override after multiple getConfiguration calls', () => {
      mockSettingsService.set('emojiFilter.mode', 'warn');
      configManager.loadDefaultConfiguration();

      // Call getConfiguration multiple times
      for (let i = 0; i < 5; i++) {
        const config = configManager.getConfiguration();
        expect(config.mode).toBe('warn');
        expect(config.source).toBe('profile');
      }
    });
  });

  describe('Session Override of Profile and Default', () => {
    it('should override profile configuration with session override', () => {
      // Set profile configuration
      mockSettingsService.set('emojiFilter.mode', 'warn');
      configManager.loadDefaultConfiguration();
      expect(configManager.getCurrentMode()).toBe('warn');

      // Override with session
      configManager.setSessionOverride('error');

      const config = configManager.getConfiguration();
      expect(config.mode).toBe('error');
      expect(config.source).toBe('session');
      expect(config.sessionOverride).toBe('error');
      expect(config.profileConfig).toBe('warn'); // Should still be stored
    });

    it('should override default configuration with session override when no profile', () => {
      // No profile configuration - using default
      expect(configManager.getCurrentMode()).toBe('auto');

      // Override with session
      configManager.setSessionOverride('allowed');

      const config = configManager.getConfiguration();
      expect(config.mode).toBe('allowed');
      expect(config.source).toBe('session');
      expect(config.sessionOverride).toBe('allowed');
      expect(config.profileConfig).toBeUndefined();
      expect(config.defaultConfig).toBe('auto');
    });

    it('should allow multiple session override changes', () => {
      const sessionModes: EmojiFilterMode[] = [
        'allowed',
        'auto',
        'warn',
        'error',
      ];

      // Set profile first
      mockSettingsService.set('emojiFilter.mode', 'warn');
      configManager.loadDefaultConfiguration();

      sessionModes.forEach((mode) => {
        configManager.setSessionOverride(mode);

        const config = configManager.getConfiguration();
        expect(config.mode).toBe(mode);
        expect(config.source).toBe('session');
        expect(config.sessionOverride).toBe(mode);
        expect(config.profileConfig).toBe('warn'); // Should remain unchanged
      });
    });
  });

  describe('Clearing Session Reverts to Profile', () => {
    it('should revert to profile configuration when session override cleared', () => {
      // Set up profile configuration
      mockSettingsService.set('emojiFilter.mode', 'warn');
      configManager.loadDefaultConfiguration();

      // Override with session
      configManager.setSessionOverride('error');
      expect(configManager.getCurrentMode()).toBe('error');

      // Clear session override
      const clearResult = configManager.clearSessionOverride();
      expect(clearResult).toBe(true);

      const config = configManager.getConfiguration();
      expect(config.mode).toBe('warn');
      expect(config.source).toBe('profile');
      expect(config.sessionOverride).toBeUndefined();
      expect(config.profileConfig).toBe('warn');
    });

    it('should revert to default when session cleared and no profile configured', () => {
      // No profile configuration
      configManager.setSessionOverride('error');
      expect(configManager.getCurrentMode()).toBe('error');

      // Clear session override
      configManager.clearSessionOverride();

      const config = configManager.getConfiguration();
      expect(config.mode).toBe('auto');
      expect(config.source).toBe('default');
      expect(config.sessionOverride).toBeUndefined();
      expect(config.profileConfig).toBeUndefined();
      expect(config.defaultConfig).toBe('auto');
    });

    it('should handle multiple clear operations gracefully', () => {
      // Set profile and session
      mockSettingsService.set('emojiFilter.mode', 'warn');
      configManager.loadDefaultConfiguration();
      configManager.setSessionOverride('error');

      // Clear multiple times
      for (let i = 0; i < 3; i++) {
        const clearResult = configManager.clearSessionOverride();
        expect(clearResult).toBe(true);

        const config = configManager.getConfiguration();
        expect(config.mode).toBe('warn');
        expect(config.source).toBe('profile');
        expect(config.sessionOverride).toBeUndefined();
      }
    });
  });

  describe('Profile Configuration Persistence', () => {
    it('should maintain profile configuration when settings become undefined', () => {
      // Set profile configuration
      mockSettingsService.set('emojiFilter.mode', 'warn');
      configManager.loadDefaultConfiguration();
      expect(configManager.getCurrentMode()).toBe('warn');

      // Simulate removing profile configuration from settings
      mockSettingsService.set('emojiFilter.mode', undefined);
      configManager.loadDefaultConfiguration();

      // Profile config persists in memory even when settings cleared
      const config = configManager.getConfiguration();
      expect(config.mode).toBe('warn');
      expect(config.source).toBe('profile');
      expect(config.profileConfig).toBe('warn'); // Still set
      expect(config.defaultConfig).toBe('auto');
    });

    it('should maintain profile configuration when settings become invalid', () => {
      // Set valid profile first
      mockSettingsService.set('emojiFilter.mode', 'warn');
      configManager.loadDefaultConfiguration();
      expect(configManager.getCurrentMode()).toBe('warn');

      // Change to invalid profile configuration in settings
      mockSettingsService.set('emojiFilter.mode', 'invalid-mode');
      configManager.loadDefaultConfiguration();

      // Profile config persists in memory even when settings become invalid
      const config = configManager.getConfiguration();
      expect(config.mode).toBe('warn');
      expect(config.source).toBe('profile');
      expect(config.profileConfig).toBe('warn'); // Still set from before
    });

    it('should maintain session override when profile settings are cleared', () => {
      // Set profile and session
      mockSettingsService.set('emojiFilter.mode', 'warn');
      configManager.loadDefaultConfiguration();
      configManager.setSessionOverride('error');

      // Remove profile configuration from settings
      mockSettingsService.set('emojiFilter.mode', undefined);
      configManager.loadDefaultConfiguration();

      const config = configManager.getConfiguration();
      expect(config.mode).toBe('error'); // Session still takes precedence
      expect(config.source).toBe('session');
      expect(config.sessionOverride).toBe('error');
      expect(config.profileConfig).toBe('warn'); // Profile config persists in memory
    });

    it('should only revert to default after full reset when profile cleared', () => {
      // Set profile configuration
      mockSettingsService.set('emojiFilter.mode', 'warn');
      configManager.loadDefaultConfiguration();
      expect(configManager.getCurrentMode()).toBe('warn');

      // Clear profile from settings
      mockSettingsService.set('emojiFilter.mode', undefined);
      configManager.loadDefaultConfiguration();

      // Profile still persists in memory
      expect(configManager.getCurrentMode()).toBe('warn');

      // Only a full reset clears the profile config
      configManager._resetForTesting();
      configManager.initialize(mockConfig, mockSettingsService);

      // Now it reverts to default
      const config = configManager.getConfiguration();
      expect(config.mode).toBe('auto');
      expect(config.source).toBe('default');
      expect(config.profileConfig).toBeUndefined();
    });
  });

  describe('Multiple Configuration Changes', () => {
    it('should handle complex sequence of configuration changes', () => {
      // Step 1: Start with default
      let config = configManager.getConfiguration();
      expect(config.mode).toBe('auto');
      expect(config.source).toBe('default');

      // Step 2: Load profile configuration
      mockSettingsService.set('emojiFilter.mode', 'warn');
      configManager.loadDefaultConfiguration();
      config = configManager.getConfiguration();
      expect(config.mode).toBe('warn');
      expect(config.source).toBe('profile');

      // Step 3: Set session override
      configManager.setSessionOverride('error');
      config = configManager.getConfiguration();
      expect(config.mode).toBe('error');
      expect(config.source).toBe('session');

      // Step 4: Change session override
      configManager.setSessionOverride('allowed');
      config = configManager.getConfiguration();
      expect(config.mode).toBe('allowed');
      expect(config.source).toBe('session');

      // Step 5: Clear session override
      configManager.clearSessionOverride();
      config = configManager.getConfiguration();
      expect(config.mode).toBe('warn');
      expect(config.source).toBe('profile');

      // Step 6: Change profile configuration
      mockSettingsService.set('emojiFilter.mode', 'error');
      configManager.loadDefaultConfiguration();
      config = configManager.getConfiguration();
      expect(config.mode).toBe('error');
      expect(config.source).toBe('profile');

      // Step 7: Clear profile configuration in settings (but it persists in memory)
      mockSettingsService.set('emojiFilter.mode', undefined);
      configManager.loadDefaultConfiguration();
      config = configManager.getConfiguration();
      expect(config.mode).toBe('error'); // Profile config persists in memory
      expect(config.source).toBe('profile');
    });

    it('should maintain state consistency during rapid changes', () => {
      const operations = [
        () => {
          mockSettingsService.set('emojiFilter.mode', 'warn');
          configManager.loadDefaultConfiguration();
        },
        () => configManager.setSessionOverride('error'),
        () => configManager.setSessionOverride('allowed'),
        () => configManager.clearSessionOverride(),
        () => {
          mockSettingsService.set('emojiFilter.mode', 'error');
          configManager.loadDefaultConfiguration();
        },
        () => configManager.setSessionOverride('warn'),
        () => configManager.clearSessionOverride(),
      ];

      operations.forEach((operation) => {
        operation();
        const config = configManager.getConfiguration();

        // Verify state consistency after each operation
        expect(['allowed', 'auto', 'warn', 'error']).toContain(config.mode);
        expect(['default', 'profile', 'session']).toContain(config.source);
        expect(config.defaultConfig).toBe('auto');

        // Verify hierarchy is maintained
        if (config.sessionOverride) {
          expect(config.source).toBe('session');
          expect(config.mode).toBe(config.sessionOverride);
        } else if (config.profileConfig) {
          expect(config.source).toBe('profile');
          expect(config.mode).toBe(config.profileConfig);
        } else {
          expect(config.source).toBe('default');
          expect(config.mode).toBe(config.defaultConfig);
        }
      });
    });

    it('should handle concurrent-like operations correctly', () => {
      // Simulate concurrent-like operations by performing multiple operations
      // in quick succession without checking state between them
      mockSettingsService.set('emojiFilter.mode', 'warn');
      configManager.loadDefaultConfiguration();
      configManager.setSessionOverride('error');
      configManager.setSessionOverride('allowed');
      mockSettingsService.set('emojiFilter.mode', 'error');
      configManager.loadDefaultConfiguration();

      // Final state should be consistent
      const config = configManager.getConfiguration();
      expect(config.mode).toBe('allowed'); // Session override should win
      expect(config.source).toBe('session');
      expect(config.sessionOverride).toBe('allowed');
      expect(config.profileConfig).toBe('error');
    });
  });

  describe('Hierarchy Enforcement Edge Cases', () => {
    it('should always prioritize session over profile even after profile reload', () => {
      // Set profile and session
      mockSettingsService.set('emojiFilter.mode', 'warn');
      configManager.loadDefaultConfiguration();
      configManager.setSessionOverride('error');

      // Change profile configuration and reload
      mockSettingsService.set('emojiFilter.mode', 'allowed');
      configManager.loadDefaultConfiguration();

      // Session should still take precedence
      const config = configManager.getConfiguration();
      expect(config.mode).toBe('error');
      expect(config.source).toBe('session');
      expect(config.sessionOverride).toBe('error');
      expect(config.profileConfig).toBe('allowed');
    });

    it('should handle profile save correctly while session override is active', () => {
      // Set session override
      configManager.setSessionOverride('error');

      // Save to profile
      const saveResult = configManager.saveToProfile();
      expect(saveResult).toBe(true);

      // Profile should be updated but session still takes precedence
      let config = configManager.getConfiguration();
      expect(config.mode).toBe('error');
      expect(config.source).toBe('session');
      expect(config.profileConfig).toBe('error');

      // After clearing session, should use saved profile
      configManager.clearSessionOverride();
      config = configManager.getConfiguration();
      expect(config.mode).toBe('error');
      expect(config.source).toBe('profile');
    });

    it('should maintain correct state when loading same profile configuration multiple times', () => {
      mockSettingsService.set('emojiFilter.mode', 'warn');

      // Load profile multiple times
      for (let i = 0; i < 5; i++) {
        configManager.loadDefaultConfiguration();
        const config = configManager.getConfiguration();
        expect(config.mode).toBe('warn');
        expect(config.source).toBe('profile');
        expect(config.profileConfig).toBe('warn');
      }
    });
  });

  describe('Complete Hierarchy Integration', () => {
    it('should demonstrate complete hierarchy: Session > Profile > Default', () => {
      // Initial state: Default
      let config = configManager.getConfiguration();
      expect(config.mode).toBe('auto');
      expect(config.source).toBe('default');

      // Add Profile level
      mockSettingsService.set('emojiFilter.mode', 'warn');
      configManager.loadDefaultConfiguration();
      config = configManager.getConfiguration();
      expect(config.mode).toBe('warn');
      expect(config.source).toBe('profile');

      // Add Session level (highest priority)
      configManager.setSessionOverride('error');
      config = configManager.getConfiguration();
      expect(config.mode).toBe('error');
      expect(config.source).toBe('session');

      // Remove Session level - should revert to Profile
      configManager.clearSessionOverride();
      config = configManager.getConfiguration();
      expect(config.mode).toBe('warn');
      expect(config.source).toBe('profile');

      // Remove Profile level from settings (but it persists in memory)
      mockSettingsService.set('emojiFilter.mode', undefined);
      configManager.loadDefaultConfiguration();
      config = configManager.getConfiguration();
      expect(config.mode).toBe('warn'); // Profile config persists in memory
      expect(config.source).toBe('profile');
    });
  });
});
