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

// Constrained PATH used to prove the launcher needs no global Bun/Node — only
// /bin/sh (POSIX shell) and core utilities are expected. This intentionally
// excludes /usr/local/bin so the test cannot accidentally resolve a globally
// installed bun. This is POSIX-only; Windows has no /usr/bin:/bin.
const CONSTRAINED_POSIX_PATH = '/usr/bin:/bin';

// Bun is a declared root dependency and test prerequisite: the launcher exec's
// it directly. A missing Bun means the repo install is broken — skipping would
// hide that, so we throw rather than mark tests as skipped.
function ensureBun(): string {
  if (existsSync(repoBun)) {
    return repoBun;
  }
  // Use POSIX-standard 'command -v' instead of non-standard 'which' for
  // portability on minimal container images and BusyBox environments.
  const cmdVResult = spawnSync('sh', ['-c', 'command -v bun'], {
    encoding: 'utf8',
  });
  if (cmdVResult.status === 0 && cmdVResult.stdout.trim()) {
    return cmdVResult.stdout.trim();
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

// POSIX-only: signal semantics (SIGINT/SIGTERM process replacement via exec)
// require the POSIX launcher. Windows has no POSIX signals and the launcher
// path is a .cmd/.ps1, not this POSIX shell script. Skip explicitly on Windows.
describe.skipIf(process.platform === 'win32')(
  'POSIX launcher signal behavior',
  () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = mkdtempSync(join(tmpdir(), 'llxprt-sig-'));
    });

    afterEach(() => {
      rmSync(tempDir, { recursive: true, force: true });
    });

    function makeLongRunning(dir: string): {
      pkgRoot: string;
      launcherTarget: string;
      pidFile: string;
    } {
      const pidFile = join(dir, 'child-pid.txt');
      const { pkgRoot, launcherTarget } = makeLayout(dir, {
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

    // Parameterized signal test: both SIGINT and SIGTERM must reach the child
    // process directly via the launcher's exec (process replacement). The POSIX
    // launcher uses `exec "$bun" "$entry" "$@"`, so the child replaces the shell
    // and signals are delivered to the actual Bun process, not a parent shell.
    function testSignalDelivery(signal: NodeJS.Signals): void {
      it(`${signal} reaches the child directly via exec (process replacement)`, () => {
        const { pkgRoot, launcherTarget, pidFile } = makeLongRunning(tempDir);
        const child = spawn(launcherTarget, [], {
          cwd: pkgRoot,
          stdio: ['pipe', 'pipe', 'pipe'],
          env: { ...process.env, PATH: CONSTRAINED_POSIX_PATH },
        });

        let exited = false;
        let exitSignal: NodeJS.Signals | null = null;
        child.on('exit', (_code, sig) => {
          exited = true;
          exitSignal = sig;
        });

        let waited = 0;
        const wait = setInterval(() => {
          if (existsSync(pidFile) || waited > 50) {
            clearInterval(wait);
            if (existsSync(pidFile)) {
              const childPid = parseInt(
                readFileSync(pidFile, 'utf8').trim(),
                10,
              );
              try {
                process.kill(childPid, signal);
              } catch {
                child.kill(signal);
              }
            } else {
              child.kill(signal);
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
            expect(exitSignal).toBe(signal);
            resolve();
          });
        });
      }, 20_000);
    }

    testSignalDelivery('SIGINT');
    testSignalDelivery('SIGTERM');
  },
);
