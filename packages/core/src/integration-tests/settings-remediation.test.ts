/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'bun:test';
import { SessionSettingsOwner } from '../session/session-settings-owner.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { performance } from 'node:perf_hooks';

const actual = { ...(await import('fs')) };
void vi.mock('fs', () => ({
  ...actual,
  existsSync: vi.fn(() => true),
  readFileSync: vi.fn(() => '{}'),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

describe('Settings Remediation Integration', () => {
  let config: SessionSettingsOwner;
  let settingsService: SettingsService;
  let mockEventListeners: Array<(...args: unknown[]) => void>;

  beforeEach(() => {
    settingsService = new SettingsService();

    mockEventListeners = [];

    // Config never adopts ambient runtime state (issue #2300) — the settings
    // service is passed explicitly.
    config = new SessionSettingsOwner(settingsService);
  });

  afterEach(async () => {
    await config.dispose();
    mockEventListeners.forEach((listener) => {
      settingsService.off('change', listener);
      settingsService.off('provider-change', listener);
      settingsService.off('cleared', listener);
    });
    mockEventListeners = [];

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
      config.writeUserParameter('model', 'gpt-4');

      expect(settingsService.get('model')).toBe('gpt-4');
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
      settingsService.setProviderSetting('openai', 'auth-key', 'test-key-123');
      settingsService.setProviderSetting('openai', 'model', 'gpt-4');

      const providerSettings = settingsService.getProviderSettings('openai');
      expect(providerSettings['auth-key']).toBe('test-key-123');
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
      config.writeUserParameter('ui.theme', 'dark');
      config.writeUserParameter('advanced.debug', true);
      config.writeUserParameter('telemetry.enabled', false);

      expect(config.readNamedParameter('ui.theme')).toBe('dark');
      expect(config.readNamedParameter('advanced.debug')).toBe(true);
      expect(config.readNamedParameter('telemetry.enabled')).toBe(false);
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

      config.writeUserParameter('temperature', 0.7);
      config.writeUserParameter('temperature', 0.8);

      expect(changeEvents).toHaveLength(2);
      expect(changeEvents[0]).toStrictEqual({
        key: 'temperature',
        oldValue: undefined,
        newValue: 0.7,
      });
      expect(changeEvents[1]).toStrictEqual({
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
      expect(providerEvents[0]).toStrictEqual({
        provider: 'openai',
        key: 'model',
        oldValue: undefined,
        newValue: 'gpt-3.5-turbo',
      });
      expect(providerEvents[1]).toStrictEqual({
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

      config.writeUserParameter('test', 'value');
      settingsService.clear();

      expect(clearedEventFired).toBe(true);
      expect(config.readNamedParameter('test')).toBeUndefined();
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
    it('should NOT persist settings across service instances', async () => {
      config.writeUserParameter('persistTest', 'should-not-persist');
      settingsService.setProviderSetting('test-provider', 'key', 'value');

      expect(config.readNamedParameter('persistTest')).toBe(
        'should-not-persist',
      );
      expect(settingsService.getProviderSettings('test-provider').key).toBe(
        'value',
      );

      const newSettingsService = new SettingsService();

      const newConfig = new SessionSettingsOwner(newSettingsService);

      expect(newConfig.readNamedParameter('persistTest')).toBeUndefined();
      await newConfig.dispose();
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
    it('should share settings between multiple Config instances', async () => {
      const config2 = new SessionSettingsOwner(settingsService);

      config.writeUserParameter('sharedValue', 'visible-to-all');

      expect(config2.readNamedParameter('sharedValue')).toBe('visible-to-all');

      config2.writeUserParameter('anotherShared', 42);

      expect(config.readNamedParameter('anotherShared')).toBe(42);
      await config2.dispose();
    });
  });

  describe('Performance Integration', () => {
    /**
     * @requirement REQ-INT-004.1
     * @scenario Performance requirements met
     * @given SettingsService instance
     * @when 1000 operations are performed
     * @then All operations complete quickly under loaded conditions
     * @and All operations are synchronous
     */
    it('should complete 1000 operations synchronously under 35ms median', () => {
      // Warmup: stabilize JIT/engine before timing to reduce variance
      for (let i = 0; i < 100; i++) {
        config.writeUserParameter(`warmup${i}`, i);
        config.readNamedParameter(`warmup${i}`);
      }

      // Run timed portion multiple times to smooth out noise from GC pauses,
      // CPU scheduling, and CI contention.
      const runs = 5;
      const elapsedTimes: number[] = [];

      for (let run = 0; run < runs; run++) {
        const startTime = performance.now();

        for (let i = 0; i < 1000; i++) {
          config.writeUserParameter(`key${i}`, i);
          config.readNamedParameter(`key${i}`);
        }

        elapsedTimes.push(performance.now() - startTime);
      }

      // Use median instead of average for robustness against outliers (e.g., GC pauses)
      const sortedTimes = [...elapsedTimes].sort((a, b) => a - b);
      const medianElapsed = sortedTimes[Math.floor(sortedTimes.length / 2)];

      // Rationale for thresholds:
      // - CI (50ms): CI runners are noisy/contended with shared resources.
      // - Local (35ms): Loaded local environments (e.g., full test suite running
      //   in parallel, IDE indexing, background processes) can cause GC pauses
      //   and CPU scheduling delays. This threshold is still 3x faster than a
      //   regression (100ms+ would indicate a real problem), so it catches
      //   regressions while avoiding flaky failures from normal load variations.
      // Using median over 5 runs provides robustness against occasional outliers
      // (e.g., a single GC pause) while still catching regressions - a true
      // performance bug would cause ALL runs to be slow.
      expect(medianElapsed).toBeLessThan(medianPerfBoundMs());

      // Verify functional correctness of final run
      expect(config.readNamedParameter('key999')).toBe(999);
      expect(config.readNamedParameter('key0')).toBe(0);
      expect(config.readNamedParameter('key500')).toBe(500);
    });

    /**
     * @requirement REQ-INT-004.2
     * @scenario Provider operations performance
     * @given SettingsService instance
     * @when Multiple provider operations are performed
     * @then All complete synchronously and quickly
     */
    it('should handle provider operations efficiently', () => {
      const startTime = performance.now();

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

      const elapsed = performance.now() - startTime;
      expect(elapsed).toBeLessThan(providerPerfBoundMs());
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

      config.writeUserParameter('model', 'gpt-4');
      config.writeUserParameter('temperature', 0.7);

      settingsService.setProviderSetting('openai', 'auth-key', 'key-1');
      settingsService.setProviderSetting('anthropic', 'auth-key', 'key-2');

      config.writeUserParameter('model', 'gpt-4-turbo');

      const allGlobalSettings = config.captureNamedParameters();
      const openaiSettings = settingsService.getProviderSettings('openai');
      const anthropicSettings =
        settingsService.getProviderSettings('anthropic');

      settingsService.clear();

      expect(allGlobalSettings.model).toBe('gpt-4-turbo');
      expect(allGlobalSettings.temperature).toBe(0.7);
      expect(openaiSettings['auth-key']).toBe('key-1');
      expect(anthropicSettings['auth-key']).toBe('key-2');

      expect(events).toHaveLength(6);
      expect(events[0].type).toBe('global-change');
      expect(events[1].type).toBe('global-change');
      expect(events[2].type).toBe('provider-change');
      expect(events[3].type).toBe('provider-change');
      expect(events[4].type).toBe('global-change');
      expect(events[5].type).toBe('cleared');

      expect(config.readNamedParameter('model')).toBeUndefined();
      expect(config.readNamedParameter('temperature')).toBeUndefined();
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
      config.writeUserParameter('model', 'test-model');
      settingsService.setProviderSetting('openai', 'auth-key', 'test-key');

      const globalSettings = await settingsService.getSettings();
      const providerSettings = await settingsService.getSettings('openai');

      expect(globalSettings.providers.openai['auth-key']).toBe('test-key');
      expect(providerSettings['auth-key']).toBe('test-key');

      await settingsService.updateSettings({ model: 'updated-model' });
      await settingsService.updateSettings('openai', { model: 'gpt-4' });

      expect(config.readNamedParameter('model')).toBe('updated-model');
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
      config.writeUserParameter('model', 'test-model');
      config.writeUserParameter('temperature', 0.8);
      settingsService.setProviderSetting('openai', 'auth-key', 'test-key');
      settingsService.setProviderSetting('openai', 'model', 'gpt-4');
      settingsService.set('activeProvider', 'openai');

      const diagnostics = await settingsService.getDiagnosticsData();

      expect(diagnostics.provider).toBe('openai');
      expect(diagnostics.providerSettings['auth-key']).toBe('[REDACTED]');
      expect(diagnostics.providerSettings.model).toBe('gpt-4');
      expect(diagnostics.ephemeralSettings.model).toBe('test-model');
      expect(diagnostics.ephemeralSettings.temperature).toBe(0.8);
      expect(diagnostics.allSettings.providers.openai['auth-key']).toBe(
        '[REDACTED]',
      );
    });
  });
});

function medianPerfBoundMs(): number {
  return process.env.CI === 'true' ? 50 : 35;
}

function providerPerfBoundMs(): number {
  return process.env.CI === 'true' ? 50 : 10;
}
