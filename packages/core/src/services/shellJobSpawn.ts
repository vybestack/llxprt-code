/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawn as cpSpawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { isBunRuntime } from '../utils/runtime.js';
import type { ProcessExitInfo } from './shellJobTypes.js';

/**
 * Minimal shape of a Bun.Subprocess — only the members we use. This avoids
 * pulling in Bun type packages (the project type-checks under Node types).
 */
interface BunSubprocessLike {
  readonly pid: number;
  readonly exited: Promise<number>;
  readonly exitCode: number | null;
  readonly signalCode: string | null;
  readonly killed: boolean;
  kill: (exitCode?: number | string) => void;
  unref: () => void;
  ref: () => void;
}

/**
 * Minimal shape of the Bun global needed for spawn.
 */
interface BunSpawnGlobal {
  spawn: (options: {
    cmd: string[];
    cwd?: string;
    env?: Record<string, string | undefined>;
    stdio?: Array<'ignore' | 'pipe' | 'inherit' | number>;
    detached?: boolean;
  }) => BunSubprocessLike;
}

/**
 * Unified result from spawning a child process, abstracting over
 * `node:child_process.spawn` (Node.js) and `Bun.spawn` (Bun).
 *
 * Under Bun, we use `Bun.spawn` because its `exited` Promise reliably
 * resolves with the exit code. Bun's `node:child_process.spawn` has a known
 * bug where the `exit` event is intermittently not delivered for the first
 * spawned detached process group, causing `terminalPromise` to hang forever.
 *
 * Under Node.js, we use `node:child_process.spawn` with the `exit` event.
 */
export interface SpawnedProcess {
  readonly pid: number;
  readonly child: ChildProcess;
  readonly exited: Promise<ProcessExitInfo>;
  readonly onError: (handler: (err: Error) => void) => void;
}

/**
 * Returns the Bun global if we are running under Bun and it has `spawn`.
 * Returns null otherwise (Node.js, or Bun without spawn).
 */
function getBunSpawn(): BunSpawnGlobal | null {
  if (!isBunRuntime()) {
    return null;
  }
  const bun = (globalThis as { Bun?: Record<string, unknown> }).Bun;
  if (bun !== undefined && typeof bun.spawn === 'function') {
    return bun as unknown as BunSpawnGlobal;
  }
  return null;
}

/**
 * Spawn a detached child process.
 *
 * Under Bun, uses `Bun.spawn` which provides a reliable `exited` Promise
 * that resolves with the exit code. Under Node.js, uses
 * `node:child_process.spawn` with the `exit` event.
 *
 * Both paths write stdout/stderr to the same log file descriptor.
 */
export function spawnDetached(
  executable: string,
  args: string[],
  cwd: string,
  env: Record<string, string | undefined>,
  logFd: number,
): SpawnedProcess {
  const bunSpawn = getBunSpawn();

  if (bunSpawn !== null) {
    return spawnWithBun(bunSpawn, executable, args, cwd, env, logFd);
  }

  return spawnWithNodeChildProcess(executable, args, cwd, env, logFd);
}

function spawnWithBun(
  bun: BunSpawnGlobal,
  executable: string,
  args: string[],
  cwd: string,
  env: Record<string, string | undefined>,
  logFd: number,
): SpawnedProcess {
  let subprocess: BunSubprocessLike;
  let spawnError: Error | null = null;

  try {
    subprocess = bun.spawn({
      cmd: [executable, ...args],
      cwd,
      env,
      stdio: ['ignore', logFd, logFd],
      detached: true,
    });
  } catch (err: unknown) {
    // Bun.spawn throws synchronously on failures such as a nonexistent cwd
    // or executable. node:child_process.spawn emits these as async 'error'
    // events. We normalize by capturing the error and synthesizing a process
    // that fails immediately.
    spawnError = err instanceof Error ? err : new Error(String(err));
    subprocess = null as unknown as BunSubprocessLike;
  }

  if (spawnError !== null) {
    return makeErrorSpawn(spawnError);
  }

  // After the `exited` Promise resolves, read exitCode/signalCode from the
  // subprocess properties (these are set by Bun before the Promise fires).
  const exited = subprocess.exited.then(
    (): ProcessExitInfo => ({
      exitCode: subprocess.exitCode,
      signal: subprocess.signalCode,
    }),
  );

  // Detach the child from the parent's event loop so background jobs do not
  // keep the process alive. This mirrors node:child_process's child.unref().
  subprocess.unref();

  return {
    pid: subprocess.pid,
    child: subprocess as unknown as ChildProcess,
    exited,
    onError: (handler) => {
      // Bun.spawn doesn't emit a separate 'error' event for spawn-time
      // failures the way node:child_process does. A rejected `exited`
      // Promise surfaces spawn errors. We attach a catch handler here.
      void subprocess.exited.catch((err: unknown) => {
        if (err instanceof Error) {
          handler(err);
        }
      });
    },
  };
}

/**
 * Create a SpawnedProcess for a spawn that failed synchronously (e.g.
 * nonexistent cwd). The error is delivered through the `exited` Promise
 * rejection and the `onError` handler, matching node:child_process behavior.
 */
function makeErrorSpawn(error: Error): SpawnedProcess {
  const fakeChild = new EventEmitter() as unknown as ChildProcess;
  return {
    pid: -1,
    child: fakeChild,
    // Never resolves: the error is delivered via onError, which triggers
    // the terminal transition through handleError → finalizeJob.
    exited: new Promise<ProcessExitInfo>(() => {}),
    onError: (handler) => {
      // Fire on next tick to match async 'error' event timing.
      setTimeout(() => handler(error), 0);
    },
  };
}

function spawnWithNodeChildProcess(
  executable: string,
  args: string[],
  cwd: string,
  env: Record<string, string | undefined>,
  logFd: number,
): SpawnedProcess {
  const child = cpSpawn(executable, args, {
    cwd,
    detached: true,
    shell: false,
    stdio: ['ignore', logFd, logFd],
    env,
  });

  // Detach the child from the parent's event loop so background jobs do not
  // keep the process alive.
  child.unref();

  const exited = new Promise<ProcessExitInfo>((resolve) => {
    child.on('exit', (code, signal) => {
      resolve({ exitCode: code, signal });
    });
  });

  return {
    pid: child.pid ?? -1,
    child,
    exited,
    onError: (handler) => {
      child.on('error', handler);
    },
  };
}
