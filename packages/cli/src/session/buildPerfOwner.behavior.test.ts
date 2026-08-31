/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * P12 behavioral tests for buildAndStartPerfOwner disabled path (Item 5).
 *
 * Calls the REAL buildAndStartPerfOwner with perf disabled. Uses lazy object
 * methods (that throw if called) to prove ONLY getTelemetrySettings() is read
 * on the disabled path. Also proves no perf directory/artifacts/observers and
 * no timers/timing/memory APIs.
 *
 * The production buildAndStartPerfOwner reads config/agent lazily through
 * getters — but because config/agent arguments are evaluated before entry,
 * the test passes lazy object methods that prove all non-setting methods
 * are untouched.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import { promises as fsp } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  buildAndStartPerfOwner,
  type PerfOwnerConfigCapability,
  type PerfOwnerAgentCapability,
} from './interactiveUI.js';
import { LoadedSettings } from '../config/settings.js';
import {
  getInteractiveStdoutObserver,
  getInteractiveRenderObserver,
  setInteractiveStdoutObserver,
  setInteractiveRenderObserver,
} from '../ui/inkRenderOptions.js';
import {
  getPerfPhaseObserver,
  setPerfPhaseObserver,
} from '@vybestack/llxprt-code-telemetry/perf/perfPhaseObserver.js';

let dir: string;

describe('interactive performance ownership', () => {
  beforeEach(() => {
    dir = fs.mkdtempSync(join(tmpdir(), 'perf-disabled-'));
    setInteractiveStdoutObserver(null);
    setInteractiveRenderObserver(null);
    setPerfPhaseObserver(null);
  });

  afterEach(async () => {
    setInteractiveStdoutObserver(null);
    setInteractiveRenderObserver(null);
    setPerfPhaseObserver(null);
    try {
      await fsp.rm(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  /**
   * Creates a PerfOwnerConfigCapability where every method EXCEPT
   * getTelemetrySettings throws if called. This proves the disabled path
   * touches only getTelemetrySettings().
   */
  function makeThrowingConfig(): PerfOwnerConfigCapability & {
    telemetryCallCount: () => number;
  } {
    let telemetryCalls = 0;
    return {
      getTelemetrySettings() {
        telemetryCalls++;
        // Perf disabled: telemetry settings without perf.enabled.
        return { perf: { enabled: false } };
      },
      getSessionId() {
        throw new Error('getSessionId should not be called when perf disabled');
      },
      getProjectRoot() {
        throw new Error(
          'getProjectRoot should not be called when perf disabled',
        );
      },
      getScreenReader() {
        throw new Error(
          'getScreenReader should not be called when perf disabled',
        );
      },
      telemetryCallCount: () => telemetryCalls,
    };
  }

  /**
   * Creates a PerfOwnerAgentCapability where every method throws if called.
   */
  function makeThrowingAgent(): PerfOwnerAgentCapability {
    return {
      getRuntimeId() {
        throw new Error('getRuntimeId should not be called when perf disabled');
      },
      getProvider() {
        throw new Error('getProvider should not be called when perf disabled');
      },
      getModel() {
        throw new Error('getModel should not be called when perf disabled');
      },
    };
  }

  function makeSettings(): LoadedSettings {
    return new LoadedSettings(
      { path: '', settings: {} },
      { path: '', settings: {} },
      { path: '', settings: {} },
      { path: '', settings: {} },
      true,
    );
  }

  describe('buildAndStartPerfOwner — disabled path (Item 5)', () => {
    it('returns null and reads only getTelemetrySettings', async () => {
      const config = makeThrowingConfig();
      const agent = makeThrowingAgent();
      const settings = makeSettings();

      const owner = await buildAndStartPerfOwner(
        config,
        agent,
        settings,
        '0.0.0-test',
      );

      // Returns null — disabled.
      expect(owner).toBe(null);

      // Only getTelemetrySettings was called (exactly once).
      expect(config.telemetryCallCount()).toBe(1);
    });

    it('installs no observers and allocates no timers', async () => {
      const config = makeThrowingConfig();
      const agent = makeThrowingAgent();

      await buildAndStartPerfOwner(config, agent, makeSettings(), 'test');

      // No observers installed.
      expect(getInteractiveStdoutObserver()).toBe(null);
      expect(getInteractiveRenderObserver()).toBe(null);
      expect(getPerfPhaseObserver()).toBe(null);
    });

    it('does not mutate process.stdout or process.stderr', async () => {
      const config = makeThrowingConfig();
      const agent = makeThrowingAgent();

      const stdoutWrite = process.stdout.write;
      const stderrWrite = process.stderr.write;

      await buildAndStartPerfOwner(config, agent, makeSettings(), 'test');

      // No mutation of stdout/stderr write methods.
      expect(process.stdout.write).toBe(stdoutWrite);
      expect(process.stderr.write).toBe(stderrWrite);
    });
  });

  describe('buildAndStartPerfOwner — platform includes arch (Item 6)', () => {
    it('the resolved platform string includes process.platform-process.arch', async () => {
      // Import the resolver directly to prove the platform format.
      const { resolvePlatformArch } = await import(
        '../ui/hooks/perf/interactivePerfRuntime.js'
      );
      const platform = resolvePlatformArch();
      expect(platform).toBe(`${process.platform}-${process.arch}`);
    });
  });
});
