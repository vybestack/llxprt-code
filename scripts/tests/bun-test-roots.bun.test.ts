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
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import {
  BUN_TEST_ROOTS,
  type BunTestRoot,
  type BunTestRootDependencies,
  BunTestRootStatError,
  DEFAULT_TEST_FILE_PATTERN,
  discoverTestFilesInDirectory,
  getErrorCode,
  isTestFileName,
  resolveBunTestFiles,
  resolveRoot,
  resolveRootCwd,
  selectsRoot,
} from '../bun-test-roots.js';

const repoRoot = resolve(import.meta.dir, '..', '..');

const realDeps: BunTestRootDependencies = {
  stat: (path) => statSync(path),
  readDirectory: (path) => readdirSync(path),
  realpath: (path) => realpathSync(path),
};

/**
 * Shared temp-directory helper. Registers its own beforeEach/afterEach hooks
 * and returns a lazy accessor, so each describe block only needs one line of
 * setup (RULES.md "DRY setup").
 */
function useTempDir(): () => string {
  let dir = '';
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bun-test-roots-'));
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

/** Creates a minimal test fixture: tempDir/src/a.test.ts. */
function writeFixture(dir: string, relative: string, content = ''): string {
  const fullPath = join(dir, relative);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content);
  return fullPath;
}

// ---------------------------------------------------------------------------
// Root table structural guarantees (AC1)
// ---------------------------------------------------------------------------

describe('BUN_TEST_ROOTS structural guarantees', () => {
  it('exposes no files, include, or exclude member on any root', () => {
    for (const root of BUN_TEST_ROOTS) {
      expect(
        'files' in root || 'include' in root || 'exclude' in root,
        `root "${root.root}" must not declare files/include/exclude`,
      ).toBe(false);
    }
  });

  it('has exactly the expected set of root tokens', () => {
    const tokens = BUN_TEST_ROOTS.map((r) => r.root);
    expect(tokens).toEqual([
      'a2a-server',
      'agents',
      'providers',
      'tools',
      'mcp',
      'telemetry',
      'storage',
      'test-utils',
      'settings',
      'ide-integration',
      'vscode-ide-companion',
      'policy',
      'lsp',
      'test-setup',
      'scripts-tests',
      'evals',
      'integration-tests',
    ]);
  });

  it('marks exactly the credentialed roots', () => {
    const credentialed = BUN_TEST_ROOTS.filter((r) => r.credentialed === true);
    expect(credentialed.map((r) => r.root).sort()).toEqual([
      'evals',
      'integration-tests',
    ]);
  });
});

// ---------------------------------------------------------------------------
// cwd resolution (§3.4)
// ---------------------------------------------------------------------------

describe('resolveRootCwd', () => {
  it('resolves undefined cwd to packages/<root>', () => {
    expect(resolveRootCwd('/repo', { root: 'core' })).toBe(
      join('/repo', 'packages', 'core'),
    );
  });

  it("resolves '.' cwd to the repo root", () => {
    expect(resolveRootCwd('/repo', { root: 'scripts', cwd: '.' })).toBe(
      join('/repo', '.'),
    );
  });

  it('resolves a relative cwd by joining under the repo root', () => {
    expect(resolveRootCwd('/repo', { root: 'evals', cwd: 'evals' })).toBe(
      join('/repo', 'evals'),
    );
  });
});

// ---------------------------------------------------------------------------
// Root selection (§3.5)
// ---------------------------------------------------------------------------

describe('selectsRoot', () => {
  it('includes an ordinary root in an unfiltered run', () => {
    expect(selectsRoot({ root: 'core' }, undefined)).toBe(true);
  });

  it('excludes a credentialed root from an unfiltered run', () => {
    expect(selectsRoot({ root: 'evals', credentialed: true }, undefined)).toBe(
      false,
    );
  });

  it('includes a credentialed root when named explicitly', () => {
    expect(selectsRoot({ root: 'evals', credentialed: true }, 'evals')).toBe(
      true,
    );
  });

  it('excludes any root that is not the named one', () => {
    expect(selectsRoot({ root: 'core' }, 'cli')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// File discovery (walker)
// ---------------------------------------------------------------------------

describe('discoverTestFilesInDirectory', () => {
  const getDir = useTempDir();

  it('resolves test files in nested directories', () => {
    writeFixture(getDir(), 'src/deep/a.test.ts');
    writeFixture(getDir(), 'src/other/b.spec.ts');

    const results = discoverTestFilesInDirectory(
      getDir(),
      DEFAULT_TEST_FILE_PATTERN,
      realDeps,
    );

    expect(results).toHaveLength(2);
    expect(results.some((f) => f.endsWith('a.test.ts'))).toBe(true);
    expect(results.some((f) => f.endsWith('b.spec.ts'))).toBe(true);
  });

  it('does not resolve files under dist, node_modules, or dotted directories', () => {
    writeFixture(getDir(), 'src/real.test.ts');
    writeFixture(getDir(), 'dist/hidden.test.ts');
    writeFixture(getDir(), 'node_modules/dep.test.ts');
    writeFixture(getDir(), '.hidden/secret.test.ts');
    writeFixture(getDir(), 'coverage/covered.test.ts');
    writeFixture(getDir(), 'tmp/temp.test.ts');
    writeFixture(getDir(), 'bundle/packed.test.ts');
    writeFixture(getDir(), '__snapshots__/snap.test.ts');

    const results = discoverTestFilesInDirectory(
      getDir(),
      DEFAULT_TEST_FILE_PATTERN,
      realDeps,
    );

    expect(results).toEqual([join(getDir(), 'src/real.test.ts')]);
  });

  it('discovers a dot-prefixed test file but prunes dot-prefixed directories', () => {
    const dotFile = writeFixture(getDir(), '.hidden.test.ts');
    writeFixture(getDir(), '.hiddendir/inside.test.ts');

    const results = discoverTestFilesInDirectory(
      getDir(),
      DEFAULT_TEST_FILE_PATTERN,
      realDeps,
    );

    expect(results).toContain(dotFile);
    expect(results.every((f) => !f.includes('.hiddendir'))).toBe(true);
  });

  it('fails loudly when a subdirectory cannot be read', () => {
    writeFixture(getDir(), 'src/a.test.ts');
    writeFixture(getDir(), 'secret/b.test.ts');
    const throwingDeps: BunTestRootDependencies = {
      stat: (path) => statSync(path),
      readDirectory: (path) => {
        if (path.endsWith(join('secret'))) {
          throw Object.assign(new Error('permission denied'), {
            code: 'EACCES',
          });
        }
        return readdirSync(path);
      },
      realpath: (path) => realpathSync(path),
    };

    expect(() =>
      discoverTestFilesInDirectory(
        getDir(),
        DEFAULT_TEST_FILE_PATTERN,
        throwingDeps,
      ),
    ).toThrow(BunTestRootStatError);
  });

  it('fails loudly when an entry cannot be stat-ed', () => {
    writeFixture(getDir(), 'src/a.test.ts');
    const throwingDeps: BunTestRootDependencies = {
      stat: (path) => {
        if (path.endsWith('a.test.ts')) {
          throw Object.assign(new Error('permission denied'), {
            code: 'EACCES',
          });
        }
        return statSync(path);
      },
      readDirectory: (path) => readdirSync(path),
      realpath: (path) => realpathSync(path),
    };

    expect(() =>
      discoverTestFilesInDirectory(
        getDir(),
        DEFAULT_TEST_FILE_PATTERN,
        throwingDeps,
      ),
    ).toThrow(BunTestRootStatError);
  });

  it('does not resolve .d.ts declaration files', () => {
    writeFixture(getDir(), 'src/types.d.ts');
    writeFixture(getDir(), 'src/real.test.ts');

    const results = discoverTestFilesInDirectory(
      getDir(),
      DEFAULT_TEST_FILE_PATTERN,
      realDeps,
    );

    expect(results).toEqual([join(getDir(), 'src/real.test.ts')]);
  });

  it('deduplicates a symlink cycle so each real file appears once', () => {
    writeFixture(getDir(), 'src/a.test.ts');
    // src/cycle -> repo root creates a cycle back into the scanned tree
    symlinkSync(getDir(), join(getDir(), 'src', 'cycle'));

    const results = discoverTestFilesInDirectory(
      getDir(),
      DEFAULT_TEST_FILE_PATTERN,
      realDeps,
    );

    // The scan directory's own real path is seeded into visited, so the
    // symlink back to it (src/cycle -> root) is never re-walked. Exactly
    // one entry: the real file under src/.
    expect(results).toEqual([join(getDir(), 'src', 'a.test.ts')]);
  });
});

// ---------------------------------------------------------------------------
// isTestFileName
// ---------------------------------------------------------------------------

describe('isTestFileName', () => {
  it.each([
    ['a.test.ts', true],
    ['a.spec.ts', true],
    ['a.bun.ts', true],
    ['a.test.tsx', true],
    ['a.spec.tsx', true],
    ['a.bun.tsx', true],
    ['a.test.js', true],
    ['a.spec.js', true],
    ['a.bun.js', true],
    ['a.ts', false],
    ['a.d.ts', false],
    ['a.test.d.ts', false],
    ['readme.md', false],
  ])('classifies %s as %s', (name, expected) => {
    expect(isTestFileName(name)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// resolveRoot — behavioral tests against temp fixtures
// ---------------------------------------------------------------------------

describe('resolveRoot', () => {
  const getDir = useTempDir();

  it('discovers a newly added test file without any configuration edit', () => {
    const root: BunTestRoot = {
      root: 'fixture',
      cwd: '.',
      directories: ['src'],
    };
    writeFixture(getDir(), 'src/first.test.ts');

    const before = resolveRoot(root, getDir());
    expect(before).toHaveLength(1);

    writeFixture(getDir(), 'src/second.test.ts');
    const after = resolveRoot(root, getDir());
    expect(after).toHaveLength(2);
    expect(after.some((f) => f.file.endsWith('second.test.ts'))).toBe(true);
  });

  it('fails loudly when a root discovers no test files', () => {
    mkdirSync(join(getDir(), 'emptydir'), { recursive: true });
    const root: BunTestRoot = {
      root: 'empty',
      cwd: '.',
      directories: ['emptydir'],
    };
    expect(() => resolveRoot(root, getDir())).toThrow(
      'discovered no test files',
    );
  });

  it('propagates a readDirectory error instead of returning a short list', () => {
    writeFixture(getDir(), 'src/a.test.ts');
    writeFixture(getDir(), 'secret/b.test.ts');
    const throwingDeps: BunTestRootDependencies = {
      stat: (path) => statSync(path),
      readDirectory: (path) => {
        if (path.endsWith(join('secret'))) {
          throw Object.assign(new Error('permission denied'), {
            code: 'EACCES',
          });
        }
        return readdirSync(path);
      },
      realpath: (path) => realpathSync(path),
    };
    const root: BunTestRoot = {
      root: 'fail',
      cwd: '.',
      directories: ['src', 'secret'],
    };

    expect(() => resolveRoot(root, getDir(), throwingDeps)).toThrow(
      BunTestRootStatError,
    );
  });

  it('propagates a stat error instead of returning a short list', () => {
    writeFixture(getDir(), 'src/a.test.ts');
    writeFixture(getDir(), 'src/b.test.ts');
    const throwingDeps: BunTestRootDependencies = {
      stat: (path) => {
        if (path.endsWith('b.test.ts')) {
          throw Object.assign(new Error('permission denied'), {
            code: 'EACCES',
          });
        }
        return statSync(path);
      },
      readDirectory: (path) => readdirSync(path),
      realpath: (path) => realpathSync(path),
    };
    const root: BunTestRoot = {
      root: 'fail',
      cwd: '.',
      directories: ['src'],
    };

    expect(() => resolveRoot(root, getDir(), throwingDeps)).toThrow(
      BunTestRootStatError,
    );
  });

  it('fails when a declared preload path does not exist', () => {
    writeFixture(getDir(), 'src/a.test.ts');
    const root: BunTestRoot = {
      root: 'bad',
      cwd: '.',
      directories: ['src'],
      preload: 'missing-preload.ts',
    };
    expect(() => resolveRoot(root, getDir())).toThrow('missing preload/config');
  });

  it('fails when a declared tsconfig path does not exist', () => {
    writeFixture(getDir(), 'src/a.test.ts');
    const root: BunTestRoot = {
      root: 'bad',
      cwd: '.',
      directories: ['src'],
      tsconfig: 'missing-tsconfig.json',
    };
    expect(() => resolveRoot(root, getDir())).toThrow('missing preload/config');
  });

  it('fails when a declared globalSetup path does not exist', () => {
    writeFixture(getDir(), 'src/a.test.ts');
    const root: BunTestRoot = {
      root: 'bad',
      cwd: '.',
      directories: ['src'],
      globalSetup: 'missing-setup.ts',
    };
    expect(() => resolveRoot(root, getDir())).toThrow('missing preload/config');
  });

  it('applies a timeout override only to the matching file', () => {
    writeFixture(getDir(), 'src/slow.test.ts');
    writeFixture(getDir(), 'src/fast.test.ts');
    const root: BunTestRoot = {
      root: 'mixed',
      cwd: '.',
      directories: ['src'],
      timeoutOverrides: [{ pattern: /slow\.test\.ts$/, timeout: 300_000 }],
    };

    const files = resolveRoot(root, getDir());
    const slow = files.find((f) => f.file.endsWith('slow.test.ts'));
    const fast = files.find((f) => f.file.endsWith('fast.test.ts'));

    expect(slow?.timeout).toBe(300_000);
    expect(fast?.timeout).toBeUndefined();
  });

  it('preserves root-level timeout for non-matching files', () => {
    writeFixture(getDir(), 'src/a.test.ts');
    const root: BunTestRoot = {
      root: 'timed',
      cwd: '.',
      directories: ['src'],
      timeout: 60_000,
      timeoutOverrides: [
        { pattern: /never-matches\.test\.ts$/, timeout: 300_000 },
      ],
    };

    const files = resolveRoot(root, getDir());
    expect(files[0]?.timeout).toBe(60_000);
  });

  it('resolves cwd undefined to packages/<root> relative to repoRoot', () => {
    writeFixture(getDir(), 'packages/mypkg/src/a.test.ts');
    const root: BunTestRoot = { root: 'mypkg' };

    const files = resolveRoot(root, getDir());
    expect(files[0]?.cwd).toBe(join(getDir(), 'packages', 'mypkg'));
    expect(files[0]?.file).toBe(join(getDir(), 'packages/mypkg/src/a.test.ts'));
  });

  it('uses a custom pattern when declared', () => {
    writeFixture(getDir(), 'evals/run.eval.ts');
    writeFixture(getDir(), 'evals/regular.test.ts');
    const root: BunTestRoot = {
      root: 'evals-root',
      cwd: '.',
      directories: ['evals'],
      pattern: /\.eval\.ts$/,
    };

    const files = resolveRoot(root, getDir());
    expect(files).toHaveLength(1);
    expect(files[0]?.file).toContain('run.eval.ts');
  });
});

// ---------------------------------------------------------------------------
// resolveBunTestFiles — integration against the real repository
// ---------------------------------------------------------------------------

describe('resolveBunTestFiles (real repository)', () => {
  it('returns an empty array for an unknown root', () => {
    expect(resolveBunTestFiles(repoRoot, 'nonexistent-root')).toEqual([]);
  });

  it('excludes credentialed roots from an unfiltered run', () => {
    const files = resolveBunTestFiles(repoRoot);
    const credentialedRoots = BUN_TEST_ROOTS.filter(
      (r) => r.credentialed === true,
    );
    for (const root of credentialedRoots) {
      const rootCwd = resolveRootCwd(repoRoot, root);
      expect(
        files.every((f) => !f.file.startsWith(rootCwd)),
        `credentialed root "${root.root}" must not appear in unfiltered run`,
      ).toBe(true);
    }
  });

  it('includes a credentialed root when named explicitly', () => {
    const files = resolveBunTestFiles(repoRoot, 'evals');
    expect(files.length).toBeGreaterThan(0);
    const evalsCwd = resolveRootCwd(repoRoot, {
      root: 'evals',
      cwd: 'evals',
    });
    expect(files.every((f) => f.cwd === evalsCwd)).toBe(true);
  });

  it('resolves the real providers root including previously-omitted files', () => {
    const files = resolveBunTestFiles(repoRoot, 'providers');
    const filePaths = files.map((f) => f.file);

    expect(files.length).toBeGreaterThan(540);

    expect(filePaths).toContain(
      join(repoRoot, 'packages/providers/src/utils/reasoningField.test.ts'),
    );
    expect(filePaths).toContain(
      join(
        repoRoot,
        'packages/providers/src/anthropic/AnthropicPromptEnvelopeAuthParity.test.ts',
      ),
    );
  });

  it('resolves the agents root to only test-bun files', () => {
    const files = resolveBunTestFiles(repoRoot, 'agents');
    const agentsCwd = resolveRootCwd(repoRoot, { root: 'agents' });
    for (const file of files) {
      expect(file.file).toContain(join(agentsCwd, 'test-bun'));
    }
  });

  it('resolves every non-credentialed root to at least one file', () => {
    const offlineRoots = BUN_TEST_ROOTS.filter(
      (root) => root.credentialed !== true,
    );
    for (const root of offlineRoots) {
      const files = resolveBunTestFiles(repoRoot, root.root);
      expect(files.length, `root "${root.root}"`).toBeGreaterThan(0);
    }
  });

  it('applies the slow timeout override to the release-install smoke', () => {
    const files = resolveBunTestFiles(repoRoot, 'scripts-tests');
    const slow = files.find((f) =>
      f.file.endsWith('issue-2603-release-install.test.ts'),
    );
    expect(slow).toBeDefined();
    expect(slow?.timeout).toBe(300_000);

    const ordinary = files.find((f) =>
      f.file.endsWith('run_bun_tests.test.ts'),
    );
    expect(ordinary?.timeout).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Error classification (ported from the manifest validation)
// ---------------------------------------------------------------------------

describe('BunTestRootStatError', () => {
  it('exposes path and code from the original error', () => {
    const cause = Object.assign(new Error('permission denied'), {
      code: 'EACCES',
      path: '/cause/path',
    });

    const err = new BunTestRootStatError('/target', 'EACCES', cause);
    expect(err.path).toBe('/target');
    expect(err.code).toBe('EACCES');
    expect(err.cause).toBe(cause);
    expect(err.message).toContain('/target');
    expect(err.message).toContain('EACCES');
  });

  it('handles undefined code gracefully', () => {
    const err = new BunTestRootStatError('/target', undefined, new Error('x'));
    expect(err.code).toBeUndefined();
    expect(err.message).not.toContain('undefined');
  });
});

describe('getErrorCode', () => {
  it('extracts a string code property', () => {
    expect(
      getErrorCode(Object.assign(new Error('e'), { code: 'ENOENT' })),
    ).toBe('ENOENT');
  });

  it('returns undefined for errors without a code', () => {
    expect(getErrorCode(new Error('no code'))).toBeUndefined();
  });

  it('returns undefined for non-objects', () => {
    expect(getErrorCode('string')).toBeUndefined();
    expect(getErrorCode(null)).toBeUndefined();
  });

  it('returns undefined when code is not a string', () => {
    expect(getErrorCode({ code: 42 })).toBeUndefined();
  });
});
