/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Behavioral evidence for the Config-level perf read API:
 * getTelemetryPerfEnabled (master switch) and getTelemetryPerfMemory
 * (master-gated memory flag). Both delegate to resolvePerfSettings so the
 * gating policy lives in one place. These tests exercise the real Config.
 */

import { describe, it, expect } from 'bun:test';
import { Config } from './config.js';
import type { ConfigParameters } from './config.js';

function makeConfig(telemetry?: ConfigParameters['telemetry']): Config {
  return new Config({
    sessionId: 'perf-getters-session',
    targetDir: '.',
    cwd: '.',
    debugMode: false,
    model: 'test-model',
    usageStatisticsEnabled: false,
    telemetry,
  });
}

describe('Config.getTelemetryPerfEnabled / getTelemetryPerfMemory', () => {
  describe('defaults', () => {
    it('perf enabled defaults to false when perf is absent', () => {
      const config = makeConfig({ enabled: true });
      expect(config.getTelemetryPerfEnabled()).toBe(false);
    });

    it('perf memory defaults to false when perf is absent', () => {
      const config = makeConfig({ enabled: true });
      expect(config.getTelemetryPerfMemory()).toBe(false);
    });

    it('both default to false for an empty perf object', () => {
      const config = makeConfig({ perf: {} });
      expect(config.getTelemetryPerfEnabled()).toBe(false);
      expect(config.getTelemetryPerfMemory()).toBe(false);
    });
  });

  describe('master switch', () => {
    it('reflects perf.enabled when on', () => {
      const config = makeConfig({ perf: { enabled: true } });
      expect(config.getTelemetryPerfEnabled()).toBe(true);
    });

    it('reflects perf.enabled when off', () => {
      const config = makeConfig({ perf: { enabled: false } });
      expect(config.getTelemetryPerfEnabled()).toBe(false);
    });
  });

  describe('memory is master-gated', () => {
    it('memory is false when the master switch is off, even if memory is configured on', () => {
      const config = makeConfig({ perf: { enabled: false, memory: true } });
      expect(config.getTelemetryPerfMemory()).toBe(false);
    });

    it('memory is false when only memory is set and master is absent (defaults off)', () => {
      const config = makeConfig({ perf: { memory: true } });
      expect(config.getTelemetryPerfMemory()).toBe(false);
    });

    it('memory is true only when the master switch is on and memory is on', () => {
      const config = makeConfig({ perf: { enabled: true, memory: true } });
      expect(config.getTelemetryPerfMemory()).toBe(true);
    });

    it('memory is false when the master switch is on but memory is off', () => {
      const config = makeConfig({ perf: { enabled: true, memory: false } });
      expect(config.getTelemetryPerfMemory()).toBe(false);
    });
  });

  describe('reflects updates', () => {
    it('getters reflect an update that enables the master switch and memory', () => {
      const config = makeConfig();
      expect(config.getTelemetryPerfEnabled()).toBe(false);
      expect(config.getTelemetryPerfMemory()).toBe(false);

      config.updateTelemetrySettings({ perf: { enabled: true, memory: true } });
      expect(config.getTelemetryPerfEnabled()).toBe(true);
      expect(config.getTelemetryPerfMemory()).toBe(true);
    });

    it('disabling the master switch gates memory back to false', () => {
      const config = makeConfig({ perf: { enabled: true, memory: true } });
      config.updateTelemetrySettings({
        perf: { enabled: false, memory: true },
      });

      expect(config.getTelemetryPerfEnabled()).toBe(false);
      expect(config.getTelemetryPerfMemory()).toBe(false);
    });
  });

  describe('return types', () => {
    it('always returns booleans across the full state space', () => {
      const cases: Array<ConfigParameters['telemetry']> = [
        undefined,
        { enabled: true },
        { perf: {} },
        { perf: { enabled: true } },
        { perf: { enabled: false } },
        { perf: { enabled: true, memory: true } },
        { perf: { enabled: false, memory: true } },
      ];
      for (const telemetry of cases) {
        const config = makeConfig(telemetry);
        expect(typeof config.getTelemetryPerfEnabled()).toBe('boolean');
        expect(typeof config.getTelemetryPerfMemory()).toBe('boolean');
      }
    });
  });
});
