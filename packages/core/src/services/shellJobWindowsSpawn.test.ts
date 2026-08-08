/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { spawnSync } from 'node:child_process';

import { debugLogger } from '../utils/debugLogger.js';
import {
  buildInnerPidMarkerCommand,
  reapAndRemoveWindowsTestDir,
  readInnerPidFromMarker,
} from '../../test/utils/shellJobTestCleanup.js';
import {
  buildWindowsBackgroundBootstrap,
  encodePowerShellCommand,
  escapePowerShellSingleQuoted,
  spawnWindowsBackground,
} from './shellJobSpawn.js';
import { boundedTaskkill } from './shellProcessKill.js';

/**
 * Timeout for probing whether a PowerShell executable (pwsh / powershell.exe)
 * is available on the system. 5s is generous for a no-op echo probe.
 */
const POWERSHELL_PROBE_TIMEOUT_MS = 5000;

/**
 * The inner command in the unref test sleeps this many seconds. The subprocess
 * relies on spawnWindowsBackground to unref its child and must exit well before
 * the managed command completes.
 */
const UNREF_SLEEP_SECONDS = 30;

/**
 * Outer spawnSync timeout for the unref test. This is the backstop if the
 * production unref does not let the subprocess exit. When it fires,
 * spawnSync's status becomes non-zero/null, distinguishing successful unref
 * (status 0) from a hang.
 */
const UNREF_SPAWN_TIMEOUT_MS = 25000;

/**
 * Maximum time to wait for a background process to exit in runAndWait. The
 * test commands are simple PowerShell one-liners that finish in a few seconds
 * even on a cold Windows runner; 15s is generous for slow cold-starts while
 * preventing a single hung process from consuming the entire per-file budget.
 * (issue #3149)
 */
const RUN_AND_WAIT_TIMEOUT_MS = 15_000;

/**
 * Check whether a PID is alive using signal 0 (works on both Windows and
 * POSIX). Used to verify the unref contract: the background process survives
 * the spawner's exit.
 */
function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Pure helper tests — run on every platform
// ---------------------------------------------------------------------------

describe('escapePowerShellSingleQuoted', () => {
  it('wraps a plain string in single quotes', () => {
    expect(escapePowerShellSingleQuoted('hello')).toBe("'hello'");
  });

  it('doubles embedded single quotes', () => {
    expect(escapePowerShellSingleQuoted("it's")).toBe("'it''s'");
  });

  it('handles a path with an apostrophe', () => {
    expect(escapePowerShellSingleQuoted("C:\\Users\\Bob's Stuff")).toBe(
      "'C:\\Users\\Bob''s Stuff'",
    );
  });

  it('passes through an empty string as two single quotes', () => {
    expect(escapePowerShellSingleQuoted('')).toBe("''");
  });
});

describe('encodePowerShellCommand', () => {
  it('produces valid base64 (alphabet [A-Za-z0-9+/=])', () => {
    const encoded = encodePowerShellCommand("Write-Host 'hello'");
    expect(encoded).toMatch(/^[A-Za-z0-9+/=]+$/);
  });

  it('decodes back to the prefixed payload', () => {
    const command = "Write-Host 'test'";
    const encoded = encodePowerShellCommand(command);
    const decoded = Buffer.from(encoded, 'base64').toString('utf16le');
    expect(decoded).toBe(
      "$ProgressPreference = 'SilentlyContinue';\n" + command,
    );
  });

  it('includes the ProgressPreference prefix', () => {
    const encoded = encodePowerShellCommand('echo hi');
    const decoded = Buffer.from(encoded, 'base64').toString('utf16le');
    expect(decoded).toContain("$ProgressPreference = 'SilentlyContinue'");
  });
});

describe('buildWindowsBackgroundBootstrap', () => {
  it('assembles the complete single-line bootstrap script', () => {
    const bootstrap = buildWindowsBackgroundBootstrap({
      executable: 'powershell.exe',
      encodedCommand: 'ZQBjAGgAbwA=',
      logPath: 'C:\\tmp\\out.log',
      errLogPath: 'C:\\tmp\\err.log',
      cwd: 'C:\\work',
    });
    expect(bootstrap).toContain('Start-Process');
    expect(bootstrap).toContain('-PassThru');
    expect(bootstrap).toContain('$null = $p.Handle');
    expect(bootstrap).toContain('$p.WaitForExit()');
    expect(bootstrap).toContain('exit $p.ExitCode');
    expect(bootstrap).toContain('-EncodedCommand');
    expect(bootstrap).toContain('-RedirectStandardOutput');
    expect(bootstrap).toContain('-RedirectStandardError');
    expect(bootstrap).toContain('-WindowStyle Hidden');
    expect(bootstrap).toContain('-WorkingDirectory');
  });

  it('places $null = $p.Handle before $p.WaitForExit()', () => {
    const bootstrap = buildWindowsBackgroundBootstrap({
      executable: 'pwsh',
      encodedCommand: 'AAA=',
      logPath: '/tmp/o',
      errLogPath: '/tmp/e',
      cwd: '/tmp',
    });
    const handleIdx = bootstrap.indexOf('$null = $p.Handle');
    const waitIdx = bootstrap.indexOf('$p.WaitForExit()');
    expect(handleIdx).toBeGreaterThan(-1);
    expect(waitIdx).toBeGreaterThan(-1);
    expect(handleIdx).toBeLessThan(waitIdx);
  });

  it('single-quote-escapes interpolated paths', () => {
    const bootstrap = buildWindowsBackgroundBootstrap({
      executable: 'powershell.exe',
      encodedCommand: 'AAA=',
      logPath: "C:\\bob's\\out.log",
      errLogPath: "C:\\bob's\\err.log",
      cwd: "C:\\bob's\\work",
    });
    // Each path is wrapped in single quotes with '' for the apostrophe
    expect(bootstrap).toContain("'C:\\bob''s\\out.log'");
    expect(bootstrap).toContain("'C:\\bob''s\\err.log'");
    expect(bootstrap).toContain("'C:\\bob''s\\work'");
  });
});

// ---------------------------------------------------------------------------
// Real-process behavioral tests — Windows only
// ---------------------------------------------------------------------------

function isExeAvailable(exe: string): boolean {
  try {
    const result = spawnSync(exe, ['-NoProfile', '-Command', 'echo ok'], {
      encoding: 'utf8',
      timeout: POWERSHELL_PROBE_TIMEOUT_MS,
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

// Probe only on Windows: on POSIX these spawns are guaranteed to fail, and
// running them at module scope would add process launches to every non-Windows
// test run for no benefit.
const isWindows = os.platform() === 'win32';
const availablePowerShellExes = isWindows
  ? ['powershell.exe', 'pwsh'].filter(isExeAvailable)
  : [];

describe.skipIf(!isWindows || availablePowerShellExes.length === 0)(
  'spawnWindowsBackground',
  () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'win-spawn-test-'));
    });

    afterEach(() => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    function makeLogPaths(): { logPath: string; errLogPath: string } {
      const logPath = path.join(tempDir, 'stdout.log');
      const errLogPath = path.join(tempDir, 'stderr.log');
      // Create empty files so Start-Process redirects work
      fs.writeFileSync(logPath, '');
      fs.writeFileSync(errLogPath, '');
      return { logPath, errLogPath };
    }

    function getPowerShellExecutable(): string {
      // Prefer pwsh if available, fall back to powershell.exe. spawnSync throws
      // synchronously (ENOENT) when pwsh is not on PATH; keep the fallback
      // behaviour identical while surfacing the reason via debugLogger.
      try {
        const result = spawnSync(
          'pwsh',
          ['-NoProfile', '-Command', 'echo ok'],
          {
            encoding: 'utf8',
            timeout: POWERSHELL_PROBE_TIMEOUT_MS,
          },
        );
        if (result.status === 0) {
          return 'pwsh';
        }
      } catch (e) {
        // pwsh not available on PATH (ENOENT) or the spawn failed — fall back to
        // powershell.exe, but log the reason so a missing pwsh is diagnosable.
        debugLogger.debug(
          '[shellJobWindowsSpawn.test] pwsh probe failed, falling back to powershell.exe:',
          e instanceof Error ? e.message : String(e),
        );
      }
      return 'powershell.exe';
    }

    /**
     * Await a SpawnedProcess's exit, bounded by a timeout that kills the
     * child on expiry so a hung process cannot consume the entire per-file
     * budget. The test commands are simple one-liners; a real exit in under
     * 15s is the norm, and a timeout indicates a genuine process hang (e.g.
     * ConPTY stall or interactive prompt) rather than slow cold-start.
     */
    function awaitBoundedExit(
      spawned: ReturnType<typeof spawnWindowsBackground>,
      timeoutMs = RUN_AND_WAIT_TIMEOUT_MS,
    ): Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }> {
      let timer: ReturnType<typeof setTimeout> | undefined;
      return Promise.race([
        spawned.exited,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            // taskkill /T /F reaps the entire process tree (outer PowerShell
            // wrapper and inner Start-Process child). Await its completion so
            // the tree is fully terminated before rejecting (issue #3149).
            void (async () => {
              if (spawned.pid > 0) {
                await boundedTaskkill(spawned.pid);
              }
              reject(
                new Error(
                  `Background process (pid ${spawned.pid}) did not exit within ${timeoutMs}ms`,
                ),
              );
            })();
          }, timeoutMs);
        }),
      ]).finally(() => {
        if (timer !== undefined) clearTimeout(timer);
      });
    }

    async function runAndWait(
      command: string,
      executable?: string,
    ): Promise<{
      exitCode: number | null;
      stdout: string;
      stderr: string;
    }> {
      const { logPath, errLogPath } = makeLogPaths();
      const exe = executable ?? getPowerShellExecutable();
      const spawned = spawnWindowsBackground(
        exe,
        command,
        tempDir,
        { ...process.env },
        logPath,
        errLogPath,
      );
      const exitInfo = await awaitBoundedExit(spawned);
      const stdout = fs.existsSync(logPath)
        ? fs.readFileSync(logPath, 'utf8')
        : '';
      const stderr = fs.existsSync(errLogPath)
        ? fs.readFileSync(errLogPath, 'utf8')
        : '';
      return { exitCode: exitInfo.exitCode, stdout, stderr };
    }

    // --- §2.2 adversarial cases ---

    it('round-trips single quotes in the model command', async () => {
      const result = await runAndWait("Write-Host 'it''s working'");
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe("it's working");
    });

    it('round-trips double quotes in the model command', async () => {
      const result = await runAndWait('Write-Host "hello world"');
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('hello world');
    });

    it('round-trips mixed quotes, ampersand, and backslashes', async () => {
      const result = await runAndWait(
        'Write-Host "path: C:\\Users\\Test & more"; Write-Host \'two\'',
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('path: C:\\Users\\Test & more');
      expect(result.stdout).toContain('two');
    });

    it('round-trips $ expansion and backtick literal', async () => {
      const result = await runAndWait('$x = 5; Write-Host "val=$x `$literal"');
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('val=5 $literal');
    });

    it('round-trips pipe characters', async () => {
      const result = await runAndWait('"a|b" | Write-Host');
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('a|b');
    });

    it('round-trips embedded newlines', async () => {
      const result = await runAndWait("Write-Host 'l1'\nWrite-Host 'l2'");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('l1');
      expect(result.stdout).toContain('l2');
    });

    it('captures native-exe stdout and stderr separately', async () => {
      const result = await runAndWait(
        'cmd /c "echo native-out & echo native-err 1>&2"',
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('native-out');
      expect(result.stderr).toContain('native-err');
    });

    it('handles empty output without error', async () => {
      const result = await runAndWait('"" | Out-Null');
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('');
    });

    // --- §2.3 exit-code propagation (guards $null = $p.Handle) ---

    it('propagates exit 3 as exit code 3 (regression for $p.Handle fix)', async () => {
      const result = await runAndWait('exit 3');
      expect(result.exitCode).toBe(3);
    });

    it('propagates exit 7 as exit code 7', async () => {
      const result = await runAndWait('exit 7');
      expect(result.exitCode).toBe(7);
    });

    it('reports exit 0 for a clean run', async () => {
      const result = await runAndWait("Write-Host 'clean'");
      expect(result.exitCode).toBe(0);
    });

    it('reports exit 1 for a throw', async () => {
      const result = await runAndWait("throw 'kaboom'");
      expect(result.exitCode).toBe(1);
    });

    // --- §2.4 $ProgressPreference (clean run leaves stderr empty) ---

    it.each(availablePowerShellExes)(
      'leaves the stderr log empty for a clean run (%s)',
      async (exe) => {
        const result = await runAndWait("Write-Output 'clean'", exe);
        expect(result.exitCode).toBe(0);
        expect(result.stdout.trim()).toBe('clean');
        expect(result.stderr.trim()).toBe('');
      },
    );

    // --- lifecycle ---

    it('returns a non-negative pid', async () => {
      const { logPath, errLogPath } = makeLogPaths();
      const spawned = spawnWindowsBackground(
        getPowerShellExecutable(),
        "Write-Host 'pid-test'",
        tempDir,
        { ...process.env },
        logPath,
        errLogPath,
      );
      expect(spawned.pid).toBeGreaterThan(0);
      await awaitBoundedExit(spawned);
    });

    it('does not keep the spawner alive (production unref)', async () => {
      const unrefDir = fs.mkdtempSync(path.join(os.tmpdir(), 'win-unref-'));
      const logPath = path.join(unrefDir, 'out.log');
      const errLogPath = path.join(unrefDir, 'err.log');
      const scriptPath = path.join(unrefDir, 'spawn-exit.ts');
      const outerPidFilePath = path.join(unrefDir, 'outer.pid');
      const innerPidFilePath = path.join(unrefDir, 'inner.pid');
      let outerPid = 0;
      let innerPid = 0;
      try {
        fs.writeFileSync(logPath, '');
        fs.writeFileSync(errLogPath, '');

        const modulePath = path
          .join(__dirname, 'shellJobSpawn.ts')
          .replace(/\\/g, '/');
        const powershellExe = getPowerShellExecutable();
        const managedCommand = buildInnerPidMarkerCommand(
          innerPidFilePath,
          UNREF_SLEEP_SECONDS,
        );
        // The script does NOT manually call p.child.unref(): production code
        // (spawnWindowsBackground) already unrefs immediately at spawn. If that
        // production contract regresses, the spawner will hang and the
        // status=0 assertion below will fail.
        const script = [
          `import { spawnWindowsBackground } from '${modulePath}';`,
          `const p = spawnWindowsBackground(`,
          `  ${JSON.stringify(powershellExe)},`,
          `  ${JSON.stringify(managedCommand)},`,
          `  ${JSON.stringify(os.tmpdir())},`,
          `  { ...process.env },`,
          `  ${JSON.stringify(logPath)},`,
          `  ${JSON.stringify(errLogPath)},`,
          `);`,
          `require('fs').writeFileSync(${JSON.stringify(outerPidFilePath)}, String(p.pid));`,
        ].join('\n');

        fs.writeFileSync(scriptPath, script);

        const start = Date.now();
        // Execute the fixture with the current Bun executable
        // (process.execPath), not npx/tsx/Node: spawnWindowsBackground's
        // production-unref contract is exercised by the runtime that will
        // actually run it, which is Bun. Using npx/tsx/Node would prove
        // nothing about production behavior.
        const result = spawnSync(process.execPath, [scriptPath], {
          timeout: UNREF_SPAWN_TIMEOUT_MS,
          encoding: 'utf8',
          shell: false,
        });
        const elapsed = Date.now() - start;

        // Capture marker PIDs BEFORE assertions so cleanup in finally always
        // has the known PIDs even if an assertion throws.
        try {
          outerPid = await readInnerPidFromMarker(outerPidFilePath, 10000);
        } catch {
          // Marker may not exist if spawn failed before writing it.
        }
        try {
          innerPid = await readInnerPidFromMarker(innerPidFilePath, 10000);
        } catch {
          // Inner process may not have started yet.
        }

        // status 0 is the deterministic regression signal: it proves the
        // spawner exited on its own BEFORE the spawnSync timeout backstop.
        // Node's spawnSync sets status to null when the timeout kills the
        // child, so a null/non-zero status would indicate the spawner hung
        // (the unref regression). This is race-resistant: it does not depend
        // on wall-clock timing that varies with cold-start cost.
        expect(result.status).toBe(0);

        // Verify the unref contract directly. Both PowerShell processes must
        // still be alive: the outer waits for the inner 30s sleep, while the
        // inner owns the redirected logs. This proves unref detached the tree
        // without killing it and gives teardown both PIDs for direct reaping.
        expect(outerPid).toBeGreaterThan(0);
        expect(isPidAlive(outerPid)).toBe(true);
        expect(innerPid).toBeGreaterThan(0);
        expect(isPidAlive(innerPid)).toBe(true);

        debugLogger.debug(
          `[shellJobWindowsSpawn.test] unref subprocess exited in ${elapsed}ms (status ${result.status})`,
        );
      } finally {
        await reapAndRemoveWindowsTestDir(unrefDir, null, [outerPid, innerPid]);
      }
    }, 60_000);
  },
);
