/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { Config } from './config.js';
import type { ConfigParameters } from './config.js';
import { ShellJobManager } from '../services/shellJobManager.js';
import type { ShellAdmissionSettingsReactor } from './coreSessionServices.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';

function makeConfig(): Config {
  const params: ConfigParameters = {
    sessionId: `reactor-test-${Date.now()}-${Math.random()}`,
    targetDir: os.tmpdir(),
    debugMode: false,
    cwd: os.tmpdir(),
    model: 'test-model',
    settingsService: new SettingsService(),
  };
  return new Config(params);
}

/**
 * A fake reactor that records every apply call, optionally throwing.
 */
function makeRecordingReactor(
  throwMsg?: string,
): ShellAdmissionSettingsReactor & {
  calls: number[];
} {
  const calls: number[] = [];
  return {
    calls,
    applyMaxBackgroundJobs(limit: number): void {
      calls.push(limit);
      if (throwMsg !== undefined) {
        throw new Error(throwMsg);
      }
    },
  };
}

describe('ShellAdmissionSettingsReactor registration and propagation', () => {
  it('applies to ALL registered reactors synchronously before the write returns', () => {
    const config = makeConfig();
    const reactor1 = makeRecordingReactor();
    const reactor2 = makeRecordingReactor();

    config.registerShellAdmissionReactor(reactor1);
    config.registerShellAdmissionReactor(reactor2);

    config.setEphemeralSetting('shell-max-background-jobs', 42);

    // Both reactors were called, synchronously, with the normalized value.
    expect(reactor1.calls).toEqual([42]);
    expect(reactor2.calls).toEqual([42]);
  });

  it('one reactor throwing does not prevent the other from running; error aggregates', () => {
    const config = makeConfig();
    const goodReactor = makeRecordingReactor();
    const throwingReactor = makeRecordingReactor('boom-A');

    config.registerShellAdmissionReactor(goodReactor);
    config.registerShellAdmissionReactor(throwingReactor);

    expect(() => {
      config.setEphemeralSetting('shell-max-background-jobs', 7);
    }).toThrow();

    try {
      config.setEphemeralSetting('shell-max-background-jobs', 7);
    } catch (err) {
      // The error should be an AggregateError or the single thrown error.
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toContain('boom-A');
    }

    // The non-throwing reactor still ran.
    expect(goodReactor.calls).toEqual([7, 7]);
    // The throwing reactor was still attempted.
    expect(throwingReactor.calls).toEqual([7, 7]);
  });

  it('multiple reactors throwing surfaces as an AggregateError', () => {
    const config = makeConfig();
    const r1 = makeRecordingReactor('boom-1');
    const r2 = makeRecordingReactor('boom-2');

    config.registerShellAdmissionReactor(r1);
    config.registerShellAdmissionReactor(r2);

    let caught: unknown;
    try {
      config.setEphemeralSetting('shell-max-background-jobs', 3);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(AggregateError);
    const aggregate = caught as AggregateError;
    expect(aggregate.errors).toHaveLength(2);
  });

  it('detach prevents the reactor from receiving future writes', () => {
    const config = makeConfig();
    const reactor = makeRecordingReactor();

    const detach = config.registerShellAdmissionReactor(reactor);

    config.setEphemeralSetting('shell-max-background-jobs', 10);
    expect(reactor.calls).toEqual([10]);

    detach();

    config.setEphemeralSetting('shell-max-background-jobs', 20);
    // No new call after detach.
    expect(reactor.calls).toEqual([10]);
  });

  it('detach is idempotent — calling twice is a no-op', () => {
    const config = makeConfig();
    const reactor = makeRecordingReactor();

    const detach = config.registerShellAdmissionReactor(reactor);
    detach();
    detach(); // Should not throw or error.

    config.setEphemeralSetting('shell-max-background-jobs', 10);
    expect(reactor.calls).toEqual([]);
  });
});

describe('ShellAdmissionSettingsReactor with a real ShellJobManager', () => {
  /**
   * A real ShellJobManager with limit 1 rejects a second concurrent job, and
   * admits it after the settings write raises the limit via the reactor. Uses
   * real short-lived processes — no mocks.
   */
  it('rejects a second concurrent job at limit 1, then admits after the limit is raised', async () => {
    const config = makeConfig();

    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reactor-real-mgr-'));
    const manager = new ShellJobManager({
      maxBackgroundJobs: 1,
      baseDir,
    });

    const reactor: ShellAdmissionSettingsReactor = {
      applyMaxBackgroundJobs(limit: number): void {
        manager.setMaxBackgroundJobs(limit);
      },
    };
    config.registerShellAdmissionReactor(reactor);

    try {
      // Launch one long-running job — should succeed.
      const job1 = manager.launch({
        command:
          os.platform() === 'win32' ? 'Start-Sleep -Seconds 30' : 'sleep 30',
        cwd: os.tmpdir(),
      });
      expect(job1.state).toBe('running');

      // A second concurrent job should be rejected (budget exhausted).
      expect(() =>
        manager.launch({
          command: os.platform() === 'win32' ? 'Write-Output hi' : 'echo hi',
          cwd: os.tmpdir(),
        }),
      ).toThrow(/budget exhausted/);

      // Raise the limit via the settings write path.
      config.setEphemeralSetting('shell-max-background-jobs', 5);

      // Now a second job should be admitted.
      const job2 = manager.launch({
        command: os.platform() === 'win32' ? 'Write-Output hi' : 'echo hi',
        cwd: os.tmpdir(),
      });
      expect(job2.state).toBe('running');

      // Clean up both jobs.
      await manager.cancel(job1.id);
      await manager.cancel(job2.id);
    } finally {
      await manager.dispose();
    }
  });
});
