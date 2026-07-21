/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync, spawn } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  copyFileSync,
  chmodSync,
  readFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const thisFile = fileURLToPath(import.meta.url);
const repoRoot = resolve(thisFile, '..', '..', '..');
const launcherPath = join(repoRoot, 'packages', 'cli', 'bin', 'llxprt');
const repoBun = join(repoRoot, 'node_modules', 'bun', 'bin', 'bun.exe');

function ensureBun(): string {
  if (existsSync(repoBun)) {
    return repoBun;
  }
  const whichResult = spawnSync('which', ['bun'], { encoding: 'utf8' });
  if (whichResult.status === 0) {
    return whichResult.stdout.trim();
  }
  throw new Error('Bun not found for test setup');
}

function makeEntry(pkgRoot: string, code: string): void {
  writeFileSync(join(pkgRoot, 'index.ts'), `#!/usr/bin/env -S bun\n${code}\n`);
}

function makeLayout(
  tempDir: string,
  opts: { withBun?: boolean; withIndex?: boolean; entryCode?: string } = {},
): { pkgRoot: string; launcherTarget: string } {
  const pkgRoot = join(tempDir, 'pkg');
  const binDir = join(pkgRoot, 'bin');
  mkdirSync(binDir, { recursive: true });

  const launcherTarget = join(binDir, 'llxprt');
  copyFileSync(launcherPath, launcherTarget);
  chmodSync(launcherTarget, 0o755);

  if (opts.withIndex !== false) {
    makeEntry(pkgRoot, opts.entryCode ?? 'process.exit(0);');
  }

  if (opts.withBun !== false) {
    const bunPath = ensureBun();
    const bunDir = join(pkgRoot, 'node_modules', 'bun', 'bin');
    mkdirSync(bunDir, { recursive: true });
    copyFileSync(bunPath, join(bunDir, 'bun.exe'));
  }

  return { pkgRoot, launcherTarget };
}

describe('POSIX launcher signal behavior', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'llxprt-sig-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function makeLongRunning(tempDir: string): {
    pkgRoot: string;
    launcherTarget: string;
    pidFile: string;
  } {
    const pidFile = join(tempDir, 'child-pid.txt');
    const { pkgRoot, launcherTarget } = makeLayout(tempDir, {
      entryCode: [
        'const fs = require("fs");',
        `fs.writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));`,
        'process.stdin.resume();',
        // Pause stdin on exit so a clean shutdown does not leave it flowing.
        'process.on("exit", () => { try { process.stdin.pause(); } catch {} });',
      ].join('\n'),
    });
    return { pkgRoot, launcherTarget, pidFile };
  }

  it('SIGINT reaches the child directly via exec (process replacement)', () => {
    const { pkgRoot, launcherTarget, pidFile } = makeLongRunning(tempDir);
    const child = spawn(launcherTarget, [], {
      cwd: pkgRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PATH: '/usr/bin:/bin' },
    });

    let exited = false;
    let exitSignal: NodeJS.Signals | null = null;
    child.on('exit', (_code, signal) => {
      exited = true;
      exitSignal = signal;
    });

    let waited = 0;
    const wait = setInterval(() => {
      if (existsSync(pidFile) || waited > 50) {
        clearInterval(wait);
        if (existsSync(pidFile)) {
          const childPid = parseInt(readFileSync(pidFile, 'utf8').trim(), 10);
          try {
            process.kill(childPid, 'SIGINT');
          } catch {
            child.kill('SIGINT');
          }
        } else {
          child.kill('SIGINT');
        }
      }
      waited++;
    }, 100);

    setTimeout(() => {
      clearInterval(wait);
      if (!exited) {
        child.kill('SIGKILL');
      }
    }, 15_000).unref();

    return new Promise<void>((resolve) => {
      child.on('exit', () => {
        expect(exited).toBe(true);
        expect(exitSignal).toBe('SIGINT');
        resolve();
      });
    });
  }, 20_000);

  it('SIGTERM reaches the child directly via exec (process replacement)', () => {
    const { pkgRoot, launcherTarget, pidFile } = makeLongRunning(tempDir);
    const child = spawn(launcherTarget, [], {
      cwd: pkgRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PATH: '/usr/bin:/bin' },
    });

    let exited = false;
    let exitSignal: NodeJS.Signals | null = null;
    child.on('exit', (_code, signal) => {
      exited = true;
      exitSignal = signal;
    });

    let waited = 0;
    const wait = setInterval(() => {
      if (existsSync(pidFile) || waited > 50) {
        clearInterval(wait);
        if (existsSync(pidFile)) {
          const childPid = parseInt(readFileSync(pidFile, 'utf8').trim(), 10);
          try {
            process.kill(childPid, 'SIGTERM');
          } catch {
            child.kill('SIGTERM');
          }
        } else {
          child.kill('SIGTERM');
        }
      }
      waited++;
    }, 100);

    setTimeout(() => {
      clearInterval(wait);
      if (!exited) {
        child.kill('SIGKILL');
      }
    }, 15_000).unref();

    return new Promise<void>((resolve) => {
      child.on('exit', () => {
        expect(exited).toBe(true);
        expect(exitSignal).toBe('SIGTERM');
        resolve();
      });
    });
  }, 20_000);
});
