/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #4001 (and duplicates #4002, #4003, #4005, #4006, #4007, #4008,
 * #4011, #4012, #4013, #4016): github tool operations that make `gh` run
 * `git` (mainly pr.create) failed with "failed to run git: fatal: Unable to
 * read current working directory" because the gh child inherited the LLxprt
 * process's working directory, which had been deleted.
 *
 * The broker now gives every gh child an explicit, existing cwd: the
 * session workspace directory when supplied and present, else the process
 * cwd when usable, else a neutral temp dir when the op names a repo, else a
 * structured error before gh is spawned.
 *
 * These tests drive the REAL executeGitHubOp against a recording `gh` shim
 * on PATH that runs a real `git` in its starting directory, so a deleted cwd
 * fails exactly as real gh does. A deleted process cwd is produced in a
 * child bun process so the test runner's own cwd stays valid. The shim is a
 * POSIX shell script, so the suite skips on Windows.
 *
 * @plan project-plans/issue4001.md
 * @issue 4001
 */

import { afterEach, describe, expect, it } from 'bun:test';
import { execFile } from 'node:child_process';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { z } from 'zod';
import { DebugLogger } from '@vybestack/llxprt-code-core/utils/debugLogger.js';
import { executeGitHubOp } from '../github-broker.js';
import {
  PR_URL,
  makeCwdShim,
  pathWithShim,
  withGhOnPath,
  type CwdShim,
  type CwdShimOptions,
} from './github-broker-cwd-recorder.js';

const execFileAsync = promisify(execFile);
const SIGNAL = new AbortController().signal;
const CHILD_SCRIPT = join(
  dirname(fileURLToPath(import.meta.url)),
  'github-broker-issue4001-child.ts',
);

const PR_PARAMS = { title: 'T', body: 'B', base: 'main', head: 'feature' };
const REPO = 'owner/name';

const childOutputSchema = z.object({
  cwdReadable: z.boolean(),
  outcome: z.union([
    z.object({ ok: z.literal(true), result: z.record(z.unknown()) }),
    z.object({ ok: z.literal(false), code: z.string(), message: z.string() }),
  ]),
});
type ChildOutput = z.infer<typeof childOutputSchema>;

interface ChildRequest {
  readonly op: string;
  readonly params: Record<string, unknown>;
  readonly workingDirectory?: string;
}

const cleanups: Array<() => Promise<void>> = [];

async function newShim(options?: CwdShimOptions): Promise<CwdShim> {
  const shim = await makeCwdShim(options);
  cleanups.push(shim.cleanup);
  return shim;
}

async function newDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

/**
 * Runs the real executeGitHubOp in a child whose own cwd was deleted before
 * the call, with the shim on the child's PATH.
 */
async function runWithDeletedCwd(
  shim: CwdShim,
  request: ChildRequest,
): Promise<ChildOutput> {
  const { stdout } = await execFileAsync(
    process.execPath,
    [CHILD_SCRIPT, JSON.stringify(request)],
    { env: { ...process.env, PATH: pathWithShim(shim.binDir) } },
  );
  return childOutputSchema.parse(JSON.parse(stdout.trim()));
}

function expectSuccess(output: ChildOutput): Record<string, unknown> {
  if (!output.outcome.ok) {
    throw new Error(
      `expected success, got ${output.outcome.code}: ${output.outcome.message}`,
    );
  }
  return output.outcome.result;
}

describe('issue #4001: gh runs in an existing working directory', () => {
  afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
  });

  describe.skipIf(process.platform === 'win32')(
    'recording gh shim (POSIX)',
    () => {
      describe('process cwd deleted', () => {
        it('runs pr.create in a neutral existing directory when repo is explicit', async () => {
          const shim = await newShim();

          const output = await runWithDeletedCwd(shim, {
            op: 'pr.create',
            params: { ...PR_PARAMS, repo: REPO },
          });

          expect(output.cwdReadable).toBe(false);
          expect(expectSuccess(output).url).toBe(PR_URL);
          expect(await shim.readCwds()).toStrictEqual([
            await realpath(tmpdir()),
          ]);
        });

        it('runs in the session workspace directory when one is supplied', async () => {
          const shim = await newShim();
          const workspace = await newDir('gh4001-workspace-');

          const output = await runWithDeletedCwd(shim, {
            op: 'pr.create',
            params: PR_PARAMS,
            workingDirectory: workspace,
          });

          expect(expectSuccess(output).url).toBe(PR_URL);
          expect(await shim.readCwds()).toStrictEqual([
            await realpath(workspace),
          ]);
        });

        it('fails with a structured error, without spawning gh, when no repo and no workspace are available', async () => {
          const shim = await newShim();

          const output = await runWithDeletedCwd(shim, {
            op: 'pr.create',
            params: PR_PARAMS,
          });

          expect(output.outcome.ok).toBe(false);
          if (output.outcome.ok) return;
          expect(output.outcome.code).toBe('HOST_GH_UNAVAILABLE');
          expect(output.outcome.message).toMatch(/working directory/i);
          expect(output.outcome.message).toMatch(/unavailable/i);
          expect(output.outcome.message).toContain('repo');
          expect(await shim.readCwds()).toStrictEqual([]);
        });

        it('falls through a missing workspace directory to the neutral directory', async () => {
          const shim = await newShim();
          const missing = join(
            await newDir('gh4001-parent-'),
            'does-not-exist',
          );

          const output = await runWithDeletedCwd(shim, {
            op: 'pr.create',
            params: { ...PR_PARAMS, repo: REPO },
            workingDirectory: missing,
          });

          expect(expectSuccess(output).url).toBe(PR_URL);
          expect(await shim.readCwds()).toStrictEqual([
            await realpath(tmpdir()),
          ]);
        });

        it('falls through a missing workspace directory to the structured error when no repo is named', async () => {
          const shim = await newShim();
          const missing = join(
            await newDir('gh4001-parent-'),
            'does-not-exist',
          );

          const output = await runWithDeletedCwd(shim, {
            op: 'pr.create',
            params: PR_PARAMS,
            workingDirectory: missing,
          });

          expect(output.outcome.ok).toBe(false);
          if (output.outcome.ok) return;
          expect(output.outcome.message).toMatch(/working directory/i);
          expect(await shim.readCwds()).toStrictEqual([]);
        });

        it('runs every step of a multi-step op in the same neutral directory', async () => {
          const shim = await newShim();

          const output = await runWithDeletedCwd(shim, {
            op: 'issue.edit',
            params: { number: 1, addLabel: ['x'], type: 'Bug', repo: REPO },
          });

          expect(expectSuccess(output)).toStrictEqual({
            number: 1,
            type: 'Bug',
          });
          const cwds = await shim.readCwds();
          expect(cwds).toHaveLength(4);
          expect(new Set(cwds)).toStrictEqual(
            new Set([await realpath(tmpdir())]),
          );
        });
      });

      describe('process cwd valid', () => {
        it('runs in the process cwd when no workspace directory is supplied', async () => {
          const shim = await newShim();

          const result = await withGhOnPath(shim.binDir, () =>
            executeGitHubOp('pr.create', PR_PARAMS, SIGNAL),
          );

          expect(result.url).toBe(PR_URL);
          expect(await shim.readCwds()).toStrictEqual([
            await realpath(process.cwd()),
          ]);
        });

        it('prefers the process cwd over the neutral directory when repo is explicit', async () => {
          const shim = await newShim();

          await withGhOnPath(shim.binDir, () =>
            executeGitHubOp('pr.create', { ...PR_PARAMS, repo: REPO }, SIGNAL),
          );

          expect(await shim.readCwds()).toStrictEqual([
            await realpath(process.cwd()),
          ]);
        });

        it('prefers an existing workspace directory over the process cwd', async () => {
          const shim = await newShim();
          const workspace = await newDir('gh4001-workspace-');

          await withGhOnPath(shim.binDir, () =>
            executeGitHubOp('pr.create', PR_PARAMS, SIGNAL, {
              workingDirectory: workspace,
            }),
          );

          expect(await shim.readCwds()).toStrictEqual([
            await realpath(workspace),
          ]);
        });

        it('falls through a missing workspace directory to the process cwd', async () => {
          const shim = await newShim();
          const missing = join(
            await newDir('gh4001-parent-'),
            'does-not-exist',
          );

          await withGhOnPath(shim.binDir, () =>
            executeGitHubOp('pr.create', PR_PARAMS, SIGNAL, {
              workingDirectory: missing,
            }),
          );

          expect(await shim.readCwds()).toStrictEqual([
            await realpath(process.cwd()),
          ]);
        });

        it('falls through a workspace path that is a file to the process cwd', async () => {
          const shim = await newShim();
          const file = join(await newDir('gh4001-parent-'), 'a-file');
          await writeFile(file, 'not a directory');

          await withGhOnPath(shim.binDir, () =>
            executeGitHubOp('pr.create', PR_PARAMS, SIGNAL, {
              workingDirectory: file,
            }),
          );

          expect(await shim.readCwds()).toStrictEqual([
            await realpath(process.cwd()),
          ]);
        });

        it('runs every step of a multi-step op in the workspace directory', async () => {
          const shim = await newShim();
          const workspace = await newDir('gh4001-workspace-');

          const result = await withGhOnPath(shim.binDir, () =>
            executeGitHubOp(
              'issue.edit',
              { number: 1, addLabel: ['x'], type: 'Bug', repo: REPO },
              SIGNAL,
              { workingDirectory: workspace },
            ),
          );

          expect(result).toStrictEqual({ number: 1, type: 'Bug' });
          const cwds = await shim.readCwds();
          expect(cwds).toHaveLength(4);
          expect(new Set(cwds)).toStrictEqual(
            new Set([await realpath(workspace)]),
          );
        });

        it('records the resolved cwd in the failure debug line', async () => {
          const shim = await newShim({ failWith: 'gh blew up 4001' });
          const workspace = await newDir('gh4001-workspace-');
          const lines: string[] = [];
          const original = DebugLogger.prototype.debug;
          DebugLogger.prototype.debug = function patched(
            this: DebugLogger,
            messageOrFn: string | (() => string),
          ): void {
            if (this.namespace !== 'llxprt:github:broker') return;
            lines.push(
              typeof messageOrFn === 'function' ? messageOrFn() : messageOrFn,
            );
          };
          try {
            await expect(
              withGhOnPath(shim.binDir, () =>
                executeGitHubOp(
                  'issue.comment',
                  { number: 1, body: 'x', repo: REPO },
                  SIGNAL,
                  { workingDirectory: workspace },
                ),
              ),
            ).rejects.toThrow('gh blew up 4001');
          } finally {
            DebugLogger.prototype.debug = original;
          }

          expect(lines).toHaveLength(1);
          expect(lines[0]).toContain(`cwd=${workspace}`);
        });
      });
    },
  );
});
