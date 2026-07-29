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
} from '../src/service/process-termination';

function isRunning(proc: ChildProcessWithoutNullStreams): boolean {
  return proc.exitCode === null && proc.signalCode === null;
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
    it('kills and awaits a live child before surfacing taskkill failure', async () => {
      const { proc, closePromise } = await createLongRunningChild();

      try {
        await expect(
          withTaskkillUnavailable(() => forceKillProcess(proc, closePromise)),
        ).rejects.toThrow();
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
  },
);
