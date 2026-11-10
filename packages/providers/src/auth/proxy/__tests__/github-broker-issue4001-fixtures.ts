/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared fixtures for the issue #4001 broker suites: temp directories, the
 * recording gh shim, and the child process that runs the real
 * `executeGitHubOp` after deleting (or locking) its own working directory.
 *
 * `useIssue4001Fixtures` registers the beforeEach/afterEach hooks itself, so
 * a suite gets isolation with one line. The child is bounded by an explicit
 * timeout and an AbortSignal tied to the running test; teardown aborts it and
 * waits for the process to exit before any directory is removed.
 *
 * @issue 4001
 */

import { afterEach, beforeEach } from 'bun:test';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { z } from 'zod';
import { DebugLogger } from '@vybestack/llxprt-code-core/utils/debugLogger.js';
import {
  makeCwdShim,
  pathWithShim,
  type CwdShim,
  type CwdShimOptions,
} from './github-broker-cwd-recorder.js';

const execFileAsync = promisify(execFile);

/** Upper bound for the child and for helper git commands. */
export const CHILD_TIMEOUT_MS = 60_000;

const CHILD_SCRIPT = join(
  dirname(fileURLToPath(import.meta.url)),
  'github-broker-issue4001-child.ts',
);

const childOutputSchema = z.object({
  cwdReadable: z.boolean(),
  outcome: z.union([
    z.object({ ok: z.literal(true), result: z.record(z.unknown()) }),
    z.object({ ok: z.literal(false), code: z.string(), message: z.string() }),
  ]),
});
export type ChildOutput = z.infer<typeof childOutputSchema>;

export interface ChildRequest {
  readonly op: string;
  readonly params: Record<string, unknown>;
  readonly workingDirectory?: string;
  /**
   * What happens to the child's own cwd before the call: removed (default) or
   * left in place but made unreadable (mode 0o000).
   */
  readonly cwdState?: 'deleted' | 'inaccessible';
  /** Points TMPDIR (hence os.tmpdir()) at a directory with mode 0o000. */
  readonly tmpdirState?: 'inaccessible';
}

export interface Issue4001Fixtures {
  /** A recording gh shim, removed after the test. */
  readonly newShim: (options?: CwdShimOptions) => Promise<CwdShim>;
  /** An empty temp directory, removed after the test. */
  readonly newDir: (prefix: string) => Promise<string>;
  /** A temp directory initialised as a real git repository. */
  readonly newRepoDir: (prefix: string) => Promise<string>;
  /** Registers cleanup to run after the test (before the abort completes). */
  readonly onCleanup: (cleanup: () => Promise<void>) => void;
  /** Runs the real executeGitHubOp inside the child with the shim on PATH. */
  readonly runInChild: (
    shim: CwdShim,
    request: ChildRequest,
  ) => Promise<ChildOutput>;
}

/** Returns the success payload or throws with the broker error. */
export function expectSuccess(output: ChildOutput): Record<string, unknown> {
  if (!output.outcome.ok) {
    throw new Error(
      `expected success, got ${output.outcome.code}: ${output.outcome.message}`,
    );
  }
  return output.outcome.result;
}

/**
 * Collects the broker's debug lines emitted while `fn` runs. The failure line
 * records the cwd handed to the gh child, which is the only place the exact
 * (canonical or not) path string is observable: `pwd -P` in the shim hides it.
 */
export async function captureBrokerDebugLines(
  fn: () => Promise<unknown>,
): Promise<{ lines: string[]; error: unknown }> {
  const lines: string[] = [];
  let error: unknown;
  const original = DebugLogger.prototype.debug;
  DebugLogger.prototype.debug = function patched(
    this: DebugLogger,
    messageOrFn: string | (() => string),
  ): void {
    if (this.namespace !== 'llxprt:github:broker') return;
    lines.push(typeof messageOrFn === 'function' ? messageOrFn() : messageOrFn);
  };
  try {
    await fn();
  } catch (caught) {
    error = caught;
  } finally {
    DebugLogger.prototype.debug = original;
  }
  return { lines, error };
}

/**
 * Runs the child fixture with the recording gh on PATH, bounded by a timeout
 * and the test's abort signal, and records its exit so cleanup can await it.
 */
function spawnChild(
  request: ChildRequest,
  shim: CwdShim,
  signal: AbortSignal,
  exits: Array<Promise<void>>,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      process.execPath,
      [CHILD_SCRIPT, JSON.stringify(request)],
      {
        env: { ...process.env, PATH: pathWithShim(shim.binDir) },
        timeout: CHILD_TIMEOUT_MS,
        killSignal: 'SIGKILL',
        signal,
      },
      (error, stdout) => (error === null ? resolve(stdout) : reject(error)),
    );
    exits.push(
      new Promise<void>((done) => {
        child.once('close', () => done());
        child.once('error', () => done());
      }),
    );
  });
}

/** Registers per-test lifecycle hooks and returns the fixture accessors. */
export function useIssue4001Fixtures(): Issue4001Fixtures {
  const cleanups: Array<() => Promise<void>> = [];
  const exits: Array<Promise<void>> = [];
  let testAbort = new AbortController();

  beforeEach(() => {
    testAbort = new AbortController();
  });

  afterEach(async () => {
    testAbort.abort();
    // The child must be gone before its directories are removed.
    await Promise.allSettled(exits.splice(0));
    await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
  });

  const onCleanup = (cleanup: () => Promise<void>): void => {
    cleanups.push(cleanup);
  };

  const newDir = async (prefix: string): Promise<string> => {
    const dir = await mkdtemp(join(tmpdir(), prefix));
    onCleanup(() => rm(dir, { recursive: true, force: true }));
    return dir;
  };

  return {
    onCleanup,
    newDir,
    newRepoDir: async (prefix) => {
      const dir = await newDir(prefix);
      await execFileAsync('git', ['init', '--quiet'], {
        cwd: dir,
        timeout: CHILD_TIMEOUT_MS,
        signal: testAbort.signal,
      });
      return dir;
    },
    newShim: async (options) => {
      const shim = await makeCwdShim(options);
      onCleanup(shim.cleanup);
      return shim;
    },
    runInChild: async (shim, request) => {
      const stdout = await spawnChild(request, shim, testAbort.signal, exits);
      return childOutputSchema.parse(JSON.parse(stdout.trim()));
    },
  };
}
