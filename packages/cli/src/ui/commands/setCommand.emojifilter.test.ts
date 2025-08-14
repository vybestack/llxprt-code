/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setCommand } from './setCommand.js';
import { createMockCommandContext } from '../../test-utils/mockCommandContext.js';
import { CommandContext } from './types.js';
import {
  ConfigurationManager,
  SettingsService,
} from '@vybestack/llxprt-code-core';

describe('setCommand - emojifilter CLI end-to-end tests', () => {
  let context: CommandContext;
  let mockSettingsService: SettingsService;

  beforeEach(() => {
    // Reset to clean state for each test
    ConfigurationManager.getInstance()._resetForTesting();

    // Create a mock settings service that actually tracks changes
    mockSettingsService = {
      get: vi.fn(),
      set: vi.fn(),
      save: vi.fn(),
      getAll: vi.fn().mockReturnValue({}),
    } as unknown as SettingsService;

    // Create context with real ConfigurationManager integration
    context = createMockCommandContext({
      services: {
        config: {
          getEphemeralSetting: vi.fn().mockReturnValue(undefined),
          setEphemeralSetting: vi.fn(),
          getEphemeralSettings: vi.fn().mockReturnValue({}),
          getSettingsService: vi.fn().mockReturnValue(mockSettingsService),
          getGeminiClient: vi.fn().mockReturnValue(null),
          getProviderManager: vi.fn().mockReturnValue(null),
        } as CommandContext['services']['config'],
      },
    });

    // Initialize ConfigurationManager with services for realistic testing
    ConfigurationManager.getInstance().initialize(
      context.services.config as unknown as Parameters<
        typeof ConfigurationManager.prototype.initialize
      >[0],
      mockSettingsService,
    );
  });

  afterEach(() => {
    // Clean up after each test
    ConfigurationManager.getInstance()._resetForTesting();
  });

  describe('Command Processing Integration', () => {
    /**
     * CLI End-to-End Test: Setting allowed mode
     * Tests complete command processing workflow with real ConfigurationManager
     */
    it('should process /set emojifilter allowed command end-to-end', async () => {
      // Execute the command as user would in CLI
      const result = await setCommand.action!(context, 'emojifilter allowed');

      // Verify command response
      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content:
          "Emoji filter mode set to 'allowed' (session only, use /profile save to persist)",
      });

      // Verify actual configuration changes in ConfigurationManager
      const configManager = ConfigurationManager.getInstance();
      const configuration = configManager.getConfiguration();

      expect(configuration.mode).toBe('allowed');
      expect(configuration.source).toBe('session');
      expect(configuration.sessionOverride).toBe('allowed');

      // Verify convenience methods reflect the change
      expect(configManager.isAllowed()).toBe(true);
      expect(configManager.shouldWarn()).toBe(false);
      expect(configManager.shouldError()).toBe(false);
    });

    /**
     * CLI End-to-End Test: Setting auto mode
     * Tests auto mode processing and verification
     */
    it('should process /set emojifilter auto command end-to-end', async () => {
      const result = await setCommand.action!(context, 'emojifilter auto');

      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content:
          "Emoji filter mode set to 'auto' (session only, use /profile save to persist)",
      });

      // Verify configuration state
      const configManager = ConfigurationManager.getInstance();
      const configuration = configManager.getConfiguration();

      expect(configuration.mode).toBe('auto');
      expect(configuration.source).toBe('session');
      expect(configuration.sessionOverride).toBe('auto');
    });

    /**
     * CLI End-to-End Test: Setting warn mode
     * Tests warn mode processing and verification
     */
    it('should process /set emojifilter warn command end-to-end', async () => {
      const result = await setCommand.action!(context, 'emojifilter warn');

      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content:
          "Emoji filter mode set to 'warn' (session only, use /profile save to persist)",
      });

      // Verify configuration state
      const configManager = ConfigurationManager.getInstance();
      const configuration = configManager.getConfiguration();

      expect(configuration.mode).toBe('warn');
      expect(configuration.source).toBe('session');
      expect(configuration.sessionOverride).toBe('warn');

      // Verify convenience methods
      expect(configManager.shouldWarn()).toBe(true);
      expect(configManager.shouldError()).toBe(false);
      expect(configManager.isAllowed()).toBe(false);
    });

    /**
     * CLI End-to-End Test: Setting error mode
     * Tests error mode processing and verification
     */
    it('should process /set emojifilter error command end-to-end', async () => {
      const result = await setCommand.action!(context, 'emojifilter error');

      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content:
          "Emoji filter mode set to 'error' (session only, use /profile save to persist)",
      });

      // Verify configuration state
      const configManager = ConfigurationManager.getInstance();
      const configuration = configManager.getConfiguration();

      expect(configuration.mode).toBe('error');
      expect(configuration.source).toBe('session');
      expect(configuration.sessionOverride).toBe('error');

      // Verify convenience methods
      expect(configManager.shouldError()).toBe(true);
      expect(configManager.shouldWarn()).toBe(false);
      expect(configManager.isAllowed()).toBe(false);
    });
  });

  describe('Invalid Mode Handling', () => {
    /**
     * CLI End-to-End Test: Invalid mode rejection
     * Tests that invalid modes are properly rejected with clear error messages
     */
    it('should reject invalid emoji filter mode with proper error message', async () => {
      const result = await setCommand.action!(context, 'emojifilter invalid');

      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content:
          "Invalid emoji filter mode 'invalid'. Valid modes are: allowed, auto, warn, error",
      });

      // Verify no configuration change occurred
      const configManager = ConfigurationManager.getInstance();
      const configuration = configManager.getConfiguration();

      expect(configuration.sessionOverride).toBeUndefined();
      expect(configuration.source).toBe('default');
      expect(configuration.mode).toBe('auto'); // Should remain at default
    });

    /**
     * CLI End-to-End Test: Case insensitive handling
     * Tests that modes are normalized to lowercase
     */
    it('should handle case-insensitive emoji filter modes and normalize to lowercase', async () => {
      const result = await setCommand.action!(context, 'emojifilter ERROR');

      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content:
          "Emoji filter mode set to 'error' (session only, use /profile save to persist)",
      });

      // Verify actual configuration uses lowercase
      const configManager = ConfigurationManager.getInstance();
      const configuration = configManager.getConfiguration();

      expect(configuration.mode).toBe('error');
      expect(configuration.sessionOverride).toBe('error');
    });

    /**
     * CLI End-to-End Test: Empty mode handling
     * Tests proper usage help when no mode is provided
     */
    it('should show usage help when no mode is provided for emojifilter', async () => {
      const result = await setCommand.action!(context, 'emojifilter');

      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: 'emojifilter: Emoji filter mode (allowed, auto, warn, error)',
      });

      // Verify no configuration change
      const configManager = ConfigurationManager.getInstance();
      expect(configManager.getConfiguration().sessionOverride).toBeUndefined();
    });
  });

  describe('Configuration Persistence in Session', () => {
    /**
     * CLI End-to-End Test: Session configuration persistence
     * Tests that configuration changes persist within the session
     */
    it('should persist configuration changes across multiple commands in session', async () => {
      // Set initial mode
      await setCommand.action!(context, 'emojifilter warn');

      // Verify persistence by checking configuration directly
      let configManager = ConfigurationManager.getInstance();
      expect(configManager.getCurrentMode()).toBe('warn');

      // Change mode again
      await setCommand.action!(context, 'emojifilter error');

      // Verify new mode is persisted
      configManager = ConfigurationManager.getInstance();
      expect(configManager.getCurrentMode()).toBe('error');

      const configuration = configManager.getConfiguration();
      expect(configuration.sessionOverride).toBe('error');
      expect(configuration.source).toBe('session');
    });

    /**
     * CLI End-to-End Test: Session override hierarchy
     * Tests that session overrides take precedence over defaults
     */
    it('should maintain session override precedence over defaults', async () => {
      // Initially should be default
      const configManager = ConfigurationManager.getInstance();
      expect(configManager.getConfiguration().source).toBe('default');
      expect(configManager.getCurrentMode()).toBe('auto');

      // Set session override
      await setCommand.action!(context, 'emojifilter allowed');

      // Session should override default
      const newConfig = configManager.getConfiguration();
      expect(newConfig.source).toBe('session');
      expect(newConfig.sessionOverride).toBe('allowed');
      expect(newConfig.mode).toBe('allowed');
      expect(newConfig.defaultConfig).toBe('auto'); // Default unchanged
    });
  });

  describe('Integration with ConfigurationManager', () => {
    /**
     * CLI End-to-End Test: ConfigurationManager integration
     * Tests that commands properly interact with the real ConfigurationManager instance
     */
    it('should integrate properly with ConfigurationManager singleton', async () => {
      const configManager = ConfigurationManager.getInstance();

      // Verify initial state
      expect(configManager.getConfiguration().source).toBe('default');

      // Execute command
      await setCommand.action!(context, 'emojifilter warn');

      // Verify same instance reflects changes
      const sameInstance = ConfigurationManager.getInstance();
      expect(sameInstance).toBe(configManager); // Same singleton instance
      expect(sameInstance.getCurrentMode()).toBe('warn');
    });

    /**
     * CLI End-to-End Test: Real ConfigurationManager state verification
     * Tests that all ConfigurationManager methods work with command-set values
     */
    it('should work with all ConfigurationManager convenience methods', async () => {
      const configManager = ConfigurationManager.getInstance();

      // Test allowed mode
      await setCommand.action!(context, 'emojifilter allowed');
      expect(configManager.isAllowed()).toBe(true);
      expect(configManager.shouldWarn()).toBe(false);
      expect(configManager.shouldError()).toBe(false);

      // Test warn mode
      await setCommand.action!(context, 'emojifilter warn');
      expect(configManager.isAllowed()).toBe(false);
      expect(configManager.shouldWarn()).toBe(true);
      expect(configManager.shouldError()).toBe(false);

      // Test error mode
      await setCommand.action!(context, 'emojifilter error');
      expect(configManager.isAllowed()).toBe(false);
      expect(configManager.shouldWarn()).toBe(false);
      expect(configManager.shouldError()).toBe(true);
    });
  });

  describe('Unset Command Integration', () => {
    /**
     * CLI End-to-End Test: Clearing session override
     * Tests complete workflow of setting and then clearing session overrides
     */
    it('should clear emoji filter session override with /set unset emojifilter', async () => {
      // First set a session override
      await setCommand.action!(context, 'emojifilter warn');

      // Verify it was set
      let configManager = ConfigurationManager.getInstance();
      expect(configManager.getCurrentMode()).toBe('warn');
      expect(configManager.getConfiguration().source).toBe('session');

      // Clear the override using unset command
      const unsetCommand = setCommand.subCommands!.find(
        (cmd) => cmd.name === 'unset',
      )!;
      const result = await unsetCommand.action!(context, 'emojifilter');

      // Verify command response
      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: 'Emoji filter session override has been removed',
      });

      // Verify session override was cleared
      configManager = ConfigurationManager.getInstance();
      const config = configManager.getConfiguration();
      expect(config.sessionOverride).toBeUndefined();
      expect(config.source).toBe('default'); // Should revert to default
      expect(configManager.getCurrentMode()).toBe('auto'); // Default mode
    });

    /**
     * CLI End-to-End Test: Unset when no override exists
     * Tests proper handling when trying to unset a non-existent override
     */
    it('should handle unset when no session override exists', async () => {
      const configManager = ConfigurationManager.getInstance();

      // Verify no session override initially
      expect(configManager.getConfiguration().sessionOverride).toBeUndefined();

      // Try to unset anyway
      const unsetCommand = setCommand.subCommands!.find(
        (cmd) => cmd.name === 'unset',
      )!;
      const result = await unsetCommand.action!(context, 'emojifilter');

      // Should still succeed
      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: 'Emoji filter session override has been removed',
      });

      // Configuration should remain unchanged
      expect(configManager.getConfiguration().source).toBe('default');
      expect(configManager.getCurrentMode()).toBe('auto');
    });
  });

  describe('Command Completion Integration', () => {
    /**
     * CLI End-to-End Test: Tab completion for emojifilter key
     * Tests that the command completion system includes emojifilter
     */
    it('should provide emojifilter in completion suggestions for set command', async () => {
      const result = await setCommand.completion!(context, 'emoji');

      expect(result).toContain('emojifilter');
    });

    /**
     * CLI End-to-End Test: Mode completion for emojifilter
     * Tests completion of valid emoji filter modes
     */
    it('should provide emoji filter mode completions when key is specified', async () => {
      const result = await setCommand.completion!(context, 'emojifilter ');

      expect(result).toEqual(
        expect.arrayContaining(['allowed', 'auto', 'warn', 'error']),
      );
      expect(result).toHaveLength(4);
    });

    /**
     * CLI End-to-End Test: Partial mode completion
     * Tests completion filtering for partial mode input
     */
    it('should filter emoji filter mode completions based on partial input', async () => {
      // Test 'w' prefix - should match 'warn'
      const wResult = await setCommand.completion!(context, 'emojifilter w');
      expect(wResult).toContain('warn');
      expect(wResult).not.toContain('allowed');
      expect(wResult).not.toContain('auto');
      expect(wResult).not.toContain('error');

      // Test 'a' prefix - should match 'allowed' and 'auto'
      const aResult = await setCommand.completion!(context, 'emojifilter a');
      expect(aResult).toContain('allowed');
      expect(aResult).toContain('auto');
      expect(aResult).not.toContain('warn');
      expect(aResult).not.toContain('error');
    });

    /**
     * CLI End-to-End Test: Unset command completion
     * Tests that unset command includes emojifilter in completions
     */
    it('should provide emojifilter completion for unset command', async () => {
      const unsetCommand = setCommand.subCommands!.find(
        (cmd) => cmd.name === 'unset',
      )!;
      const result = await unsetCommand.completion!(context, 'emoji');

      expect(result).toContain('emojifilter');
    });
  });

  describe('Error Handling and Edge Cases', () => {
    /**
     * CLI End-to-End Test: Whitespace handling
     * Tests that commands handle extra whitespace properly
     */
    it('should handle extra whitespace in commands gracefully', async () => {
      const result = await setCommand.action!(
        context,
        '  emojifilter   warn  ',
      );

      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content:
          "Emoji filter mode set to 'warn' (session only, use /profile save to persist)",
      });

      // Verify configuration change despite whitespace
      const configManager = ConfigurationManager.getInstance();
      expect(configManager.getCurrentMode()).toBe('warn');
    });

    /**
     * CLI End-to-End Test: Multiple successive commands
     * Tests that multiple consecutive commands work properly
     */
    it('should handle multiple successive emoji filter commands', async () => {
      // Execute multiple commands in sequence
      const results = [];

      results.push(await setCommand.action!(context, 'emojifilter allowed'));
      results.push(await setCommand.action!(context, 'emojifilter warn'));
      results.push(await setCommand.action!(context, 'emojifilter error'));
      results.push(await setCommand.action!(context, 'emojifilter auto'));

      // All should succeed
      results.forEach((result) => {
        expect(result.messageType).toBe('info');
      });

      // Final state should be 'auto'
      const configManager = ConfigurationManager.getInstance();
      expect(configManager.getCurrentMode()).toBe('auto');
      expect(configManager.getConfiguration().sessionOverride).toBe('auto');
    });

    /**
     * CLI End-to-End Test: Configuration state consistency
     * Tests that configuration state remains consistent across operations
     */
    it('should maintain configuration state consistency across all operations', async () => {
      const configManager = ConfigurationManager.getInstance();

      // Test full cycle: default -> set -> unset -> set again

      // Initial state
      expect(configManager.getCurrentMode()).toBe('auto');
      expect(configManager.getConfiguration().source).toBe('default');

      // Set mode
      await setCommand.action!(context, 'emojifilter error');
      expect(configManager.getCurrentMode()).toBe('error');
      expect(configManager.getConfiguration().source).toBe('session');

      // Unset mode
      const unsetCommand = setCommand.subCommands!.find(
        (cmd) => cmd.name === 'unset',
      )!;
      await unsetCommand.action!(context, 'emojifilter');
      expect(configManager.getCurrentMode()).toBe('auto');
      expect(configManager.getConfiguration().source).toBe('default');

      // Set different mode
      await setCommand.action!(context, 'emojifilter allowed');
      expect(configManager.getCurrentMode()).toBe('allowed');
      expect(configManager.getConfiguration().source).toBe('session');

      // Verify internal consistency
      const finalConfig = configManager.getConfiguration();
      expect(finalConfig.mode).toBe(finalConfig.sessionOverride);
      expect(finalConfig.defaultConfig).toBe('auto'); // Unchanged
    });
  });
});
