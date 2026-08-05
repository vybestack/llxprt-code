/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { ShellJobManager } from '../services/shellJobManager.js';
import {
  normalizeShellMaxBackgroundJobs,
  normalizeShellLogMaxBytes,
  getOrCreateShellJobManager,
} from './asyncTaskServices.js';

function makeTempBase(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'shell-job-cfg-test-'));
}

function pgidOf(pid: number): number | null {
  const result = spawnSync('ps', ['-o', 'pgid=', '-p', String(pid)], {
    encoding: 'utf8',
  });
  const parsed = parseInt(result.stdout.trim(), 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function isPidAliveWindows(pid: number): boolean {
  const result = spawnSync(
    'tasklist',
    ['/FI', `PID eq ${pid}`, '/NH', '/FO', 'CSV'],
    { encoding: 'utf8', timeout: 5000 },
  );
  return result.stdout.includes(String(pid));
}

/**
 * Returns true when the launched job's process is no longer alive.
 *
 * On POSIX this inspects the process group (the manager launches a detached
 * group); on Windows the job record holds the outer PowerShell PID and
 * dispose() reaps the tree via `taskkill /T /F`, so checking that single PID
 * is sufficient.
 */
function isProcessGone(pid: number): boolean {
  if (os.platform() === 'win32') {
    return !isPidAliveWindows(pid);
  }
  const pgid = pgidOf(pid);
  if (pgid === null) {
    return true;
  }
  try {
    process.kill(-pgid, 0);
    return false;
  } catch {
    return true;
  }
}

/** A command that stays alive long enough to observe a `running` job. */
function longRunningCommand(): string {
  return os.platform() === 'win32' ? 'Start-Sleep -Seconds 60' : 'sleep 60';
}

/** A command that writes `bye` to stdout and exits immediately. */
function echoByeCommand(): string {
  return os.platform() === 'win32' ? 'Write-Output bye' : 'echo bye';
}

function makeFakeSettingsService(values: Record<string, unknown> = {}): {
  get: (key: string) => unknown;
  set: (key: string, value: unknown) => void;
} {
  const store = new Map<string, unknown>(Object.entries(values));
  return {
    get: (key: string) => store.get(key),
    set: (key: string, value: unknown) => {
      store.set(key, value);
    },
  };
}

describe('Shell job config wiring', () => {
  describe('normalizeShellMaxBackgroundJobs', () => {
    it('returns the number when valid positive integer', () => {
      expect(normalizeShellMaxBackgroundJobs(10)).toBe(10);
      expect(normalizeShellMaxBackgroundJobs(1)).toBe(1);
    });

    it('returns -1 for unlimited', () => {
      expect(normalizeShellMaxBackgroundJobs(-1)).toBe(-1);
    });

    it('parses string values', () => {
      expect(normalizeShellMaxBackgroundJobs('20')).toBe(20);
      expect(normalizeShellMaxBackgroundJobs('-1')).toBe(-1);
    });

    it('falls back to default for invalid input', () => {
      expect(normalizeShellMaxBackgroundJobs(0)).toBe(10);
      expect(normalizeShellMaxBackgroundJobs(-5)).toBe(10);
      expect(normalizeShellMaxBackgroundJobs('abc')).toBe(10);
      expect(normalizeShellMaxBackgroundJobs(undefined)).toBe(10);
    });

    it('respects custom fallback', () => {
      expect(normalizeShellMaxBackgroundJobs(0, 5)).toBe(5);
    });
  });

  describe('normalizeShellLogMaxBytes', () => {
    it('returns the value when valid', () => {
      expect(normalizeShellLogMaxBytes(8388608)).toBe(8388608);
      expect(normalizeShellLogMaxBytes(1024)).toBe(1024);
    });

    it('parses string values', () => {
      expect(normalizeShellLogMaxBytes('4096')).toBe(4096);
    });

    it('falls back to default for values below minimum', () => {
      expect(normalizeShellLogMaxBytes(512)).toBe(8388608);
      expect(normalizeShellLogMaxBytes(0)).toBe(8388608);
    });

    it('falls back for invalid input', () => {
      expect(normalizeShellLogMaxBytes('abc')).toBe(8388608);
      expect(normalizeShellLogMaxBytes(undefined)).toBe(8388608);
    });
  });

  describe('getOrCreateShellJobManager', () => {
    it('lazily creates a ShellJobManager with resolved settings', () => {
      let stored: ShellJobManager | undefined;
      const settings = makeFakeSettingsService({
        'shell-max-background-jobs': 7,
        'shell-background-log-max-bytes': 4194304,
      });

      const manager = getOrCreateShellJobManager(
        settings,
        () => stored,
        (m) => {
          stored = m;
        },
      );

      expect(manager).toBeDefined();
      expect(manager.getMaxBackgroundJobs()).toBe(7);

      // Second call returns the same instance
      const manager2 = getOrCreateShellJobManager(
        settings,
        () => stored,
        (m) => {
          stored = m;
        },
      );
      expect(manager2).toBe(manager);
    });

    it('uses defaults when settings absent', () => {
      let stored: ShellJobManager | undefined;
      const settings = makeFakeSettingsService({});

      const manager = getOrCreateShellJobManager(
        settings,
        () => stored,
        (m) => {
          stored = m;
        },
      );

      expect(manager.getMaxBackgroundJobs()).toBe(10);
    });
  });

  describe('settings propagation to a live manager', () => {
    it('setMaxBackgroundJobs changes the budget', async () => {
      const manager = new ShellJobManager({
        maxBackgroundJobs: 5,
        baseDir: makeTempBase(),
      });
      expect(manager.getMaxBackgroundJobs()).toBe(5);

      // Simulate what configBase.setEphemeralSetting does
      manager.setMaxBackgroundJobs(normalizeShellMaxBackgroundJobs(3));
      expect(manager.getMaxBackgroundJobs()).toBe(3);

      await manager.dispose();
    });
  });

  describe('disposal terminates running jobs', () => {
    let manager: ShellJobManager;
    let baseDir: string;

    beforeEach(() => {
      baseDir = makeTempBase();
      manager = new ShellJobManager({ baseDir });
    });

    afterEach(async () => {
      // dispose() owns baseDir (ShellJobLogStore.destroy() removes it), so an
      // explicit rmSync here is redundant and, on Windows, races with
      // file-handle release right after taskkill /F /T (EPERM). The manager
      // is the owner and best-effort removes the directory on dispose.
      await manager.dispose();
    });

    it('dispose cancels a running job and removes the temp dir', async () => {
      const job = manager.launch({
        command: longRunningCommand(),
        cwd: os.tmpdir(),
      });

      // Verify the job is running
      expect(manager.get(job.id)?.state).toBe('running');
      expect(isProcessGone(job.pid)).toBe(false);

      await manager.dispose();

      // The job must be terminal after dispose
      const terminal = manager.get(job.id);
      // After dispose, jobs map is cleared, so get returns undefined.
      // The proof is that the process group is gone.
      expect(terminal).toBeUndefined();
      expect(isProcessGone(job.pid)).toBe(true);
    });

    it('dispose removes the temp directory', async () => {
      manager.launch({
        command: echoByeCommand(),
        cwd: os.tmpdir(),
      });
      // Give it a moment to write
      await new Promise((resolve) => setTimeout(resolve, 200));

      await manager.dispose();

      expect(fs.existsSync(baseDir)).toBe(false);
    });
  });
});
