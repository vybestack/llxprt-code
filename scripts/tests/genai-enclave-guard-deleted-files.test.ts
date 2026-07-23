/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for genai-enclave guard file discovery — specifically
 * that tracked-but-deleted files (staged or unstaged) are excluded from
 * scanning so the guard does not fail-closed on ENOENT for a file that
 * was intentionally removed from the worktree (#2606 / issue #2352).
 *
 * These tests create REAL temporary git repositories (no mock theater) and
 * invoke git commands to produce actual `git ls-files` and `git status`
 * outputs, then verify the discovery helper correctly classifies paths.
 *
 * Per RULES.md: behavioral tests asserting on observable outcomes
 * (which files are discovered / excluded), not implementation details.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  collectDeletedPaths,
  discoverScannableFiles,
  rel,
} from '../genai-enclave/file-discovery.ts';

// ─── Helpers ────────────────────────────────────────────────────────────────

interface TempGitRepo {
  readonly root: string;
  /** Run a git command inside the repo. */
  git(args: string[]): string;
  /** Write a file inside the repo. */
  write(relPath: string, content: string): void;
}

const tempRepos: string[] = [];

function createTempGitRepo(): TempGitRepo {
  const root = mkdtempSync(join(tmpdir(), 'genai-discovery-'));
  tempRepos.push(root);

  function git(args: string[]): string {
    return execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  }

  // Initialize repo with identity
  git(['init']);
  git(['config', 'user.email', 'test@test.test']);
  git(['config', 'user.name', 'Test']);

  return {
    root,
    git,
    write(relPath: string, content: string): void {
      const full = join(root, relPath);
      mkdirSync(join(full, '..'), { recursive: true });
      writeFileSync(full, content);
    },
  };
}

afterEach(() => {
  const errors: string[] = [];
  for (const repo of tempRepos.splice(0)) {
    try {
      rmSync(repo, { recursive: true, force: true });
    } catch (e) {
      errors.push(
        `Failed to clean up ${repo}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  if (errors.length > 0) {
    throw new Error(
      `Temp repo cleanup failed (${errors.length} error(s)): ${errors.join('; ')}`,
    );
  }
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('genai-enclave discovery — deleted file exclusion', () => {
  it('excludes an unstaged-deleted tracked file from discovery', () => {
    const repo = createTempGitRepo();
    // Create and commit a normal source file
    repo.write('packages/cli/src/normal.ts', 'export const x = 1;\n');
    // Create and commit a file that will be deleted in the worktree
    repo.write(
      'packages/providers/src/auth/migration.ts',
      'export const y = 2;\n',
    );
    repo.git(['add', '.']);
    repo.git(['commit', '-m', 'initial']);

    // Delete the file from the working tree (unstaged deletion: " D")
    rmSync(join(repo.root, 'packages/providers/src/auth/migration.ts'));

    const result = discoverScannableFiles(repo.root);

    expect(result.errors).toEqual([]);
    const discoveredRelPaths = result.files.map((f) => rel(repo.root, f));
    // The deleted file must NOT be in the discovery set
    expect(discoveredRelPaths).not.toContain(
      'packages/providers/src/auth/migration.ts',
    );
    // The normal file MUST still be discovered
    expect(discoveredRelPaths).toContain('packages/cli/src/normal.ts');
  });

  it('excludes a staged-deleted tracked file from discovery', () => {
    const repo = createTempGitRepo();
    repo.write('packages/cli/src/keep.ts', 'export const x = 1;\n');
    repo.write('packages/providers/src/dead.ts', 'export const y = 2;\n');
    repo.git(['add', '.']);
    repo.git(['commit', '-m', 'initial']);

    // Stage the deletion: "D " (deleted in index)
    repo.git(['rm', 'packages/providers/src/dead.ts']);

    const result = discoverScannableFiles(repo.root);

    expect(result.errors).toEqual([]);
    const discoveredRelPaths = result.files.map((f) => rel(repo.root, f));
    expect(discoveredRelPaths).not.toContain('packages/providers/src/dead.ts');
    expect(discoveredRelPaths).toContain('packages/cli/src/keep.ts');
  });

  it('includes untracked non-ignored existing files alongside tracked files', () => {
    const repo = createTempGitRepo();
    repo.write('packages/cli/src/tracked.ts', 'export const x = 1;\n');
    repo.git(['add', '.']);
    repo.git(['commit', '-m', 'initial']);

    // Create a new untracked file (exists on disk, not in git index)
    repo.write('packages/cli/src/untracked.ts', 'export const z = 3;\n');

    const result = discoverScannableFiles(repo.root);

    expect(result.errors).toEqual([]);
    const discoveredRelPaths = result.files.map((f) => rel(repo.root, f));
    expect(discoveredRelPaths).toContain('packages/cli/src/tracked.ts');
    expect(discoveredRelPaths).toContain('packages/cli/src/untracked.ts');
  });

  it('includes both tracked and untracked when no deletions exist', () => {
    const repo = createTempGitRepo();
    repo.write('packages/core/src/a.ts', 'export const a = 1;\n');
    repo.git(['add', '.']);
    repo.git(['commit', '-m', 'initial']);
    repo.write('packages/core/src/b.ts', 'export const b = 2;\n');

    const result = discoverScannableFiles(repo.root);
    expect(result.errors).toEqual([]);
    expect(result.files.length).toBeGreaterThanOrEqual(2);
  });

  it('returns errors (fail-closed) when git ls-files fails in a non-repo', () => {
    // Create a temp dir that is NOT a git repo
    const nonRepo = mkdtempSync(join(tmpdir(), 'genai-nonrepo-'));
    tempRepos.push(nonRepo);

    const result = discoverScannableFiles(nonRepo);
    // Must NOT silently pass — discovery failure is an operational error
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('collectDeletedPaths identifies both staged and unstaged deletions', () => {
    const repo = createTempGitRepo();
    repo.write('packages/cli/src/unstaged-delete.ts', 'export const x = 1;\n');
    repo.write('packages/cli/src/staged-delete.ts', 'export const y = 2;\n');
    repo.write('packages/cli/src/keep.ts', 'export const z = 3;\n');
    repo.git(['add', '.']);
    repo.git(['commit', '-m', 'initial']);

    // Unstaged deletion
    rmSync(join(repo.root, 'packages/cli/src/unstaged-delete.ts'));
    // Staged deletion
    repo.git(['rm', 'packages/cli/src/staged-delete.ts']);

    const deleted = collectDeletedPaths(repo.root);
    const deletedRel = [...deleted].sort();
    expect(deletedRel).toEqual([
      'packages/cli/src/staged-delete.ts',
      'packages/cli/src/unstaged-delete.ts',
    ]);
  });
});
