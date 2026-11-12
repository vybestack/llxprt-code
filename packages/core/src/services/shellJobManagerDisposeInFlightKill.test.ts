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
import type { TaskkillResult } from './shellProcessKill.js';

describe('ShellJobManager disposal termination ownership', () => {
  it('waits for an in-flight Windows tree kill before returning', async () => {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dispose-kill-'));
    let signalKillStarted!: () => void;
    const killStarted = new Promise<void>((resolve) => {
      signalKillStarted = resolve;
    });
    let killFinished = false;
    const killFailure = new Error('simulated Windows tree kill');
    const manager = new ShellJobManager({
      baseDir,
      terminationPlatform: 'win32',
      taskkillImpl: async (): Promise<TaskkillResult> => {
        signalKillStarted();
        await new Promise((resolve) => setTimeout(resolve, 400));
        killFinished = true;
        return { ok: false, error: killFailure };
      },
    });
    manager.launch({ command: 'sleep 0.15', cwd: baseDir });
    try {
      const disposal = manager.dispose();
      await killStarted;
      let disposalError: unknown;
      try {
        await disposal;
      } catch (error) {
        disposalError = error;
      }
      expect(killFinished).toBe(true);
      expect(disposalError).toBeInstanceOf(AggregateError);
      if (!(disposalError instanceof AggregateError))
        throw new Error('Expected disposal to report the failed tree kill');
      expect(disposalError.errors).toContain(killFailure);
    } finally {
      await manager.dispose().catch(() => undefined);
      fs.rmSync(baseDir, { recursive: true, force: true });
    }
  }, 30000);
});
