/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Config } from '../config/config.js';
import {
  resetSettingsService,
  registerSettingsService,
} from '../settings/settingsServiceInstance.js';
import { SettingsService } from '../settings/SettingsService.js';
import {
  createProviderRuntimeContext,
  setActiveProviderRuntimeContext,
} from '../runtime/providerRuntimeContext.js';
import process from 'process';

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    existsSync: vi.fn(() => true),
    readFileSync: vi.fn(() => '{}'),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
  };
});

describe('Settings Remediation Integration', () => {
  let config: Config;
  let settingsService: SettingsService;
  let mockEventListeners: Array<(...args: unknown[]) => void>;

  beforeEach(() => {
    resetSettingsService();

    settingsService = new SettingsService();

    const runtime = createProviderRuntimeContext({
      settingsService,
      runtimeId: 'test-settings-remediation',
      metadata: { source: 'settings-remediation.test.ts' },
    });
    setActiveProviderRuntimeContext(runtime);

    registerSettingsService(settingsService);

    mockEventListeners = [];

    config = new Config({
      sessionId: 'test-session',
      targetDir: process.cwd(),
      debugMode: false,
      model: 'test-model',
      cwd: process.cwd(),
    });
  });

  afterEach(() => {
    mockEventListeners.forEach((listener) => {
      settingsService.off('change', listener);
      settingsService.off('provider-change', listener);
      settingsService.off('cleared', listener);
    });
    mockEventListeners = [];

    resetSettingsService();
    vi.clearAllMocks();
  });

  describe('Config to SettingsService Integration', () => {
    /**
     * @requirement REQ-INT-001.1
     * @scenario Config command updates in-memory settings
     * @given Fresh SettingsService instance
     * @when Config.setEphemeralSetting is called
     * @then SettingsService has value in memory
     * @and No file is written
     * @and Operation completes synchronously
     */
    it('should update settings through Config to SettingsService synchronously', () => {
      const startTime = Date.now();

      config.setEphemeralSetting('model', 'gpt-4');

      expect(settingsService.get('model')).toBe('gpt-4');

      const elapsed = Date.now() - startTime;
      const perfBudgetMs = process.platform === 'darwin' ? 15 : 5;
      expect(elapsed).toBeLessThan(perfBudgetMs);
    });

    /**
     * @requirement REQ-INT-001.2
     * @scenario Config provider settings update
     * @given Fresh SettingsService instance
     * @when Config updates provider-specific settings
     * @then SettingsService provider settings are updated
     * @and No file operations occur
     */
    it('should update provider settings through integration', () => {
      settingsService.setProviderSetting('openai', 'apiKey', 'test-key-123');
      settingsService.setProviderSetting('openai', 'model', 'gpt-4');

      const providerSettings = settingsService.getProviderSettings('openai');
      expect(providerSettings.apiKey).toBe('test-key-123');
      expect(providerSettings.model).toBe('gpt-4');
    });

    /**
     * @requirement REQ-INT-001.3
     * @scenario Nested key support
     * @given SettingsService supports nested keys
     * @when Config sets nested settings
     * @then Values are stored and retrieved correctly
     */
    it('should handle nested key settings correctly', () => {
      config.setEphemeralSetting('ui.theme', 'dark');
      config.setEphemeralSetting('advanced.debug', true);
      config.setEphemeralSetting('telemetry.enabled', false);

      expect(config.getEphemeralSetting('ui.theme')).toBe('dark');
      expect(config.getEphemeralSetting('advanced.debug')).toBe(true);
      expect(config.getEphemeralSetting('telemetry.enabled')).toBe(false);
    });
  });

  describe('Event Propagation Integration', () => {
    /**
     * @requirement REQ-INT-002.1
     * @scenario Events propagate from SettingsService to listeners
     * @given SettingsService with event listener
     * @when Setting is updated through Config
     * @then Event is emitted with correct data
     * @and Event contains old and new values
     */
    it('should propagate events from SettingsService to listeners', () => {
      const changeEvents: Array<{
        key: string;
        oldValue: unknown;
        newValue: unknown;
      }> = [];

      const listener = (event: {
        key: string;
        oldValue: unknown;
        newValue: unknown;
      }) => {
        changeEvents.push(event);
      };
      mockEventListeners.push(listener);
      settingsService.on('change', listener);

      config.setEphemeralSetting('temperature', 0.7);
      config.setEphemeralSetting('temperature', 0.8);

      expect(changeEvents).toHaveLength(2);
      expect(changeEvents[0]).toEqual({
        key: 'temperature',
        oldValue: undefined,
        newValue: 0.7,
      });
      expect(changeEvents[1]).toEqual({
        key: 'temperature',
        oldValue: 0.7,
        newValue: 0.8,
      });
    });

    /**
     * @requirement REQ-INT-002.2
     * @scenario Provider change events
     * @given SettingsService with provider change listener
     * @when Provider setting is updated
     * @then Provider change event is emitted
     */
    it('should emit provider change events correctly', () => {
      const providerEvents: Array<{
        provider: string;
        key: string;
        oldValue: unknown;
        newValue: unknown;
      }> = [];

      const listener = (event: {
        provider: string;
        key: string;
        oldValue: unknown;
        newValue: unknown;
      }) => {
        providerEvents.push(event);
      };
      mockEventListeners.push(listener);
      settingsService.on('provider-change', listener);

      settingsService.setProviderSetting('openai', 'model', 'gpt-3.5-turbo');
      settingsService.setProviderSetting('openai', 'model', 'gpt-4');

      expect(providerEvents).toHaveLength(2);
      expect(providerEvents[0]).toEqual({
        provider: 'openai',
        key: 'model',
        oldValue: undefined,
        newValue: 'gpt-3.5-turbo',
      });
      expect(providerEvents[1]).toEqual({
        provider: 'openai',
        key: 'model',
        oldValue: 'gpt-3.5-turbo',
        newValue: 'gpt-4',
      });
    });

    /**
     * @requirement REQ-INT-002.3
     * @scenario Clear events
     * @given SettingsService with clear listener
     * @when Settings are cleared
     * @then Clear event is emitted
     */
    it('should emit cleared events when settings are cleared', () => {
      let clearedEventFired = false;

      const listener = () => {
        clearedEventFired = true;
      };
      mockEventListeners.push(listener);
      settingsService.on('cleared', listener);

      config.setEphemeralSetting('test', 'value');
      config.clearEphemeralSettings();

      expect(clearedEventFired).toBe(true);
      expect(config.getEphemeralSetting('test')).toBeUndefined();
    });
  });

  describe('Memory Persistence Integration', () => {
    /**
     * @requirement REQ-INT-003.1
     * @scenario Settings are NOT persisted across instances
     * @given SettingsService with data
     * @when New instance is created
     * @then Previous data is not accessible
     */
    it('should NOT persist settings across service instances', () => {
      config.setEphemeralSetting('persistTest', 'should-not-persist');
      settingsService.setProviderSetting('test-provider', 'key', 'value');

      expect(config.getEphemeralSetting('persistTest')).toBe(
        'should-not-persist',
      );
      expect(settingsService.getProviderSettings('test-provider').key).toBe(
        'value',
      );

      resetSettingsService();

      const newSettingsService = new SettingsService();
      const newRuntime = createProviderRuntimeContext({
        settingsService: newSettingsService,
        runtimeId: 'test-new-instance',
        metadata: { source: 'persistence-test' },
      });
      setActiveProviderRuntimeContext(newRuntime);
      registerSettingsService(newSettingsService);

      const newConfig = new Config({
        sessionId: 'new-session',
        targetDir: process.cwd(),
        debugMode: false,
        model: 'test-model',
        cwd: process.cwd(),
      });

      expect(newConfig.getEphemeralSetting('persistTest')).toBeUndefined();
      expect(
        newSettingsService.getProviderSettings('test-provider').key,
      ).toBeUndefined();
    });

    /**
     * @requirement REQ-INT-003.2
     * @scenario Multiple instances share same service
     * @given Multiple Config instances
     * @when One updates settings
     * @then All instances see the change
     */
    it('should share settings between multiple Config instances', () => {
      const config2 = new Config({
        sessionId: 'test-session-2',
        targetDir: process.cwd(),
        debugMode: false,
        model: 'test-model-2',
        cwd: process.cwd(),
      });

      config.setEphemeralSetting('sharedValue', 'visible-to-all');

      expect(config2.getEphemeralSetting('sharedValue')).toBe('visible-to-all');

      config2.setEphemeralSetting('anotherShared', 42);

      expect(config.getEphemeralSetting('anotherShared')).toBe(42);
    });
  });

  describe('Performance Integration', () => {
    /**
     * @requirement REQ-INT-004.1
     * @scenario Performance requirements met
     * @given SettingsService instance
     * @when 1000 operations are performed
     * @then All operations complete in under 10ms
     * @and All operations are synchronous
     */
    it('should complete 1000 operations synchronously under 10ms', () => {
      const startTime = Date.now();

      for (let i = 0; i < 1000; i++) {
        config.setEphemeralSetting(`key${i}`, i);
        config.getEphemeralSetting(`key${i}`);
      }

      const elapsed = Date.now() - startTime;

      expect(elapsed).toBeLessThan(10);

      expect(config.getEphemeralSetting('key999')).toBe(999);
      expect(config.getEphemeralSetting('key0')).toBe(0);
      expect(config.getEphemeralSetting('key500')).toBe(500);
    });

    /**
     * @requirement REQ-INT-004.2
     * @scenario Provider operations performance
     * @given SettingsService instance
     * @when Multiple provider operations are performed
     * @then All complete synchronously and quickly
     */
    it('should handle provider operations efficiently', () => {
      const startTime = Date.now();

      const providers = ['openai', 'anthropic', 'google', 'local'];
      const settingsPerProvider = 50;

      for (const provider of providers) {
        for (let i = 0; i < settingsPerProvider; i++) {
          settingsService.setProviderSetting(
            provider,
            `setting${i}`,
            `value${i}`,
          );
        }
      }

      for (const provider of providers) {
        const settings = settingsService.getProviderSettings(provider);
        expect(Object.keys(settings)).toHaveLength(settingsPerProvider);
      }

      const elapsed = Date.now() - startTime;
      expect(elapsed).toBeLessThan(10);
    });
  });

  describe('Multiple Component Integration', () => {
    /**
     * @requirement REQ-INT-005.1
     * @scenario Multiple components work together
     * @given Config, SettingsService, and event listeners
     * @when Complex workflow is executed
     * @then All components interact correctly
     * @and Data flows properly between components
     */
    it('should support complex multi-component workflows', () => {
      const events: Array<{ type: string; data: unknown }> = [];

      const globalListener = (event: unknown) => {
        events.push({ type: 'global-change', data: event });
      };
      const providerListener = (event: unknown) => {
        events.push({ type: 'provider-change', data: event });
      };
      const clearListener = () => {
        events.push({ type: 'cleared', data: null });
      };

      mockEventListeners.push(globalListener, providerListener, clearListener);
      settingsService.on('change', globalListener);
      settingsService.on('provider-change', providerListener);
      settingsService.on('cleared', clearListener);

      config.setEphemeralSetting('model', 'gpt-4');
      config.setEphemeralSetting('temperature', 0.7);

      settingsService.setProviderSetting('openai', 'apiKey', 'key-1');
      settingsService.setProviderSetting('anthropic', 'apiKey', 'key-2');

      config.setEphemeralSetting('model', 'gpt-4-turbo');

      const allGlobalSettings = config.getEphemeralSettings();
      const openaiSettings = settingsService.getProviderSettings('openai');
      const anthropicSettings =
        settingsService.getProviderSettings('anthropic');

      config.clearEphemeralSettings();

      expect(allGlobalSettings.model).toBe('gpt-4-turbo');
      expect(allGlobalSettings.temperature).toBe(0.7);
      expect(openaiSettings.apiKey).toBe('key-1');
      expect(anthropicSettings.apiKey).toBe('key-2');

      expect(events).toHaveLength(6);
      expect(events[0].type).toBe('global-change');
      expect(events[1].type).toBe('global-change');
      expect(events[2].type).toBe('provider-change');
      expect(events[3].type).toBe('provider-change');
      expect(events[4].type).toBe('global-change');
      expect(events[5].type).toBe('cleared');

      expect(config.getEphemeralSetting('model')).toBeUndefined();
      expect(config.getEphemeralSetting('temperature')).toBeUndefined();
    });
  });

  describe('Legacy Interface Compatibility', () => {
    /**
     * @requirement REQ-INT-006.1
     * @scenario Legacy promise-based interface works
     * @given SettingsService with legacy methods
     * @when Legacy methods are called
     * @then They return resolved promises
     * @and Data is consistent with synchronous methods
     */
    it('should support legacy promise-based interface', async () => {
      config.setEphemeralSetting('model', 'test-model');
      settingsService.setProviderSetting('openai', 'apiKey', 'test-key');

      const globalSettings = await settingsService.getSettings();
      const providerSettings = await settingsService.getSettings('openai');

      expect(globalSettings.providers.openai.apiKey).toBe('test-key');
      expect(providerSettings.apiKey).toBe('test-key');

      await settingsService.updateSettings({ model: 'updated-model' });
      await settingsService.updateSettings('openai', { model: 'gpt-4' });

      expect(config.getEphemeralSetting('model')).toBe('updated-model');
      expect(settingsService.getProviderSettings('openai').model).toBe('gpt-4');
    });

    /**
     * @requirement REQ-INT-006.2
     * @scenario Diagnostics integration works
     * @given SettingsService with data
     * @when Diagnostics are requested
     * @then Complete diagnostics are returned
     */
    it('should provide comprehensive diagnostics', async () => {
      config.setEphemeralSetting('model', 'test-model');
      config.setEphemeralSetting('temperature', 0.8);
      settingsService.setProviderSetting('openai', 'apiKey', 'test-key');
      settingsService.setProviderSetting('openai', 'model', 'gpt-4');
      settingsService.set('activeProvider', 'openai');

      const diagnostics = await settingsService.getDiagnosticsData();

      expect(diagnostics.provider).toBe('openai');
      expect(diagnostics.providerSettings.apiKey).toBe('test-key');
      expect(diagnostics.providerSettings.model).toBe('gpt-4');
      expect(diagnostics.ephemeralSettings.model).toBe('test-model');
      expect(diagnostics.ephemeralSettings.temperature).toBe(0.8);
      expect(diagnostics.allSettings.providers.openai.apiKey).toBe('test-key');
    });
  });
});
