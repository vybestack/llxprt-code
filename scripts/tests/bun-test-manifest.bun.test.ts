/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'bun:test';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  BUN_NATIVE_TEST_MANIFEST,
  BunManifestStatError,
  resolveBunNativeTestFiles,
  resolveEntryFileNames,
  resolveWorkspaceCwd,
  selectsEntry,
} from '../bun-test-manifest.js';

const repoRoot = resolve(__dirname, '..', '..');
const temporaryRoots: string[] = [];

/** Stat/glob stubs for tests that must never touch the real filesystem. */
const throwingStat = (error: unknown) => ({
  stat: (): never => {
    throw error;
  },
  glob: (): readonly string[] => [],
});

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('Bun native test manifest', () => {
  it('gates the exact test-setup native suite', () => {
    expect(
      BUN_NATIVE_TEST_MANIFEST.find(
        ({ workspace }) => workspace === 'test-setup',
      ),
    ).toEqual({
      workspace: 'test-setup',
      cwd: '.',
      files: [
        'test-setup/augment-bun-vi.test.ts',
        'test-setup/stub-helpers.bun.test.ts',
      ],
    });
  });

  it('resolves every advertised workspace to verified files', () => {
    for (const entry of BUN_NATIVE_TEST_MANIFEST) {
      const workspace = entry.workspace;
      const files = resolveBunNativeTestFiles(repoRoot, workspace);
      expect(files.length, workspace).toBeGreaterThan(0);
      const expectedCwd = resolveWorkspaceCwd(repoRoot, workspace, entry.cwd);
      expect(
        files.every(({ cwd }) => cwd === expectedCwd),
        workspace,
      ).toBe(true);
    }
  });

  it('retains the core CI characterization sample', () => {
    const files = resolveBunNativeTestFiles(repoRoot, 'core');
    expect(files.map(({ file }) => file)).toContain(
      resolve(repoRoot, 'packages/core/src/utils/errors.test.ts'),
    );
  });

  it('keeps known unsupported CLI tests outside the supported set', () => {
    const files = resolveBunNativeTestFiles(repoRoot, 'cli').map(
      ({ file }) => file,
    );
    expect(files.some((file) => file.endsWith('coreToolToggle.test.ts'))).toBe(
      false,
    );
    expect(files.some((file) => file.includes('useToolScheduler'))).toBe(false);
  });

  it('contains only nonempty workspace entries and existing files', () => {
    for (const entry of BUN_NATIVE_TEST_MANIFEST) {
      expect(
        resolveBunNativeTestFiles(repoRoot, entry.workspace).length,
        entry.workspace,
      ).toBeGreaterThan(0);
    }

    // A workspace may be declared by more than one entry, and an entry may
    // derive its files from globs rather than a curated list. Only the
    // curated entries have a count that can be predicted here.
    for (const workspace of new Set(
      BUN_NATIVE_TEST_MANIFEST.map(({ workspace }) => workspace),
    )) {
      const entries = BUN_NATIVE_TEST_MANIFEST.filter(
        (entry) => entry.workspace === workspace,
      );
      if (entries.some((entry) => entry.files === undefined)) {
        continue;
      }
      const expectedFileCount = entries.reduce(
        (total, entry) => total + (entry.files?.length ?? 0),
        0,
      );
      expect(resolveBunNativeTestFiles(repoRoot, workspace)).toHaveLength(
        expectedFileCount,
      );
    }
  });

  it('declares exactly one of files or include for every entry', () => {
    for (const entry of BUN_NATIVE_TEST_MANIFEST) {
      expect(
        (entry.files === undefined) !== (entry.include === undefined),
        entry.workspace,
      ).toBe(true);
    }
  });

  it('returns an empty set for an unknown workspace', () => {
    expect(resolveBunNativeTestFiles(repoRoot, 'unknown')).toEqual([]);
  });

  it('fails when a selected manifest file is missing', () => {
    const missingRepoRoot = resolve(repoRoot, 'definitely-missing-repository');

    expect(() => resolveBunNativeTestFiles(missingRepoRoot, 'core')).toThrow(
      'Bun native test manifest contains missing files',
    );
  });

  it('classifies only ENOENT as a missing manifest path', () => {
    const cause = Object.assign(new Error('missing'), {
      code: 'ENOENT',
      path: '/cause/path',
    });

    expect(() =>
      resolveBunNativeTestFiles('/fixture', 'core', throwingStat(cause)),
    ).toThrow('Bun native test manifest contains missing files');
  });

  it('preserves path, code, and cause for non-ENOENT stat failures', () => {
    const cause = Object.assign(new Error('permission denied'), {
      code: 'EACCES',
      path: '/cause/path',
    });
    let thrown: unknown;

    try {
      resolveBunNativeTestFiles('/fixture', 'core', throwingStat(cause));
    } catch (error: unknown) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(BunManifestStatError);
    if (!(thrown instanceof BunManifestStatError)) {
      throw new Error('Expected BunManifestStatError');
    }
    // Built with `join` so the expectation uses native separators; the
    // resolver joins the same way, so a literal POSIX path only matches
    // on POSIX platforms.
    expect(thrown.path).toBe(
      join('/fixture', 'packages/core/src/utils/errors.test.ts'),
    );
    expect(thrown.code).toBe('EACCES');
    expect(thrown.cause).toBe(cause);
  });

  it('rejects a manifest path that exists but is not a regular file', () => {
    const fixtureRoot = join(
      tmpdir(),
      `bun-test-manifest-directory-${process.pid}-${Date.now()}`,
    );
    temporaryRoots.push(fixtureRoot);
    // Every declared 'core' path must exist as a directory, otherwise the
    // missing-file check fires before the non-file check under assertion.
    for (const entry of BUN_NATIVE_TEST_MANIFEST.filter(
      (candidate) => candidate.workspace === 'core',
    )) {
      // Glob roots declare `include` instead of `files`; `core` is curated, so
      // this is defensive against the shared type rather than a live case.
      for (const file of entry.files ?? []) {
        mkdirSync(join(fixtureRoot, 'packages/core', file), {
          recursive: true,
        });
      }
    }

    expect(() => resolveBunNativeTestFiles(fixtureRoot, 'core')).toThrow(
      'Bun native test manifest contains non-files',
    );
  });
});

describe('selectsEntry', () => {
  it('includes an ordinary root in an unfiltered run', () => {
    expect(
      selectsEntry({ workspace: 'core', files: ['a.test.ts'] }, undefined),
    ).toBe(true);
  });

  it('excludes a credentialed root from an unfiltered run', () => {
    expect(
      selectsEntry(
        { workspace: 'evals', files: ['a.eval.ts'], credentialed: true },
        undefined,
      ),
    ).toBe(false);
  });

  it('includes a credentialed root when it is requested by name', () => {
    expect(
      selectsEntry(
        { workspace: 'evals', files: ['a.eval.ts'], credentialed: true },
        'evals',
      ),
    ).toBe(true);
  });

  it('excludes any root that is not the named one', () => {
    expect(
      selectsEntry({ workspace: 'core', files: ['a.test.ts'] }, 'cli'),
    ).toBe(false);
  });
});

describe('resolveEntryFileNames', () => {
  const globDependencies = (matches: Record<string, readonly string[]>) => ({
    stat: () => ({ isFile: () => true }),
    glob: (pattern: string): readonly string[] => matches[pattern] ?? [],
  });

  it('returns a curated file list verbatim', () => {
    expect(
      resolveEntryFileNames(
        { workspace: 'w', files: ['b.test.ts', 'a.test.ts'] },
        '/root',
        globDependencies({}),
      ),
    ).toEqual(['b.test.ts', 'a.test.ts']);
  });

  it('expands include globs and sorts the result', () => {
    expect(
      resolveEntryFileNames(
        { workspace: 'w', include: ['**/*.test.ts'] },
        '/root',
        globDependencies({ '**/*.test.ts': ['b.test.ts', 'a.test.ts'] }),
      ),
    ).toEqual(['a.test.ts', 'b.test.ts']);
  });

  it('removes exclude matches from the include result', () => {
    expect(
      resolveEntryFileNames(
        {
          workspace: 'w',
          include: ['**/*.test.ts'],
          exclude: ['**/*.bun.test.ts'],
        },
        '/root',
        globDependencies({
          '**/*.test.ts': ['a.test.ts', 'b.bun.test.ts'],
          '**/*.bun.test.ts': ['b.bun.test.ts'],
        }),
      ),
    ).toEqual(['a.test.ts']);
  });

  it('deduplicates files matched by more than one include pattern', () => {
    expect(
      resolveEntryFileNames(
        { workspace: 'w', include: ['a*.ts', '*.test.ts'] },
        '/root',
        globDependencies({
          'a*.ts': ['a.test.ts'],
          '*.test.ts': ['a.test.ts', 'b.test.ts'],
        }),
      ),
    ).toEqual(['a.test.ts', 'b.test.ts']);
  });

  it('rejects an entry declaring both files and include', () => {
    expect(() =>
      resolveEntryFileNames(
        { workspace: 'w', files: ['a.test.ts'], include: ['*.test.ts'] },
        '/root',
        globDependencies({}),
      ),
    ).toThrow('declares both "files" and "include"');
  });

  it('rejects an entry declaring neither files nor include', () => {
    expect(() =>
      resolveEntryFileNames({ workspace: 'w' }, '/root', globDependencies({})),
    ).toThrow('declares neither "files" nor "include"');
  });

  it('fails loudly when include globs match nothing', () => {
    expect(() =>
      resolveEntryFileNames(
        { workspace: 'w', include: ['**/*.test.ts'] },
        '/root',
        globDependencies({}),
      ),
    ).toThrow('matched no test files');
  });
});

describe('resolveWorkspaceCwd', () => {
  it('resolves undefined cwd to packages/<workspace>', () => {
    expect(resolveWorkspaceCwd(repoRoot, 'core', undefined)).toBe(
      join(repoRoot, 'packages', 'core'),
    );
  });

  it('resolves empty string cwd to the repo root', () => {
    expect(resolveWorkspaceCwd(repoRoot, 'core', '')).toBe(repoRoot);
  });

  it("resolves '.' cwd to the repo root via join", () => {
    expect(resolveWorkspaceCwd(repoRoot, 'core', '.')).toBe(
      join(repoRoot, '.'),
    );
  });

  it('resolves a relative cwd by joining under repo root', () => {
    expect(resolveWorkspaceCwd(repoRoot, 'core', 'test-setup')).toBe(
      join(repoRoot, 'test-setup'),
    );
  });
});
