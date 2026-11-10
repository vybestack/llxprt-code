/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Working-directory resolution for the `gh` child process.
 *
 * `gh` runs `git` for several operations (pr.create does so even with
 * --repo/--head/--base), and `git` dies with "Unable to read current working
 * directory" when its inherited cwd has been deleted. The broker therefore
 * never lets the child inherit a cwd: every invocation gets an explicit,
 * existing directory chosen here.
 *
 * @issue 4001
 */

import { constants } from 'node:fs';
import { access, realpath, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';

import { brokerError } from './github-broker-errors.js';

/**
 * Host-side options for one brokered operation. Deliberately not part of the
 * op parameters or of the socket payload: the model cannot set them and the
 * sandbox transport never carries them.
 *
 * @issue 4001
 */
export interface GitHubExecOptions {
  /**
   * The session workspace directory. Used when it is an existing directory;
   * otherwise resolution falls through to the process cwd.
   */
  readonly workingDirectory?: string;
}

/**
 * Canonicalises `path` and verifies the process can list and enter it.
 * `stat` alone accepts a directory (mode 0o000, say) that gh and git cannot
 * use, so access is checked explicitly. Returns the canonical path, or
 * undefined for anything that is missing, not a directory, or inaccessible.
 */
async function usableDirectory(path: string): Promise<string | undefined> {
  try {
    const canonical = await realpath(path);
    if (!(await stat(canonical)).isDirectory()) return undefined;
    await access(canonical, constants.R_OK | constants.X_OK);
    return canonical;
  } catch {
    return undefined;
  }
}

/**
 * The directory chosen for one operation. `neutral` is true only for the
 * temp-directory fallback, where no local checkout is available.
 */
export interface ResolvedGhDirectory {
  readonly cwd: string;
  readonly neutral: boolean;
}

/** `process.cwd()` throws ENOENT once the directory has been removed. */
function readProcessCwd(): string | undefined {
  try {
    return process.cwd();
  } catch {
    return undefined;
  }
}

/**
 * Picks the directory every gh child of one operation runs in.
 *
 * Order: (1) the supplied session workspace directory, (2) the process cwd,
 * (3) the OS temp directory when the operation names an explicit repo (so gh
 * relies on GH_REPO/--repo rather than local git state), (4) a structured
 * error raised before gh is spawned. A candidate is used only when it exists
 * and the process can read and enter it; the returned path is canonical
 * (realpath), and `neutral` marks the temp-directory fallback.
 *
 * Repo-less operations keep resolving the current repository from the
 * directory chosen in (1) or (2), which is why (3) is repo-gated.
 *
 * @issue 4001
 */
export async function resolveGhWorkingDirectory(
  options: GitHubExecOptions | undefined,
  hasExplicitRepo: boolean,
): Promise<ResolvedGhDirectory> {
  const workspace = options?.workingDirectory;
  if (workspace !== undefined && workspace.length > 0) {
    const usable = await usableDirectory(workspace);
    if (usable !== undefined) return { cwd: usable, neutral: false };
  }

  const processCwd = readProcessCwd();
  if (processCwd !== undefined) {
    const usable = await usableDirectory(processCwd);
    if (usable !== undefined) return { cwd: usable, neutral: false };
  }

  if (hasExplicitRepo) {
    const usable = await usableDirectory(tmpdir());
    if (usable !== undefined) return { cwd: usable, neutral: true };
  }

  throw brokerError(
    'HOST_GH_UNAVAILABLE',
    'The working directory is unavailable: the process working directory is missing or inaccessible and no usable session workspace directory was provided, so gh cannot run. Passing "repo" (owner/name) avoids the dependency on a local directory.',
  );
}

/**
 * Rejects, before gh is spawned, a request that still needs a local checkout
 * although only the neutral fallback directory is available.
 *
 * `pr.create` without `head` makes gh infer the head branch from the current
 * checkout, even with --repo/GH_REPO set. In the fallback directory that
 * inference fails, or worse, silently picks an unrelated checkout when TMPDIR
 * lies inside one. Every other operation either carries an explicit `number`
 * (all operations that accept one require it) or lists/creates against the
 * explicit repo, so none of them reads local git state.
 *
 * @issue 4001
 */
export function assertNoCheckoutNeeded(
  op: string,
  params: Record<string, unknown>,
  directory: ResolvedGhDirectory,
): void {
  if (!directory.neutral || op !== 'pr.create') return;
  if (typeof params.head === 'string' && params.head.length > 0) return;
  throw brokerError(
    'INVALID_PARAM',
    'The working directory is unavailable, so the head branch cannot be inferred from a local checkout. Pass "head" (the branch to open the pull request from) to run pr.create without one.',
  );
}
