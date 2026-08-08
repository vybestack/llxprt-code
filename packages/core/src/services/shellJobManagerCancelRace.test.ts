/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ShellJobManager } from './shellJobManager.js';
import { boundedTaskkill, type TaskkillResult } from './shellProcessKill.js';
import {
  buildInnerPidMarkerCommand,
  disposeAndCleanupWindowsTest,
  readInnerPidFromMarker,
} from '../../test/utils/shellJobTestCleanup.js';

interface BlockedTaskkillManager {
  manager: ShellJobManager;
  releaseTaskkill: () => void;
  taskkillStarted: Promise<void>;
  getKillCallCount: () => number;
}

function createBlockedTaskkillManager(
  baseDir: string,
  logMaxBytes?: number,
): BlockedTaskkillManager {
  let killCallCount = 0;
  let releaseTaskkill!: () => void;
  let signalTaskkillStarted!: () => void;
  const taskkillBlocked = new Promise<void>((resolve) => {
    releaseTaskkill = resolve;
  });
  const taskkillStarted = new Promise<void>((resolve) => {
    signalTaskkillStarted = resolve;
  });
  const manager = new ShellJobManager({
    baseDir,
    logMaxBytes,
    taskkillImpl: async (targetPid: number): Promise<TaskkillResult> => {
      killCallCount++;
      signalTaskkillStarted();
      await taskkillBlocked;
      return boundedTaskkill(targetPid);
    },
  });
  return {
    manager,
    releaseTaskkill,
    taskkillStarted,
    getKillCallCount: () => killCallCount,
  };
}

async function waitForTerminal(
  manager: ShellJobManager,
  id: string,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (manager.get(id)?.state === 'running') {
    if (Date.now() > deadline) {
      throw new Error(`Job ${id} did not reach terminal state in time`);
    }
    await Bun.sleep(50);
  }
}

describe.skipIf(os.platform() !== 'win32')(
  'ShellJobManager cancellation ownership',
  () => {
    it('allows only the first cancellation to terminate the process tree', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'win-cancel-race-'));
      const innerMarker = path.join(dir, 'inner.pid');
      const { manager, releaseTaskkill, taskkillStarted, getKillCallCount } =
        createBlockedTaskkillManager(dir);
      let outerPid = 0;
      let innerPid = 0;
      try {
        const job = manager.launch({
          command: buildInnerPidMarkerCommand(innerMarker, 60),
          cwd: os.tmpdir(),
        });
        outerPid = job.pid ?? 0;
        innerPid = await readInnerPidFromMarker(innerMarker, 10_000);

        const firstCancellation = manager.cancel(job.id);
        await taskkillStarted;
        const secondCancellation = manager.cancel(job.id);
        expect(getKillCallCount()).toBe(1);

        releaseTaskkill();
        expect(await firstCancellation).toBe(true);
        expect(await secondCancellation).toBe(false);
        expect(getKillCallCount()).toBe(1);
        expect(manager.get(job.id)?.state).toBe('cancelled');
      } finally {
        releaseTaskkill();
        await disposeAndCleanupWindowsTest(dir, manager, [outerPid, innerPid]);
      }
    }, 45_000);

    it('keeps cancellation terminal ownership when output crosses the cap afterward', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'win-cancel-cap-'));
      const innerMarker = path.join(dir, 'inner.pid');
      const { manager, releaseTaskkill, taskkillStarted, getKillCallCount } =
        createBlockedTaskkillManager(dir, 1);
      let outerPid = 0;
      let innerPid = 0;
      try {
        const job = manager.launch({
          command: buildInnerPidMarkerCommand(
            innerMarker,
            60,
            "Start-Sleep -Seconds 2; Write-Output ('x' * 128)",
          ),
          cwd: os.tmpdir(),
        });
        outerPid = job.pid ?? 0;
        innerPid = await readInnerPidFromMarker(innerMarker, 10_000);

        const cancellation = manager.cancel(job.id);
        await taskkillStarted;
        await Bun.sleep(3000);
        expect(getKillCallCount()).toBe(1);

        releaseTaskkill();
        expect(await cancellation).toBe(true);
        await waitForTerminal(manager, job.id);
        expect(manager.get(job.id)?.state).toBe('cancelled');
        expect(getKillCallCount()).toBe(1);
      } finally {
        releaseTaskkill();
        await disposeAndCleanupWindowsTest(dir, manager, [outerPid, innerPid]);
      }
    }, 45_000);

    it('keeps cap terminal ownership when cancellation follows', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'win-cap-cancel-'));
      const innerMarker = path.join(dir, 'inner.pid');
      const { manager, releaseTaskkill, taskkillStarted, getKillCallCount } =
        createBlockedTaskkillManager(dir, 1);
      let outerPid = 0;
      let innerPid = 0;
      try {
        const job = manager.launch({
          command: buildInnerPidMarkerCommand(
            innerMarker,
            60,
            "Write-Output ('x' * 128)",
          ),
          cwd: os.tmpdir(),
        });
        outerPid = job.pid ?? 0;
        innerPid = await readInnerPidFromMarker(innerMarker, 10_000);

        await taskkillStarted;
        const cancellation = manager.cancel(job.id);
        expect(getKillCallCount()).toBe(1);

        releaseTaskkill();
        expect(await cancellation).toBe(false);
        await waitForTerminal(manager, job.id);
        const terminal = manager.get(job.id);
        expect(terminal?.state).toBe('failed');
        expect(terminal?.failureReason).toContain('exceeded cap');
        expect(getKillCallCount()).toBe(1);
      } finally {
        releaseTaskkill();
        await disposeAndCleanupWindowsTest(dir, manager, [outerPid, innerPid]);
      }
    }, 45_000);
  },
);
