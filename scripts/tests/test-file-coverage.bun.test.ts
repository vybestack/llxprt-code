/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import {
  BunTestRootStatError,
  type BunTestRootDependencies,
  DEFAULT_TEST_FILE_PATTERN,
  discoverTestFilesInDirectory,
} from '../bun-test-roots.js';
import {
  type TestExecutor,
  discoverRepositoryTestFiles,
  findDoublyExecutedTestFiles,
  findUncoveredTestFiles,
} from '../check-test-file-coverage.js';

const repoRoot = resolve(import.meta.dir, '..', '..');

const realDeps: BunTestRootDependencies = {
  stat: (path: string) => statSync(path),
  readDirectory: (path: string) => readdirSync(path),
  realpath: (path: string) => realpathSync(path),
};

/**
 * Shared temp-directory helper (RULES.md "DRY setup"). Registers its own
 * beforeEach/afterEach hooks and returns a lazy accessor, so each describe
 * block needs only one line of setup.
 */
function useTempDir(): () => string {
  let dir = '';
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'test-file-coverage-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  return () => {
    if (dir === '') {
      throw new Error('Temp directory accessed outside its lifecycle');
    }
    return dir;
  };
}

/** Writes a file (and any missing parent directories) inside a temp root. */
function writeFile(root: string, relative: string): string {
  const fullPath = join(root, relative);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, '');
  return fullPath;
}

/** Builds an executor that scans a single workspace-relative directory. */
function scanningExecutor(name: string, scanRelative: string): TestExecutor {
  return {
    name,
    discover: (root: string): readonly string[] =>
      discoverTestFilesInDirectory(
        join(root, scanRelative),
        DEFAULT_TEST_FILE_PATTERN,
        realDeps,
      ),
  };
}

// ---------------------------------------------------------------------------
// Headline assertions against the real repository (AC7, AC8)
// ---------------------------------------------------------------------------

describe('test-file coverage guard (real repository)', () => {
  it('reports zero uncovered test files (AC8)', () => {
    const uncovered = findUncoveredTestFiles(repoRoot);
    expect(
      uncovered,
      `Expected every repository test file to be run by some executor, but these were uncovered:\n${uncovered.join('\n')}`,
    ).toEqual([]);
  });

  it('reports zero doubly-executed test files (AC7)', () => {
    const duplicates = findDoublyExecutedTestFiles(repoRoot);
    expect(
      duplicates,
      `Expected no test file to be run by two executors, but these were duplicated:\n${duplicates
        .map((entry) => `${entry.file} ← ${entry.executors.join(', ')}`)
        .join('\n')}`,
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Repository walk behavior
// ---------------------------------------------------------------------------

describe('discoverRepositoryTestFiles', () => {
  const getDir = useTempDir();

  it('walks the repository and returns test files sorted', () => {
    const a = writeFile(getDir(), 'packages/foo/src/b.test.ts');
    const b = writeFile(getDir(), 'packages/foo/src/a.test.ts');
    writeFile(getDir(), 'packages/foo/src/notatest.ts');

    const files = discoverRepositoryTestFiles(getDir(), realDeps);

    expect(files).toEqual([b, a]);
  });

  it('includes eval files alongside test/spec/bun files', () => {
    const evalFile = writeFile(getDir(), 'evals/run.eval.ts');
    const testFile = writeFile(getDir(), 'packages/x/y.test.ts');

    const files = discoverRepositoryTestFiles(getDir(), realDeps);

    expect(files).toContain(evalFile);
    expect(files).toContain(testFile);
  });

  it('does not walk skipped directories', () => {
    writeFile(getDir(), 'node_modules/dep/skip.test.ts');
    writeFile(getDir(), 'dist/generated.test.ts');
    writeFile(getDir(), '.hidden/secret.test.ts');
    writeFile(getDir(), 'coverage/covered.test.ts');
    writeFile(getDir(), 'bundle/packed.test.ts');
    writeFile(getDir(), 'tmp/temp.test.ts');
    writeFile(getDir(), '__snapshots__/snap.test.ts');
    const real = writeFile(getDir(), 'packages/real/real.test.ts');

    const files = discoverRepositoryTestFiles(getDir(), realDeps);

    expect(files).toEqual([real]);
  });

  it('discovers a dot-prefixed test file but prunes dot-prefixed directories', () => {
    const dotFile = writeFile(getDir(), 'packages/x/.hidden.test.ts');
    writeFile(getDir(), 'packages/x/.hiddendir/inside.test.ts');

    const files = discoverRepositoryTestFiles(getDir(), realDeps);

    expect(files).toContain(dotFile);
    expect(files.every((f) => !f.includes(join('.hiddendir')))).toBe(true);
  });

  it('fails loudly when a subdirectory cannot be read', () => {
    writeFile(getDir(), 'packages/a/real.test.ts');
    writeFile(getDir(), 'packages/b/orphan.test.ts');
    const throwingDeps: BunTestRootDependencies = {
      stat: (path) => statSync(path),
      readDirectory: (path) => {
        if (path.endsWith(join('packages', 'b'))) {
          throw Object.assign(new Error('permission denied'), {
            code: 'EACCES',
          });
        }
        return readdirSync(path);
      },
      realpath: (path) => realpathSync(path),
    };

    expect(() => discoverRepositoryTestFiles(getDir(), throwingDeps)).toThrow(
      BunTestRootStatError,
    );
  });

  it('fails loudly when an entry cannot be stat-ed', () => {
    writeFile(getDir(), 'packages/a/real.test.ts');
    const throwingDeps: BunTestRootDependencies = {
      stat: (path) => {
        if (path.endsWith('real.test.ts')) {
          throw Object.assign(new Error('permission denied'), {
            code: 'EACCES',
          });
        }
        return statSync(path);
      },
      readDirectory: (path) => readdirSync(path),
      realpath: (path) => realpathSync(path),
    };

    expect(() => discoverRepositoryTestFiles(getDir(), throwingDeps)).toThrow(
      BunTestRootStatError,
    );
  });
});

// ---------------------------------------------------------------------------
// Coverage logic against temp fixtures
// ---------------------------------------------------------------------------

describe('findUncoveredTestFiles', () => {
  const getDir = useTempDir();

  it('reports a file under a scanned directory as covered', () => {
    writeFile(getDir(), 'packages/scanned/a.test.ts');

    const uncovered = findUncoveredTestFiles(getDir(), realDeps, [
      scanningExecutor('scanner', 'packages/scanned'),
    ]);

    expect(uncovered).toEqual([]);
  });

  it('reports a file no executor scans as uncovered', () => {
    const covered = writeFile(getDir(), 'packages/scanned/a.test.ts');
    const orphan = writeFile(getDir(), 'packages/orphan/b.test.ts');

    const uncovered = findUncoveredTestFiles(getDir(), realDeps, [
      scanningExecutor('scanner', 'packages/scanned'),
    ]);

    expect(uncovered).toEqual([orphan]);
    expect(uncovered).not.toContain(covered);
  });
});

describe('findDoublyExecutedTestFiles', () => {
  const getDir = useTempDir();

  it('reports a file claimed by two executors as doubly executed', () => {
    const shared = writeFile(getDir(), 'packages/shared/c.test.ts');

    const duplicates = findDoublyExecutedTestFiles(getDir(), [
      scanningExecutor('executor-one', 'packages/shared'),
      scanningExecutor('executor-two', 'packages/shared'),
    ]);

    expect(duplicates).toHaveLength(1);
    expect(duplicates[0]?.file).toBe(shared);
    expect(duplicates[0]?.executors).toEqual(['executor-one', 'executor-two']);
  });

  it('reports nothing when each file has exactly one executor', () => {
    writeFile(getDir(), 'packages/a/x.test.ts');
    writeFile(getDir(), 'packages/b/y.test.ts');

    const duplicates = findDoublyExecutedTestFiles(getDir(), [
      scanningExecutor('executor-a', 'packages/a'),
      scanningExecutor('executor-b', 'packages/b'),
    ]);

    expect(duplicates).toEqual([]);
  });
});
