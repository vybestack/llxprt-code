import { SessionSettingsOwner } from '../session/session-settings-owner.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { afterEach } from 'bun:test';
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

const owners: SessionSettingsOwner[] = [];
function settingsFor(config: Config): SessionSettingsOwner {
  const owner = new SessionSettingsOwner(new SettingsService());
  owner.bindTelemetry(config);
  owners.push(owner);
  return owner;
}

describe('Config telemetry perf copy isolation', () => {
  afterEach(async () => {
    for (const owner of owners.splice(0)) await owner.dispose();
  });
  describe('constructor/get copy isolation', () => {
    it('getTelemetrySettings returns a perf object that is a copy of the internal reference', () => {
      const config = makeConfig({
        perf: { enabled: true, memory: true },
      });
      const got = config.getTelemetrySettings();

      expect(got.perf).toStrictEqual({ enabled: true, memory: true });
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
      expect(gotAgain.perf).toStrictEqual({ enabled: true, memory: true });
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
    it('updateTelemetrySettings clones a provided perf so caller mutation cannot affect internal state', async () => {
      const config = makeConfig();
      const owner = settingsFor(config);
      const callerPerf = { enabled: true, memory: true };
      await owner.updateTelemetrySettings({ perf: callerPerf });

      // The stored perf must not be the caller's reference.
      expect(owner.readTelemetrySettings().perf).not.toBe(callerPerf);

      // Mutating the caller object after update has no effect.
      callerPerf.enabled = false;
      callerPerf.memory = false;
      expect(owner.readTelemetrySettings().perf).toStrictEqual({
        enabled: true,
        memory: true,
      });
    });

    it('a perf obtained via get, then mutated, does not leak back through update', async () => {
      const config = makeConfig({
        perf: { enabled: true, memory: true },
      });
      const owner = settingsFor(config);
      const snapshot = owner.readTelemetrySettings();
      // Hand the (already-isolated) perf back in via update, then mutate it.
      await owner.updateTelemetrySettings({ perf: snapshot.perf });
      snapshot.perf!.enabled = false;

      expect(owner.readTelemetrySettings().perf?.enabled).toBe(true);
    });

    it('omitting perf in update retains the previously-cloned internal perf', async () => {
      const config = makeConfig({
        perf: { enabled: true, memory: true },
      });
      const owner = settingsFor(config);
      await owner.updateTelemetrySettings({ logPrompts: false });

      expect(owner.readTelemetrySettings().perf).toStrictEqual({
        enabled: true,
        memory: true,
      });
    });

    it('providing a perf replaces it entirely — enabled/memory are not deep-merged', async () => {
      const config = makeConfig({
        perf: { enabled: true, memory: true },
      });
      const owner = settingsFor(config);
      // New perf omits memory: shallow replacement, not a merge.
      await owner.updateTelemetrySettings({ perf: { enabled: true } });

      expect(owner.readTelemetrySettings().perf).toStrictEqual({
        enabled: true,
      });
    });
  });
});
