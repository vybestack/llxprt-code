/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Review round 1 for issue #4001.
 *
 * M1: with an explicit repo, `pr.create` still needs a local checkout when
 * `head` is omitted (gh infers the head from the current branch even with
 * --repo/GH_REPO). In the neutral fallback directory that inference fails,
 * or worse picks an unrelated checkout when TMPDIR sits inside one. The
 * broker therefore rejects such a request before gh is spawned and asks for
 * `head`. No other operation infers anything from a checkout: every
 * operation that accepts a `number` requires it.
 *
 * M2: a directory the process cannot enter is not a usable working directory,
 * so the workspace, the process cwd and the temp directory are each verified
 * for read and search access after canonicalisation with realpath.
 *
 * These tests drive the real executeGitHubOp against the recording gh shim.
 * Deleted or locked process cwds are produced in a child process so the test
 * runner keeps a valid cwd. POSIX only; the permission cases are skipped for
 * root, which bypasses file modes.
 *
 * @issue 4001
 */

import { describe, expect, it } from 'bun:test';
import { chmod, realpath, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GITHUB_OP_SPECS } from '@vybestack/llxprt-code-tools/tools/github-ops.js';
import { executeGitHubOp } from '../github-broker.js';
import { PR_URL, withGhOnPath } from './github-broker-cwd-recorder.js';
import {
  captureBrokerDebugLines,
  expectSuccess,
  useIssue4001Fixtures,
} from './github-broker-issue4001-fixtures.js';

const SIGNAL = new AbortController().signal;
const REPO = 'owner/name';
const WITH_HEAD = { title: 'T', body: 'B', base: 'main', head: 'feature' };
const WITHOUT_HEAD = { title: 'T', body: 'B', base: 'main' };

const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;

describe.skipIf(process.platform === 'win32')(
  'issue #4001 review round 1 (POSIX)',
  () => {
    const { newShim, newDir, newRepoDir, runInChild } = useIssue4001Fixtures();

    /** Runs `fn` with `dir` at mode 0o000, restoring it even on failure. */
    async function withLockedDir<T>(
      dir: string,
      fn: () => Promise<T>,
    ): Promise<T> {
      await chmod(dir, 0o000);
      try {
        return await fn();
      } finally {
        await chmod(dir, 0o700);
      }
    }

    describe('M1: head is required when no checkout is available', () => {
      it('rejects pr.create without head before spawning gh when the cwd is gone and only repo is named', async () => {
        const shim = await newShim();

        const output = await runInChild(shim, {
          op: 'pr.create',
          params: { ...WITHOUT_HEAD, repo: REPO },
        });

        expect(output.outcome.ok).toBe(false);
        if (output.outcome.ok) return;
        expect(output.outcome.code).toBe('INVALID_PARAM');
        expect(output.outcome.message).toMatch(
          /working directory is unavailable/i,
        );
        expect(output.outcome.message).toMatch(
          /head branch cannot be inferred/i,
        );
        expect(output.outcome.message).toMatch(/pass "head"/i);
        expect(await shim.readCwds()).toStrictEqual([]);
      });

      it('treats an empty head like a missing head', async () => {
        const shim = await newShim();

        const output = await runInChild(shim, {
          op: 'pr.create',
          params: { ...WITHOUT_HEAD, head: '', repo: REPO },
        });

        expect(output.outcome.ok).toBe(false);
        expect(await shim.readCwds()).toStrictEqual([]);
      });

      it('still runs pr.create with head in the neutral directory', async () => {
        const shim = await newShim();

        const output = await runInChild(shim, {
          op: 'pr.create',
          params: { ...WITH_HEAD, repo: REPO },
        });

        expect(expectSuccess(output).url).toBe(PR_URL);
        expect(await shim.readCwds()).toStrictEqual([await realpath(tmpdir())]);
      });

      it('does not require head when a usable workspace directory exists', async () => {
        const shim = await newShim();
        const workspace = await newRepoDir('gh4001-workspace-');

        const output = await runInChild(shim, {
          op: 'pr.create',
          params: { ...WITHOUT_HEAD, repo: REPO },
          workingDirectory: workspace,
        });

        expect(expectSuccess(output).url).toBe(PR_URL);
        expect(await shim.readCwds()).toStrictEqual([
          await realpath(workspace),
        ]);
      });

      it('does not require head when the process cwd is usable', async () => {
        const shim = await newShim();

        const result = await withGhOnPath(shim.binDir, () =>
          executeGitHubOp('pr.create', { ...WITHOUT_HEAD, repo: REPO }, SIGNAL),
        );

        expect(result.url).toBe(PR_URL);
        expect(await shim.readCwds()).toStrictEqual([
          await realpath(process.cwd()),
        ]);
      });

      it('has no other operation that infers its target from the current branch', () => {
        const optionalNumberOps = Object.entries(GITHUB_OP_SPECS)
          .filter(
            ([, spec]) =>
              'number' in spec.params && !spec.required.includes('number'),
          )
          .map(([name]) => name);

        expect(optionalNumberOps).toStrictEqual([]);
      });
    });

    describe('M2: working directories must be accessible', () => {
      it.skipIf(isRoot)(
        'falls through a workspace the process cannot enter to the process cwd',
        async () => {
          const shim = await newShim();
          const locked = await newDir('gh4001-locked-');

          await withLockedDir(locked, () =>
            withGhOnPath(shim.binDir, () =>
              executeGitHubOp('pr.create', WITH_HEAD, SIGNAL, {
                workingDirectory: locked,
              }),
            ),
          );

          expect(await shim.readCwds()).toStrictEqual([
            await realpath(process.cwd()),
          ]);
        },
      );

      it.skipIf(isRoot)(
        'falls through an inaccessible workspace to the neutral directory when the process cwd is gone',
        async () => {
          const shim = await newShim();
          const locked = await newDir('gh4001-locked-');

          const output = await withLockedDir(locked, () =>
            runInChild(shim, {
              op: 'pr.create',
              params: { ...WITH_HEAD, repo: REPO },
              workingDirectory: locked,
            }),
          );

          expect(expectSuccess(output).url).toBe(PR_URL);
          expect(await shim.readCwds()).toStrictEqual([
            await realpath(tmpdir()),
          ]);
        },
      );

      it.skipIf(isRoot)(
        'falls through an inaccessible process cwd to the neutral directory when repo is named',
        async () => {
          const shim = await newShim();

          const output = await runInChild(shim, {
            op: 'pr.create',
            params: { ...WITH_HEAD, repo: REPO },
            cwdState: 'inaccessible',
          });

          expect(expectSuccess(output).url).toBe(PR_URL);
          expect(await shim.readCwds()).toStrictEqual([
            await realpath(tmpdir()),
          ]);
        },
      );

      it.skipIf(isRoot)(
        'reports the working directory as unavailable when the process cwd is inaccessible and no repo is named',
        async () => {
          const shim = await newShim();

          const output = await runInChild(shim, {
            op: 'pr.create',
            params: WITH_HEAD,
            cwdState: 'inaccessible',
          });

          expect(output.outcome.ok).toBe(false);
          if (output.outcome.ok) return;
          expect(output.outcome.code).toBe('HOST_GH_UNAVAILABLE');
          expect(output.outcome.message).toMatch(/working directory/i);
          expect(await shim.readCwds()).toStrictEqual([]);
        },
      );

      it.skipIf(isRoot)(
        'reports the working directory as unavailable when the temp directory is inaccessible too',
        async () => {
          const shim = await newShim();

          const output = await runInChild(shim, {
            op: 'pr.create',
            params: { ...WITH_HEAD, repo: REPO },
            tmpdirState: 'inaccessible',
          });

          expect(output.outcome.ok).toBe(false);
          if (output.outcome.ok) return;
          expect(output.outcome.code).toBe('HOST_GH_UNAVAILABLE');
          expect(await shim.readCwds()).toStrictEqual([]);
        },
      );

      it('runs in the canonical path of a workspace given as a symlink', async () => {
        const shim = await newShim({ failWith: 'gh blew up 4001' });
        const target = await newRepoDir('gh4001-target-');
        const link = join(await newDir('gh4001-links-'), 'workspace-link');
        await symlink(target, link);

        const { lines } = await captureBrokerDebugLines(() =>
          withGhOnPath(shim.binDir, () =>
            executeGitHubOp(
              'issue.comment',
              { number: 1, body: 'x', repo: REPO },
              SIGNAL,
              { workingDirectory: link },
            ),
          ),
        );

        expect(lines).toHaveLength(1);
        expect(lines[0]).toContain(`cwd=${await realpath(target)} `);
        expect(lines[0]).not.toContain(link);
        expect(await shim.readCwds()).toStrictEqual([await realpath(target)]);
      });

      it('falls through a workspace symlink whose target was deleted', async () => {
        const shim = await newShim();
        const target = await newDir('gh4001-target-');
        const link = join(await newDir('gh4001-links-'), 'dangling-link');
        await symlink(target, link);
        await rm(target, { recursive: true, force: true });

        await withGhOnPath(shim.binDir, () =>
          executeGitHubOp('pr.create', WITH_HEAD, SIGNAL, {
            workingDirectory: link,
          }),
        );

        expect(await shim.readCwds()).toStrictEqual([
          await realpath(process.cwd()),
        ]);
      });
    });
  },
);
