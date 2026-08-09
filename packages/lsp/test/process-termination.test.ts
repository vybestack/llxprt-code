/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { once } from 'node:events';
import {
  forceKillProcess,
  observeProcessClose,
} from '../src/service/process-termination.js';

function isRunning(proc: ChildProcessWithoutNullStreams): boolean {
  return proc.exitCode === null && proc.signalCode === null;
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function createLongRunningChild(): Promise<{
  proc: ChildProcessWithoutNullStreams;
  closePromise: Promise<void>;
}> {
  const proc = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
  const closePromise = observeProcessClose(proc);
  await once(proc, 'spawn');
  return { proc, closePromise };
}

async function withTaskkillUnavailable<T>(
  operation: () => Promise<T>,
): Promise<T> {
  const originalPath = process.env.PATH;
  const originalSystemRoot = process.env.SystemRoot;
  process.env.PATH = '';
  process.env.SystemRoot = '';
  try {
    return await operation();
  } finally {
    if (originalPath === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = originalPath;
    }
    if (originalSystemRoot === undefined) {
      delete process.env.SystemRoot;
    } else {
      process.env.SystemRoot = originalSystemRoot;
    }
  }
}

describe.skipIf(process.platform !== 'win32')(
  'Windows forced process termination',
  () => {
    it('kills and awaits a live child when taskkill is unavailable', async () => {
      const { proc, closePromise } = await createLongRunningChild();

      try {
        await expect(
          withTaskkillUnavailable(() => forceKillProcess(proc, closePromise)),
        ).resolves.toBeUndefined();
        expect(isRunning(proc)).toBe(false);
      } finally {
        if (isRunning(proc)) {
          proc.kill('SIGKILL');
          await closePromise;
        }
      }
    });

    it('does not report taskkill failure for an already terminated child', async () => {
      const proc = spawn(process.execPath, ['-e', 'process.exit(0)']);
      const closePromise = observeProcessClose(proc);
      await closePromise;

      await expect(
        withTaskkillUnavailable(() => forceKillProcess(proc, closePromise)),
      ).resolves.toBeUndefined();
    });

    it('confirms termination via externally observable state when taskkill succeeds but close is not emitted', async () => {
      // Reproduces the nightly Windows failure: taskkill /F /T succeeds
      // externally (exit 0) but Bun's ChildProcess may not emit `close`
      // for that path. forceKillProcess must resolve once the process is
      // externally gone, rather than surfacing an implementation-detail
      // cleanup timeout.
      const { proc, closePromise } = await createLongRunningChild();
      const pid = proc.pid;
      expect(pid).toBeDefined();
      expect(isPidAlive(pid as number)).toBe(true);

      const start = Date.now();
      await expect(
        forceKillProcess(proc, closePromise),
      ).resolves.toBeUndefined();
      const elapsed = Date.now() - start;

      // The requested OS outcome is achieved: the process is externally gone.
      expect(isPidAlive(pid as number)).toBe(false);
      // Must complete well under the 5-second caller budget.
      expect(elapsed).toBeLessThan(5_000);
    });
  },
);
