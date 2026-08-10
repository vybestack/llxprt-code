/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Behavioral evidence for Config-level perf copy isolation. P09 gap: the
 * nested perf sub-object must be defensively cloned on ingress (constructor
 * resolution and updateTelemetrySettings) and on egress (getTelemetrySettings)
 * so that mutating a returned or supplied perf object can never reach internal
 * state. Isolation is provided by copying, not by freezing.
 *
 * These tests exercise the real Config public methods end-to-end.
 */

import { describe, it, expect } from 'bun:test';
import { Config } from './config.js';
import type { ConfigParameters } from './config.js';

function makeConfig(telemetry?: ConfigParameters['telemetry']): Config {
  return new Config({
    sessionId: 'perf-copy-session',
    targetDir: '.',
    cwd: '.',
    debugMode: false,
    model: 'test-model',
    usageStatisticsEnabled: false,
    telemetry,
  });
}

describe('Config telemetry perf copy isolation', () => {
  describe('constructor/get copy isolation', () => {
    it('getTelemetrySettings returns a perf object that is a copy of the internal reference', () => {
      const config = makeConfig({
        perf: { enabled: true, memory: true },
      });
      const got = config.getTelemetrySettings();

      expect(got.perf).toEqual({ enabled: true, memory: true });
      // The returned perf must not be the internal reference.
      expect(got.perf).not.toBe(
        (config as unknown as { telemetrySettings: { perf?: unknown } })
          .telemetrySettings.perf,
      );
    });

    it('mutating the returned perf does not affect a subsequent get', () => {
      const config = makeConfig({
        perf: { enabled: true, memory: true },
      });
      const got = config.getTelemetrySettings();
      got.perf!.enabled = false;
      got.perf!.memory = false;

      const gotAgain = config.getTelemetrySettings();
      expect(gotAgain.perf).toEqual({ enabled: true, memory: true });
    });

    it('two consecutive gets return independent perf objects', () => {
      const config = makeConfig({
        perf: { enabled: true, memory: false },
      });
      const first = config.getTelemetrySettings();
      const second = config.getTelemetrySettings();

      expect(first.perf).not.toBe(second.perf);
      first.perf!.enabled = false;
      expect(second.perf?.enabled).toBe(true);
    });

    it('returned perf is not frozen — isolation is by copy, not by freeze', () => {
      const config = makeConfig({
        perf: { enabled: true, memory: true },
      });
      const got = config.getTelemetrySettings();

      expect(Object.isFrozen(got.perf)).toBe(false);
      // Mutation succeeds (no throw) but must not leak into internal state.
      expect(() => {
        got.perf!.enabled = false;
      }).not.toThrow();
      expect(config.getTelemetrySettings().perf?.enabled).toBe(true);
    });
  });

  describe('update/get copy isolation', () => {
    it('updateTelemetrySettings clones a provided perf so caller mutation cannot affect internal state', () => {
      const config = makeConfig();
      const callerPerf = { enabled: true, memory: true };
      config.updateTelemetrySettings({ perf: callerPerf });

      // The stored perf must not be the caller's reference.
      expect(
        (config as unknown as { telemetrySettings: { perf?: unknown } })
          .telemetrySettings.perf,
      ).not.toBe(callerPerf);

      // Mutating the caller object after update has no effect.
      callerPerf.enabled = false;
      callerPerf.memory = false;
      expect(config.getTelemetrySettings().perf).toEqual({
        enabled: true,
        memory: true,
      });
    });

    it('a perf obtained via get, then mutated, does not leak back through update', () => {
      const config = makeConfig({
        perf: { enabled: true, memory: true },
      });
      const snapshot = config.getTelemetrySettings();
      // Hand the (already-isolated) perf back in via update, then mutate it.
      config.updateTelemetrySettings({ perf: snapshot.perf });
      snapshot.perf!.enabled = false;

      expect(config.getTelemetrySettings().perf?.enabled).toBe(true);
    });

    it('omitting perf in update retains the previously-cloned internal perf', () => {
      const config = makeConfig({
        perf: { enabled: true, memory: true },
      });
      config.updateTelemetrySettings({ logPrompts: false });

      expect(config.getTelemetrySettings().perf).toEqual({
        enabled: true,
        memory: true,
      });
    });

    it('providing a perf replaces it entirely — enabled/memory are not deep-merged', () => {
      const config = makeConfig({
        perf: { enabled: true, memory: true },
      });
      // New perf omits memory: shallow replacement, not a merge.
      config.updateTelemetrySettings({ perf: { enabled: true } });

      expect(config.getTelemetrySettings().perf).toEqual({ enabled: true });
    });
  });
});
