/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Review round 1 (L1) for issue #4001: the recording `gh` stand-in must not
 * hide git failures. It may only tolerate the one outcome real gh tolerates:
 * a non-repository directory for a request that names its repository
 * explicitly (and, for pr.create, its head branch). Everything else, such as
 * git being unavailable, must fail loudly with git's own stderr so a suite
 * cannot pass for the wrong reason.
 *
 * The stand-in is a POSIX shell script, so the suite skips on Windows.
 *
 * @issue 4001
 */

import { afterEach, describe, expect, it } from 'bun:test';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  PR_URL,
  makeCwdShim,
  type CwdShim,
} from './github-broker-cwd-recorder.js';

const execFileAsync = promisify(execFile);

interface Outcome {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

const cleanups: Array<() => Promise<void>> = [];

async function nonRepositoryDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'gh4001-recorder-'));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

async function newShim(): Promise<CwdShim> {
  const shim = await makeCwdShim();
  cleanups.push(shim.cleanup);
  return shim;
}

interface ExecFailure {
  readonly code: number;
  readonly stdout?: string;
  readonly stderr?: string;
}

function isExecFailure(error: unknown): error is ExecFailure {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'number'
  );
}

/** Runs the stand-in `gh` the way the broker would, in `cwd`. */
async function runGh(
  shim: CwdShim,
  argv: readonly string[],
  options: { cwd: string; env: Record<string, string> },
): Promise<Outcome> {
  try {
    const { stdout, stderr } = await execFileAsync(
      join(shim.binDir, 'gh'),
      [...argv],
      { cwd: options.cwd, env: options.env, timeout: 30_000 },
    );
    return { code: 0, stdout, stderr };
  } catch (error) {
    if (isExecFailure(error)) {
      return {
        code: error.code,
        stdout: error.stdout ?? '',
        stderr: error.stderr ?? '',
      };
    }
    throw error;
  }
}

const PR_WITH_HEAD = ['pr', 'create', '--title', 'T', '--head', 'feature'];
const PR_WITHOUT_HEAD = ['pr', 'create', '--title', 'T'];

describe('issue #4001 recording gh stand-in', () => {
  describe.skipIf(process.platform === 'win32')('POSIX shell script', () => {
    afterEach(async () => {
      await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
    });

    const withGit = (repo?: string): Record<string, string> => ({
      PATH: process.env.PATH ?? '',
      ...(repo === undefined ? {} : { GH_REPO: repo }),
    });

    it('accepts a non-repository directory for an explicit repo and head', async () => {
      const shim = await newShim();

      const outcome = await runGh(shim, PR_WITH_HEAD, {
        cwd: await nonRepositoryDir(),
        env: withGit('owner/name'),
      });

      expect(outcome.code).toBe(0);
      expect(outcome.stdout.trim()).toBe(PR_URL);
    });

    it('fails with git stderr in a non-repository directory when no repo is named', async () => {
      const shim = await newShim();

      const outcome = await runGh(shim, PR_WITH_HEAD, {
        cwd: await nonRepositoryDir(),
        env: withGit(),
      });

      expect(outcome.code).not.toBe(0);
      expect(outcome.stderr).toContain('not a git repository');
    });

    it('fails in a non-repository directory when pr.create names a repo but no head', async () => {
      const shim = await newShim();

      const outcome = await runGh(shim, PR_WITHOUT_HEAD, {
        cwd: await nonRepositoryDir(),
        env: withGit('owner/name'),
      });

      expect(outcome.code).not.toBe(0);
      expect(outcome.stderr).toContain('not a git repository');
    });

    it('fails when git itself is unavailable instead of ignoring the error', async () => {
      const shim = await newShim();

      const outcome = await runGh(shim, PR_WITH_HEAD, {
        cwd: await nonRepositoryDir(),
        // No PATH entry that contains git: only the stand-in's own dir.
        env: { PATH: shim.binDir, GH_REPO: 'owner/name' },
      });

      expect(outcome.code).not.toBe(0);
      expect(outcome.stderr).toContain('failed to run git');
    });
  });
});
