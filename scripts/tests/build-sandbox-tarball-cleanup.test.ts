/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Regression tests for #3334: the sandbox build must clear stale packed
 * tarballs by enumerating the dist directory, not by passing a glob to
 * `rmSync`. `node:fs` does no glob expansion, so the old cleanup was a silent
 * no-op and a version bump left the previous tarball behind, where the
 * Dockerfile `COPY ... *.tgz` glob handed both versions to a single
 * `npm install -g`.
 */

import { afterEach, describe, expect, it } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removeTarballs } from '../utils/tarball-cleanup.ts';

const CORE_PREFIX = 'vybestack-llxprt-code-core';

const fixtureRoots: string[] = [];

function createTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'tarball-cleanup-'));
  fixtureRoots.push(root);
  return root;
}

function createDistDir(files: readonly string[]): string {
  const distDir = join(createTempRoot(), 'dist');
  mkdirSync(distDir);
  for (const name of files) {
    writeFileSync(join(distDir, name), 'packed');
  }
  return distDir;
}

afterEach(() => {
  for (const root of fixtureRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('removeTarballs', () => {
  it('removes every tarball sharing the package prefix, including stale versions', () => {
    const distDir = createDistDir([
      'vybestack-llxprt-code-core-0.0.1.tgz',
      'vybestack-llxprt-code-core-0.11.0.tgz',
    ]);

    removeTarballs(distDir, CORE_PREFIX);

    expect(readdirSync(distDir)).toEqual([]);
  });

  it('preserves other packages tarballs, prefix-boundary names, and non-tarball files', () => {
    const preserved = [
      '.last_build',
      'README.txt',
      'vybestack-llxprt-code-corex-9.9.9.tgz',
      'vybestack-llxprt-code-tools-0.5.0.tgz',
    ];
    const distDir = createDistDir([
      'vybestack-llxprt-code-core-0.0.1.tgz',
      ...preserved,
    ]);

    removeTarballs(distDir, CORE_PREFIX);

    expect([...readdirSync(distDir)].sort()).toEqual(preserved);
  });

  it('is a no-op for an empty dist directory', () => {
    const distDir = createDistDir([]);

    expect(() => removeTarballs(distDir, CORE_PREFIX)).not.toThrow();

    expect(readdirSync(distDir)).toEqual([]);
  });

  it('is a no-op when the dist directory does not exist', () => {
    // Fresh checkout with --skip-npm-install-build: no build has created
    // packages/<pkg>/dist yet. The old force:true cleanup never threw here.
    const distDir = join(createTempRoot(), 'packages', 'core', 'dist');

    expect(() => removeTarballs(distDir, CORE_PREFIX)).not.toThrow();

    expect(existsSync(distDir)).toBe(false);
  });

  it('propagates errors other than a missing dist directory', () => {
    // ENOTDIR: a file sits where the dist directory is expected. Silently
    // swallowing this would hide a broken workspace layout.
    const distDir = join(createTempRoot(), 'dist');
    writeFileSync(distDir, 'not a directory');

    expect(() => removeTarballs(distDir, CORE_PREFIX)).toThrow();
  });
});
