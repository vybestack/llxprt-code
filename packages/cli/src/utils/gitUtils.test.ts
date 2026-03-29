/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi, describe, expect, it, afterEach, beforeEach } from 'vitest';
import * as child_process from 'child_process';
import {
  isGitHubRepository,
  getGitRepoRoot,
  getLatestGitHubRelease,
  getGitHubRepoInfo,
  getWorkspaceIdentity,
} from './gitUtils.js';

vi.mock('child_process');

describe('isGitHubRepository', async () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns false if the git command fails', async () => {
    vi.mocked(child_process.execSync).mockImplementation((): string => {
      throw new Error('oops');
    });
    expect(isGitHubRepository()).toBe(false);
  });

  it('returns false if the remote is not github.com', async () => {
    vi.mocked(child_process.execSync).mockReturnValueOnce('https://gitlab.com');
    expect(isGitHubRepository()).toBe(false);
  });

  it('returns true if the remote is github.com', async () => {
    vi.mocked(child_process.execSync).mockReturnValueOnce(`
      origin  https://github.com/acoliver/llxprt-code (fetch)
      origin  https://github.com/acoliver/llxprt-code (push)
    `);
    expect(isGitHubRepository()).toBe(true);
  });
});

describe('getGitHubRepoInfo', async () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('throws an error if github repo info cannot be determined', async () => {
    vi.mocked(child_process.execSync).mockImplementation((): string => {
      throw new Error('oops');
    });
    expect(() => {
      getGitHubRepoInfo();
    }).toThrowError(/oops/);
  });

  it('throws an error if owner/repo could not be determined', async () => {
    vi.mocked(child_process.execSync).mockReturnValueOnce('');
    expect(() => {
      getGitHubRepoInfo();
    }).toThrowError(/Owner & repo could not be extracted from remote URL/);
  });

  it('returns the owner and repo', async () => {
    vi.mocked(child_process.execSync).mockReturnValueOnce(
      'https://github.com/owner/repo.git ',
    );
    expect(getGitHubRepoInfo()).toStrictEqual({ owner: 'owner', repo: 'repo' });
  });
});

describe('getGitRepoRoot', async () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('throws an error if git root cannot be determined', async () => {
    vi.mocked(child_process.execSync).mockImplementation((): string => {
      throw new Error('oops');
    });
    expect(() => {
      getGitRepoRoot();
    }).toThrowError(/oops/);
  });

  it('throws an error if git root is empty', async () => {
    vi.mocked(child_process.execSync).mockReturnValueOnce('');
    expect(() => {
      getGitRepoRoot();
    }).toThrowError(/Git repo returned empty value/);
  });

  it('returns the root', async () => {
    vi.mocked(child_process.execSync).mockReturnValueOnce('/path/to/git/repo');
    expect(getGitRepoRoot()).toBe('/path/to/git/repo');
  });
});

describe('getLatestRelease', async () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('throws an error if the fetch fails', async () => {
    global.fetch = vi.fn(() => Promise.reject('nope'));
    await expect(getLatestGitHubRelease()).rejects.toThrowError(
      /Unable to determine the latest/,
    );
  });

  it('throws an error if the fetch does not return a json body', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ foo: 'bar' }),
      } as Response),
    );
    await expect(getLatestGitHubRelease()).rejects.toThrowError(
      /Unable to determine the latest/,
    );
  });

  it('returns the release version', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ tag_name: 'v1.2.3' }),
      } as Response),
    );
    await expect(getLatestGitHubRelease()).resolves.toBe('v1.2.3');
  });
});

describe('getWorkspaceIdentity', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return git repo root when inside a git repository', () => {
    vi.mocked(child_process.execSync).mockReturnValueOnce(
      '/Users/test/projects/my-repo',
    );

    const result = getWorkspaceIdentity();

    expect(result).toBe('/Users/test/projects/my-repo');
    expect(child_process.execSync).toHaveBeenCalledWith(
      'git rev-parse --show-toplevel',
      expect.objectContaining({ encoding: 'utf-8' }),
    );
  });

  it('should return cwd when NOT inside a git repository', () => {
    vi.mocked(child_process.execSync).mockImplementation(() => {
      throw new Error('not a git repository');
    });

    const result = getWorkspaceIdentity();

    // Should fall back to process.cwd()
    expect(result).toBe(process.cwd());
  });

  it('should handle git command failure gracefully and fall back to cwd', () => {
    vi.mocked(child_process.execSync).mockImplementation(() => {
      throw new Error('fatal: git command failed');
    });

    const result = getWorkspaceIdentity();

    expect(result).toBe(process.cwd());
  });

  it('should return the same identity from different subdirectories in same repo', () => {
    const repoRoot = '/Users/test/projects/my-repo';
    vi.mocked(child_process.execSync).mockReturnValue(repoRoot);

    // Simulate multiple calls (as if from different subdirs)
    const result1 = getWorkspaceIdentity();
    const result2 = getWorkspaceIdentity();

    expect(result1).toBe(repoRoot);
    expect(result2).toBe(repoRoot);
    expect(result1).toBe(result2);
  });

  it('should handle bare repo gracefully', () => {
    vi.mocked(child_process.execSync).mockImplementation(() => {
      throw new Error('fatal: this operation must be run in a work tree');
    });

    const result = getWorkspaceIdentity();

    // Should fall back to cwd for bare repos
    expect(result).toBe(process.cwd());
  });

  it('should normalize and return absolute paths', () => {
    // Mock git returning a path with trailing newline/whitespace
    const pathWithWhitespace = '  /Users/test/projects/my-repo  \n';
    vi.mocked(child_process.execSync).mockReturnValueOnce(pathWithWhitespace);

    const result = getWorkspaceIdentity();

    // Should trim and normalize
    expect(result).toBe('/Users/test/projects/my-repo');
    expect(result).not.toContain('\n');
    expect(result).not.toMatch(/^\s/);
    expect(result).not.toMatch(/\s$/);
  });
});
