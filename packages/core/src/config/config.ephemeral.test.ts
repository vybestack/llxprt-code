/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Config } from './config.js';
import {
  registerSettingsService,
  resetSettingsService,
} from '../settings/settingsServiceInstance.js';
import { SettingsService } from '../settings/SettingsService.js';
import { clearActiveProviderRuntimeContext } from '../runtime/providerRuntimeContext.js';

describe('Config - Ephemeral Settings', () => {
  let config: Config;

  beforeEach(() => {
    // Reset SettingsService singleton to ensure clean state between tests
    resetSettingsService();
    registerSettingsService(new SettingsService());

    config = new Config({
      model: 'test-model',
      question: 'test question',
      embeddingModel: 'test-embedding',
      targetDir: '.',
      usageStatisticsEnabled: false,
      sessionId: 'test-session',
      debugMode: false,
      cwd: '.',
    });
  });

  afterEach(() => {
    clearActiveProviderRuntimeContext();
  });

  describe('todo-continuation setting', () => {
    /**
     * @requirement REQ-004.2
     * @scenario Setting defaults to true when unset
     * @given No todo-continuation setting configured
     * @when getEphemeralSetting('todo-continuation') called
     * @then Returns undefined (not true) - services handle the default logic
     */
    it('should return undefined for unset todo-continuation setting', () => {
      // When no setting is configured
      const result = config.getEphemeralSetting('todo-continuation');

      // Then it returns undefined (services handle default logic)
      expect(result).toBeUndefined();
    });

    /**
     * @requirement REQ-004.1
     * @scenario Explicit true value preserved
     * @given todo-continuation set to true
     * @when getEphemeralSetting('todo-continuation') called
     * @then Returns true
     */
    it('should return true when explicitly set to true', () => {
      // Given setting is explicitly set to true
      config.setEphemeralSetting('todo-continuation', true);

      // When getting the setting
      const result = config.getEphemeralSetting('todo-continuation');

      // Then it returns true
      expect(result).toBe(true);
    });

    /**
     * @requirement REQ-004.1
     * @scenario Explicit false value preserved
     * @given todo-continuation set to false
     * @when getEphemeralSetting('todo-continuation') called
     * @then Returns false
     */
    it('should return false when explicitly set to false', () => {
      // Given setting is explicitly set to false
      config.setEphemeralSetting('todo-continuation', false);

      // When getting the setting
      const result = config.getEphemeralSetting('todo-continuation');

      // Then it returns false
      expect(result).toBe(false);
    });

    /**
     * @requirement REQ-004.2
     * @scenario Service treats undefined as true
     * @given No setting configured
     * @when todoContinuationService checks setting
     * @then Continuation is enabled
     */
    it('should demonstrate service behavior with undefined setting', () => {
      // Given no setting configured
      const ephemeralSetting = config.getEphemeralSetting('todo-continuation');

      // When service checks the setting (simulating service logic)
      const continuationEnabled = ephemeralSetting !== false; // This is how the service treats undefined

      // Then continuation is enabled (undefined !== false is true)
      expect(ephemeralSetting).toBeUndefined();
      expect(continuationEnabled).toBe(true);
    });

    it('should demonstrate service behavior with explicit false', () => {
      // Given setting is explicitly set to false
      config.setEphemeralSetting('todo-continuation', false);
      const ephemeralSetting = config.getEphemeralSetting('todo-continuation');

      // When service checks the setting (simulating service logic)
      const continuationEnabled = ephemeralSetting !== false; // This is how the service treats false

      // Then continuation is disabled (false !== false is false)
      expect(ephemeralSetting).toBe(false);
      expect(continuationEnabled).toBe(false);
    });

    it('should demonstrate service behavior with explicit true', () => {
      // Given setting is explicitly set to true
      config.setEphemeralSetting('todo-continuation', true);
      const ephemeralSetting = config.getEphemeralSetting('todo-continuation');

      // When service checks the setting (simulating service logic)
      const continuationEnabled = ephemeralSetting !== false; // This is how the service treats true

      // Then continuation is enabled (true !== false is true)
      expect(ephemeralSetting).toBe(true);
      expect(continuationEnabled).toBe(true);
    });
  });

  describe('ephemeral settings persistence', () => {
    it('should persist ephemeral setting values across get/set operations', () => {
      // Given multiple ephemeral settings
      config.setEphemeralSetting('todo-continuation', false);
      config.setEphemeralSetting('shell-replacement', true);
      config.setEphemeralSetting('tool-output-max-items', 100);

      // When getting the settings
      const todoContinuation = config.getEphemeralSetting('todo-continuation');
      const shellReplacement = config.getEphemeralSetting('shell-replacement');
      const maxItems = config.getEphemeralSetting('tool-output-max-items');

      // Then all values are preserved
      expect(todoContinuation).toBe(false);
      expect(shellReplacement).toBe(true);
      expect(maxItems).toBe(100);
    });

    it('should normalize legacy boolean streaming values when reading settings', () => {
      const settingsService = config.getSettingsService();

      settingsService.set('streaming', false);

      expect(config.getEphemeralSetting('streaming')).toBe('disabled');
      expect(config.getEphemeralSettings().streaming).toBe('disabled');

      settingsService.set('streaming', true);

      expect(config.getEphemeralSetting('streaming')).toBe('enabled');
      expect(config.getEphemeralSettings().streaming).toBe('enabled');
    });

    it('should return copy of all ephemeral settings', () => {
      // Given multiple ephemeral settings
      config.setEphemeralSetting('todo-continuation', true);
      config.setEphemeralSetting('custom-setting', 'test-value');

      // When getting all settings
      const allSettings = config.getEphemeralSettings();

      // Then it returns a copy with all settings
      expect(allSettings).toEqual({
        'todo-continuation': true,
        'custom-setting': 'test-value',
        tools: {},
      });

      // And modifying the returned object doesn't affect the config
      allSettings['new-setting'] = 'should-not-affect-config';
      expect(config.getEphemeralSetting('new-setting')).toBeUndefined();
    });
  });

  describe('type safety', () => {
    it('should handle different value types for ephemeral settings', () => {
      // Boolean values
      config.setEphemeralSetting('todo-continuation', false);
      expect(config.getEphemeralSetting('todo-continuation')).toBe(false);

      // Number values
      config.setEphemeralSetting('tool-output-max-items', 50);
      expect(config.getEphemeralSetting('tool-output-max-items')).toBe(50);

      // String values
      config.setEphemeralSetting('auth-key', 'test-key');
      expect(config.getEphemeralSetting('auth-key')).toBe('test-key');

      // Object values
      const headers = { 'Content-Type': 'application/json' };
      config.setEphemeralSetting('custom-headers', headers);
      expect(config.getEphemeralSetting('custom-headers')).toEqual(headers);
    });
  });
});
