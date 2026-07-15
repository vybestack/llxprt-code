/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  BUN_NATIVE_TEST_MANIFEST,
  BunManifestStatError,
  resolveBunNativeTestFiles,
  resolveWorkspaceCwd,
} from '../bun-test-manifest.js';

const repoRoot = resolve(__dirname, '..', '..');
const temporaryRoots: string[] = [];

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
      expect(entry.files.length, entry.workspace).toBeGreaterThan(0);
      expect(resolveBunNativeTestFiles(repoRoot, entry.workspace)).toHaveLength(
        entry.files.length,
      );
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
      resolveBunNativeTestFiles('/fixture', 'core', {
        stat: () => {
          throw cause;
        },
      }),
    ).toThrow('Bun native test manifest contains missing files');
  });

  it('preserves path, code, and cause for non-ENOENT stat failures', () => {
    const cause = Object.assign(new Error('permission denied'), {
      code: 'EACCES',
      path: '/cause/path',
    });
    let thrown: unknown;

    try {
      resolveBunNativeTestFiles('/fixture', 'core', {
        stat: () => {
          throw cause;
        },
      });
    } catch (error: unknown) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(BunManifestStatError);
    if (!(thrown instanceof BunManifestStatError)) {
      throw new Error('Expected BunManifestStatError');
    }
    expect(thrown.path).toBe('/fixture/packages/core/src/utils/errors.test.ts');
    expect(thrown.code).toBe('EACCES');
    expect(thrown.cause).toBe(cause);
  });

  it('rejects a manifest path that exists but is not a regular file', () => {
    const fixtureRoot = join(
      tmpdir(),
      `bun-test-manifest-directory-${process.pid}-${Date.now()}`,
    );
    temporaryRoots.push(fixtureRoot);
    mkdirSync(join(fixtureRoot, 'packages/core/src/utils/errors.test.ts'), {
      recursive: true,
    });

    expect(() => resolveBunNativeTestFiles(fixtureRoot, 'core')).toThrow(
      'Bun native test manifest contains non-files',
    );
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
