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

import { stat } from 'node:fs/promises';
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

async function isExistingDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
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
 * error raised before gh is spawned.
 *
 * Repo-less operations keep resolving the current repository from the
 * directory chosen in (1) or (2), which is why (3) is repo-gated.
 *
 * @issue 4001
 */
export async function resolveGhWorkingDirectory(
  options: GitHubExecOptions | undefined,
  hasExplicitRepo: boolean,
): Promise<string> {
  const workspace = options?.workingDirectory;
  if (
    workspace !== undefined &&
    workspace.length > 0 &&
    (await isExistingDirectory(workspace))
  ) {
    return workspace;
  }

  const processCwd = readProcessCwd();
  if (processCwd !== undefined && (await isExistingDirectory(processCwd))) {
    return processCwd;
  }

  if (hasExplicitRepo) {
    const neutral = tmpdir();
    if (await isExistingDirectory(neutral)) return neutral;
  }

  throw brokerError(
    'HOST_GH_UNAVAILABLE',
    'The working directory is unavailable: the process working directory no longer exists and no existing session workspace directory was provided, so gh cannot run. Passing "repo" (owner/name) avoids the dependency on a local directory.',
  );
}
