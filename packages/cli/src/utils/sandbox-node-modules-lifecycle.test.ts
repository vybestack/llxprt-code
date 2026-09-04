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
import {
  SANDBOX_SIGNAL_CHILD_PATH,
  SANDBOX_SIGNAL_CHILD_READY_MARKER_ENV,
  SANDBOX_SIGNAL_CHILD_WORKDIR_ENV,
} from '../../test-utils/sandbox-node-modules-signal-child.js';
import { useFakeEngine } from '../../test-utils/fake-dependency-engine-harness.js';
import { addPrivateDependencyMounts } from './sandbox-node-modules.js';

const RUN_ROOT_PREFIX = 'sandbox-node-modules-';

function makeWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'issue3450-ws-'));
}

/**
 * Points the production Storage resolver at a private temp cache root so
 * the tests never inspect run directories in the shared live user cache
 * (#3450 remediation F8); engine-owned storage must never appear there.
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

/**
 * Assert the signal fixture died from its signal: strictly (status null,
 * signal name) on POSIX, or via bun's win32 emulation of signal delivery as
 * a normal exit status 1 — the observable contract there is termination (it
 * did not continue into the trailing timer) and the handler having released
 * the engine-owned volumes, asserted by the caller.
 */
function assertSignalDeath(
  result: ReturnType<typeof spawnSync>,
  signal: 'SIGINT' | 'SIGTERM',
): void {
  if (process.platform === 'win32') {
    expect(result.status === 1 || result.signal === signal).toBe(true);
  } else {
    expect(result.status).toBeNull();
    expect(result.signal).toBe(signal);
  }
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
  const engine = useFakeEngine();
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

  it('registers process-level cleanup handlers immediately after creation and unregisters after release', () => {
    const args: string[] = [];
    const exitBefore = process.listenerCount('exit');
    const sigintBefore = process.listenerCount('SIGINT');
    const sigtermBefore = process.listenerCount('SIGTERM');
    const lifecycle = addPrivateDependencyMounts(engine.config, args, workdir);
    try {
      // Exactly one handler per signal is live while the storage exists.
      expect(process.listenerCount('exit') - exitBefore).toBe(1);
      expect(process.listenerCount('SIGINT') - sigintBefore).toBe(1);
      expect(process.listenerCount('SIGTERM') - sigtermBefore).toBe(1);
      expect(engine.volumeNames()).toHaveLength(2);
    } finally {
      lifecycle.release();
    }
    // Release unregisters every handler the creation registered.
    expect(process.listenerCount('exit') - exitBefore).toBe(0);
    expect(process.listenerCount('SIGINT') - sigintBefore).toBe(0);
    expect(process.listenerCount('SIGTERM') - sigtermBefore).toBe(0);
    expect(engine.volumeNames()).toStrictEqual([]);
    expect(privateRunRoots()).toStrictEqual([]);
  });

  // bun emulates signal delivery on win32 by terminating the child with a
  // normal exit status 1, so the registered JS signal handlers (and the
  // release-before-death contract they carry) never run; the child even
  // reaches readiness and reports signal death via the fixture's exit-code
  // convention, but the engine-owned volumes stay. See issue #3563 for the
  // adjacent win32 close-handler gap. The emitted-mounts and handler
  // assertions still exercise POSIX.
  it.each(['SIGINT', 'SIGTERM'] as const).skipIf(process.platform === 'win32')(
    'removes the engine-owned volumes and terminates on %s instead of continuing',
    (signal) => {
      // A real child process runs the checked-in signal fixture against the
      // same fake engine state and signals itself while the storage exists.
      // The fixture receives only data (the signal as argv and the
      // workspace and marker paths as validated environment variables), so
      // no source code is constructed at runtime.
      // Registering a cleanup listener replaces the signal's default
      // termination, so the lifecycle must both release the volumes AND
      // restore that termination when no other handler owns the signal:
      // the child has to die from the signal, not continue into later
      // work with its storage already gone (#3450 OCR F9).
      const cacheDir = Storage.getGlobalCacheDir();
      const storageReadyMarker = path.join(
        cacheDir,
        `issue3450-storage-ready-${signal}.txt`,
      );
      const result = spawnSync(
        process.execPath,
        [SANDBOX_SIGNAL_CHILD_PATH, signal],
        {
          env: {
            ...process.env,
            NODE_ENV: 'production',
            [SANDBOX_SIGNAL_CHILD_WORKDIR_ENV]: workdir,
            [SANDBOX_SIGNAL_CHILD_READY_MARKER_ENV]: storageReadyMarker,
          },
          encoding: 'utf8',
          timeout: 30_000,
        },
      );
      if (!fs.existsSync(storageReadyMarker)) {
        throw new Error(
          `Signal fixture failed before readiness: status=${String(result.status)} signal=${String(result.signal)} stdout=${result.stdout} stderr=${result.stderr}`,
        );
      }
      expect(fs.readFileSync(storageReadyMarker, 'utf8')).toBe(
        'PRIVATE-STORAGE-READY:1\n',
      );
      assertSignalDeath(result, signal);
      expect(result.stdout).not.toContain('CONTINUED-AFTER-SIGNAL');
      // The signal handler released the engine-owned volumes.
      expect(engine.volumeNames()).toStrictEqual([]);
      expect(privateRunRoots()).toStrictEqual([]);
    },
  );

  it('warns on stderr naming the operation and volume when engine removal fails', () => {
    const lifecycle = addPrivateDependencyMounts(engine.config, [], workdir);
    const created = [...engine.volumeNames()].sort();
    expect(created).toHaveLength(2);
    // The fault lives in the engine, not the host: the first volume rm
    // fails once (deterministic under any runner uid).
    engine.setKnob('fail-volume-rm-once');
    const writeSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    try {
      expect(() => lifecycle.release()).not.toThrow();
      const text = writeSpy.mock.calls.map((call) => String(call[0])).join('');
      expect(text).toContain(
        `failed to remove the private sandbox dependency volume '${created[0]}'`,
      );
      expect(text).toContain('fake engine: volume rm failed by request');
      // The warning did not stop the rest of the release: only the volume
      // whose one removal failed remains, while the other was removed.
      expect(engine.volumeNames()).toStrictEqual([created[0]]);
    } finally {
      writeSpy.mockRestore();
    }
  });

  it('releases exactly once: a second release makes no engine calls and warns about nothing', () => {
    const lifecycle = addPrivateDependencyMounts(engine.config, [], workdir);
    lifecycle.release();
    const invocationCount = engine.invocations().length;
    const writeSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    try {
      expect(() => lifecycle.release()).not.toThrow();
    } finally {
      writeSpy.mockRestore();
    }
    expect(engine.invocations()).toHaveLength(invocationCount);
    expect(writeSpy.mock.calls).toStrictEqual([]);
  });
});
