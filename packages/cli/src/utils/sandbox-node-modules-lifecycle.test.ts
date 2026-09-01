/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Storage } from '@vybestack/llxprt-code-storage';
import { addPrivateDependencyMounts } from './sandbox-node-modules.js';

const DOCKER_CONFIG = { command: 'docker', image: 'test' } as const;
const RUN_ROOT_PREFIX = 'sandbox-node-modules-';

function makeWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'issue3450-ws-'));
}

/**
 * Points the production Storage resolver at a private temp cache root so
 * the tests never create or inspect run directories in the shared live
 * user cache (#3450 remediation F8).
 */
function isolateCacheEnv(): () => void {
  const saved = process.env.LLXPRT_CACHE_HOME;
  const isolated = fs.mkdtempSync(path.join(os.tmpdir(), 'issue3450-cache-'));
  process.env.LLXPRT_CACHE_HOME = isolated;
  return () => {
    if (saved === undefined) {
      delete process.env.LLXPRT_CACHE_HOME;
    } else {
      process.env.LLXPRT_CACHE_HOME = saved;
    }
    fs.rmSync(isolated, { recursive: true, force: true });
  };
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function privateRunRoots(): string[] {
  const cacheDir = Storage.getGlobalCacheDir();
  return fs
    .readdirSync(cacheDir)
    .filter((entry) => entry.startsWith(RUN_ROOT_PREFIX))
    .map((entry) => path.join(cacheDir, entry));
}

describe('#3450 private dependency storage lifecycle', () => {
  let workdir = '';
  let restoreCacheEnv: () => void;

  beforeEach(() => {
    workdir = makeWorkspace();
    restoreCacheEnv = isolateCacheEnv();
    writeJson(path.join(workdir, 'package.json'), {
      workspaces: ['packages/nested'],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (workdir !== '') fs.rmSync(workdir, { recursive: true, force: true });
    restoreCacheEnv();
  });

  it('registers process-level cleanup handlers immediately after creation and unregisters after completion', () => {
    const args: string[] = [];
    const exitBefore = process.listenerCount('exit');
    const sigintBefore = process.listenerCount('SIGINT');
    const sigtermBefore = process.listenerCount('SIGTERM');
    const cleanup = addPrivateDependencyMounts(DOCKER_CONFIG, args, workdir);
    try {
      // Exactly one handler per signal is live while the storage exists.
      expect(process.listenerCount('exit') - exitBefore).toBe(1);
      expect(process.listenerCount('SIGINT') - sigintBefore).toBe(1);
      expect(process.listenerCount('SIGTERM') - sigtermBefore).toBe(1);
    } finally {
      cleanup();
    }
    // Completion unregisters every handler the creation registered.
    expect(process.listenerCount('exit') - exitBefore).toBe(0);
    expect(process.listenerCount('SIGINT') - sigintBefore).toBe(0);
    expect(process.listenerCount('SIGTERM') - sigtermBefore).toBe(0);
    expect(privateRunRoots()).toStrictEqual([]);
  });

  it.each(['SIGINT', 'SIGTERM'] as const)(
    'removes the per-run storage and terminates on %s instead of continuing',
    (signal) => {
      // A subprocess runs the production helper and signals itself while
      // the storage exists. Registering a cleanup listener replaces the
      // signal's default termination, so the lifecycle must both remove
      // the subtree AND restore that termination when no other handler
      // owns the signal: the child has to die from the signal, not
      // continue into later work with its storage already gone (#3450
      // OCR F9).
      const cacheDir = Storage.getGlobalCacheDir();
      const scriptPath = path.join(
        cacheDir,
        `issue3450-signal-self-${signal}.ts`,
      );
      const storageReadyMarker = path.join(
        cacheDir,
        `issue3450-storage-ready-${signal}.txt`,
      );
      const helperModule = path.join(
        import.meta.dirname,
        'sandbox-node-modules.ts',
      );
      const script = [
        'import fs from "node:fs";',
        `import { addPrivateDependencyMounts } from ${JSON.stringify(helperModule)};`,
        `const workdir = ${JSON.stringify(workdir)};`,
        `const cacheDir = ${JSON.stringify(cacheDir)};`,
        `const storageReadyMarker = ${JSON.stringify(storageReadyMarker)};`,
        'const args: string[] = [];',
        'addPrivateDependencyMounts({ command: "docker", image: "test" }, args, workdir);',
        `const runRoots = fs.readdirSync(cacheDir).filter((entry) => entry.startsWith(${JSON.stringify(RUN_ROOT_PREFIX)}));`,
        'if (runRoots.length !== 1) throw new Error(`Expected exactly one private run root, found ${runRoots.length}`);',
        'fs.writeFileSync(storageReadyMarker, "PRIVATE-STORAGE-READY:1\\n", { flush: true });',
        `process.kill(process.pid, ${JSON.stringify(signal)});`,
        // Only reachable when the cleanup handler wrongly swallows the
        // signal instead of restoring the default termination.
        'setTimeout(() => { console.log("CONTINUED-AFTER-SIGNAL"); process.exit(4); }, 1500);',
      ].join('\n');
      fs.writeFileSync(scriptPath, script);
      const result = spawnSync(process.execPath, [scriptPath], {
        env: { ...process.env, NODE_ENV: 'production' },
        encoding: 'utf8',
        timeout: 30_000,
      });
      expect(fs.readFileSync(storageReadyMarker, 'utf8')).toBe(
        'PRIVATE-STORAGE-READY:1\n',
      );
      expect(result.status).toBeNull();
      expect(result.signal).toBe(signal);
      expect(result.stdout).not.toContain('CONTINUED-AFTER-SIGNAL');
      expect(privateRunRoots()).toStrictEqual([]);
    },
  );

  it('warns on stderr naming the operation and path when removal fails', () => {
    const args: string[] = [];
    const cleanup = addPrivateDependencyMounts(DOCKER_CONFIG, args, workdir);
    const created = privateRunRoots()[0];
    // Deterministic on privileged runners too: a chmod-based denial lets
    // root remove the tree anyway, so the fault is injected at the
    // filesystem boundary instead. Recursive removal of the run root
    // fails the way an EPERM from the OS would (#3450 OCR F13), and the
    // warning must still reach the user on stderr.
    const realRmSync = fs.rmSync;
    const rmSpy = vi
      .spyOn(fs, 'rmSync')
      .mockImplementation((...rmArgs: Parameters<typeof fs.rmSync>) => {
        if (rmArgs[0] === created) {
          throw Object.assign(
            new Error(
              `EPERM: operation not permitted, rm '${String(rmArgs[0])}'`,
            ),
            { code: 'EPERM' },
          );
        }
        return realRmSync(...rmArgs);
      });
    const writeSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    try {
      expect(() => cleanup()).not.toThrow();
      const text = writeSpy.mock.calls.map((call) => String(call[0])).join('');
      expect(text).toContain(
        'failed to remove the private sandbox dependency storage',
      );
      expect(text).toContain(created);
    } finally {
      writeSpy.mockRestore();
      rmSpy.mockRestore();
    }
  });
});
