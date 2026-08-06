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

import { debugLogger } from '../utils/debugLogger.js';
import {
  buildWindowsBackgroundBootstrap,
  encodePowerShellCommand,
  escapePowerShellSingleQuoted,
  spawnWindowsBackground,
} from './shellJobSpawn.js';

/**
 * Timeout for probing whether a PowerShell executable (pwsh / powershell.exe)
 * is available on the system. 5s is generous for a no-op echo probe.
 */
const POWERSHELL_PROBE_TIMEOUT_MS = 5000;

/**
 * The inner command in the unref test sleeps this many seconds. The test's
 * subprocess explicitly unreferences the exposed child handle and must exit
 * well before the managed command completes.
 */
const UNREF_SLEEP_SECONDS = 30;

/**
 * Outer spawnSync timeout for the unref test. Acts as a backstop if releasing
 * the exposed child handle does not let the subprocess exit.
 */
const UNREF_SPAWN_TIMEOUT_MS = 15000;

/**
 * The spawner must exit before this elapsed time when unref() is present.
 * Typical measured elapsed on this machine is ~2–5s (PowerShell cold start
 * + import). The old bound (10000ms) was too tight on CI where cold starts
 * can approach it. 12000ms still catches a genuine unref regression: with
 * unref removed the spawner hangs for UNREF_SLEEP_SECONDS (30s) and is only
 * killed by UNREF_SPAWN_TIMEOUT_MS (15000ms), so elapsed would be ~15000ms
 * which exceeds 12000ms and fails the assertion.
 */
const UNREF_ELAPSED_BOUND_MS = 12000;

// ---------------------------------------------------------------------------
// Pure helper tests — run on every platform
// ---------------------------------------------------------------------------

/**
 * Force-kill the process tree recorded in a pid file, if any, and surface
 * cleanup failures instead of letting orphaned processes fail silently.
 */
function reapPidFile(pidFilePath: string): void {
  if (!fs.existsSync(pidFilePath)) {
    return;
  }
  const pid = parseInt(fs.readFileSync(pidFilePath, 'utf8').trim(), 10);
  if (Number.isNaN(pid) || pid <= 0) {
    return;
  }
  const killResult = spawnSync(
    'taskkill',
    ['/pid', pid.toString(), '/f', '/t'],
    {
      timeout: POWERSHELL_PROBE_TIMEOUT_MS,
      encoding: 'utf8',
    },
  );
  if (killResult.status === 0) {
    return;
  }
  const output = killResult.stderr || killResult.stdout || '(no output)';
  debugLogger.warn(
    `[shellJobWindowsSpawn.test] taskkill cleanup for pid ${pid} exited with status ${killResult.status}: ${output}`,
  );
}

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
      const exitInfo = await spawned.exited;
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

    it('returns a live pid for the managed PowerShell process', async () => {
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
      await spawned.exited;
    });

    it('does not keep the spawner alive (unref)', async () => {
      const unrefDir = fs.mkdtempSync(path.join(os.tmpdir(), 'win-unref-'));
      const logPath = path.join(unrefDir, 'out.log');
      const errLogPath = path.join(unrefDir, 'err.log');
      const scriptPath = path.join(unrefDir, 'spawn-exit.ts');
      const pidFilePath = path.join(unrefDir, 'spawned.pid');
      try {
        fs.writeFileSync(logPath, '');
        fs.writeFileSync(errLogPath, '');

        const modulePath = path
          .join(__dirname, 'shellJobSpawn.ts')
          .replace(/\\/g, '/');
        const powershellExe = getPowerShellExecutable();
        const script = [
          `import { spawnWindowsBackground } from '${modulePath}';`,
          `const p = spawnWindowsBackground(`,
          `  ${JSON.stringify(powershellExe)},`,
          `  'Start-Sleep -Seconds ${UNREF_SLEEP_SECONDS}',`,
          `  ${JSON.stringify(os.tmpdir())},`,
          `  { ...process.env },`,
          `  ${JSON.stringify(logPath)},`,
          `  ${JSON.stringify(errLogPath)},`,
          `);`,
          `require('fs').writeFileSync(${JSON.stringify(pidFilePath)}, String(p.pid));`,
          `p.child.unref();`,
        ].join('\n');
        fs.writeFileSync(scriptPath, script);

        // Consumers that intentionally abandon the returned lifecycle promise can
        // unref the exposed child handle. This subprocess does so explicitly and
        // must exit before the managed command finishes.
        const start = Date.now();
        const result = spawnSync('npx', ['tsx', scriptPath], {
          timeout: UNREF_SPAWN_TIMEOUT_MS,
          encoding: 'utf8',
          shell: true,
        });
        const elapsed = Date.now() - start;

        expect(result.status).toBe(0);
        expect(elapsed).toBeLessThan(UNREF_ELAPSED_BOUND_MS);
      } finally {
        // Reap the spawned 30s process tree so it does not survive the test run.
        reapPidFile(pidFilePath);
        fs.rmSync(unrefDir, { recursive: true, force: true });
      }
    });
  },
);
