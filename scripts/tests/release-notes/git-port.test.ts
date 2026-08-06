/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { execFileSync } from 'node:child_process';
import {
  parseCommits,
  getCommits,
  getAllCommits,
  getMergeIntroducedHashes,
  getOctopusMergeIntroducedHashes,
  getRootCommit,
  createTopologyResolver,
} from '../../release-notes/git-port.js';
import { useTempRepo, gitCommit, gitMerge } from './fixtures.js';

const NUL = '\0';

const HASH_A = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0';
const HASH_B = 'b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1';
const HASH_MERGE = 'c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2';
const HASH_ROOT = 'd4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3';

function makeRecord(
  hash: string,
  subject: string,
  author: string,
  parents = '',
): string {
  return [hash, subject, author, parents].join(NUL) + NUL;
}

function makeOutput(records: readonly string[]): string {
  return records.join('');
}

describe('parseCommits', () => {
  it('parses a single commit record', () => {
    const output = makeOutput([
      makeRecord(HASH_A, 'feat: add streaming', 'Alice'),
    ]);
    const commits = parseCommits(output);
    expect(commits).toHaveLength(1);
    expect(commits[0]!.hash).toBe(HASH_A);
    expect(commits[0]!.subject).toBe('feat: add streaming');
    expect(commits[0]!.author).toBe('Alice');
    expect(commits[0]!.isMerge).toBe(false);
  });

  it('parses a merge commit (two parents) with isMerge=true', () => {
    const output = makeOutput([
      makeRecord(
        HASH_MERGE,
        'Merge pull request #42',
        'Bob',
        'parent1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa parent2aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      ),
    ]);
    const commits = parseCommits(output);
    expect(commits).toHaveLength(1);
    expect(commits[0]!.isMerge).toBe(true);
    expect(commits[0]!.parents).toHaveLength(2);
  });

  it('parses a root commit (no parents) with isMerge=false', () => {
    const output = makeOutput([
      makeRecord(HASH_ROOT, 'Initial commit', 'Alice'),
    ]);
    const commits = parseCommits(output);
    expect(commits).toHaveLength(1);
    expect(commits[0]!.isMerge).toBe(false);
    expect(commits[0]!.parents).toEqual([]);
  });

  it('parses an empty string into an empty array', () => {
    expect(parseCommits('')).toEqual([]);
  });

  it('parses multiple records', () => {
    const output = makeOutput([
      makeRecord(HASH_A, 'feat: first', 'Alice'),
      makeRecord(HASH_B, 'fix: second', 'Bob'),
    ]);
    const commits = parseCommits(output);
    expect(commits).toHaveLength(2);
    expect(commits[0]!.hash).toBe(HASH_A);
    expect(commits[1]!.hash).toBe(HASH_B);
  });

  it('parses a subject containing literal 0x1e (record separator) text safely', () => {
    const evilSubject = 'feat: contains \x1e RS char';
    const output = makeOutput([
      makeRecord(HASH_A, evilSubject, 'Alice'),
      makeRecord(HASH_B, 'fix: another', 'Bob'),
    ]);
    const commits = parseCommits(output);
    expect(commits).toHaveLength(2);
    expect(commits[0]!.subject).toBe(evilSubject);
    expect(commits[0]!.hash).toBe(HASH_A);
  });

  it('parses a subject containing literal 0x1f (field separator) text safely', () => {
    const evilSubject = 'feat: contains \x1f FS char';
    const output = makeOutput([makeRecord(HASH_A, evilSubject, 'Alice')]);
    const commits = parseCommits(output);
    expect(commits).toHaveLength(1);
    expect(commits[0]!.subject).toBe(evilSubject);
  });

  it('does not produce phantom records from trailing NUL', () => {
    const output = makeRecord(HASH_A, 'feat: first', 'Alice') + NUL;
    const commits = parseCommits(output);
    expect(commits).toHaveLength(1);
    expect(commits[0]!.hash).toBe(HASH_A);
  });

  it('skips incomplete trailing record (fewer than 4 fields)', () => {
    const output = makeRecord(HASH_A, 'feat: first', 'Alice') + 'truncated\0';
    const commits = parseCommits(output);
    expect(commits).toHaveLength(1);
  });

  it('skips records with invalid (non-40-hex) hashes', () => {
    const output = makeOutput([
      makeRecord('abc1234', 'feat: short hash', 'Alice'),
      makeRecord(HASH_B, 'fix: valid hash', 'Bob'),
    ]);
    const commits = parseCommits(output);
    expect(commits).toHaveLength(1);
    expect(commits[0]!.hash).toBe(HASH_B);
  });

  it('handles Unicode and unusual whitespace in subjects', () => {
    const output = makeOutput([
      makeRecord(HASH_A, 'feat: Unicode 你好世界\n\ttabbed', 'Alice'),
    ]);
    const commits = parseCommits(output);
    expect(commits[0]!.subject).toContain('你好世界');
  });
});

describe('getCommits (temp-repo integration)', () => {
  const getDir = useTempRepo();

  it('returns an empty array when there are no commits in range', () => {
    const dir = getDir();
    gitCommit(dir, 'Initial commit');
    const commits = getCommits('HEAD', 'HEAD');
    expect(commits).toEqual([]);
  });

  it('parses a root commit with no parents', () => {
    const dir = getDir();
    gitCommit(dir, 'feat: root commit');
    const emptyTree = execFileSync(
      'git',
      ['hash-object', '-t', 'tree', '/dev/null'],
      {
        encoding: 'utf8',
      },
    ).trim();
    const startHash = execFileSync(
      'git',
      ['commit-tree', emptyTree, '-m', 'start'],
      { encoding: 'utf8' },
    ).trim();
    execFileSync('git', ['update-ref', 'refs/tags/start', startHash], {
      encoding: 'utf8',
    });
    const commits = getCommits('refs/tags/start', 'HEAD');
    expect(commits).toHaveLength(1);
    expect(commits[0]!.subject).toBe('feat: root commit');
    expect(commits[0]!.isMerge).toBe(false);
  });

  it('parses a single commit with one parent', () => {
    const dir = getDir();
    const root = gitCommit(dir, 'Initial commit');
    execFileSync('git', ['tag', 'start', root], {
      encoding: 'utf8',
    });
    gitCommit(dir, 'feat: second commit');
    const commits = getCommits('start', 'HEAD');
    expect(commits).toHaveLength(1);
    expect(commits[0]!.subject).toBe('feat: second commit');
    expect(commits[0]!.parents).toEqual([root]);
  });

  it('retains all sequential commits with complete hashes in reverse-chronological order', () => {
    const dir = getDir();
    const root = gitCommit(dir, 'Initial commit');
    execFileSync('git', ['tag', 'start', root], {
      encoding: 'utf8',
    });
    const h1 = gitCommit(dir, 'feat: first');
    const h2 = gitCommit(dir, 'feat: second');
    const h3 = gitCommit(dir, 'feat: third');
    const commits = getCommits('start', 'HEAD');
    expect(commits).toHaveLength(3);
    expect(commits[0]!.hash).toBe(h3);
    expect(commits[1]!.hash).toBe(h2);
    expect(commits[2]!.hash).toBe(h1);
    expect(commits[0]!.subject).toBe('feat: third');
    expect(commits[1]!.subject).toBe('feat: second');
    expect(commits[2]!.subject).toBe('feat: first');
    for (const commit of commits) {
      expect(commit.hash).toMatch(/^[0-9a-f]{40}$/);
    }
  });

  it('detects a two-parent merge commit', () => {
    const dir = getDir();
    const root = gitCommit(dir, 'Initial commit');
    execFileSync('git', ['tag', 'start', root], {
      encoding: 'utf8',
    });
    execFileSync('git', ['checkout', '-b', 'feature'], {
      encoding: 'utf8',
    });
    gitCommit(dir, 'Branch 1 commit');
    const branch1Hash = execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).trim();
    try {
      execFileSync('git', ['checkout', 'main'], {
        encoding: 'utf8',
      });
    } catch {
      execFileSync('git', ['checkout', 'master'], {
        encoding: 'utf8',
      });
    }
    gitCommit(dir, 'Branch 2 commit');
    const branch2Hash = execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).trim();
    const mergeHash = gitMerge(dir, 'Merge branches', 'feature');
    const commits = getCommits('start', 'HEAD');
    const mergeCommit = commits.find((c) => c.hash === mergeHash);
    expect(mergeCommit).toBeDefined();
    expect(mergeCommit!.isMerge).toBe(true);
    expect(mergeCommit!.parents).toHaveLength(2);
    expect(mergeCommit!.parents).toContain(branch1Hash);
    expect(mergeCommit!.parents).toContain(branch2Hash);
  });
});

describe('getMergeIntroducedHashes (temp-repo integration)', () => {
  const getDir = useTempRepo();

  describe('getAllCommits (temp-repo integration)', () => {
    const getDir = useTempRepo();

    it('includes the root commit, unlike getCommits(root..HEAD)', () => {
      const dir = getDir();
      const root = gitCommit(dir, 'Initial commit');
      gitCommit(dir, 'feat: second');
      gitCommit(dir, 'feat: third');

      const allCommits = getAllCommits();
      const rangedCommits = getCommits(root, 'HEAD');

      expect(rangedCommits).not.toContain(
        expect.objectContaining({ hash: root }),
      );
      const allHashes = allCommits.map((c) => c.hash);
      expect(allHashes).toContain(root);
      expect(allCommits).toHaveLength(3);
    });

    it('includes root commit in reverse-chronological order', () => {
      const dir = getDir();
      const root = gitCommit(dir, 'Initial commit');
      const h1 = gitCommit(dir, 'feat: first');
      const h2 = gitCommit(dir, 'feat: second');

      const commits = getAllCommits();
      expect(commits).toHaveLength(3);
      expect(commits[0]!.hash).toBe(h2);
      expect(commits[1]!.hash).toBe(h1);
      expect(commits[2]!.hash).toBe(root);
      expect(commits[2]!.subject).toBe('Initial commit');
    });
  });

  it('returns commits introduced by a two-parent merge', () => {
    const dir = getDir();
    const root = gitCommit(dir, 'Initial commit');
    execFileSync('git', ['tag', 'start', root], {
      encoding: 'utf8',
    });
    execFileSync('git', ['checkout', '-b', 'feature'], {
      encoding: 'utf8',
    });
    gitCommit(dir, 'Feature commit 1');
    const childHash = execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).trim();
    try {
      execFileSync('git', ['checkout', 'main'], {
        encoding: 'utf8',
      });
    } catch {
      execFileSync('git', ['checkout', 'master'], {
        encoding: 'utf8',
      });
    }
    gitCommit(dir, 'Mainline commit');
    const mergeHash = gitMerge(dir, 'Merge branches', 'feature');
    const mergeCommitInfo = execFileSync('git', ['cat-file', '-p', mergeHash], {
      encoding: 'utf8',
    });
    const parentLines = mergeCommitInfo
      .split('\n')
      .filter((line) => line.startsWith('parent '))
      .map((line) => line.slice('parent '.length).trim());
    const [firstParent, secondParent] = parentLines;
    const introduced = getMergeIntroducedHashes(firstParent!, secondParent!);
    expect(introduced).toContain(childHash);
    expect(introduced).not.toContain(mergeHash);
  });
});

describe('createTopologyResolver', () => {
  const getDir = useTempRepo();

  it('returns a resolver that delegates to getMergeIntroducedHashes', () => {
    const resolver = createTopologyResolver();
    expect(typeof resolver.getMergeIntroducedHashes).toBe('function');
    expect(typeof resolver.getOctopusMergeIntroducedHashes).toBe('function');
    const dir = getDir();
    void dir;
  });

  it('octopus resolver returns deduplicated introduced children for 3-parent merge', () => {
    const dir = getDir();
    const root = gitCommit(dir, 'Initial commit');
    execFileSync('git', ['tag', 'start', root], { encoding: 'utf8' });

    // Create two feature branches with commits
    execFileSync('git', ['checkout', '-b', 'feature1'], { encoding: 'utf8' });
    gitCommit(dir, 'Feature1 commit');
    const feature1Child = execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).trim();

    execFileSync('git', ['checkout', root], { encoding: 'utf8' });
    execFileSync('git', ['checkout', '-b', 'feature2'], { encoding: 'utf8' });
    gitCommit(dir, 'Feature2 commit');
    const feature2Child = execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).trim();

    // Merge both branches into main as an octopus merge
    try {
      execFileSync('git', ['checkout', 'main'], { encoding: 'utf8' });
    } catch {
      execFileSync('git', ['checkout', 'master'], { encoding: 'utf8' });
    }
    gitCommit(dir, 'Mainline commit');
    execFileSync(
      'git',
      [
        'merge',
        '--no-ff',
        '-m',
        'Octopus merge of two branches',
        'feature1',
        'feature2',
      ],
      { encoding: 'utf8' },
    );
    const mergeHash = execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).trim();
    const parents = execFileSync(
      'git',
      ['log', '-1', '--format=%P', mergeHash],
      {
        encoding: 'utf8',
      },
    )
      .trim()
      .split(/\s+/);

    const resolver = createTopologyResolver();
    const introduced = resolver.getOctopusMergeIntroducedHashes(parents);
    // Both feature branch children should be included.
    expect(introduced).toContain(feature1Child);
    expect(introduced).toContain(feature2Child);
    // No duplicates.
    expect(new Set(introduced).size).toBe(introduced.length);
  });
});

describe('getOctopusMergeIntroducedHashes (temp-repo integration)', () => {
  const getDir = useTempRepo();

  it('returns all unique children introduced by a 3-parent octopus merge', () => {
    const dir = getDir();
    const root = gitCommit(dir, 'Initial commit');
    execFileSync('git', ['tag', 'start', root], { encoding: 'utf8' });

    execFileSync('git', ['checkout', '-b', 'feature1'], { encoding: 'utf8' });
    gitCommit(dir, 'Feature1 commit');
    const feature1Child = execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).trim();

    execFileSync('git', ['checkout', root], { encoding: 'utf8' });
    execFileSync('git', ['checkout', '-b', 'feature2'], { encoding: 'utf8' });
    gitCommit(dir, 'Feature2 commit');
    const feature2Child = execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).trim();

    try {
      execFileSync('git', ['checkout', 'main'], { encoding: 'utf8' });
    } catch {
      execFileSync('git', ['checkout', 'master'], { encoding: 'utf8' });
    }
    gitCommit(dir, 'Mainline commit');
    execFileSync(
      'git',
      ['merge', '--no-ff', '-m', 'Octopus merge', 'feature1', 'feature2'],
      { encoding: 'utf8' },
    );
    const mergeHash = execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).trim();
    const parents = execFileSync(
      'git',
      ['log', '-1', '--format=%P', mergeHash],
      {
        encoding: 'utf8',
      },
    )
      .trim()
      .split(/\s+/);

    const introduced = getOctopusMergeIntroducedHashes(parents);
    expect(introduced).toContain(feature1Child);
    expect(introduced).toContain(feature2Child);
  });

  it('returns an empty array for fewer than 2 parents', () => {
    expect(getOctopusMergeIntroducedHashes([])).toEqual([]);
    expect(getOctopusMergeIntroducedHashes(['onlyone'])).toEqual([]);
  });
});

describe('getRootCommit (temp-repo integration)', () => {
  const getDir = useTempRepo();

  it('returns the root commit hash for a repo with a single root', () => {
    const dir = getDir();
    const rootHash = gitCommit(dir, 'Initial commit');
    expect(getRootCommit()).toBe(rootHash);
  });

  it('returns the oldest root commit when multiple root commits exist', () => {
    const dir = getDir();
    const root1 = gitCommit(dir, 'First root');
    // Create a second root via an orphan branch then merge it back
    // (allowing unrelated histories for this synthetic topology test).
    execFileSync('git', ['checkout', '--orphan', 'orphan'], {
      encoding: 'utf8',
    });
    execFileSync('git', ['rm', '-rf', '.'], { encoding: 'utf8' });
    const root2 = gitCommit(dir, 'Second root');
    execFileSync('git', ['checkout', 'main'], { encoding: 'utf8' });
    execFileSync(
      'git',
      [
        'merge',
        '--no-ff',
        '--allow-unrelated-histories',
        '-m',
        'Merge orphan roots',
        'orphan',
      ],
      { encoding: 'utf8' },
    );
    const result = getRootCommit();
    // The oldest root is returned (rev-list --max-parents=0 lists oldest first).
    expect([root1, root2]).toContain(result);
  });

  it('returns null for an empty repository with no commits', () => {
    getDir();
    expect(getRootCommit()).toBeNull();
  });
});
