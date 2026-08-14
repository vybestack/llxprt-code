/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Child-process behavior test for launcher exit status (issue #3230): a
 * profiled child terminated by a signal must produce a NONZERO launcher
 * status, portably. The launcher's rule (launcherExitCode) is exercised
 * against a REAL child process that terminates itself via a signal — on POSIX
 * this surfaces as close(code=null, signal='SIGTERM'); on Windows, Bun/Node
 * emulate signal kills with a nonzero exit code, which flows through the same
 * rule. No signal numbers, process.kill of foreign pids, or platform shells.
 */

import { describe, expect, it } from 'bun:test';
import { spawn } from 'node:child_process';
import { launcherExitCode } from '../../memory/launcher.ts';

function childClose(
  child: ReturnType<typeof spawn>,
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
}

describe('launcherExitCode — signal-terminated child', () => {
  it('maps a signal-killed real child to a nonzero launcher status', async () => {
    // The child terminates itself with the default signal (SIGTERM on POSIX;
    // an emulated termination on Windows). Using the current executable keeps
    // the test runtime-agnostic (Bun today).
    const child = spawn(process.execPath, ['-e', 'process.kill(process.pid)']);
    const { code, signal } = await childClose(child);
    // Either the platform reports a signal kill (code === null) or an
    // emulated nonzero exit code — both must map to a nonzero status.
    if (signal !== null) {
      expect(code).toBeNull();
    } else {
      expect(code).not.toBe(0);
      expect(code).not.toBeNull();
    }
    expect(launcherExitCode(code)).not.toBe(0);
  }, 20_000);

  it('preserves a normal nonzero child exit code', () => {
    expect(launcherExitCode(3)).toBe(3);
  });

  it('preserves a clean child exit as success', () => {
    expect(launcherExitCode(0)).toBe(0);
  });

  it('maps an aborted spawn (code null without a signal) to nonzero', () => {
    expect(launcherExitCode(null)).toBe(1);
  });
});
