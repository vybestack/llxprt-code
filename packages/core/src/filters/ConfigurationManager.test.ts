/**
 * ConfigurationManager Tests
 * Comprehensive test suite for emoji filter configuration management
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ConfigurationManager,
  type EmojiFilterMode,
} from './ConfigurationManager.js';
import { SettingsService } from '../settings/SettingsService.js';
import type { Config } from '../config/config.js';

// Mock the Config type for testing
const createMockConfig = (): Config => ({}) as Config;

describe('ConfigurationManager', () => {
  let configManager: ConfigurationManager;
  let mockSettingsService: SettingsService;
  let mockConfig: Config;

  beforeEach(() => {
    // Reset singleton before each test
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
    // Clean up
    configManager._resetForTesting();
  });

  describe('Singleton Pattern', () => {
    it('should return same instance on multiple calls', () => {
      const instance1 = ConfigurationManager.getInstance();
      const instance2 = ConfigurationManager.getInstance();
      expect(instance1).toBe(instance2);
    });

    it('should maintain state across getInstance calls', () => {
      const instance1 = ConfigurationManager.getInstance();
      instance1.setSessionOverride('warn');

      const instance2 = ConfigurationManager.getInstance();
      expect(instance2.getCurrentMode()).toBe('warn');
    });
  });

  describe('Default Configuration', () => {
    it('should return auto mode by default', () => {
      const config = configManager.getConfiguration();
      expect(config.mode).toBe('auto');
      expect(config.source).toBe('default');
    });

    it('should use built-in default when settings service unavailable', () => {
      // Create fresh instance without settings service
      (
        ConfigurationManager as unknown as {
          instance: ConfigurationManager | null;
        }
      ).instance = null;
      const freshManager = ConfigurationManager.getInstance();

      const config = freshManager.getConfiguration();
      expect(config.mode).toBe('auto');
      expect(config.defaultConfig).toBe('auto');
    });
  });

  describe('Configuration Hierarchy', () => {
    it('should prioritize session override over profile', () => {
      // Set profile config
      mockSettingsService.set('emojiFilter.mode', 'warn');
      configManager.loadDefaultConfiguration();

      // Set session override
      configManager.setSessionOverride('error');

      const config = configManager.getConfiguration();
      expect(config.mode).toBe('error');
      expect(config.source).toBe('session');
    });

    it('should fall back to profile when session cleared', () => {
      // Set profile config
      mockSettingsService.set('emojiFilter.mode', 'warn');
      configManager.loadDefaultConfiguration();

      // Set and clear session override
      configManager.setSessionOverride('error');
      configManager.clearSessionOverride();

      const config = configManager.getConfiguration();
      expect(config.mode).toBe('warn');
      expect(config.source).toBe('profile');
    });

    it('should fall back to default when no profile or session', () => {
      const config = configManager.getConfiguration();
      expect(config.mode).toBe('auto');
      expect(config.source).toBe('default');
    });
  });

  describe('Session Override', () => {
    it('should set valid session override successfully', () => {
      const modes: EmojiFilterMode[] = ['allowed', 'auto', 'warn', 'error'];

      modes.forEach((mode) => {
        const result = configManager.setSessionOverride(mode);
        expect(result).toBe(true);
        expect(configManager.getCurrentMode()).toBe(mode);
        expect(configManager.getConfiguration().source).toBe('session');
      });
    });

    it('should reject invalid session override', () => {
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      const result = configManager.setSessionOverride(
        'invalid' as EmojiFilterMode,
      );
      expect(result).toBe(false);
      expect(consoleSpy).toHaveBeenCalledWith(
        'Invalid emoji filter mode: invalid',
      );

      consoleSpy.mockRestore();
    });

    it('should maintain previous mode when invalid mode provided', () => {
      configManager.setSessionOverride('warn');
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      configManager.setSessionOverride('invalid' as EmojiFilterMode);
      expect(configManager.getCurrentMode()).toBe('warn');

      consoleSpy.mockRestore();
    });
  });

  describe('Clear Session Override', () => {
    it('should clear session override successfully', () => {
      configManager.setSessionOverride('error');

      const result = configManager.clearSessionOverride();
      expect(result).toBe(true);

      const config = configManager.getConfiguration();
      expect(config.sessionOverride).toBeUndefined();
    });

    it('should revert to profile configuration after clearing session', () => {
      // Set profile config
      mockSettingsService.set('emojiFilter.mode', 'warn');
      configManager.loadDefaultConfiguration();

      // Override with session
      configManager.setSessionOverride('error');
      expect(configManager.getCurrentMode()).toBe('error');

      // Clear session override
      configManager.clearSessionOverride();
      expect(configManager.getCurrentMode()).toBe('warn');
      expect(configManager.getConfiguration().source).toBe('profile');
    });

    it('should revert to default when no profile available', () => {
      configManager.setSessionOverride('error');
      configManager.clearSessionOverride();

      const config = configManager.getConfiguration();
      expect(config.mode).toBe('auto');
      expect(config.source).toBe('default');
    });
  });

  describe('Profile Persistence', () => {
    it('should save current mode to profile successfully', () => {
      configManager.setSessionOverride('warn');

      const result = configManager.saveToProfile();
      expect(result).toBe(true);
      expect(mockSettingsService.get('emojiFilter.mode')).toBe('warn');
    });

    it('should update profile config state after save', () => {
      configManager.setSessionOverride('error');
      configManager.saveToProfile();

      // Clear session to test profile config
      configManager.clearSessionOverride();
      expect(configManager.getCurrentMode()).toBe('error');
      expect(configManager.getConfiguration().source).toBe('profile');
    });

    it('should handle settings service unavailable gracefully', () => {
      // Create manager without settings service
      (
        ConfigurationManager as unknown as {
          instance: ConfigurationManager | null;
        }
      ).instance = null;
      const freshManager = ConfigurationManager.getInstance();

      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      const result = freshManager.saveToProfile();
      expect(result).toBe(false);
      expect(consoleSpy).toHaveBeenCalledWith(
        'Settings service not available for profile save',
      );

      consoleSpy.mockRestore();
    });
  });

  describe('Load Default Configuration', () => {
    it('should load valid configuration from settings', () => {
      mockSettingsService.set('emojiFilter.mode', 'warn');

      const result = configManager.loadDefaultConfiguration();
      expect(result).toBe(true);
      expect(configManager.getCurrentMode()).toBe('warn');
    });

    it('should ignore invalid configuration from settings', () => {
      mockSettingsService.set('emojiFilter.mode', 'invalid');

      const result = configManager.loadDefaultConfiguration();
      expect(result).toBe(true);
      expect(configManager.getCurrentMode()).toBe('auto'); // Should remain default
    });

    it('should handle missing settings gracefully', () => {
      const result = configManager.loadDefaultConfiguration();
      expect(result).toBe(true);
      expect(configManager.getCurrentMode()).toBe('auto');
    });

    it('should not override session configuration', () => {
      configManager.setSessionOverride('error');

      mockSettingsService.set('emojiFilter.mode', 'warn');
      configManager.loadDefaultConfiguration();

      // Session override should still take precedence
      expect(configManager.getCurrentMode()).toBe('error');
      expect(configManager.getConfiguration().source).toBe('session');
    });
  });

  describe('Convenience Methods', () => {
    it('should correctly identify allowed mode', () => {
      configManager.setSessionOverride('allowed');
      expect(configManager.isAllowed()).toBe(true);

      configManager.setSessionOverride('auto');
      expect(configManager.isAllowed()).toBe(false);
    });

    it('should correctly identify warn mode', () => {
      configManager.setSessionOverride('warn');
      expect(configManager.shouldWarn()).toBe(true);

      configManager.setSessionOverride('auto');
      expect(configManager.shouldWarn()).toBe(false);
    });

    it('should correctly identify error mode', () => {
      configManager.setSessionOverride('error');
      expect(configManager.shouldError()).toBe(true);

      configManager.setSessionOverride('auto');
      expect(configManager.shouldError()).toBe(false);
    });

    it('should return current mode correctly', () => {
      const modes: EmojiFilterMode[] = ['allowed', 'auto', 'warn', 'error'];

      modes.forEach((mode) => {
        configManager.setSessionOverride(mode);
        expect(configManager.getCurrentMode()).toBe(mode);
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle settings service errors gracefully', () => {
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      // Mock settings service to throw error
      vi.spyOn(mockSettingsService, 'get').mockImplementation(() => {
        throw new Error('Settings error');
      });

      const result = configManager.loadDefaultConfiguration();
      expect(result).toBe(false);
      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to load configuration from settings:',
        expect.any(Error),
      );

      consoleSpy.mockRestore();
    });

    it('should handle save errors gracefully', () => {
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      // Mock settings service to throw error
      vi.spyOn(mockSettingsService, 'set').mockImplementation(() => {
        throw new Error('Save error');
      });

      const result = configManager.saveToProfile();
      expect(result).toBe(false);
      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to save configuration to profile:',
        expect.any(Error),
      );

      consoleSpy.mockRestore();
    });
  });

  describe('Configuration State Structure', () => {
    it('should return complete configuration state', () => {
      // Set up complex state
      mockSettingsService.set('emojiFilter.mode', 'warn');
      configManager.loadDefaultConfiguration();
      configManager.setSessionOverride('error');

      const config = configManager.getConfiguration();

      expect(config).toEqual({
        mode: 'error',
        source: 'session',
        sessionOverride: 'error',
        profileConfig: 'warn',
        defaultConfig: 'auto',
      });
    });

    it('should handle partial state correctly', () => {
      // Only default config
      const config = configManager.getConfiguration();

      expect(config).toEqual({
        mode: 'auto',
        source: 'default',
        sessionOverride: undefined,
        profileConfig: undefined,
        defaultConfig: 'auto',
      });
    });
  });

  describe('Integration Scenarios', () => {
    it('should handle complete workflow correctly', () => {
      // 1. Start with default
      expect(configManager.getCurrentMode()).toBe('auto');

      // 2. Load profile configuration
      mockSettingsService.set('emojiFilter.mode', 'warn');
      configManager.loadDefaultConfiguration();
      expect(configManager.getCurrentMode()).toBe('warn');

      // 3. Set session override
      configManager.setSessionOverride('error');
      expect(configManager.getCurrentMode()).toBe('error');

      // 4. Save to profile
      configManager.saveToProfile();
      expect(mockSettingsService.get('emojiFilter.mode')).toBe('error');

      // 5. Clear session - should still be error from saved profile
      configManager.clearSessionOverride();
      expect(configManager.getCurrentMode()).toBe('error');
    });

    it('should maintain consistency across operations', () => {
      const operations = [
        () => configManager.setSessionOverride('warn'),
        () => configManager.saveToProfile(),
        () => configManager.setSessionOverride('error'),
        () => configManager.clearSessionOverride(),
        () => configManager.loadDefaultConfiguration(),
      ];

      operations.forEach((op) => {
        op();
        const config = configManager.getConfiguration();

        // Verify state consistency
        expect(['allowed', 'auto', 'warn', 'error']).toContain(config.mode);
        expect(['default', 'profile', 'session']).toContain(config.source);
        expect(config.defaultConfig).toBe('auto');
      });
    });
  });
});
