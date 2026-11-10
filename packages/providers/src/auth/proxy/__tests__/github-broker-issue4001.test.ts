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

import { describe, expect, it } from 'bun:test';
import { realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executeGitHubOp } from '../github-broker.js';
import { PR_URL, withGhOnPath } from './github-broker-cwd-recorder.js';
import {
  captureBrokerDebugLines,
  expectSuccess,
  useIssue4001Fixtures,
} from './github-broker-issue4001-fixtures.js';

const SIGNAL = new AbortController().signal;

const PR_PARAMS = { title: 'T', body: 'B', base: 'main', head: 'feature' };
const REPO = 'owner/name';

describe('issue #4001: gh runs in an existing working directory', () => {
  const { newShim, newDir, newRepoDir, runInChild } = useIssue4001Fixtures();

  describe.skipIf(process.platform === 'win32')(
    'recording gh shim (POSIX)',
    () => {
      describe('process cwd deleted', () => {
        it('runs pr.create in a neutral existing directory when repo is explicit', async () => {
          const shim = await newShim();

          const output = await runInChild(shim, {
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
          const workspace = await newRepoDir('gh4001-workspace-');

          const output = await runInChild(shim, {
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

          const output = await runInChild(shim, {
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

          const output = await runInChild(shim, {
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

          const output = await runInChild(shim, {
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

          const output = await runInChild(shim, {
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
          const workspace = await newRepoDir('gh4001-workspace-');

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
          const { lines, error } = await captureBrokerDebugLines(() =>
            withGhOnPath(shim.binDir, () =>
              executeGitHubOp(
                'issue.comment',
                { number: 1, body: 'x', repo: REPO },
                SIGNAL,
                { workingDirectory: workspace },
              ),
            ),
          );

          expect(String(error)).toContain('gh blew up 4001');
          expect(lines).toHaveLength(1);
          expect(lines[0]).toContain(`cwd=${workspace}`);
        });
      });
    },
  );
});
