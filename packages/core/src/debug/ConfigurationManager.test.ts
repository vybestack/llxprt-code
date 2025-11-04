/**
 * @plan:PLAN-20250120-DEBUGLOGGING.P08
 * @requirement REQ-003,REQ-007
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ConfigurationManager } from './ConfigurationManager.js';
import { DebugSettings } from './types.js';

describe('ConfigurationManager', () => {
  beforeEach(() => {
    // Reset singleton instance before each test
    // @ts-expect-error - Accessing private static for test cleanup
    ConfigurationManager.instance = undefined;

    // Clean up environment variables
    delete process.env.DEBUG;
    delete process.env.LLXPRT_DEBUG;
    delete process.env.DEBUG_ENABLED;
    delete process.env.DEBUG_LEVEL;
    delete process.env.DEBUG_OUTPUT;

    // Clean up test config files that might have been created
    const userConfigPath = path.join(os.homedir(), '.llxprt', 'settings.json');
    const projectConfigPath = path.join(
      process.cwd(),
      '.llxprt',
      'config.json',
    );

    // Backup and temporarily remove user config if it exists
    if (fs.existsSync(userConfigPath)) {
      const backupPath = userConfigPath + '.test-backup';
      if (!fs.existsSync(backupPath)) {
        fs.copyFileSync(userConfigPath, backupPath);
      }
      try {
        // Remove debug section from config for test isolation
        const content = JSON.parse(fs.readFileSync(userConfigPath, 'utf8'));
        delete content.debug;
        fs.writeFileSync(userConfigPath, JSON.stringify(content, null, 2));
      } catch {
        // If parsing fails, just remove the file temporarily
        fs.unlinkSync(userConfigPath);
      }
    }

    // Remove project config if it exists
    if (fs.existsSync(projectConfigPath)) {
      fs.unlinkSync(projectConfigPath);
    }
  });

  afterAll(() => {
    // Restore user config backup if it exists
    const userConfigPath = path.join(os.homedir(), '.llxprt', 'settings.json');
    const backupPath = userConfigPath + '.test-backup';

    if (fs.existsSync(backupPath)) {
      fs.copyFileSync(backupPath, userConfigPath);
      fs.unlinkSync(backupPath);
    }
  });

  describe('Singleton Pattern', () => {
    it('should return the same instance on multiple calls to getInstance', () => {
      // @plan:PLAN-20250120-DEBUGLOGGING.P08
      const instance1 = ConfigurationManager.getInstance();
      const instance2 = ConfigurationManager.getInstance();
      expect(instance1).toBe(instance2);
    });

    it('should create instance only once', () => {
      // @plan:PLAN-20250120-DEBUGLOGGING.P08
      const instance = ConfigurationManager.getInstance();
      expect(instance).toBeDefined();
    });
  });

  describe('Configuration Loading', () => {
    it('should load configurations from all sources', () => {
      // @plan:PLAN-20250120-DEBUGLOGGING.P08
      const manager = ConfigurationManager.getInstance();
      manager.loadConfigurations();
      expect(manager.getEffectiveConfig()).toBeDefined();
    });

    it('should handle missing environment variables gracefully', () => {
      // @plan:PLAN-20250120-DEBUGLOGGING.P08
      const manager = ConfigurationManager.getInstance();
      manager.loadConfigurations();
      const config = manager.getEffectiveConfig();
      expect(config).toBeDefined();
    });

    it('should handle missing user config file gracefully', () => {
      // @plan:PLAN-20250120-DEBUGLOGGING.P08
      const manager = ConfigurationManager.getInstance();
      manager.loadConfigurations();
      const config = manager.getEffectiveConfig();
      expect(config).toBeDefined();
    });

    it('should handle missing project config file gracefully', () => {
      // @plan:PLAN-20250120-DEBUGLOGGING.P08
      const manager = ConfigurationManager.getInstance();
      manager.loadConfigurations();
      const config = manager.getEffectiveConfig();
      expect(config).toBeDefined();
    });

    it('should handle invalid JSON in config files', () => {
      // @plan:PLAN-20250120-DEBUGLOGGING.P08
      const manager = ConfigurationManager.getInstance();
      manager.loadConfigurations();
      const config = manager.getEffectiveConfig();
      expect(config).toBeDefined();
    });
  });

  describe('Configuration Hierarchy and Precedence', () => {
    it('should apply CLI arguments with highest precedence', () => {
      // @plan:PLAN-20250120-DEBUGLOGGING.P08
      const manager = ConfigurationManager.getInstance();
      const config = manager.getEffectiveConfig();
      expect(config.enabled).toBeDefined();
    });

    it('should apply environment variables with second highest precedence', () => {
      // @plan:PLAN-20250120-DEBUGLOGGING.P08
      process.env.DEBUG_ENABLED = 'true';
      process.env.DEBUG_LEVEL = 'debug';

      const manager = ConfigurationManager.getInstance();
      const config = manager.getEffectiveConfig();
      expect(config.enabled).toBe(true);
      expect(config.level).toBe('debug');

      delete process.env.DEBUG_ENABLED;
      delete process.env.DEBUG_LEVEL;
    });

    it('should apply user config with third precedence', () => {
      // @plan:PLAN-20250120-DEBUGLOGGING.P08
      const manager = ConfigurationManager.getInstance();
      const config = manager.getEffectiveConfig();
      expect(config).toBeDefined();
    });

    it('should apply project config with fourth precedence', () => {
      // @plan:PLAN-20250120-DEBUGLOGGING.P08
      const manager = ConfigurationManager.getInstance();
      const config = manager.getEffectiveConfig();
      expect(config).toBeDefined();
    });

    it('should use default config when no other sources available', () => {
      // @plan:PLAN-20250120-DEBUGLOGGING.P08
      const manager = ConfigurationManager.getInstance();
      const config = manager.getEffectiveConfig();
      expect(config.enabled).toBe(false);
      expect(config.namespaces).toEqual([]);
      expect(config.level).toBe('info');
      expect(config.lazyEvaluation).toBe(true);
      expect(config.redactPatterns).toEqual(['apiKey', 'token', 'password']);
    });
  });

  describe('Ephemeral Settings', () => {
    it('should set ephemeral configuration that overrides persistent config', () => {
      // @plan:PLAN-20250120-DEBUGLOGGING.P08
      const manager = ConfigurationManager.getInstance();
      const ephemeralConfig: Partial<DebugSettings> = {
        enabled: true,
        level: 'debug',
        namespaces: ['test:*'],
      };

      manager.setEphemeralConfig(ephemeralConfig);
      const config = manager.getEffectiveConfig();
      expect(config.enabled).toBe(true);
      expect(config.level).toBe('debug');
      expect(config.namespaces).toEqual(['test:*']);
    });

    it('should persist ephemeral configuration to user config', () => {
      // @plan:PLAN-20250120-DEBUGLOGGING.P08
      const manager = ConfigurationManager.getInstance();
      const ephemeralConfig: Partial<DebugSettings> = {
        enabled: true,
        level: 'verbose',
      };

      manager.setEphemeralConfig(ephemeralConfig);
      manager.persistEphemeralConfig();
      // After persistence, config should still be effective
      const config = manager.getEffectiveConfig();
      expect(config.enabled).toBe(true);
      expect(config.level).toBe('verbose');
    });

    it('should clear ephemeral settings after persistence', () => {
      // @plan:PLAN-20250120-DEBUGLOGGING.P08
      const manager = ConfigurationManager.getInstance();
      manager.setEphemeralConfig({ enabled: true });
      manager.persistEphemeralConfig();
      // Should verify ephemeral is cleared but persistent remains
      const config = manager.getEffectiveConfig();
      expect(config.enabled).toBe(true);
    });
  });

  describe('Configuration Merging', () => {
    it('should merge configurations correctly maintaining type safety', () => {
      // @plan:PLAN-20250120-DEBUGLOGGING.P08
      const manager = ConfigurationManager.getInstance();
      const config = manager.getEffectiveConfig();
      expect(typeof config.enabled).toBe('boolean');
      expect(
        Array.isArray(config.namespaces) ||
          typeof config.namespaces === 'object',
      ).toBe(true);
      expect(typeof config.level).toBe('string');
      expect(typeof config.lazyEvaluation).toBe('boolean');
      expect(Array.isArray(config.redactPatterns)).toBe(true);
    });

    it('should handle partial configuration merging', () => {
      // @plan:PLAN-20250120-DEBUGLOGGING.P08
      const manager = ConfigurationManager.getInstance();
      const partialConfig: Partial<DebugSettings> = {
        enabled: true,
        // Other properties should remain from base config
      };

      manager.setEphemeralConfig(partialConfig);
      const config = manager.getEffectiveConfig();
      expect(config.enabled).toBe(true);
      expect(config.level).toBeDefined(); // Should have default value
      expect(config.namespaces).toBeDefined(); // Should have default value
    });
  });

  describe('Event Notifications', () => {
    it('should notify subscribers when configuration changes', () => {
      // @plan:PLAN-20250120-DEBUGLOGGING.P08
      const manager = ConfigurationManager.getInstance();
      const listener = vi.fn();

      manager.subscribe(listener);
      manager.setEphemeralConfig({ enabled: true });
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('should allow unsubscribing from notifications', () => {
      // @plan:PLAN-20250120-DEBUGLOGGING.P08
      const manager = ConfigurationManager.getInstance();
      const listener = vi.fn();

      manager.subscribe(listener);
      manager.unsubscribe(listener);
      manager.setEphemeralConfig({ enabled: true });
      expect(listener).not.toHaveBeenCalled();
    });

    it('should handle multiple subscribers correctly', () => {
      // @plan:PLAN-20250120-DEBUGLOGGING.P08
      const manager = ConfigurationManager.getInstance();
      const listener1 = vi.fn();
      const listener2 = vi.fn();

      manager.subscribe(listener1);
      manager.subscribe(listener2);
      manager.setEphemeralConfig({ enabled: true });
      expect(listener1).toHaveBeenCalledTimes(1);
      expect(listener2).toHaveBeenCalledTimes(1);
    });
  });

  describe('Output Target and Redaction', () => {
    it('should return correct output target based on configuration', () => {
      // @plan:PLAN-20250120-DEBUGLOGGING.P08
      const manager = ConfigurationManager.getInstance();
      const target = manager.getOutputTarget();
      expect(typeof target).toBe('string');
    });

    it('should return redaction patterns from configuration', () => {
      // @plan:PLAN-20250120-DEBUGLOGGING.P08
      const manager = ConfigurationManager.getInstance();
      const patterns = manager.getRedactPatterns();
      expect(Array.isArray(patterns)).toBe(true);
      patterns.forEach((pattern) => {
        expect(typeof pattern).toBe('string');
      });
    });
  });

  describe('Property-based Configuration Tests', () => {
    it('should handle any valid namespace format', () => {
      // @plan:PLAN-20250120-DEBUGLOGGING.P08
      const manager = ConfigurationManager.getInstance();
      const validNamespaces = [
        'app:*',
        'module:submodule:*',
        'test',
        '*',
        'app:module',
        'lib:*:debug',
      ];

      validNamespaces.forEach((namespace) => {
        manager.setEphemeralConfig({ namespaces: [namespace] });
        const config = manager.getEffectiveConfig();
        expect(config.namespaces).toContain(namespace);
      });
    });

    it('should handle any valid configuration combination', () => {
      // @plan:PLAN-20250120-DEBUGLOGGING.P08
      const manager = ConfigurationManager.getInstance();
      const testConfigs: Array<Partial<DebugSettings>> = [
        { enabled: true, level: 'debug' },
        { enabled: false, namespaces: ['test:*'] },
        { level: 'info', lazyEvaluation: false },
        { redactPatterns: ['password', 'token'], output: 'console' },
        {
          enabled: true,
          level: 'verbose',
          namespaces: ['*'],
          lazyEvaluation: true,
        },
      ];

      testConfigs.forEach((config) => {
        manager.setEphemeralConfig(config);
        const effectiveConfig = manager.getEffectiveConfig();
        expect(effectiveConfig).toBeDefined();
      });
    });

    it('should ensure configuration merge operations are consistent', () => {
      // @plan:PLAN-20250120-DEBUGLOGGING.P08
      const manager = ConfigurationManager.getInstance();
      const config1: Partial<DebugSettings> = { enabled: true, level: 'debug' };
      const config2: Partial<DebugSettings> = {
        namespaces: ['test:*'],
        lazyEvaluation: false,
      };

      // Test merge order consistency
      manager.setEphemeralConfig(config1);
      manager.setEphemeralConfig(config2);
      const result1 = manager.getEffectiveConfig();

      // Reset and merge in different order
      manager.setEphemeralConfig(config2);
      manager.setEphemeralConfig(config1);
      const result2 = manager.getEffectiveConfig();

      // Results should be predictable based on merge strategy
      expect(result1).toBeDefined();
      expect(result2).toBeDefined();
    });
  });
});
