/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const thisFile = fileURLToPath(import.meta.url);
const repoRoot = resolve(thisFile, '..', '..', '..');
const smokeScript = join(
  repoRoot,
  'scripts',
  'tests',
  'issue-2603-release-install-smoke.cjs',
);
const releasePackHelper = join(
  repoRoot,
  'scripts',
  'tests',
  'issue-2603-release-pack.cjs',
);

/**
 * Spawns the standalone smoke script as an async child process with a hard
 * timeout that SIGKILLs the child to prevent hangs/leaks. Using `spawn` (not
 * `spawnSync`) keeps the event loop responsive to Vitest's worker RPC.
 *
 * Cleanup design (no process-global listener leaks):
 *   - The child is spawned NON-detached, so it belongs to the Vitest worker's
 *     process group. If the worker is terminated (test cancellation, aggregate
 *     suite teardown, parent signal), the non-detached child is reaped
 *     automatically by the OS without any registered handlers here.
 *   - The only timers/listeners are attached to the `child` object itself
 *     (close/error events + a timeout timer), and are all removed in
 *     `dispose()` so no event-loop handles remain after the test settles.
 *   - NO `process.on('SIGINT'/'SIGTERM'/'exit'/'beforeExit')` listeners are
 *     registered: those keep the Vitest worker alive and caused the aggregate
 *     suite hang. Scoped cleanup is the caller's responsibility via the
 *     returned `dispose()` (invoked from try/finally + onTestFinished).
 */
const SMOKE_TIMEOUT_MS = 540_000;

interface SmokeHandle {
  promise: Promise<{
    status: number | null;
    stdout: string;
    stderr: string;
  }>;
  /** Kill the child if still alive and clear all timers/listeners. Idempotent. */
  dispose: () => void;
}

function runSmokeAsync(): SmokeHandle {
  let child: ChildProcess | null = spawn('node', [smokeScript, repoRoot], {
    cwd: repoRoot,
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  let settled = false;
  let timer: NodeJS.Timeout | null = null;
  let disposed = false;
  let streamTeardown: (() => void) | null = null;

  const promise = new Promise<{
    status: number | null;
    stdout: string;
    stderr: string;
  }>((resolvePromise, reject) => {
    function finish(
      outcome:
        | { ok: true; status: number | null }
        | { ok: false; error: unknown },
    ): void {
      if (settled) return;
      settled = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (outcome.ok) {
        resolvePromise({ status: outcome.status, stdout, stderr });
      } else {
        reject(outcome.error);
      }
    }

    timer = setTimeout(() => {
      dispose();
      finish({
        ok: false,
        error: new Error(
          `smoke script exceeded ${SMOKE_TIMEOUT_MS}ms and was killed to prevent a hang/leak`,
        ),
      });
    }, SMOKE_TIMEOUT_MS);

    function onStdout(chunk: Buffer): void {
      stdout += chunk.toString();
    }
    function onStderr(chunk: Buffer): void {
      stderr += chunk.toString();
    }
    function onError(err: Error): void {
      finish({ ok: false, error: err });
    }
    function onClose(status: number | null): void {
      finish({ ok: true, status });
    }

    const c = child!;
    const { stdout: out, stderr: err } = c;
    if (!out || !err) {
      // With stdio 'pipe' both streams exist; guard for type narrowing only.
      finish({ ok: false, error: new Error('child streams unavailable') });
      return;
    }
    out.on('data', onStdout);
    err.on('data', onStderr);
    c.on('error', onError);
    c.on('close', onClose);

    streamTeardown = () => {
      out.removeListener('data', onStdout);
      err.removeListener('data', onStderr);
      c.removeListener('error', onError);
      c.removeListener('close', onClose);
    };
  });

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    // Kill the child if still alive. The child is non-detached, so a plain
    // kill() is sufficient; no process-group kill is needed.
    if (child && child.exitCode === null && child.signalCode === null) {
      try {
        child.kill('SIGKILL');
      } catch {
        // best effort; child may have exited concurrently
      }
    }
    streamTeardown?.();
    streamTeardown = null;
    child = null;
  }

  return { promise, dispose };
}

describe('release-like CLI pack/install smoke (issue #2603)', () => {
  it('the standalone smoke script exists and is invocable via npm script', () => {
    expect(existsSync(smokeScript)).toBe(true);
  });

  it('the release-pack helper exports packReleaseLikeCli', async () => {
    const mod = await import(releasePackHelper);
    expect(typeof mod.packReleaseLikeCli).toBe('function');
  }, 15_000);

  it('release-like global + local install runs --version and exits 0, release manifest has exact versions', async (ctx) => {
    const smoke = runSmokeAsync();
    // Guarantee the child is killed and listeners cleared even if the test is
    // cancelled (timeout) or fails before reaching the finally below.
    ctx.onTestFinished(() => smoke.dispose());
    let result: { status: number | null; stdout: string; stderr: string };
    try {
      result = await smoke.promise;
    } finally {
      smoke.dispose();
    }
    const { status, stdout, stderr } = result;
    expect(
      status,
      `smoke exited ${status}\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`,
    ).toBe(0);
    expect(stderr).toBe('');
    expect(stdout).toContain('global-install-version');
    expect(stdout).toContain('local-install-version');
    expect(stdout).toContain('npm-exec-ephemeral');
    expect(stdout).toContain('release-manifest-integrity');
    expect(stdout).toContain('All release-install smoke assertions passed.');
  }, 600_000);
});
