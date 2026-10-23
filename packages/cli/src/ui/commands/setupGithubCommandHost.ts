/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  getGitRepoRoot,
  getLatestGitHubRelease,
  isGitHubRepository,
  getGitHubRepoInfo,
} from '../../utils/gitUtils.js';
import type { GithubSetupOperations } from './setupGithubCommand.js';
export function bindGithubSetup(
  workingDirectory: string,
  proxy: string | undefined,
): GithubSetupOperations {
  return {
    proxy,
    isGitHubRepository: () => isGitHubRepository(workingDirectory),
    getGitRepoRoot: () => getGitRepoRoot(workingDirectory),
    getRepoInfo: () => getGitHubRepoInfo(workingDirectory),
    getRelease: (signal) => getLatestGitHubRelease(proxy, signal),
  };
}
