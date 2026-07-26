/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, afterEach } from 'vitest';

/**
 * Shared temp-fixture helper per dev-docs/RULES.md: one line of setup per
 * describe block instead of duplicated beforeEach/afterEach hooks.
 * Returns a lazy temp directory accessor and auto-cleans on afterEach.
 */
export function createTempDirHelper(): () => string {
  let dir: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'llxprt-rn-'));
  });

  afterEach(() => {
    if (dir !== undefined) {
      rmSync(dir, { recursive: true, force: true });
    }
    dir = undefined;
  });

  return () => {
    if (dir === undefined) {
      throw new Error('createTempDirHelper accessor called outside a test');
    }
    return dir;
  };
}

/**
 * Write a file inside a temp directory created by createTempDirHelper.
 */
export function writeTempFile(
  dir: string,
  relativePath: string,
  content: string,
): string {
  const fullPath = join(dir, relativePath);
  writeFileSync(fullPath, content, 'utf-8');
  return fullPath;
}

/**
 * Creates and initializes an isolated git repository in a temp directory,
 * changing the process working directory so that git-port functions (which
 * use cwd implicitly) operate on the temp repo. Returns a lazy directory
 * accessor. Auto-restores cwd and removes the temp repo on afterEach.
 *
 * Extracted from git-port.test.ts and processing.test.ts per dev-docs/RULES.md
 * shared-setup requirements.
 */
export function useTempRepo(prefix = 'llxprt-git'): () => string {
  let dir: string | undefined;
  let originalCwd: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), `${prefix}-`));
    originalCwd = process.cwd();
    process.chdir(dir);
    execFileSync('git', ['init', '--initial-branch=main'], {
      encoding: 'utf8',
    });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], {
      encoding: 'utf8',
    });
    execFileSync('git', ['config', 'user.name', 'Test'], { encoding: 'utf8' });
    execFileSync('git', ['config', 'commit.gpgsign', 'false'], {
      encoding: 'utf8',
    });
  });

  afterEach(() => {
    if (originalCwd !== undefined) {
      process.chdir(originalCwd);
    }
    if (dir !== undefined) {
      rmSync(dir, { recursive: true, force: true });
    }
    dir = undefined;
    originalCwd = undefined;
  });

  return () => {
    if (dir === undefined) {
      throw new Error('useTempRepo accessor called outside a test');
    }
    return dir;
  };
}

/**
 * Creates a commit in the git repo at `dir` by writing a stamp file, staging
 * all changes, and committing with the given message. Returns the full commit
 * hash.
 */
export function gitCommit(dir: string, message: string): string {
  const stampFile = join(dir, `.stamp-${Date.now()}-${Math.random()}`);
  writeFileSync(stampFile, String(Math.random()));
  execFileSync('git', ['add', '.'], { encoding: 'utf8' });
  execFileSync('git', ['commit', '-m', message], {
    encoding: 'utf8',
  });
  return execFileSync('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim();
}

/**
 * Merges `branchToMerge` into the current branch with --no-ff and the given
 * commit message. Returns the full merge commit hash.
 */
export function gitMerge(
  dir: string,
  message: string,
  branchToMerge: string,
): string {
  void dir;
  execFileSync('git', ['merge', '--no-ff', '-m', message, branchToMerge], {
    encoding: 'utf8',
  });
  return execFileSync('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim();
}
