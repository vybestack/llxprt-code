/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ShellExecutionService } from './shellExecutionService.js';
import type { ShellExecutionResult } from './shellExecutionTypes.js';

const isWindows = os.platform() === 'win32';

/** Signal-0 existence check. */
function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Poll until `markerPath` exists and contains non-whitespace. */
async function waitForMarker(
  markerPath: string,
  timeoutMs = 8000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const content = fs.readFileSync(markerPath, 'utf8').trim();
      if (content !== '') return content;
    } catch {
      // Not written yet.
    }
    if (Date.now() > deadline) {
      throw new Error(`Marker ${markerPath} not written within ${timeoutMs}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** Kill an entire detached process group (no-op if already gone). POSIX only. */
function reapGroup(pgid: number | undefined): void {
  // Guard the cleanup path: a spawn that produced no pid yields 0 here, and
  // `process.kill(-0)` is `process.kill(0)` — a signal to the TEST RUNNER's
  // own process group.
  if (pgid === undefined || !Number.isInteger(pgid) || pgid <= 0) return;
  try {
    process.kill(-pgid, 'SIGKILL');
  } catch {
    // Already gone.
  }
}

/**
 * Service-level child_process abort behavior (Issue #3517). A foreground
 * abort must not produce a result while the spawned process group still has
 * live members, and escalation must kill a grandchild that survives SIGTERM.
 */
describe.skipIf(isWindows)(
  'child_process abort group reap (POSIX, issue #3517)',
  () => {
    it('resolves the abort result only after a TERM-immune grandchild is dead', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-abort-'));
      const marker = path.join(dir, 'grandchild.pid');
      // The subshell stays in the spawned group; `trap '' TERM` sets SIG_IGN,
      // a disposition that survives `exec sleep 30`. The foreground `sleep
      // 30` keeps the direct child alive until the abort fires.
      const command = `( trap '' TERM; exec sleep 30 ) & echo $! > ${marker}; sleep 30`;
      const abortController = new AbortController();
      const handle = await ShellExecutionService.execute(
        command,
        dir,
        () => undefined,
        abortController.signal,
        false,
      );
      try {
        const grandchildPid = Number(await waitForMarker(marker, 8000));
        expect(grandchildPid).toBeGreaterThan(0);

        abortController.abort();
        const result: ShellExecutionResult = await handle.result;

        expect(result.aborted).toBe(true);
        // Escalation succeeded within the reap window: no survivor flag.
        expect(result.survivingGroupMembersOnAbort).toBeUndefined();
        // THE assertion (AC2): the grandchild is dead by the time the result
        // exists. It was reparented when the direct child died, so a
        // signal-0 probe proves real death.
        expect(isPidAlive(grandchildPid)).toBe(false);
      } finally {
        reapGroup(handle.pid);
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }, 30000);

    it('resolves a prompt abort with no survivor field when the group dies on SIGTERM', async () => {
      const abortController = new AbortController();
      const handle = await ShellExecutionService.execute(
        'sleep 30',
        os.tmpdir(),
        () => undefined,
        abortController.signal,
        false,
      );
      try {
        // Let the command reach its steady state before aborting, as a real
        // timeout would.
        await new Promise((resolve) => setTimeout(resolve, 300));
        const start = Date.now();
        abortController.abort();
        const result = await handle.result;
        const elapsed = Date.now() - start;

        expect(result.aborted).toBe(true);
        expect(result.survivingGroupMembersOnAbort).toBeUndefined();
        // The whole group dies on SIGTERM, so resolution must not pay the
        // full reap window (AC4): only the escalation grace plus a
        // first-poll confirmation.
        expect(elapsed).toBeLessThan(2000);
      } finally {
        reapGroup(handle.pid);
      }
    }, 20000);
  },
);
