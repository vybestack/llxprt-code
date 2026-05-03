/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { promises as fsPromises } from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import type { RepositoryContext } from './types.js';

const GIT_TIMEOUT_MS = 3000;
const GIT_MAX_BUFFER = 1024 * 1024;

/**
 * RepositoryContextProvider handles git operations to collect repository context.
 */
export class RepositoryContextProvider {
  async collectRepositoryContext(
    rootPath: string,
  ): Promise<RepositoryContext | null> {
    try {
      const gitUrl = await this.getGitRemoteUrl(rootPath);
      const commitSha = await this.getCurrentCommit(rootPath);
      const branch = await this.getCurrentBranch(rootPath);

      if (!gitUrl && !commitSha) {
        return null; // Not a git repo or failed to get info
      }

      return {
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing: git command output fallback
        gitUrl: gitUrl || 'unknown',
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing: git command output fallback
        commitSha: commitSha || 'unknown',
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing: git command output fallback
        branch: branch || 'unknown',
        rootPath,
      };
    } catch {
      // Git info unavailable; not a git repo.
      return null;
    }
  }

  /**
   * Get the "Working Set" of files:
   * 1. Unstaged changes (git diff --name-only)
   * 2. Staged changes (git diff --name-only --cached)
   * 3. Recent commits (git log -n <limit> --name-only)
   */
  async getWorkingSetFiles(
    workspaceRoot: string,
    limit: number = 5,
  ): Promise<string[]> {
    const files = new Set<string>();

    try {
      const execGit = (args: string[]) => {
        // eslint-disable-next-line sonarjs/no-os-command-from-path -- Project intentionally invokes platform tooling at this trusted boundary; arguments remain explicit and behavior is preserved.
        const result = spawnSync('git', ['-C', workspaceRoot, ...args], {
          encoding: 'utf-8',
          stdio: 'pipe',
          timeout: GIT_TIMEOUT_MS,
          maxBuffer: GIT_MAX_BUFFER,
        });
        return result.status === 0 ? result.stdout.trim() : '';
      };

      // 1. Unstaged changes
      execGit(['diff', '--name-only', '-z'])
        .split('\0')
        .forEach((f) => f && files.add(f));

      // 2. Staged changes
      execGit(['diff', '--name-only', '--cached', '-z'])
        .split('\0')
        .forEach((f) => f && files.add(f));

      // 3. Recent commits
      // Note: -z works with --name-only in log but we need to ensure format doesn't break it.
      // Safest is to rely on diffs for working set, but strictly following plan:
      execGit(['log', `-n${limit}`, '--name-only', '--format=', '-z'])
        .split('\0')
        .forEach((f) => f && files.add(f));
    } catch {
      // Git command failed; return what we have.
    }

    // Filter existing files and convert to absolute paths
    const validFiles: string[] = [];
    for (const file of files) {
      if (!file.trim()) continue;
      const absPath = path.resolve(workspaceRoot, file);
      try {
        await fsPromises.access(absPath);
        validFiles.push(absPath);
      } catch {
        // File might be deleted
      }
    }

    return validFiles;
  }

  private async getGitRemoteUrl(repoPath: string): Promise<string | null> {
    try {
      const result = spawnSync(
        // eslint-disable-next-line sonarjs/no-os-command-from-path -- Project intentionally invokes platform tooling at this trusted boundary; arguments remain explicit and behavior is preserved.
        'git',
        ['-C', repoPath, 'remote', 'get-url', 'origin'],
        {
          encoding: 'utf-8',
          stdio: 'pipe',
          timeout: GIT_TIMEOUT_MS,
          maxBuffer: GIT_MAX_BUFFER,
        },
      );
      return result.status === 0 ? result.stdout.trim() : null;
    } catch {
      return null;
    }
  }

  private async getCurrentCommit(repoPath: string): Promise<string | null> {
    try {
      // eslint-disable-next-line sonarjs/no-os-command-from-path -- Project intentionally invokes platform tooling at this trusted boundary; arguments remain explicit and behavior is preserved.
      const result = spawnSync('git', ['-C', repoPath, 'rev-parse', 'HEAD'], {
        encoding: 'utf-8',
        stdio: 'pipe',
        timeout: GIT_TIMEOUT_MS,
        maxBuffer: GIT_MAX_BUFFER,
      });
      return result.status === 0 ? result.stdout.trim() : null;
    } catch {
      return null;
    }
  }

  private async getCurrentBranch(repoPath: string): Promise<string | null> {
    try {
      const result = spawnSync(
        // eslint-disable-next-line sonarjs/no-os-command-from-path -- Project intentionally invokes platform tooling at this trusted boundary; arguments remain explicit and behavior is preserved.
        'git',
        ['-C', repoPath, 'branch', '--show-current'],
        {
          encoding: 'utf-8',
          stdio: 'pipe',
          timeout: GIT_TIMEOUT_MS,
          maxBuffer: GIT_MAX_BUFFER,
        },
      );
      return result.status === 0 ? result.stdout.trim() : null;
    } catch {
      return null;
    }
  }
}
