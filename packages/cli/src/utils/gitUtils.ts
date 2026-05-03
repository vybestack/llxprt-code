/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { execSync } from 'child_process';
import * as path from 'path';
import { ProxyAgent, setGlobalDispatcher } from 'undici';
import { debugLogger } from '@vybestack/llxprt-code-core';

/**
 * Checks if a directory is within a git repository hosted on GitHub.
 * @returns true if the directory is in a git repository with a github.com remote, false otherwise
 */
export const isGitHubRepository = (): boolean => {
  try {
    const remotes = (
      // eslint-disable-next-line sonarjs/no-os-command-from-path -- Project intentionally invokes platform tooling at this trusted boundary; arguments remain explicit and behavior is preserved.
      execSync('git remote -v', {
        encoding: 'utf-8',
      }) || ''
    ).trim();

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
export const getGitRepoRoot = (): string => {
  const gitRepoRoot = (
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- Project intentionally invokes platform tooling at this trusted boundary; arguments remain explicit and behavior is preserved.
    execSync('git rev-parse --show-toplevel', {
      encoding: 'utf-8',
    }) || ''
  ).trim();

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
  proxy?: string,
): Promise<string> => {
  try {
    const controller = new AbortController();
    if (proxy) {
      setGlobalDispatcher(new ProxyAgent(proxy));
    }

    const endpoint = `https://api.github.com/repos/acoliver/run-llxprt-code/releases/latest`;

    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: controller.signal,
    });

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
  }
};

/**
 * getGitHubRepoInfo returns the owner and repository for a GitHub repo.
 * @returns the owner and repository of the github repo.
 * @throws error if the exec command fails.
 */
export function getGitHubRepoInfo(): { owner: string; repo: string } {
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- Project intentionally invokes platform tooling at this trusted boundary; arguments remain explicit and behavior is preserved.
  const remoteUrl = execSync('git remote get-url origin', {
    encoding: 'utf-8',
  }).trim();

  // Matches either https://github.com/owner/repo.git or git@github.com:owner/repo.git
  const match = remoteUrl.match(
    // eslint-disable-next-line sonarjs/regular-expr -- Static regex reviewed for lint hardening; behavior preserved.
    /(?:https?:\/\/|git@)github\.com(?::|\/)([^/]+)\/([^/]+?)(?:\.git)?$/,
  );

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
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- Project intentionally invokes platform tooling at this trusted boundary; arguments remain explicit and behavior is preserved.
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
