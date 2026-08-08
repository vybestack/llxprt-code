/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

import {
  boundedTaskkill,
  escalateKillUnix,
  isKillablePid,
  taskkillTree,
} from './shellProcessKill.js';
import { createExitGuard } from './shellExitGuard.js';

const isWindows = os.platform() === 'win32';

/** Signal-0 existence check, portable across POSIX and Windows. */
function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Poll until `markerPath` exists and contains non-whitespace, returning its trimmed content. */
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
function reapGroup(pgid: number): void {
  // Guard the cleanup path against the very bug under test: a spawn that
  // produced no pid yields 0 here, and `process.kill(-0)` is `process.kill(0)`,
  // which would signal the TEST RUNNER's own process group.
  if (!Number.isInteger(pgid) || pgid <= 0) return;
  try {
    process.kill(-pgid, 'SIGKILL');
  } catch {
    // Already gone.
  }
}

// ---------------------------------------------------------------------------
// isKillablePid — the single chokepoint, platform independent
// ---------------------------------------------------------------------------

describe('isKillablePid', () => {
  it('rejects every pid that POSIX kill(2) would reinterpret', () => {
    // 0 signals the caller's own process group and -1 signals every
    // signalable process; both are the catastrophic cases this guard exists
    // for. Negative values target a process group rather than a process.
    expect(isKillablePid(0)).toBe(false);
    expect(isKillablePid(-0)).toBe(false);
    expect(isKillablePid(-1)).toBe(false);
    expect(isKillablePid(-1234)).toBe(false);
  });

  it('rejects non-finite and non-integer numbers', () => {
    expect(isKillablePid(Number.NaN)).toBe(false);
    expect(isKillablePid(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isKillablePid(Number.NEGATIVE_INFINITY)).toBe(false);
    // A fractional value could be truncated after the `-pid` negation and
    // land on an unrelated process group.
    expect(isKillablePid(1.5)).toBe(false);
    expect(isKillablePid(0.5)).toBe(false);
  });

  it('rejects absent and non-numeric values', () => {
    expect(isKillablePid(undefined)).toBe(false);
    expect(isKillablePid(null)).toBe(false);
    expect(isKillablePid('1234')).toBe(false);
    expect(isKillablePid({})).toBe(false);
  });

  it('accepts whole positive pids', () => {
    expect(isKillablePid(1)).toBe(true);
    expect(isKillablePid(1234)).toBe(true);
    expect(isKillablePid(process.pid)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// escalateKillUnix — POSIX-only (production behavior is POSIX-gated)
// ---------------------------------------------------------------------------

describe.skipIf(isWindows)('escalateKillUnix pid validation (POSIX)', () => {
  it('pid 0 does NOT signal the caller process group (caller + sibling survive)', async () => {
    // The helper runs in its OWN process group (detached/setsid). It spawns a
    // sibling into that same group, then calls escalateKillUnix(0). With the
    // bug present, process.kill(0) reaps the helper's entire group (helper +
    // sibling). With the guard, it is a no-op and both survive. The parent
    // test process lives in a different group, so it is never in the blast
    // radius — this is the assertion that actually catches kill(0).
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'escalate-pid0-'));
    const siblingMarker = path.join(dir, 'sibling.pid');
    const calledMarker = path.join(dir, 'called');
    const returnedMarker = path.join(dir, 'returned');
    const scriptPath = path.join(dir, 'probe.ts');
    const modulePath = path
      .join(__dirname, 'shellProcessKill.ts')
      .replace(/\\/g, '/');
    const guardPath = path
      .join(__dirname, 'shellExitGuard.ts')
      .replace(/\\/g, '/');

    const script = [
      `import { spawn } from 'node:child_process';`,
      `import { writeFile } from 'node:fs/promises';`,
      `import { escalateKillUnix } from '${modulePath}';`,
      `import { createExitGuard } from '${guardPath}';`,
      `const siblingMarker = process.argv[2];`,
      `const calledMarker = process.argv[3];`,
      `const returnedMarker = process.argv[4];`,
      `// Sibling shares THIS helper's process group (not detached).`,
      `const sibling = spawn('sleep', ['30'], { stdio: 'ignore' });`,
      `await writeFile(siblingMarker, String(sibling.pid));`,
      `await writeFile(calledMarker, 'called');`,
      `const guard = createExitGuard();`,
      `// If the bug is present this reaps our own group (SIGTERM then SIGKILL).`,
      `await escalateKillUnix(0, guard, () => {});`,
      `// Written only AFTER escalateKillUnix(0) returned, so the parent waiting`,
      `// on this marker proves the helper SURVIVED the call, not merely that it`,
      `// reached it (the pre-call marker can only prove reachability).`,
      `await writeFile(returnedMarker, 'returned');`,
      `// Survived: stay alive briefly so the parent can observe liveness.`,
      `await new Promise((r) => setTimeout(r, 4000));`,
      `try { sibling.kill('SIGKILL'); } catch { /* already gone */ }`,
      `process.exit(0);`,
    ].join('\n');
    fs.writeFileSync(scriptPath, script);

    const helper = spawn(
      process.execPath,
      [scriptPath, siblingMarker, calledMarker, returnedMarker],
      { detached: true, stdio: 'ignore' },
    );
    helper.unref();
    const helperPid = helper.pid ?? 0;
    let siblingPid = 0;
    try {
      siblingPid = Number(await waitForMarker(siblingMarker, 8000));
      // Diagnosability: proves the helper reached the escalateKillUnix(0) call.
      await waitForMarker(calledMarker, 8000);
      // THE gate: this marker is written only AFTER escalateKillUnix(0)
      // returned, so reaching here proves the helper SURVIVED the call rather
      // than merely reaching it. A future change that hangs inside
      // escalateKillUnix before the guard would never write this marker and
      // this wait would time out, instead of wrongly passing.
      await waitForMarker(returnedMarker, 8000);
      // Allow time for the SIGTERM (t=0) + SIGKILL escalation (t=200ms).
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // THE assertion that catches kill(0): the "caller" (helper) and its
      // same-group sibling must both still be alive.
      expect(helperPid).toBeGreaterThan(0);
      expect(isPidAlive(helperPid)).toBe(true);
      expect(siblingPid).toBeGreaterThan(0);
      expect(isPidAlive(siblingPid)).toBe(true);
    } finally {
      reapGroup(helperPid);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 30000);

  it('pid -1 / NaN / Infinity do not signal anything and do not invoke the kill fallback', async () => {
    // Without the guard, escalateKillUnix(-1) => process.kill(1) (EPERM, caught
    // => killFallback); NaN/Infinity => process.kill throws (caught =>
    // killFallback). With the guard, all three short-circuit before any kill.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'escalate-bad-'));
    const outMarker = path.join(dir, 'fallback.txt');
    const scriptPath = path.join(dir, 'probe.ts');
    const modulePath = path
      .join(__dirname, 'shellProcessKill.ts')
      .replace(/\\/g, '/');
    const guardPath = path
      .join(__dirname, 'shellExitGuard.ts')
      .replace(/\\/g, '/');

    const script = [
      `import { writeFile } from 'node:fs/promises';`,
      `import { escalateKillUnix } from '${modulePath}';`,
      `import { createExitGuard } from '${guardPath}';`,
      `const out = process.argv[2];`,
      `let fallbackCalls = 0;`,
      `const guard = createExitGuard();`,
      `await escalateKillUnix(-1, guard, () => { fallbackCalls++; });`,
      `await escalateKillUnix(NaN, guard, () => { fallbackCalls++; });`,
      `await escalateKillUnix(Infinity, guard, () => { fallbackCalls++; });`,
      `await writeFile(out, String(fallbackCalls));`,
      `process.exit(0);`,
    ].join('\n');
    fs.writeFileSync(scriptPath, script);

    const helper = spawn(process.execPath, [scriptPath, outMarker], {
      detached: true,
      stdio: 'ignore',
    });
    helper.unref();
    const helperPid = helper.pid ?? 0;
    try {
      const result = await waitForMarker(outMarker, 8000);
      // With the guard the kill fallback is never invoked for bad pids. This
      // is the assertion that fails without the fix: pre-guard, -1 reaches
      // process.kill(1) (EPERM) and NaN/Infinity throw, so all three land in
      // the fallback and the marker reads "3".
      //
      // Deliberately no liveness assertion on the helper: it calls
      // process.exit(0) immediately after writing the marker, so by the time
      // the parent observes the marker the helper has already exited on
      // purpose. Asserting it is alive races its own normal exit.
      expect(result).toBe('0');
    } finally {
      reapGroup(helperPid);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 30000);

  it('a valid pid of a real detached child is still killed (guard did not break the feature)', async () => {
    // A detached child becomes its own process-group leader (setsid), so
    // process.kill(-pid) targets only that group.
    const child = spawn('sleep', ['30'], { detached: true, stdio: 'ignore' });
    child.unref();
    const childPid = child.pid ?? 0;
    expect(childPid).toBeGreaterThan(0);
    // Observe the exit via the child handle rather than a signal-0 probe: this
    // process is the child's parent, so between SIGKILL and the runtime's
    // SIGCHLD reap the pid is a zombie and `process.kill(pid, 0)` still
    // SUCCEEDS. Awaiting 'exit' proves termination without that race.
    const exited = new Promise<NodeJS.Signals | null>((resolve) => {
      child.on('exit', (_code, signal) => resolve(signal));
    });
    try {
      const guard = createExitGuard();
      await escalateKillUnix(childPid, guard, () => {});
      const signal = await Promise.race([
        exited,
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`pid ${childPid} was not killed`)),
            8000,
          ),
        ),
      ]);
      // The guard must not have suppressed the kill for a legitimate pid.
      // escalateKillUnix sends SIGTERM first and only escalates to SIGKILL
      // after SIGKILL_TIMEOUT_MS, so a well-behaved `sleep` dies on SIGTERM.
      // Asserting SIGKILL specifically would assert the escalation timer
      // rather than the guard; what matters here is that a signal was
      // delivered at all.
      expect(signal === 'SIGTERM' || signal === 'SIGKILL').toBe(true);
    } finally {
      reapGroup(childPid);
    }
  }, 20000);
});

// ---------------------------------------------------------------------------
// boundedTaskkill / taskkillTree — Windows-only (production behavior gated)
// ---------------------------------------------------------------------------

describe.skipIf(!isWindows)(
  'taskkill primitives pid validation (Windows)',
  () => {
    it('boundedTaskkill resolves {ok:false} for invalid pids and never rejects', async () => {
      // Deliberately-invalid values that exercise the runtime guard. The cast
      // bridges the pre-fix `number` signature; the guard validates at runtime.
      const badPids = [
        { label: 'zero', value: 0 },
        { label: 'negative', value: -1 },
        { label: 'NaN', value: Number.NaN },
        { label: 'undefined', value: undefined },
      ];
      for (const { value } of badPids) {
        const result = await boundedTaskkill(value as never);
        expect(result.ok).toBe(false);
        expect(result.error).toBeInstanceOf(Error);
        // A validation-rejection error proves the guard fired BEFORE spawning
        // taskkill — distinct from a taskkill subprocess exit-code error.
        expect(result.error?.message).toMatch(/non-killable|invalid.*pid/i);
      }
    });

    it('taskkillTree with invalid pids does not throw (fire-and-forget guard)', () => {
      const badPids = [
        { label: 'zero', value: 0 },
        { label: 'negative', value: -1 },
        { label: 'NaN', value: Number.NaN },
        { label: 'undefined', value: undefined },
      ];
      for (const { value } of badPids) {
        expect(() => taskkillTree(value as never)).not.toThrow();
      }
    });

    it('boundedTaskkill with a valid pid still spawns taskkill and reaps the process', async () => {
      const child = spawn(
        'powershell.exe',
        ['-NoProfile', '-Command', 'Start-Sleep -Seconds 60'],
        { windowsHide: true, stdio: 'ignore' },
      );
      child.on('error', () => {});
      child.unref();
      const childPid = child.pid ?? 0;
      expect(childPid).toBeGreaterThan(0);
      // Wait until the pid is observable by taskkill rather than a fixed
      // delay, which can be too short on a loaded CI runner.
      await waitForPidVisible(childPid, 8000);
      try {
        const result = await boundedTaskkill(childPid);
        expect(result.ok).toBe(true);
        await waitForPidGone(childPid, 8000);
        expect(isPidAlive(childPid)).toBe(false);
      } finally {
        reapWindowsPid(childPid);
      }
    }, 20000);

    it('taskkillTree with a valid pid terminates a live child', async () => {
      const child = spawn(
        'powershell.exe',
        ['-NoProfile', '-Command', 'Start-Sleep -Seconds 60'],
        { windowsHide: true, stdio: 'ignore' },
      );
      child.on('error', () => {});
      const childPid = child.pid ?? 0;
      expect(childPid).toBeGreaterThan(0);
      // Observe the exit through the handle rather than a signal-0 probe: a
      // killed child stays visible as a zombie until the runtime reaps it.
      const exited = new Promise<void>((resolve) => {
        child.once('exit', () => resolve());
      });
      // Wait until the pid is observable by taskkill rather than a fixed
      // delay, which can be too short on a loaded CI runner.
      await waitForPidVisible(childPid, 8000);
      try {
        taskkillTree(childPid);
        await Promise.race([
          exited,
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error(`pid ${childPid} was not killed`)),
              8000,
            ),
          ),
        ]);
      } finally {
        reapWindowsPid(childPid);
      }
    }, 20000);
  },
);

/** Poll until a Windows pid is confirmed gone. */
async function waitForPidGone(pid: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isPidAlive(pid)) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

/**
 * Poll until a pid is observable by taskkill, up to `timeoutMs`. A static
 * delay is flaky on a loaded CI runner where the child may take longer than
 * the fixed window to be observable; polling keeps the readiness gate stable.
 */
async function waitForPidVisible(
  pid: number,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (isPidAlive(pid)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** Best-effort direct reap of a Windows pid (cleanup only). */
function reapWindowsPid(pid: number): void {
  if (pid <= 0) return;
  try {
    spawn('taskkill', ['/pid', String(pid), '/f', '/t'], {
      windowsHide: true,
      stdio: 'ignore',
    });
  } catch {
    // Already gone.
  }
}
