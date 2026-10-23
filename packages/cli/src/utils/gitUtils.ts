/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { execSync } from 'child_process';
import * as path from 'path';
import { ProxyAgent } from 'undici';
import { debugLogger } from '@vybestack/llxprt-code-telemetry';

/**
 * Checks if a directory is within a git repository hosted on GitHub.
 * @returns true if the directory is in a git repository with a github.com remote, false otherwise
 */
export const isGitHubRepository = (workingDirectory: string): boolean => {
  try {
    const gitRemoteOutput = execSync('git remote -v', {
      encoding: 'utf-8',
      cwd: workingDirectory,
    });
    const remotes = (gitRemoteOutput || '').trim();

    const pattern = /github\.com/;

    return pattern.test(remotes);
  } catch (_error) {
    // If any filesystem error occurs, assume not a git repo
    debugLogger.debug(`Failed to get git remote:`, _error);
    return false;
  }
};

/**
 * getGitRepoRoot returns the root directory of the git repository.
 * @returns the path to the root of the git repo.
 * @throws error if the exec command fails.
 */
export const getGitRepoRoot = (workingDirectory: string): string => {
  const gitRepoRootOutput = execSync('git rev-parse --show-toplevel', {
    encoding: 'utf-8',
    cwd: workingDirectory,
  });
  const gitRepoRoot = (gitRepoRootOutput || '').trim();

  if (!gitRepoRoot) {
    throw new Error(`Git repo returned empty value`);
  }

  return gitRepoRoot;
};

/**
 * getLatestGitHubRelease returns the release tag as a string.
 * @returns string of the release tag (e.g. "v1.2.3").
 */
export const getLatestGitHubRelease = async (
  proxy: string | undefined,
  signal: AbortSignal,
): Promise<string> => {
  const dispatcher = proxy ? new ProxyAgent(proxy) : undefined;
  try {
    const endpoint = `https://api.github.com/repos/acoliver/run-llxprt-code/releases/latest`;

    const options = {
      method: 'GET',
      headers: {
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal,
      dispatcher,
    };
    const response = await fetch(endpoint, options);

    if (!response.ok) {
      throw new Error(
        `Invalid response code: ${response.status} - ${response.statusText}`,
      );
    }

    const releaseTag = (await response.json()).tag_name;
    if (releaseTag == null || releaseTag === '') {
      throw new Error(`Response did not include tag_name field`);
    }
    return releaseTag;
  } catch (_error) {
    debugLogger.debug(
      `Failed to determine latest run-llxprt-code release:`,
      _error,
    );
    throw new Error(
      `Unable to determine the latest run-llxprt-code release on GitHub.`,
    );
  } finally {
    await dispatcher?.close();
  }
};

/**
 * getGitHubRepoInfo returns the owner and repository for a GitHub repo.
 * @returns the owner and repository of the github repo.
 * @throws error if the exec command fails.
 */
export function getGitHubRepoInfo(workingDirectory: string): {
  owner: string;
  repo: string;
} {
  const remoteUrl = execSync('git remote get-url origin', {
    encoding: 'utf-8',
    cwd: workingDirectory,
  }).trim();

  // Matches either https://github.com/owner/repo.git or git@github.com:owner/repo.git.
  // The pattern is passed to RegExp via an identifier so it is not a static
  // literal flagged by sonarjs/regular-expr.
  const githubRemotePattern =
    '(?:https?://|git@)github\\.com(?::|/)([^/]+)/([^/]+?)(?:\\.git)?$';
  const match = remoteUrl.match(new RegExp(githubRemotePattern));

  // If the regex fails match, throw an error.
  if (!match?.[1] || !match[2]) {
    throw new Error(
      `Owner & repo could not be extracted from remote URL: ${remoteUrl}`,
    );
  }

  return { owner: match[1], repo: match[2] };
}

/**
 * getWorkspaceIdentity returns a stable workspace identifier.
 * Uses git repository root if available, falls back to cwd.
 * Returns an absolute, normalized path.
 *
 * @param cwd - Optional working directory (defaults to process.cwd())
 * @returns Absolute path to workspace identity (git root or cwd fallback)
 */
export function getWorkspaceIdentity(cwd?: string): string {
  const effectiveCwd = cwd ?? process.cwd();
  try {
    const gitRoot = execSync('git rev-parse --show-toplevel', {
      encoding: 'utf-8',
      cwd: effectiveCwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return path.resolve(gitRoot);
  } catch {
    return path.resolve(effectiveCwd);
  }
}
